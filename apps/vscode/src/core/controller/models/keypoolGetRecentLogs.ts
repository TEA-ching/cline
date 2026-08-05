// KeypoolLive — handler: keypoolGetRecentLogs
// © 2026 Ronan LE MEILLAT — MIT License

import { KeypoolLogsRequest, KeypoolLogsResponse, KeypoolLogEntry } from "@shared/proto/cline/models"
import { KeypoolLog } from "@/core/keypoollive/KeypoolLog"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

export async function keypoolGetRecentLogs(_controller: Controller, request: KeypoolLogsRequest): Promise<KeypoolLogsResponse> {
	try {
		const count = request.count > 0 ? request.count : 20
		const raw = KeypoolLog.getLastNLogEntries(count)
		const entries: KeypoolLogEntry[] = raw.map((e) =>
			KeypoolLogEntry.create({
				timestamp: e.timestamp,
				provider: e.provider,
				modelId: e.modelId,
			}),
		)
		return KeypoolLogsResponse.create({ entries })
	} catch (err) {
		Logger.error("[keypoolGetRecentLogs] Failed to read log entries:", err)
		return KeypoolLogsResponse.create({ entries: [] })
	}
}
