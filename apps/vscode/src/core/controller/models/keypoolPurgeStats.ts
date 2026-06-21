// KeypoolLive — handler: keypoolPurgeStats
// © 2026 Ronan LE MEILLAT — MIT License

import { EmptyRequest } from "@shared/proto/cline/common"
import { KeypoolPurgeStatsResponse } from "@shared/proto/cline/models"
import { KeypoolUsageDb } from "@/core/keypoollive/KeypoolUsageDb"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."
import { keypoolInjectEnvConfig } from "./keypoolInjectEnvConfig"

/**
 * Purges all usage and error statistics stored in the NDJSON files.
 */
export async function keypoolPurgeStats(
	controller: Controller,
	_request: EmptyRequest,
): Promise<KeypoolPurgeStatsResponse> {
	try {
		keypoolInjectEnvConfig(controller)
		KeypoolUsageDb.purge()
		Logger.info("[keypoolPurgeStats] Statistics purged successfully.")
		return KeypoolPurgeStatsResponse.create({ success: true })
	} catch (err) {
		Logger.error("[keypoolPurgeStats] Failed to purge stats:", err)
		return KeypoolPurgeStatsResponse.create({
			success: false,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}
