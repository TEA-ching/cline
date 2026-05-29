// KeypoolLive — KeypoolUsageDb: SQLite persistence for per-key usage + errors
// © 2026 Ronan LE MEILLAT — MIT License

// Type-only import: erased at compile time, generates no require() call.
// The actual module is loaded lazily at runtime so the extension can
// still activate even if better-sqlite3 is unavailable (e.g. wrong
// Electron ABI or missing node_modules in a packaged VSIX).
import type Database from "better-sqlite3"
import { mkdirSync } from "fs"
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

/**
 * Maps a UsagePeriod to its corresponding SQLite strftime format string.
 * Used for grouping stats by time intervals.
 *
 * @param period - The usage period.
 * @returns A strftime-compatible format string.
 */
function periodFormat(period: UsagePeriod): string {
	switch (period) {
		case "hour":
			return "%Y-%m-%dT%H:00"
		case "day":
			return "%Y-%m-%d"
		case "week":
			return "%Y-W%W"
		case "month":
			return "%Y-%m"
	}
}

/** Returns the better-sqlite3 constructor, or null if the native module cannot be loaded. */
function tryLoadBetterSqlite3(): typeof Database | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		return require("better-sqlite3")
	} catch {
		return null
	}
}

/**
 * Calculates the cutoff timestamp (in milliseconds) for a given usage period
 * relative to the current time. Used to filter recent history.
 *
 * @param period - The usage period.
 * @returns The cutoff timestamp.
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
 * Determines the file path for the SQLite database within the extension's
 * global storage directory.
 *
 * @returns The absolute path to usage.db.
 */
function getUsageDbPath(): string {
	const storagePath = HostProvider.get().globalStorageFsPath
	return path.join(storagePath, "keypoollive", "usage.db")
}

/**
 * Handles persistent storage of API key usage and error history using SQLite.
 *
 * NOTE: This class uses lazy-loading for 'better-sqlite3' to ensure the extension
 * can still boot even if the native module is missing or incompatible with the current environment.
 */
export class KeypoolUsageDb {
	/** Singleton database connection instance. */
	private static db: Database.Database | null = null

	/**
	 * Set to true if the 'better-sqlite3' module fails to load.
	 * This prevents repeated expensive attempts to require() a missing module.
	 */
	private static dbUnavailable = false

	/**
	 * Returns the open SQLite database, or null if better-sqlite3 is unavailable.
	 * Logs a one-time warning on first unavailability.
	 */
	private static getDb(): Database.Database | null {
		if (KeypoolUsageDb.dbUnavailable) return null
		if (!KeypoolUsageDb.db) {
			const BetterSqlite3 = tryLoadBetterSqlite3()
			if (!BetterSqlite3) {
				KeypoolUsageDb.dbUnavailable = true
				Logger.warn(
					"[KeypoolUsageDb] better-sqlite3 native module unavailable — key usage stats will not be persisted.",
					"Install the module and rebuild the extension to enable persistence.",
				)
				return null
			}
			const dbPath = getUsageDbPath()
			const dbDir = path.dirname(dbPath)
			try {
				mkdirSync(dbDir, { recursive: true })
			} catch (e) {
				Logger.error("[KeypoolUsageDb] Failed to create DB directory:", e)
				return null
			}
			KeypoolUsageDb.db = new BetterSqlite3(dbPath)
			KeypoolUsageDb.initSchema(KeypoolUsageDb.db)
		}
		return KeypoolUsageDb.db
	}

	/**
	 * Creates the necessary tables and indexes if they don't already exist.
	 *
	 * @param db - The SQLite database instance.
	 */
	private static initSchema(db: Database.Database): void {
		db.exec(`
			/* 
			   The 'key_usage' table tracks every successful request. 
			   We store timestamps as integers (milliseconds) for easy sorting and filtering. 
			*/
			CREATE TABLE IF NOT EXISTS key_usage (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				ts INTEGER NOT NULL,
				provider TEXT NOT NULL,
				model_id TEXT NOT NULL,
				key_owner TEXT NOT NULL,
				key_hint TEXT NOT NULL,
				prompt_tokens INTEGER NOT NULL DEFAULT 0,
				completion_tokens INTEGER NOT NULL DEFAULT 0
			);
			/* Index on timestamp for fast time-range queries (e.g., last 24h). */
			CREATE INDEX IF NOT EXISTS idx_key_usage_ts ON key_usage(ts);
			/* Compound index for grouping stats by provider and owner. */
			CREATE INDEX IF NOT EXISTS idx_key_usage_provider ON key_usage(provider, key_owner, key_hint);

			/* 
			   The 'key_errors' table tracks API failures. 
			   By keeping errors separate from usage, we can easily calculate error rates via joins. 
			*/
			CREATE TABLE IF NOT EXISTS key_errors (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				ts INTEGER NOT NULL,
				provider TEXT NOT NULL,
				model_id TEXT NOT NULL,
				key_owner TEXT NOT NULL,
				key_hint TEXT NOT NULL,
				error_code INTEGER
			);
			CREATE INDEX IF NOT EXISTS idx_key_errors_ts ON key_errors(ts);
			CREATE INDEX IF NOT EXISTS idx_key_errors_provider ON key_errors(provider, key_owner, key_hint);
		`)
	}

