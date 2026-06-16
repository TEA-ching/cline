/**
 * KeypoolLive — Monitoring Dashboard.
 *
 * This component displays real-time statistics for the API keys managed by KeypoolLive.
 * It provides two main views:
 * 1. Token Usage: Shows consumption (prompt/completion tokens) per key and provider.
 * 2. Error Rates: Shows reliability metrics and recent error codes per key.
 *
 * Data can be filtered across 4 time scales and exported to CSV for further analysis.
 *
 * © 2026 Ronan LE MEILLAT — MIT License
 */

import { EmptyRequest } from "@shared/proto/cline/common"
import { KeypoolErrorStat, KeypoolStatsRequest, KeypoolUsageStat } from "@shared/proto/cline/models"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useClickAway, useWindowSize } from "react-use"
import PopupModalContainer from "@/components/common/PopupModalContainer"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ModelsServiceClient } from "@/services/grpc-client"

/** Supported time periods for statistics aggregation */
type Period = "hour" | "day" | "week" | "month"

/** Configuration for the period selector buttons */
const PERIODS: { key: Period; label: string }[] = [
	{ key: "hour", label: "1h" },
	{ key: "day", label: "24h" },
	{ key: "week", label: "7d" },
	{ key: "month", label: "30d" },
]

/**
 * Formats large token counts into human-readable strings (e.g., 1.2M, 450k).
 * Handles both standard numbers and BigInts returned by gRPC.
 */
function formatTokens(n: bigint | number): string {
	const v = typeof n === "bigint" ? Number(n) : n
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
	if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
	return String(v)
}

/**
 * Aggregates usage statistics by provider
 */
function aggregateUsageByProvider(stats: KeypoolUsageStat[]): Record<
	string,
	{
		promptTokens: number
		completionTokens: number
		requestCount: number
	}
> {
	return stats.reduce(
		(acc, stat) => {
			const provider = stat.provider
			if (!acc[provider]) {
				acc[provider] = {
					promptTokens: 0,
					completionTokens: 0,
					requestCount: 0,
				}
			}
			acc[provider].promptTokens += Number(stat.promptTokens)
			acc[provider].completionTokens += Number(stat.completionTokens)
			acc[provider].requestCount += Number(stat.requestCount)
			return acc
		},
		{} as Record<string, { promptTokens: number; completionTokens: number; requestCount: number }>,
	)
}

/**
 * Aggregates error statistics by provider
 */
function aggregateErrorsByProvider(stats: KeypoolErrorStat[]): Record<
	string,
	{
		totalRequests: number
		errorCount: number
		errorRate: number
	}
> {
	return stats.reduce(
		(acc, stat) => {
			const provider = stat.provider
			if (!acc[provider]) {
				acc[provider] = {
					totalRequests: 0,
					errorCount: 0,
					errorRate: 0,
				}
			}
			acc[provider].totalRequests += Number(stat.totalRequests)
			acc[provider].errorCount += Number(stat.errorCount)
			acc[provider].errorRate = acc[provider].errorCount / acc[provider].totalRequests
			return acc
		},
		{} as Record<string, { totalRequests: number; errorCount: number; errorRate: number }>,
	)
}

/**
 * Aggregates usage statistics by model (using provider as model proxy)
 */
function aggregateUsageByModel(stats: KeypoolUsageStat[]): Record<
	string,
	{
		promptTokens: number
		completionTokens: number
		requestCount: number
	}
> {
	return stats.reduce(
		(acc, stat) => {
			const model = stat.provider // Using provider as model proxy
			if (!acc[model]) {
				acc[model] = {
					promptTokens: 0,
					completionTokens: 0,
					requestCount: 0,
				}
			}
			acc[model].promptTokens += Number(stat.promptTokens)
			acc[model].completionTokens += Number(stat.completionTokens)
			acc[model].requestCount += Number(stat.requestCount)
			return acc
		},
		{} as Record<string, { promptTokens: number; completionTokens: number; requestCount: number }>,
	)
}

/**
 * Aggregates error statistics by model (using provider as model proxy)
 */
function aggregateErrorsByModel(stats: KeypoolErrorStat[]): Record<
	string,
	{
		totalRequests: number
		errorCount: number
		errorRate: number
	}
> {
	return stats.reduce(
		(acc, stat) => {
			const model = stat.provider // Using provider as model proxy
			if (!acc[model]) {
				acc[model] = {
					totalRequests: 0,
					errorCount: 0,
					errorRate: 0,
				}
			}
			acc[model].totalRequests += Number(stat.totalRequests)
			acc[model].errorCount += Number(stat.errorCount)
			acc[model].errorRate = acc[model].errorCount / acc[model].totalRequests
			return acc
		},
		{} as Record<string, { totalRequests: number; errorCount: number; errorRate: number }>,
	)
}

