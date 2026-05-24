// KeypoolLive — Dashboard: token usage + error rates per key, 4 time scales, CSV export
// © 2026 Ronan LE MEILLAT — MIT License

import { KeypoolErrorStat, KeypoolStatsRequest, KeypoolUsageStat } from "@shared/proto/cline/models"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useClickAway, useWindowSize } from "react-use"
import PopupModalContainer from "@/components/common/PopupModalContainer"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ModelsServiceClient } from "@/services/grpc-client"

type Period = "hour" | "day" | "week" | "month"
const PERIODS: { key: Period; label: string }[] = [
	{ key: "hour", label: "1h" },
	{ key: "day", label: "24h" },
	{ key: "week", label: "7d" },
	{ key: "month", label: "30d" },
]

function formatTokens(n: bigint | number): string {
	const v = typeof n === "bigint" ? Number(n) : n
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
	if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
	return String(v)
}

function toUsageCsv(stats: KeypoolUsageStat[]): string {
	const header = "period,provider,key_owner,key_hint,prompt_tokens,completion_tokens,requests"
	const rows = stats.map(
		(r) =>
			`${r.periodLabel},${r.provider},${r.keyOwner},${r.keyHint},${r.promptTokens},${r.completionTokens},${r.requestCount}`,
	)
	return [header, ...rows].join("\n")
}

function toErrorCsv(stats: KeypoolErrorStat[]): string {
	const header = "provider,key_owner,key_hint,total_requests,error_count,error_rate,last_error_code"
	const rows = stats.map(
		(r) =>
			`${r.provider},${r.keyOwner},${r.keyHint},${r.totalRequests},${r.errorCount},${r.errorRate.toFixed(3)},${r.lastErrorCode ?? ""}`,
	)
	return [header, ...rows].join("\n")
}

function downloadCsv(content: string, filename: string): void {
	const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}

const KeypoolLiveDashboard: React.FC = () => {
	const [isVisible, setIsVisible] = useState(false)
	const [period, setPeriod] = useState<Period>("day")
	const [usageStats, setUsageStats] = useState<KeypoolUsageStat[]>([])
	const [errorStats, setErrorStats] = useState<KeypoolErrorStat[]>([])
	const [loading, setLoading] = useState(false)
	const [tab, setTab] = useState<"usage" | "errors">("usage")
	const buttonRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()
	const [arrowPosition, setArrowPosition] = useState(0)
	const [menuPosition, setMenuPosition] = useState(0)

	const fetchStats = useCallback(
		(p: Period) => {
			if (!isVisible) return
			setLoading(true)
			const req = KeypoolStatsRequest.create({ period: p })
			Promise.all([
				ModelsServiceClient.keypoolGetUsageStats(req).catch(() => ({ stats: [] })),
				ModelsServiceClient.keypoolGetErrorStats(req).catch(() => ({ stats: [] })),
			])
				.then(([usage, errors]) => {
					setUsageStats(usage.stats)
					setErrorStats(errors.stats)
				})
				.finally(() => setLoading(false))
		},
		[isVisible],
	)

	useEffect(() => {
		if (isVisible) {
			fetchStats(period)
		}
	}, [isVisible, period, fetchStats])

	useClickAway(modalRef, () => setIsVisible(false))

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
							</>
						)}
					</div>
				</PopupModalContainer>
			)}
		</div>
	)
}

export default KeypoolLiveDashboard
