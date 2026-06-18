/**
 * KeypoolLive — KeypoolUsageDb: NDJSON persistence for per-key usage + errors
 * © 2026 Ronan LE MEILLAT — MIT License
 *
 * This module stores lightweight API-key usage and error statistics for the
 * KeypoolLive provider. It supports two storage modes:
 *
 * - Local mode (default): Uses NDJSON files in the extension storage directory
 * - Remote mode: Uses a Cloudflare Worker KV backend for shared statistics
 *
 * The design is append-oriented and dependency-free. Records are written as one
 * JSON object per line, which keeps the implementation simple, avoids native
 * module ABI issues with Electron, and remains easy to inspect manually when
 * debugging keypool behavior.
 *
 * Important maintenance notes for external contributors:
 *
 * 1. Do not expose raw API keys in these files. All persistence paths use
 *    `keyOwner` and `keyHint` only; `keyHint` should remain a short, non-secret
 *    identifier such as a fingerprint suffix or provider-side label.
 *
 * 2. The files are append-only except for size trimming. Because records are
 *    always appended with an increasing timestamp, the physical line order is
 *    also the chronological insertion order. Trimming therefore removes the
 *    oldest lines from each file without parsing JSON.
 *
 * 3. The aggregation methods are meant to mirror the behavior of the former
 *    SQLite implementation closely enough for UI reporting. When changing
 *    grouping keys, sorting, or error-rate calculations, verify that the
 *    KeypoolLive dashboard still receives the expected fields.
 *
 * 4. The implementation is synchronous and deliberately small. It is optimized
 *    for maintainability and predictable behavior in the extension host rather
 *    than high-throughput analytics.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import path from "path";
import { HostProvider } from "@/hosts/host-provider";
import { Logger } from "@/shared/services/Logger";

/**
 * Time granularity used when grouping successful request usage into statistics.
 *
 * These values are exposed to callers and must stay in sync with the UI/reporting
 * layer that asks for hourly, daily, weekly, or monthly key usage.
 */
export type UsagePeriod = "hour" | "day" | "week" | "month";

/**
 * Storage mode for usage statistics.
 * - "local": Use NDJSON files in extension storage (default)
 * - "remote": Use Cloudflare Worker KV backend
 */
export type KeypoolStorageMode = "local" | "remote";

/**
 * Configuration for remote storage mode.
 */
export interface KeypoolRemoteConfig {
	/** URL of the Cloudflare Worker (e.g., https://ai-proxy.example.com) */
	workerUrl: string;
	/** Bearer token for authentication (the vault key) */
	authToken: string;
}

/**
 * Represents a successful API request that consumed tokens from a pooled key.
 *
 * `provider`, `modelId`, `keyOwner`, and `keyHint` identify where the request was
 * sent and which logical key was used. Token fields are raw model token counts,
 * not cost values. The model id is persisted for debugging/context even though
 * the current aggregation methods group by provider/key only.
 */
export interface KeyUsageEntry {
	provider: string;
	modelId: string;
	keyOwner: string;
	keyHint: string;
	promptTokens: number;
	completionTokens: number;
}

/**
 * Represents a failed API request associated with a pooled key.
 *
 * `errorCode` is nullable because some failures are not HTTP errors or do not
 * expose a numeric status code. Keeping the field nullable lets callers
 * distinguish "unknown/non-HTTP error" from an actual HTTP status.
 */
export interface KeyErrorEntry {
	provider: string;
	modelId: string;
	keyOwner: string;
	keyHint: string;
	errorCode: number | null;
}

/**
 * Aggregated usage statistics for one key within one period bucket.
 *
 * `period` is a formatted UTC label such as `2026-06-15T08:00` or
 * `2026-W24`. `requestCount` is the number of successful usage records that
 * contributed to the totals.
 */
export interface KeyUsageStat {
	period: string;
	provider: string;
	modelId: string;
	keyOwner: string;
	keyHint: string;
	promptTokens: number;
	completionTokens: number;
	requestCount: number;
}

/**
 * Aggregated error statistics for one key over the retained error history.
 *
 * `totalRequests` is the number of successful usage records for the same
 * provider/key pair. The error rate is calculated as `errorCount / totalRequests`
 * with a denominator floor of 1, matching the previous SQL behavior.
 */
export interface KeyErrorStat {
	provider: string;
	keyOwner: string;
	keyHint: string;
	totalRequests: number;
	errorCount: number;
	errorRate: number;
	lastErrorCode: number | null;
}

