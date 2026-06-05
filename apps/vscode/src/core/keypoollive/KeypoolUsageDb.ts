// KeypoolLive — KeypoolUsageDb: NDJSON persistence for per-key usage + errors
// © 2026 Ronan LE MEILLAT — MIT License

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"

/**
 * Defines the time granularity for usage statistics.
 */
export type UsagePeriod = "hour" | "day" | "week" | "month"

/**
 * Represents a single usage event (typically one successful request).
 */
export interface KeyUsageEntry {
	provider: string
	modelId: string
	keyOwner: string
	keyHint: string
	promptTokens: number
	completionTokens: number
}

/**
 * Represents a single error event recorded for an API key.
 */
export interface KeyErrorEntry {
	provider: string
	modelId: string
	keyOwner: string
	keyHint: string
	errorCode: number | null
}

/**
 * Aggregated usage statistics for a specific key within a time period.
 */
export interface KeyUsageStat {
	period: string
	provider: string
	keyOwner: string
	keyHint: string
	promptTokens: number
	completionTokens: number
	requestCount: number
}

/**
 * Aggregated error statistics for a specific key, including calculated error rates.
 */
export interface KeyErrorStat {
	provider: string
	keyOwner: string
	keyHint: string
	totalRequests: number
	errorCount: number
	errorRate: number
	lastErrorCode: number | null
}

// ─── Internal record shapes written to NDJSON files ──────────────────────────

interface UsageRecord extends KeyUsageEntry {
	ts: number
}

interface ErrorRecord extends KeyErrorEntry {
	ts: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad2(n: number): string {
	return n.toString().padStart(2, "0")
}

/** Returns a UTC week number (0–53) matching SQLite's %W. */
function utcWeek(d: Date): number {
	const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
	return Math.floor((d.getTime() - jan1.getTime()) / 86_400_000 / 7)
}

/** Formats a timestamp into the period label that matches the old SQLite strftime output. */
function formatPeriodLabel(ts: number, period: UsagePeriod): string {
	const d = new Date(ts)
	switch (period) {
		case "hour":
			return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:00`
		case "day":
			return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
		case "week":
			return `${d.getUTCFullYear()}-W${pad2(utcWeek(d))}`
		case "month":
			return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`
	}
}

/**
 * Returns the cutoff timestamp (ms) for the given period relative to now.
 */
function periodCutoffMs(period: UsagePeriod): number {
	const now = Date.now()
	switch (period) {
		case "hour":
			return now - 60 * 60 * 1000
		case "day":
			return now - 24 * 60 * 60 * 1000
		case "week":
			return now - 7 * 24 * 60 * 60 * 1000
		case "month":
			return now - 30 * 24 * 60 * 60 * 1000
	}
}

/** 
 * Returns the directory containing both NDJSON files. 
 * 
 * Location:
 * On Windows: C:\Users\<User>\AppData\Roaming\Code\User\globalStorage\<extension-id>
 * On macOS: ~/Library/Application Support/Code/User/globalStorage/<extension-id>
 * On Linux: ~/.config/Code/User/globalStorage/<extension-id>
 * */
function getDbDir(): string {
	const storagePath = HostProvider.get().globalStorageFsPath
	return path.join(storagePath, "keypoollive")
}

// ─── KeypoolUsageDb ───────────────────────────────────────────────────────────

/**
 * Handles persistent storage of API key usage and error history using
 * newline-delimited JSON (NDJSON) files. Each line in the file is one
 * JSON object with a `ts` (millisecond timestamp) field. This avoids the
 * native module dependency on better-sqlite3, which is incompatible with
 * recent Electron ABI versions.
 *
 * Two files are maintained:
 *   - `usage.ndjson`  — one line per successful request
 *   - `errors.ndjson` — one line per error event
 *
 * When the combined size of both files exceeds `maxSizeMb`, the oldest 25 %
 * of lines are trimmed from each file before the next write.
 */
export class KeypoolUsageDb {
	/** Default maximum combined size of both NDJSON files (bytes). */
	private static maxSizeBytes: number = 50 * 1024 * 1024

	/**
	 * Override the maximum combined file size.  Called by the extension host
	 * whenever the `keypoolliveMaxDbSizeMb` setting changes.
	 */
	static setMaxSizeMb(mb: number): void {
		KeypoolUsageDb.maxSizeBytes = Math.max(1, mb) * 1024 * 1024
	}

