// KeypoolLive — handler: keypoolGetUsageStats
// © 2026 Ronan LE MEILLAT — MIT License

import { KeypoolStatsRequest, KeypoolUsageStat, KeypoolUsageStatsResponse } from "@shared/proto/cline/models"
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
 * Returns per-key usage statistics for the requested time period.
 */
export async function keypoolGetUsageStats(
	controller: Controller,
	request: KeypoolStatsRequest,
): Promise<KeypoolUsageStatsResponse> {
	try {
		keypoolInjectEnvConfig(controller)
		const period = toPeriod(request.period)
		const rows = await KeypoolUsageDb.getUsageStats(period)
		const stats: KeypoolUsageStat[] = rows.map((r) =>
			KeypoolUsageStat.create({
				periodLabel: r.period,
				provider: r.provider,
				modelId: r.modelId,
				keyOwner: r.keyOwner,
				keyHint: r.keyHint,
				promptTokens: r.promptTokens,
				completionTokens: r.completionTokens,
				requestCount: r.requestCount,
			}),
		)
		return KeypoolUsageStatsResponse.create({ stats })
	} catch (err) {
		Logger.error("[keypoolGetUsageStats] Failed to fetch usage stats:", err)
		return KeypoolUsageStatsResponse.create({ stats: [] })
	}
}
