// KeypoolLive — handler: keypoolGetErrorStats
// © 2026 Ronan LE MEILLAT — MIT License

import { KeypoolErrorStat, KeypoolErrorStatsResponse, KeypoolStatsRequest } from "@shared/proto/cline/models"
import { KeypoolUsageDb, UsagePeriod } from "@/core/keypoollive/KeypoolUsageDb"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."
import { keypoolInjectEnvConfig } from "./keypoolInjectEnvConfig"

const VALID_PERIODS: UsagePeriod[] = ["hour", "day", "week", "month"]

function toPeriod(raw: string): UsagePeriod {
	if (VALID_PERIODS.includes(raw as UsagePeriod)) {
		return raw as UsagePeriod
	}
	return "day"
}

/**
 * Returns per-key error statistics for the requested time period.
 */
export async function keypoolGetErrorStats(
	controller: Controller,
	request: KeypoolStatsRequest,
): Promise<KeypoolErrorStatsResponse> {
	try {
		keypoolInjectEnvConfig(controller)
		const period = toPeriod(request.period)
		const rows = await KeypoolUsageDb.getErrorStats()
		const stats: KeypoolErrorStat[] = rows.map((r) =>
			KeypoolErrorStat.create({
				provider: r.provider,
				keyOwner: r.keyOwner,
				keyHint: r.keyHint,
				totalRequests: r.totalRequests,
				errorCount: r.errorCount,
				errorRate: r.errorRate,
				lastErrorCode: r.lastErrorCode !== null ? r.lastErrorCode : undefined,
			}),
		)
		return KeypoolErrorStatsResponse.create({ stats })
	} catch (err) {
		Logger.error("[keypoolGetErrorStats] Failed to fetch error stats:", err)
		return KeypoolErrorStatsResponse.create({ stats: [] })
	}
}