	/** Absolute path to usage.ndjson. */
	private static usagePath(): string {
		return path.join(getDbDir(), "usage.ndjson")
	}

	/** Absolute path to errors.ndjson. */
	private static errorsPath(): string {
		return path.join(getDbDir(), "errors.ndjson")
	}

	/** Ensures the storage directory exists. Returns false on failure. */
	private static ensureDir(): boolean {
		try {
			mkdirSync(getDbDir(), { recursive: true })
			return true
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to create directory:", e)
			return false
		}
	}

	/** Returns the size in bytes of a file, or 0 if it does not exist. */
	private static fileSize(filePath: string): number {
		try {
			return existsSync(filePath) ? statSync(filePath).size : 0
		} catch {
			return 0
		}
	}

	/** Returns the combined size of both NDJSON files in bytes. */
	static getFileSizeBytes(): number {
		return KeypoolUsageDb.fileSize(KeypoolUsageDb.usagePath()) + KeypoolUsageDb.fileSize(KeypoolUsageDb.errorsPath())
	}

	/**
	 * Reads all valid JSON lines from an NDJSON file.
	 * Silently skips blank or malformed lines.
	 */
	private static readLines<T>(filePath: string): T[] {
		if (!existsSync(filePath)) return []
		try {
			const content = readFileSync(filePath, "utf8")
			const results: T[] = []
			for (const line of content.split("\n")) {
				const trimmed = line.trim()
				if (!trimmed) continue
				try {
					results.push(JSON.parse(trimmed) as T)
				} catch {
					// skip malformed line
				}
			}
			return results
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to read file:", filePath, e)
			return []
		}
	}

	/**
	 * Trims the oldest `fraction` of lines from a file (by line order, which
	 * equals insertion/time order since records are always appended).
	 */
	private static trimFile(filePath: string, fraction: number): void {
		if (!existsSync(filePath)) return
		try {
			const content = readFileSync(filePath, "utf8")
			const lines = content.split("\n").filter((l) => l.trim())
			if (lines.length === 0) return
			const keep = lines.slice(Math.floor(lines.length * fraction))
			writeFileSync(filePath, keep.join("\n") + (keep.length > 0 ? "\n" : ""), "utf8")
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to trim file:", filePath, e)
		}
	}

	/**
	 * Checks combined file size and trims the oldest 25 % of each file if the
	 * combined size exceeds the configured maximum.
	 */
	private static trimIfNeeded(): void {
		if (KeypoolUsageDb.getFileSizeBytes() <= KeypoolUsageDb.maxSizeBytes) return
		Logger.warn("[KeypoolUsageDb] DB size exceeded limit — trimming oldest 25% of records.")
		KeypoolUsageDb.trimFile(KeypoolUsageDb.usagePath(), 0.25)
		KeypoolUsageDb.trimFile(KeypoolUsageDb.errorsPath(), 0.25)
	}

	/**
	 * Appends a single JSON record as one NDJSON line.
	 */
	private static appendLine(filePath: string, record: object): void {
		if (!KeypoolUsageDb.ensureDir()) return
		KeypoolUsageDb.trimIfNeeded()
		try {
			appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8")
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to append record:", e)
		}
	}

	// ─── Public API ────────────────────────────────────────────────────────────

	/**
	 * Persists a new usage entry.
	 */
	static recordUsage(entry: KeyUsageEntry): void {
		const record: UsageRecord = { ts: Date.now(), ...entry }
		KeypoolUsageDb.appendLine(KeypoolUsageDb.usagePath(), record)
	}

	/**
	 * Persists a new error entry.
	 */
	static recordError(entry: KeyErrorEntry): void {
		const record: ErrorRecord = { ts: Date.now(), ...entry }
		KeypoolUsageDb.appendLine(KeypoolUsageDb.errorsPath(), record)
	}

