/**
 * KeypoolLive - KeypoolLog: NDJSON logger
 * © 2026 Ronan LE MEILLAT — MIT License
 *
 * Detailed description of the KeypoolLog class:
 *
 * This class provides a logging mechanism for debugging and monitoring exchanges with AI providers.
 * It uses NDJSON format for logging the called provider/model and the message array.
 * The logs are stored in:
 * On Windows: C:\Users\<User>\AppData\Roaming\Code\User\globalStorage\<extension-id>\keypoollive\messages.ndjson
 * On macOS: ~/Library/Application Support/Code/User/globalStorage/<extension-id>/keypoollive/messages.ndjson
 * On Linux: ~/.config/Code/User/globalStorage/<extension-id>/keypoollive/messages.ndjson
 *
 * The log file is rotated when it exceeds 50MB, with up to 5 archived logs kept as zip files.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	readdirSync,
	unlinkSync,
	createReadStream,
	createWriteStream,
	writeFileSync
} from "fs";
import path from "path";
import { createGzip } from "zlib";
import { pipeline } from "stream";
import { promisify } from "util";
import { HostProvider } from "@/hosts/host-provider";
import { Logger } from "@/shared/services/Logger";

const pipelineAsync = promisify(pipeline);

/**
 * Interface for a log entry
 */
export interface LogEntry {
	provider: string;
	modelId: string;
	messages: Array<{
		role: string;
		content: string;
	}>;
	timestamp: number;
	metadata?: Record<string, unknown>;
}

/**
 * Returns the directory containing the log files.
 */
function getLogDir(): string {
	const storagePath = HostProvider.get().globalStorageFsPath;
	return path.join(storagePath, "keypoollive");
}

/**
 * Returns the path to the main log file.
 */
function getLogPath(): string {
	return path.join(getLogDir(), "messages.ndjson");
}

/**
 * Returns the path to the archives directory.
 */
function getArchiveDir(): string {
	return path.join(getLogDir(), "archives");
}

/**
 * Ensures the log directory and archives directory exist.
 */
function ensureDirectories(): boolean {
	try {
		mkdirSync(getLogDir(), { recursive: true });
		mkdirSync(getArchiveDir(), { recursive: true });
		return true;
	} catch (e) {
		Logger.error("[KeypoolLog] Failed to create directories:", e);
		return false;
	}
}

/**
 * Test function to verify the logging system works correctly
 * This can be used for manual testing or in test suites
 */
export async function testKeypoolLog(): Promise<void> {
	try {
		// Test basic logging
		await KeypoolLog.logEntry({
			provider: "test-provider",
			modelId: "test-model",
			messages: [
				{ role: "system", content: "Test system prompt" },
				{ role: "user", content: "Test user message" }
			],
			metadata: {
				test: true,
				timestamp: Date.now()
			}
		});

		// Verify the log was written
		const entries = KeypoolLog.getLogEntries();
		console.log(`[KeypoolLog Test] Found ${entries.length} log entries`);
		if (entries.length > 0) {
			console.log("[KeypoolLog Test] Last entry:", entries[0]);
		}

		// Test purge (commented out to avoid accidental data loss)
		// await KeypoolLog.purgeLogs();
		// console.log("[KeypoolLog Test] Logs purged");

	} catch (e) {
		console.error("[KeypoolLog Test] Error:", e);
	}
}

/**
 * Compresses a file to gzip format and saves it in the archives directory.
 */
async function compressToArchive(sourcePath: string, archiveName: string): Promise<void> {
	const archivePath = path.join(getArchiveDir(), `${archiveName}.gz`);
	const gzip = createGzip();
	const sourceStream = createReadStream(sourcePath);
	const destinationStream = createWriteStream(archivePath);

	try {
		await pipelineAsync(sourceStream, gzip, destinationStream);
	} catch (e) {
		Logger.error("[KeypoolLog] Failed to compress archive:", e);
		throw e;
	}
}

/**
 * Rotates the log file by compressing the current log and creating a new empty log file.
 */
async function rotateLogFile(): Promise<void> {
	if (!existsSync(getLogPath())) return;

	try {
		// Generate archive name with timestamp
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const archiveName = `messages-${timestamp}`;

		// Compress current log to archive
		await compressToArchive(getLogPath(), archiveName);

		// Create new empty log file
		writeFileSync(getLogPath(), "", "utf8");

		// Clean up old archives (keep only 5 most recent)
		await cleanupOldArchives();
	} catch (e) {
		Logger.error("[KeypoolLog] Failed to rotate log file:", e);
	}
}

/**
 * Cleans up old archives, keeping only the 5 most recent.
 */
async function cleanupOldArchives(): Promise<void> {
	try {
		const archives = readdirSync(getArchiveDir())
			.filter((file: string) => file.endsWith(".gz"))
			.sort((a: string, b: string) => {
				// Sort by timestamp in filename (newest first)
				const aTime = a.replace("messages-", "").replace(".gz", "");
				const bTime = b.replace("messages-", "").replace(".gz", "");
				return bTime.localeCompare(aTime);
			});

		// Keep only the 5 most recent archives
		if (archives.length > 5) {
			const archivesToDelete = archives.slice(5);
			for (const archive of archivesToDelete) {
				try {
					unlinkSync(path.join(getArchiveDir(), archive));
				} catch (e) {
					Logger.error(`[KeypoolLog] Failed to delete old archive ${archive}:`, e);
				}
			}
		}
	} catch (e) {
		Logger.error("[KeypoolLog] Failed to clean up old archives:", e);
	}
}