/**
 * Component to display aggregated totals (by provider or model)
 */
const AggregatedTotalsSection: React.FC<{
	title: string
	aggregatedData: Record<string, any>
	columns: { key: string; label: string; align?: string; format?: (value: any) => string }[]
	label: string
}> = ({ title, aggregatedData, columns, label }) => {
	if (Object.keys(aggregatedData).length === 0) return null

	return (
		<div className="mt-2 pt-2 border-t border-border">
			<div className="text-xs font-medium mb-1">{title}</div>
			<table className="w-full text-xs border-collapse">
				<thead>
					<tr className="text-muted-foreground text-left">
						<th className="py-0.5 pr-2 font-medium">{label}</th>
						{columns.map((col, i) => (
							<th className={`py-0.5 pr-2 font-medium ${col.align === "right" ? "text-right" : ""}`} key={i}>
								{col.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{Object.entries(aggregatedData).map(([key, data]) => (
						<tr className="border-t border-border/50" key={key}>
							<td className="py-0.5 pr-2 font-medium">{key}</td>
							{columns.map((col, i) => {
								const value = data[col.key]
								const formattedValue = col.format ? col.format(value) : String(value)
								return (
									<td className={`py-0.5 pr-2 ${col.align === "right" ? "text-right" : ""}`} key={i}>
										{col.key === "errorRate" ? `${(value * 100).toFixed(1)}%` : formattedValue}
									</td>
								)
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

/**
 * Converts usage statistics into a CSV string.
 */
function toUsageCsv(stats: KeypoolUsageStat[]): string {
	const header = "period,provider,key_owner,key_hint,prompt_tokens,completion_tokens,requests"
	const rows = stats.map(
		(r) =>
			`${r.periodLabel},${r.provider},${r.keyOwner},${r.keyHint},${r.promptTokens},${r.completionTokens},${r.requestCount}`,
	)
	return [header, ...rows].join("\n")
}

/**
 * Converts error statistics into a CSV string.
 */
function toErrorCsv(stats: KeypoolErrorStat[]): string {
	const header = "provider,key_owner,key_hint,total_requests,error_count,error_rate,last_error_code"
	const rows = stats.map(
		(r) =>
			`${r.provider},${r.keyOwner},${r.keyHint},${r.totalRequests},${r.errorCount},${r.errorRate.toFixed(3)},${r.lastErrorCode ?? ""}`,
	)
	return [header, ...rows].join("\n")
}

/**
 * Triggers a browser download for a generated CSV file.
 */
function downloadCsv(content: string, filename: string): void {
	const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}

// Export des fonctions et composants pour les tests
export { aggregateUsageByProvider, aggregateErrorsByProvider, aggregateUsageByModel, aggregateErrorsByModel, formatTokens, toUsageCsv, toErrorCsv, AggregatedTotalsSection }

const KeypoolLiveDashboard: React.FC = () => {
	// Visibility and navigation state
	const [isVisible, setIsVisible] = useState(false)
	const [period, setPeriod] = useState<Period>("day")
	const [tab, setTab] = useState<"usage" | "errors">("usage")

	// Data state
	const [usageStats, setUsageStats] = useState<KeypoolUsageStat[]>([])
	const [errorStats, setErrorStats] = useState<KeypoolErrorStat[]>([])
	const [loading, setLoading] = useState(false)
	const [purging, setPurging] = useState(false)

	// UI Refs and layout state
	const buttonRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()
	const [arrowPosition, setArrowPosition] = useState(0)
	const [menuPosition, setMenuPosition] = useState(0)

	/**
	 * Fetches both usage and error statistics from the backend service.
	 * Requests are performed in parallel.
	 */
	const fetchStats = useCallback(
		(p: Period) => {
			if (!isVisible) return
			setLoading(true)
			const req = KeypoolStatsRequest.create({ period: p })
			Promise.all([
				ModelsServiceClient.keypoolGetUsageStats(req).catch((err) => {
					console.error("Failed to fetch usage stats:", err)
					return { stats: [] }
				}),
				ModelsServiceClient.keypoolGetErrorStats(req).catch((err) => {
					console.error("Failed to fetch error stats:", err)
					return { stats: [] }
				}),
			])
				.then(([usage, errors]) => {
					setUsageStats(usage.stats)
					setErrorStats(errors.stats)
				})
				.finally(() => setLoading(false))
		},
		[isVisible],
	)

	/** Purges all statistics and refreshes the view. */
	const handlePurge = useCallback(() => {
		if (!window.confirm("Purge all KeypoolLive statistics? This cannot be undone.")) return
		setPurging(true)
		ModelsServiceClient.keypoolPurgeStats(EmptyRequest.create())
			.then(() => {
				setUsageStats([])
				setErrorStats([])
			})
			.catch((err) => {
				console.error("Failed to purge stats:", err)
			})
			.finally(() => setPurging(false))
	}, [])

	// Fetch data whenever the dashboard is opened or the period changes
	useEffect(() => {
		if (isVisible) {
			fetchStats(period)
		}
	}, [isVisible, period, fetchStats])

	// Close dashboard when clicking outside the popup
	useClickAway(modalRef, () => setIsVisible(false))

	/**
	 * Position the popup modal relative to the trigger button in the toolbar.
	 * Adjusts dynamically based on viewport dimensions.
	 */
	useEffect(() => {
		if (isVisible && buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect()
			const center = rect.left + rect.width / 2
			setArrowPosition(document.documentElement.clientWidth - center - 5)
			setMenuPosition(rect.top + 1)
		}
	}, [isVisible, viewportWidth, viewportHeight])

	return (
		<div className="inline-flex min-w-0 max-w-full items-center" ref={modalRef}>
			<div className="inline-flex w-full items-center" ref={buttonRef}>
				<Tooltip>
					{!isVisible && <TooltipContent>KeypoolLive Dashboard</TooltipContent>}
					<TooltipTrigger>
						<VSCodeButton
							appearance="icon"
							aria-label="KeypoolLive Dashboard"
							className="p-0 m-0 flex items-center"
							onClick={() => setIsVisible(!isVisible)}>
							<i className="codicon codicon-graph" style={{ fontSize: "12.5px" }} />
						</VSCodeButton>
					</TooltipTrigger>
				</Tooltip>
			</div>

			{isVisible && (
				<PopupModalContainer $arrowPosition={arrowPosition} $menuPosition={menuPosition}>
					{/* Header */}
					<div className="flex-shrink-0 px-3 pt-2 pb-1">
						<div className="flex justify-between items-center">
							<div className="text-sm font-medium">KeypoolLive Dashboard</div>
							<div className="flex gap-1 items-center">
								{/* Time scale selector */}
								<div className="flex gap-0.5">
									{PERIODS.map(({ key, label }) => (
										<button
											className={`text-[10px] px-1.5 py-0.5 rounded ${
												period === key
													? "bg-primary text-primary-foreground"
													: "text-muted-foreground hover:bg-muted/50"
											}`}
											key={key}
											onClick={() => setPeriod(key)}
											type="button">
											{label}
										</button>
									))}
								</div>
								{/* Refresh */}
								<VSCodeButton appearance="icon" onClick={() => fetchStats(period)} title="Refresh">
									<i className="codicon codicon-refresh" style={{ fontSize: "10px" }} />
								</VSCodeButton>
								{/* Purge */}
								<Tooltip>
									<TooltipContent>Purge all statistics</TooltipContent>
									<TooltipTrigger>
										<VSCodeButton
											appearance="icon"
											disabled={purging}
											onClick={handlePurge}
											title="Purge statistics">
											<i className="codicon codicon-trash" style={{ fontSize: "10px" }} />
										</VSCodeButton>
									</TooltipTrigger>
								</Tooltip>
							</div>
						</div>

						{/* Tabs */}
						<div className="flex gap-2 mt-1.5 border-b border-border">
							{(["usage", "errors"] as const).map((t) => (
								<button
									className={`text-xs pb-1 ${
										tab === t
											? "border-b-2 border-primary font-medium text-foreground"
											: "text-muted-foreground hover:text-foreground"
									}`}
									key={t}
									onClick={() => setTab(t)}
									type="button">
									{t === "usage" ? "Token Usage" : "Error Rates"}
								</button>
							))}
						</div>
					</div>

					{/* Content */}
					<div
						className="flex-1 overflow-auto px-3 pb-2"
						style={{ minHeight: 0, maxHeight: "300px", minWidth: "480px" }}>
						{loading && <div className="text-xs text-muted-foreground py-2">Loading…</div>}

						{!loading && tab === "usage" && (
							<>
								{usageStats.length === 0 ? (
									<div className="text-xs text-muted-foreground py-2">No usage data for this period.</div>
								) : (
									<table className="w-full text-xs border-collapse mt-1">
										<thead>
											<tr className="text-muted-foreground text-left">
												<th className="py-0.5 pr-2 font-medium">Period</th>
												<th className="py-0.5 pr-2 font-medium">Provider</th>
												<th className="py-0.5 pr-2 font-medium">Owner</th>
												<th className="py-0.5 pr-2 font-medium">Key</th>
												<th className="py-0.5 pr-2 font-medium text-right">Prompt</th>
												<th className="py-0.5 pr-2 font-medium text-right">Completion</th>
												<th className="py-0.5 font-medium text-right">Reqs</th>
											</tr>
										</thead>
										<tbody>
											{usageStats.map((r, i) => (
												<tr className="border-t border-border/50" key={i}>
													<td className="py-0.5 pr-2">{r.periodLabel}</td>
													<td className="py-0.5 pr-2">{r.provider}</td>
													<td className="py-0.5 pr-2">{r.keyOwner || "—"}</td>
													<td className="py-0.5 pr-2 font-mono">…{r.keyHint}</td>
													<td className="py-0.5 pr-2 text-right">{formatTokens(r.promptTokens)}</td>
													<td className="py-0.5 pr-2 text-right">{formatTokens(r.completionTokens)}</td>
													<td className="py-0.5 text-right">{String(r.requestCount)}</td>
												</tr>
											))}
										</tbody>
									</table>
								)}
								<div className="mt-2">
									<VSCodeButton
										appearance="secondary"
										className="text-[10px]"
										onClick={() => downloadCsv(toUsageCsv(usageStats), `kpl-usage-${period}.csv`)}>
										Export CSV
									</VSCodeButton>
								</div>

								{/* Provider Totals Section */}
								<AggregatedTotalsSection
									aggregatedData={aggregateUsageByProvider(usageStats)}
									columns={[
										{ key: "promptTokens", label: "Prompt Tokens", align: "right", format: formatTokens },
										{
											key: "completionTokens",
											label: "Completion Tokens",
											align: "right",
											format: formatTokens,
										},
										{ key: "requestCount", label: "Requests", align: "right" },
									]}
									title="Totals by Provider"
									label="Provider"
								/>
							</>
						)}

						{!loading && tab === "errors" && (
							<>
								{errorStats.length === 0 ? (
									<div className="text-xs text-muted-foreground py-2">No error data for this period.</div>
								) : (
									<table className="w-full text-xs border-collapse mt-1">
										<thead>
											<tr className="text-muted-foreground text-left">
												<th className="py-0.5 pr-2 font-medium">Provider</th>
												<th className="py-0.5 pr-2 font-medium">Owner</th>
												<th className="py-0.5 pr-2 font-medium">Key</th>
												<th className="py-0.5 pr-2 font-medium text-right">Requests</th>
												<th className="py-0.5 pr-2 font-medium text-right">Errors</th>
												<th className="py-0.5 pr-2 font-medium text-right">Rate</th>
												<th className="py-0.5 font-medium text-right">Last Code</th>
											</tr>
										</thead>
										<tbody>
											{errorStats.map((r, i) => (
												<tr className="border-t border-border/50" key={i}>
													<td className="py-0.5 pr-2">{r.provider}</td>
													<td className="py-0.5 pr-2">{r.keyOwner || "—"}</td>
													<td className="py-0.5 pr-2 font-mono">…{r.keyHint}</td>
													<td className="py-0.5 pr-2 text-right">{String(r.totalRequests)}</td>
													<td className="py-0.5 pr-2 text-right">{String(r.errorCount)}</td>
													<td
														className={`py-0.5 pr-2 text-right ${r.errorRate > 0.1 ? "text-red-500" : ""}`}>
														{(r.errorRate * 100).toFixed(1)}%
													</td>
													<td className="py-0.5 text-right">
														{r.lastErrorCode ? String(r.lastErrorCode) : "—"}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								)}
								<div className="mt-2">
									<VSCodeButton
										appearance="secondary"
										className="text-[10px]"
										onClick={() => downloadCsv(toErrorCsv(errorStats), `kpl-errors-${period}.csv`)}>
										Export CSV
									</VSCodeButton>
								</div>

								{/* Provider Totals Section */}
								<AggregatedTotalsSection
									aggregatedData={aggregateErrorsByProvider(errorStats)}
									columns={[
										{ key: "totalRequests", label: "Requests", align: "right" },
										{ key: "errorCount", label: "Errors", align: "right" },
										{ key: "errorRate", label: "Error Rate", align: "right" },
									]}
									title="Totals by Provider"
									label="Provider"
								/>
							</>
						)}
					</div>
				</PopupModalContainer>
			)}
		</div>
	)
}

export default KeypoolLiveDashboard