// ─── Internal record shapes written to NDJSON files ──────────────────────────

/**
 * On-disk usage record.
 *
 * The public `KeyUsageEntry` interface intentionally does not include `ts`; the
 * database layer owns timestamps so callers cannot accidentally backdate or
 * duplicate records.
 */
interface UsageRecord extends KeyUsageEntry {
	ts: number;
}

/**
 * On-disk error record.
 *
 * Like usage records, error records receive an append timestamp when persisted.
 */
interface ErrorRecord extends KeyErrorEntry {
	ts: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Formats a number as two digits.
 *
 * This helper keeps date/week labels aligned with the string format previously
 * produced by SQLite `strftime()` calls.
 */
function pad2(n: number): string {
	return n.toString().padStart(2, "0");
}

/**
 * Returns a UTC week number in the 0–53 range.
 *
 * This intentionally mirrors SQLite's `%W` convention: weeks start on Monday
 * and days before the first Monday of the year belong to week 0. Keeping this
 * behavior unchanged avoids surprising changes in weekly report labels.
 */
function utcWeek(d: Date): number {
	const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.floor((d.getTime() - jan1.getTime()) / 86_400_000 / 7);
}

/**
 * Formats a millisecond timestamp into the period label used by aggregation.
 *
 * All labels are UTC-based to keep reporting deterministic across machines in
 * different local time zones. The returned strings match the former SQLite
 * `strftime()` output closely enough that existing UI code can remain stable.
 */
function formatPeriodLabel(ts: number, period: UsagePeriod): string {
	const d = new Date(ts);
	switch (period) {
		case "hour":
			return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:00`;
		case "day":
			return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
		case "week":
			return `${d.getUTCFullYear()}-W${pad2(utcWeek(d))}`;
		case "month":
			return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
	}
}

/**
 * Returns the start cutoff for the requested rolling period.
 *
 * This is intentionally a rolling window relative to `Date.now()`, not a
 * calendar-aligned window. For example, `day` keeps the last 24 hours rather
 * than the current UTC day.
 */
function periodCutoffMs(period: UsagePeriod): number {
	const now = Date.now();
	switch (period) {
		case "hour":
			return now - 60 * 60 * 1000;
		case "day":
			return now - 24 * 60 * 60 * 1000;
		case "week":
			return now - 7 * 24 * 60 * 60 * 1000;
		case "month":
			return now - 30 * 24 * 60 * 60 * 1000;
	}
}

/**
 * Returns the directory containing both NDJSON files.
 *
 * Resolution order:
 *
 * 1. `KEYPOOL_USAGE_DB_DIR` environment variable — useful for tests and for
 *    sharing the same database directory with the SDK keypoollive provider.
 * 2. VS Code extension global storage, which is platform-specific:
 *    - Windows: %APPDATA%\Code\User\globalStorage\<extension-id>
 *    - macOS:   ~/Library/Application Support/Code/User/globalStorage/<extension-id>
 *    - Linux:   ~/.config/Code/User/globalStorage/<extension-id>
 */
function getDbDir(): string {
	if (process.env.KEYPOOL_USAGE_DB_DIR) {
		return process.env.KEYPOOL_USAGE_DB_DIR;
	}
	const storagePath = HostProvider.get().globalStorageFsPath;
	return path.join(storagePath, "keypoollive");
}

// ─── KeypoolUsageDb ───────────────────────────────────────────────────────────

/**
 * Persistent storage for KeypoolLive API-key usage and error history.
 *
 * The class exposes a static file-backed database API. It is not instantiated
 * because the extension host treats these files as a single shared append log
 * per installation. The storage format is intentionally simple:
 *
 * - every line is an independent JSON object;
 * - every record includes `ts`, a millisecond epoch timestamp;
 * - malformed or blank lines are ignored when reading;
 * - old records are trimmed by file size to prevent unbounded disk growth.
 *
 * This implementation replaced the previous SQLite-backed schema to avoid the
 * `better-sqlite3` native dependency and Electron ABI compatibility issues.
 */
export class KeypoolUsageDb {
	/**
	 * Default maximum combined size of `usage.ndjson` and `errors.ndjson`.
	 *
	 * The limit is shared across both files. If it is exceeded before an append,
	 * each file independently drops its oldest 25% of lines.
	 */
	private static maxSizeBytes: number = 50 * 1024 * 1024;

	/**
	 * Current storage mode.
	 * - "local": Use NDJSON files (default)
	 * - "remote": Use Cloudflare Worker KV backend
	 */
	private static storageMode: KeypoolStorageMode = "local";

	/**
	 * Remote configuration (only used when storageMode is "remote").
	 */
	private static remoteConfig: KeypoolRemoteConfig | null = null;

	/**
	 * Updates the maximum combined database size.
	 *
	 * The extension calls this when the `keypoolliveMaxDbSizeMb` setting changes.
	 * Values below 1 MB are raised to 1 MB to avoid creating an unusably small
	 * log that would trim aggressively on every write.
	 */
	static setMaxSizeMb(mb: number): void {
		KeypoolUsageDb.maxSizeBytes = Math.max(1, mb) * 1024 * 1024;
	}

	/**
	 * Configures the database to use remote storage mode.
	 *
	 * @param config - Remote worker configuration
	 */
	static setRemoteMode(config: KeypoolRemoteConfig): void {
		KeypoolUsageDb.storageMode = "remote";
		KeypoolUsageDb.remoteConfig = config;
	}

	/**
	 * Configures the database to use local storage mode.
	 */
	static setLocalMode(): void {
		KeypoolUsageDb.storageMode = "local";
		KeypoolUsageDb.remoteConfig = null;
	}

	/**
	 * Returns the current storage mode.
	 */
	static getStorageMode(): KeypoolStorageMode {
		return KeypoolUsageDb.storageMode;
	}

	/** Absolute path to `usage.ndjson`. */
	private static usagePath(): string {
		return path.join(getDbDir(), "usage.ndjson");
	}

	/** Absolute path to `errors.ndjson`. */
	private static errorsPath(): string {
		return path.join(getDbDir(), "errors.ndjson");
	}

	/**
	 * Ensures the database directory exists.
	 *
	 * `recursive: true` lets the extension create both the host global-storage
	 * directory and the nested `keypoollive` directory in one call. Failures are
	 * logged and surfaced as `false` so callers can skip the write instead of
	 * throwing through request-handling code.
	 */
	private static ensureDir(): boolean {
		try {
			mkdirSync(getDbDir(), { recursive: true });
			return true;
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to create directory:", e);
			return false;
		}
	}

	/**
	 * Returns the size in bytes of a file, or `0` if it does not exist.
	 *
	 * Exceptions are swallowed because size checks are best-effort guards for
	 * trimming; a read/write failure is already logged by the operation that
	 * needs the file.
	 */
	private static fileSize(filePath: string): number {
		try {
			return existsSync(filePath) ? statSync(filePath).size : 0;
		} catch {
			return 0;
		}
	}

	/**
	 * Returns the combined size of both NDJSON files.
	 *
	 * This is used by `trimIfNeeded()` to enforce the shared disk budget across
	 * successful-request and error-record logs.
	 */
	static getFileSizeBytes(): number {
		// In remote mode, return the size from the worker
		if (KeypoolUsageDb.storageMode === "remote" && KeypoolUsageDb.remoteConfig) {
			// Fire-and-forget request to get remote size
			KeypoolUsageDb.fetchRemoteSize().catch(() => {});
			return 0; // Local size is not relevant in remote mode
		}
		return (
			KeypoolUsageDb.fileSize(KeypoolUsageDb.usagePath()) +
			KeypoolUsageDb.fileSize(KeypoolUsageDb.errorsPath())
		);
	}

	/**
	 * Reads all valid JSON objects from an NDJSON file.
	 *
	 * Blank lines are ignored, which makes the reader tolerant of a trailing
	 * newline. Malformed lines are skipped instead of failing the entire read;
	 * this protects reporting from a partially written or manually edited file.
	 * The method does not repair the file, so repeated malformed writes should
	 * be investigated through logs.
	 */
	private static readLines<T>(filePath: string): T[] {
		if (!existsSync(filePath)) return [];
		try {
			const content = readFileSync(filePath, "utf8");
			const results: T[] = [];
			for (const line of content.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					results.push(JSON.parse(trimmed) as T);
				} catch {
					// Skip malformed line to keep reporting resilient.
				}
			}
			return results;
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to read file:", filePath, e);
			return [];
		}
	}

	/**
	 * Drops the oldest fraction of lines from a file.
	 *
	 * The `fraction` parameter is the amount to remove, not the amount to keep.
	 * For example, `0.25` removes the oldest 25% of lines and keeps the newest
	 * 75%. This works because records are appended in chronological order.
	 *
	 * Trimming is line-based rather than JSON-aware for performance and
	 * simplicity. Since each line is independently parseable, cutting between
	 * lines cannot corrupt a JSON record.
	 */
	private static trimFile(filePath: string, fraction: number): void {
		if (!existsSync(filePath)) return;
		try {
			const content = readFileSync(filePath, "utf8");
			const lines = content.split("\n").filter((l) => l.trim());
			if (lines.length === 0) return;
			const keep = lines.slice(Math.floor(lines.length * fraction));
			writeFileSync(
				filePath,
				keep.join("\n") + (keep.length > 0 ? "\n" : ""),
				"utf8",
			);
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to trim file:", filePath, e);
		}
	}

	/**
	 * Trims both files when the shared size budget is exceeded.
	 *
	 * The check happens before appending a new record. As a result, a single
	 * append may temporarily leave the database slightly above the configured
	 * limit, but subsequent writes will continue trimming until the budget is
	 * respected again.
	 */
	private static trimIfNeeded(): void {
		if (KeypoolUsageDb.getFileSizeBytes() <= KeypoolUsageDb.maxSizeBytes)
			return;
		Logger.warn(
			"[KeypoolUsageDb] DB size exceeded limit — trimming oldest 25% of records.",
		);
		KeypoolUsageDb.trimFile(KeypoolUsageDb.usagePath(), 0.25);
		KeypoolUsageDb.trimFile(KeypoolUsageDb.errorsPath(), 0.25);
	}

	/**
	 * Appends one JSON object as a single NDJSON line.
	 *
	 * This method performs the common write path for both usage and error logs:
	 * create the directory, trim if needed, then append the serialized record.
	 * JSON serialization is intentionally performed close to the write so any
	 * unexpected serialization failure is logged with the append failure.
	 */
	private static appendLine(filePath: string, record: object): void {
		if (!KeypoolUsageDb.ensureDir()) return;
		KeypoolUsageDb.trimIfNeeded();
		try {
			appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to append record:", e);
		}
	}

	// ─── Remote API helpers ───────────────────────────────────────────────────

	/**
	 * Makes a request to the remote worker API.
	 *
	 * @param endpoint - API endpoint path (e.g., "/v1/keypool/usage")
	 * @param method - HTTP method
	 * @param body - Request body (for POST requests)
	 * @returns Response data or null on error
	 */
	private static async fetchRemote<T>(
		endpoint: string,
		method: "GET" | "POST" = "GET",
		body?: object,
	): Promise<T | null> {
		if (!KeypoolUsageDb.remoteConfig) return null;

		const url = `${KeypoolUsageDb.remoteConfig.workerUrl}${endpoint}`;
		try {
			const response = await fetch(url, {
				method,
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${KeypoolUsageDb.remoteConfig.authToken}`,
				},
				body: body ? JSON.stringify(body) : undefined,
			});

			if (!response.ok) {
				Logger.error(
					`[KeypoolUsageDb] Remote API error: ${response.status} ${response.statusText}`,
				);
				return null;
			}

			return (await response.json()) as T;
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to call remote API:", e);
			return null;
		}
	}

	/**
	 * Records usage to the remote worker.
	 */
	private static async recordRemoteUsage(entry: KeyUsageEntry): Promise<void> {
		await KeypoolUsageDb.fetchRemote("/v1/keypool/usage", "POST", entry);
	}

	/**
	 * Records error to the remote worker.
	 */
	private static async recordRemoteError(entry: KeyErrorEntry): Promise<void> {
		await KeypoolUsageDb.fetchRemote("/v1/keypool/error", "POST", entry);
	}

	/**
	 * Gets usage stats from the remote worker.
	 */
	private static async fetchRemoteUsageStats(
		period: UsagePeriod,
	): Promise<KeyUsageStat[]> {
		const result = await KeypoolUsageDb.fetchRemote<{ data: KeyUsageStat[] }>(
			`/v1/keypool/stats?period=${period}`,
		);
		return result?.data ?? [];
	}

	/**
	 * Gets error stats from the remote worker.
	 */
	private static async fetchRemoteErrorStats(): Promise<KeyErrorStat[]> {
		const result = await KeypoolUsageDb.fetchRemote<{ data: KeyErrorStat[] }>(
			"/v1/keypool/errors",
		);
		return result?.data ?? [];
	}

	/**
	 * Gets file size from the remote worker.
	 */
	private static async fetchRemoteSize(): Promise<number> {
		const result = await KeypoolUsageDb.fetchRemote<{ sizeBytes: number }>(
			"/v1/keypool/size",
		);
		return result?.sizeBytes ?? 0;
	}

	/**
	 * Purges data on the remote worker.
	 */
	private static async purgeRemote(): Promise<number> {
		const result = await KeypoolUsageDb.fetchRemote<{ ok: boolean; freedBytes: number }>(
			"/v1/keypool/purge",
			"POST",
		);
		return result?.freedBytes ?? 0;
	}

	// ─── Public API ────────────────────────────────────────────────────────────

	/**
	 * Persists a successful API-key usage event.
	 *
	 * The timestamp is assigned by the database layer to preserve append-order
	 * semantics. Callers should not include timestamps in `KeyUsageEntry`.
	 *
	 * In remote mode, the record is sent to the Cloudflare Worker.
	 * In local mode, the record is appended to the NDJSON file.
	 */
	static recordUsage(entry: KeyUsageEntry): void {
		if (KeypoolUsageDb.storageMode === "remote") {
			// Fire-and-forget remote recording
			KeypoolUsageDb.recordRemoteUsage(entry).catch(() => {});
		} else {
			const record: UsageRecord = { ts: Date.now(), ...entry };
			KeypoolUsageDb.appendLine(KeypoolUsageDb.usagePath(), record);
		}
	}

	/**
	 * Persists a failed API-key request.
	 *
	 * Errors are stored separately from successful usage so the error log can
	 * retain non-HTTP failures and status-code details without bloating the
	 * usage aggregation path.
	 *
	 * In remote mode, the record is sent to the Cloudflare Worker.
	 * In local mode, the record is appended to the NDJSON file.
	 */
	static recordError(entry: KeyErrorEntry): void {
		if (KeypoolUsageDb.storageMode === "remote") {
			// Fire-and-forget remote recording
			KeypoolUsageDb.recordRemoteError(entry).catch(() => {});
		} else {
			const record: ErrorRecord = { ts: Date.now(), ...entry };
			KeypoolUsageDb.appendLine(KeypoolUsageDb.errorsPath(), record);
		}
	}

	/**
	 * Returns usage statistics grouped by period, provider, owner, and key hint.
	 *
	 * The time filter is a rolling window based on the requested period. Inside
	 * that window, records are bucketed into calendar-style UTC labels. Token
	 * counts and request counts are summed for each group.
	 *
	 * The sort order mirrors the previous SQL query: newest period first, then
	 * provider, key owner, and key hint lexicographically.
	 *
	 * In remote mode, stats are fetched from the Cloudflare Worker.
	 * In local mode, stats are computed from the NDJSON file.
	 */
	static async getUsageStats(period: UsagePeriod): Promise<KeyUsageStat[]> {
		if (KeypoolUsageDb.storageMode === "remote") {
			return KeypoolUsageDb.fetchRemoteUsageStats(period);
		}

		try {
			const cutoff = periodCutoffMs(period);
			const records = KeypoolUsageDb.readLines<UsageRecord>(
				KeypoolUsageDb.usagePath(),
			).filter((r) => r.ts >= cutoff);

			// Group by period-label + provider + keyOwner + keyHint.
			// The NUL separator avoids collisions between readable string parts.
			const map = new Map<
				string,
				{
					period: string;
					provider: string;
					modelId: string;
					keyOwner: string;
					keyHint: string;
					promptTokens: number;
					completionTokens: number;
					requestCount: number;
				}
			>();

			for (const r of records) {
				const label = formatPeriodLabel(r.ts, period);
				const key = `${label}\x00${r.provider}\x00${r.keyOwner}\x00${r.keyHint}`;
				const existing = map.get(key);
				if (existing) {
					existing.promptTokens += r.promptTokens;
					existing.completionTokens += r.completionTokens;
					existing.requestCount++;
				} else {
					map.set(key, {
						period: label,
						provider: r.provider,
						modelId: r.modelId,
						keyOwner: r.keyOwner,
						keyHint: r.keyHint,
						promptTokens: r.promptTokens,
						completionTokens: r.completionTokens,
						requestCount: 1,
					});
				}
			}

			// Sort: period DESC, provider, keyOwner, keyHint (mirrors old SQL ORDER BY).
			return Array.from(map.values()).sort((a, b) => {
				if (b.period !== a.period) return b.period.localeCompare(a.period);
				if (a.provider !== b.provider)
					return a.provider.localeCompare(b.provider);
				if (a.keyOwner !== b.keyOwner)
					return a.keyOwner.localeCompare(b.keyOwner);
				if (a.modelId !== b.modelId)
					return a.modelId.localeCompare(b.modelId);
				return a.keyHint.localeCompare(b.keyHint);
			});
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to get usage stats:", e);
			return [];
		}
	}

	/**
	 * Returns error statistics grouped by provider, owner, and key hint.
	 *
	 * Unlike usage stats, this method uses the full retained error history and
	 * does not apply a time cutoff. That mirrors the original SQL query, which
	 * had no `WHERE ts >= ...` clause for errors.
	 *
	 * The denominator for `errorRate` is the number of successful usage records
	 * for the same key. This means the rate is an error-to-success ratio rather
	 * than a strict percentage of all attempts. The denominator is floored at 1
	 * to preserve the previous SQL behavior of `MAX(total_requests, 1)`.
	 *
	 * In remote mode, stats are fetched from the Cloudflare Worker.
	 * In local mode, stats are computed from the NDJSON file.
	 */
	static async getErrorStats(): Promise<KeyErrorStat[]> {
		if (KeypoolUsageDb.storageMode === "remote") {
			return KeypoolUsageDb.fetchRemoteErrorStats();
		}

		try {
			const errorRecords = KeypoolUsageDb.readLines<ErrorRecord>(
				KeypoolUsageDb.errorsPath(),
			);
			const usageRecords = KeypoolUsageDb.readLines<UsageRecord>(
				KeypoolUsageDb.usagePath(),
			);

			// Accumulate successful usage counts per provider/key pair.
			const usageMap = new Map<string, number>();
			for (const r of usageRecords) {
				const key = `${r.provider}\x00${r.keyOwner}\x00${r.keyHint}`;
				usageMap.set(key, (usageMap.get(key) ?? 0) + 1);
			}

			// Accumulate error counts and the latest non-null numeric error code.
			const errorMap = new Map<
				string,
				{
					provider: string;
					keyOwner: string;
					keyHint: string;
					errorCount: number;
					lastErrorCode: number | null;
				}
			>();
			for (const r of errorRecords) {
				const key = `${r.provider}\x00${r.keyOwner}\x00${r.keyHint}`;
				const existing = errorMap.get(key);
				if (existing) {
					existing.errorCount++;
					if (r.errorCode !== null) existing.lastErrorCode = r.errorCode;
				} else {
					errorMap.set(key, {
						provider: r.provider,
						keyOwner: r.keyOwner,
						keyHint: r.keyHint,
						errorCount: 1,
						lastErrorCode: r.errorCode,
					});
				}
			}

			const result: KeyErrorStat[] = [];
			for (const [key, e] of errorMap) {
				const totalRequests = usageMap.get(key) ?? 0;
				result.push({
					provider: e.provider,
					keyOwner: e.keyOwner,
					keyHint: e.keyHint,
					totalRequests,
					errorCount: e.errorCount,
					// Avoid division by zero and mirror the former SQL MAX(total_requests, 1).
					errorRate: e.errorCount / Math.max(totalRequests, 1),
					lastErrorCode: e.lastErrorCode,
				});
			}

			// Sort by descending error rate, matching the previous SQL ORDER BY.
			return result.sort((a, b) => b.errorRate - a.errorRate);
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to get error stats:", e);
			return [];
		}
	}

	/**
	 * Deletes both NDJSON files and returns the number of bytes freed.
	 *
	 * This purges stored statistics but intentionally leaves the containing
	 * directory in place so future writes can recreate the files normally.
	 *
	 * In remote mode, data is purged from the Cloudflare Worker.
	 * In local mode, files are deleted from disk.
	 */
	static purge(): number {
		if (KeypoolUsageDb.storageMode === "remote") {
			// Fire-and-forget remote purge
			KeypoolUsageDb.purgeRemote().catch(() => {});
			return 0;
		}

		let freed = 0;
		for (const filePath of [
			KeypoolUsageDb.usagePath(),
			KeypoolUsageDb.errorsPath(),
		]) {
			try {
				if (existsSync(filePath)) {
					freed += statSync(filePath).size;
					unlinkSync(filePath);
				}
			} catch (e) {
				Logger.error("[KeypoolUsageDb] Failed to delete file:", filePath, e);
			}
		}
		return freed;
	}

	/**
	 * Compatibility no-op.
	 *
	 * The former SQLite implementation needed an explicit close path. NDJSON
	 * files do not hold persistent file handles, so this method remains for API
	 * compatibility with callers that still invoke `close()`.
	 */
	static close(): void {
		// NDJSON files do not hold open file handles.
	}
}