/**
 * Checks if log rotation is needed and performs it if necessary.
 */
async function checkAndRotateLogFile(): Promise<void> {
	if (!existsSync(getLogPath())) return;

	try {
		const stats = statSync(getLogPath());
		if (stats.size >= 50 * 1024 * 1024) { // 50MB
			await rotateLogFile();
		}
	} catch (e) {
		Logger.error("[KeypoolLog] Failed to check log file size:", e);
	}
}

/**
 * Main class for handling API provider exchange logs
 */
export class KeypoolLog {
	/**
	 * Logs a new entry to the NDJSON file
	 * @param entry The log entry to add (without timestamp)
	 */
	static async logEntry(entry: Omit<LogEntry, "timestamp">): Promise<void> {
		if (!ensureDirectories()) return;

		const record: LogEntry = {
			...entry,
			timestamp: Date.now()
		};

		try {
			await checkAndRotateLogFile();
			appendFileSync(getLogPath(), JSON.stringify(record) + "\n", "utf8");
		} catch (e) {
			Logger.error("[KeypoolLog] Failed to log entry:", e);
		}
	}

	/**
	 * Reads all log entries from the file
	 * @param since Optional timestamp to filter entries (only return entries newer than this)
	 * @returns Array of log entries
	 */
	static getLogEntries(since?: number): LogEntry[] {
		if (!existsSync(getLogPath())) return [];

		try {
			const content = readFileSync(getLogPath(), "utf8");
			const entries: LogEntry[] = [];

			for (const line of content.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed) continue;

				try {
					const entry = JSON.parse(trimmed) as LogEntry;
					if (!since || entry.timestamp >= since) {
						entries.push(entry);
					}
				} catch {
					// Skip malformed lines
					Logger.warn("[KeypoolLog] Skipping malformed log entry");
				}
			}

			// Sort by timestamp (newest first)
			return entries.sort((a, b) => b.timestamp - a.timestamp);
		} catch (e) {
			Logger.error("[KeypoolLog] Failed to read log entries:", e);
			return [];
		}
	}

	/**
	 * Deletes all log files (main log and archives)
	 */
	static async purgeLogs(): Promise<void> {
		try {
			// Delete main log file
			if (existsSync(getLogPath())) {
				unlinkSync(getLogPath());
			}

			// Delete all archives
			if (existsSync(getArchiveDir())) {
				const archives = readdirSync(getArchiveDir());
				for (const archive of archives) {
					try {
						unlinkSync(path.join(getArchiveDir(), archive));
					} catch (e) {
						Logger.error(`[KeypoolLog] Failed to delete archive ${archive}:`, e);
					}
				}
			}
		} catch (e) {
			Logger.error("[KeypoolLog] Failed to purge logs:", e);
		}
	}

	/**
	 * Retrieves a single log entry by its timestamp.
	 * @param timestamp The timestamp of the log entry to retrieve
	 * @returns The log entry if found, or null if not found
	 */
	static getLogEntryByTimestamp(timestamp: number): LogEntry | null {
		const entries = this.getLogEntries();
		return entries.find(entry => entry.timestamp === timestamp) || null;
	}

	/**
	 * Converts a log entry to a markdown string for display in the UI.
	 * @param entry The log entry to convert
	 * @returns A markdown string representing the log entry
	 */
	static logEntryToMarkdown(entry: LogEntry): string {
		const time = new Date(entry.timestamp).toLocaleString();
		let markdown = `**Provider:** ${entry.provider}\n`;
		markdown += `**Model ID:** ${entry.modelId}\n`;
		markdown += `**Timestamp:** ${time}\n\n`;
		markdown += `**Messages:**\n`;

		for (const msg of entry.messages) {
			markdown += `- **${msg.role}:**\n`;

			// Check if content is valid JSON and format it accordingly
			try {
				const potentialJson = msg.content.trim();
				if (potentialJson.startsWith('{') && potentialJson.endsWith('}') ||
					potentialJson.startsWith('[') && potentialJson.endsWith(']')) {
					JSON.parse(potentialJson);
					markdown += "```json\n" + JSON.stringify(JSON.parse(potentialJson), null, 2) + "\n```\n";
				} else {
					markdown += `${msg.content}\n`;
				}
			} catch (e) {
				// If not valid JSON, display as plain text
				markdown += `${msg.content}\n`;
			}
		}

		if (entry.metadata) {
			markdown += `\n**Metadata:**\n\`\`\`json\n${JSON.stringify(entry.metadata, null, 2)}\n\`\`\``;
		}

		return markdown;
	}

	/**
	 * Retrieves an array of the last n log entries, sorted by timestamp (newest first).
	 * @param n The number of log entries to retrieve
	 * @returns An array of log entries
	 */
	static getLastNLogEntries(n: number): LogEntry[] {
		const entries = this.getLogEntries();
		return entries.slice(0, n);
	}
}