	/**
	 * Persists a new usage entry to the database.
	 *
	 * @param entry - The usage details (tokens, model, etc.).
	 */
	static recordUsage(entry: KeyUsageEntry): void {
		try {
			const db = KeypoolUsageDb.getDb()
			if (!db) return
			const stmt = db.prepare(`
				INSERT INTO key_usage (ts, provider, model_id, key_owner, key_hint, prompt_tokens, completion_tokens)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`)
			stmt.run(
				Date.now(),
				entry.provider,
				entry.modelId,
				entry.keyOwner,
				entry.keyHint,
				entry.promptTokens,
				entry.completionTokens,
			)
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to record usage:", e)
		}
	}

	/**
	 * Persists a new error entry to the database.
	 *
	 * @param entry - The error details (error code, model, etc.).
	 */
	static recordError(entry: KeyErrorEntry): void {
		try {
			const db = KeypoolUsageDb.getDb()
			if (!db) return
			const stmt = db.prepare(`
				INSERT INTO key_errors (ts, provider, model_id, key_owner, key_hint, error_code)
				VALUES (?, ?, ?, ?, ?, ?)
			`)
			stmt.run(Date.now(), entry.provider, entry.modelId, entry.keyOwner, entry.keyHint, entry.errorCode)
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to record error:", e)
		}
	}

	/**
	 * Retrieves aggregated usage statistics for the specified period.
	 *
	 * @param period - The time interval to group by (hour, day, etc.).
	 * @returns An array of usage statistics.
	 */
	static getUsageStats(period: UsagePeriod): KeyUsageStat[] {
		try {
			const db = KeypoolUsageDb.getDb()
			if (!db) return []

			// Determine the grouping format (e.g., hourly, daily) and the time window.
			const fmt = periodFormat(period)
			const cutoff = periodCutoffMs(period)

			const stmt = db.prepare(`
				SELECT
					/* SQLite strftime expects seconds, so we divide our millisecond timestamp by 1000. */
					strftime('${fmt}', ts / 1000, 'unixepoch') AS period,
					provider,
					key_owner AS keyOwner,
					key_hint AS keyHint,
					SUM(prompt_tokens) AS promptTokens,
					SUM(completion_tokens) AS completionTokens,
					COUNT(*) AS requestCount
				FROM key_usage
				WHERE ts >= ?
				GROUP BY period, provider, key_owner, key_hint
				ORDER BY period DESC, provider, key_owner, key_hint
			`)
			return stmt.all(cutoff) as KeyUsageStat[]
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to get usage stats:", e)
			return []
		}
	}

	/**
	 * Retrieves aggregated error statistics for all keys, calculated from both
	 * the error and usage tables to derive error rates.
	 *
	 * @returns An array of error statistics sorted by descending error rate.
	 */
	static getErrorStats(): KeyErrorStat[] {
		try {
			const db = KeypoolUsageDb.getDb()
			if (!db) return []

			const stmt = db.prepare(`
				SELECT
					e.provider,
					e.key_owner AS keyOwner,
					e.key_hint AS keyHint,
					u.total_requests AS totalRequests,
					COUNT(e.id) AS errorCount,
					/* Calculate error rate. We use MAX(..., 1) to avoid division by zero if usage is somehow missing. */
					CAST(COUNT(e.id) AS REAL) / MAX(u.total_requests, 1) AS errorRate,
					MAX(e.error_code) AS lastErrorCode
				FROM key_errors e
				/* Join with the usage table to get the total number of successful requests for comparison. */
				LEFT JOIN (
					SELECT provider, key_owner, key_hint, COUNT(*) AS total_requests
					FROM key_usage
					GROUP BY provider, key_owner, key_hint
				) u ON e.provider = u.provider AND e.key_owner = u.key_owner AND e.key_hint = u.key_hint
				GROUP BY e.provider, e.key_owner, e.key_hint
				ORDER BY errorRate DESC
			`)
			return stmt.all() as KeyErrorStat[]
		} catch (e) {
			Logger.error("[KeypoolUsageDb] Failed to get error stats:", e)
			return []
		}
	}

	/**
	 * Safely closes the database connection.
	 * Should be called when the extension is deactivated.
	 */
	static close(): void {
		if (KeypoolUsageDb.db) {
			KeypoolUsageDb.db.close()
			KeypoolUsageDb.db = null
		}
	}
}