	/**
	 * Retrieves aggregated usage statistics for the specified period.
	 */
	static getUsageStats(period: UsagePeriod): KeyUsageStat[] {
		try {
			const cutoff = periodCutoffMs(period)
			const records = KeypoolUsageDb.readLines<UsageRecord>(KeypoolUsageDb.usagePath()).filter((r) => r.ts >= cutoff)

			// Group by period-label + provider + keyOwner + keyHint
			const map = new Map<
				string,
				{ period: string; provider: string; keyOwner: string; keyHint: string; promptTokens: number; completionTokens: number; requestCount: number }
			>()

			for (const r of records) {
				const label = formatPeriodLabel(r.ts, period)
				const key = `${label}\x00${r.provider}\x00${r.keyOwner}\x00${r.keyHint}`
				const existing = map.get(key)
				if (existing) {
					existing.promptTokens += r.promptTokens
					existing.completionTokens += r.completionTokens
					existing.requestCount++
				} else {
					map.set(key, {
						period: label,
						provider: r.provider,
						keyOwner: r.keyOwner,
						keyHint: r.keyHint,
						promptTokens: r.promptTokens,
						completionTokens: r.completionTokens,
						requestCount: 1,
					})
				}
			}

			// Sort: period DESC, provider, keyOwner, keyHint (mirrors old SQL ORDER BY)
			return Array.from(map.values()).sort((a, b) => {
				if (b.period !== a.period) return b.period.localeCompare(a.period)
				if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
				if (a.keyOwner !== b.keyOwner) return a.keyOwner.localeCompare(b.keyOwner)
				return a.keyHint.localeCompare(b.keyHint)
			})
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to get usage stats:", e)
			return []
		}
	}

	/**
	 * Retrieves aggregated error statistics for all keys (full history, no time
	 * filter — mirrors the original SQL query that had no WHERE clause on ts).
	 */
	static getErrorStats(): KeyErrorStat[] {
		try {
			const errorRecords = KeypoolUsageDb.readLines<ErrorRecord>(KeypoolUsageDb.errorsPath())
			const usageRecords = KeypoolUsageDb.readLines<UsageRecord>(KeypoolUsageDb.usagePath())

			// Accumulate usage counts per key
			const usageMap = new Map<string, number>()
			for (const r of usageRecords) {
				const key = `${r.provider}\x00${r.keyOwner}\x00${r.keyHint}`
				usageMap.set(key, (usageMap.get(key) ?? 0) + 1)
			}

			// Accumulate error counts per key
			const errorMap = new Map<
				string,
				{ provider: string; keyOwner: string; keyHint: string; errorCount: number; lastErrorCode: number | null }
			>()
			for (const r of errorRecords) {
				const key = `${r.provider}\x00${r.keyOwner}\x00${r.keyHint}`
				const existing = errorMap.get(key)
				if (existing) {
					existing.errorCount++
					if (r.errorCode !== null) existing.lastErrorCode = r.errorCode
				} else {
					errorMap.set(key, {
						provider: r.provider,
						keyOwner: r.keyOwner,
						keyHint: r.keyHint,
						errorCount: 1,
						lastErrorCode: r.errorCode,
					})
				}
			}

			const result: KeyErrorStat[] = []
			for (const [key, e] of errorMap) {
				const totalRequests = usageMap.get(key) ?? 0
				result.push({
					provider: e.provider,
					keyOwner: e.keyOwner,
					keyHint: e.keyHint,
					totalRequests,
					errorCount: e.errorCount,
					// Avoid division by zero — mirror: MAX(total_requests, 1)
					errorRate: e.errorCount / Math.max(totalRequests, 1),
					lastErrorCode: e.lastErrorCode,
				})
			}

			// Sort by descending error rate (mirrors old SQL ORDER BY errorRate DESC)
			return result.sort((a, b) => b.errorRate - a.errorRate)
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to get error stats:", e)
			return []
		}
	}

	/**
	 * Deletes both NDJSON files, effectively purging all statistics.
	 * Returns the total number of bytes freed.
	 */
	static purge(): number {
		let freed = 0
		for (const filePath of [KeypoolUsageDb.usagePath(), KeypoolUsageDb.errorsPath()]) {
			try {
				if (existsSync(filePath)) {
					freed += statSync(filePath).size
					unlinkSync(filePath)
				}
			} catch (e) {
				Logger.error("[KeypoolUsageDb] Failed to delete file:", filePath, e)
			}
		}
		return freed
	}

	/** No-op: kept for API compatibility with the former SQLite implementation. */
	static close(): void {
		// NDJSON files do not hold open file handles
	}
}
