import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ModelsServiceClient } from "@/services/grpc-client"
import KeypoolLiveDashboard, {
	AggregatedTotalsSection,
	aggregateErrorsByProvider,
	aggregateUsageByProvider,
	formatTokens,
} from "./KeypoolLiveDashboard"

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		keypoolGetUsageStats: vi.fn(),
		keypoolGetErrorStats: vi.fn(),
		keypoolPurgeStats: vi.fn(),
	},
}))

// xlsx performs real file/DOM operations on export; stub it so "Export XLSx"
// clicks are observable without touching the filesystem.
vi.mock("xlsx", () => ({
	utils: {
		json_to_sheet: vi.fn(() => ({})),
		book_new: vi.fn(() => ({})),
		book_append_sheet: vi.fn(),
	},
	writeFile: vi.fn(),
}))

describe("KeypoolLiveDashboard - Provider Totals", () => {
	describe("aggregateUsageByProvider", () => {
		it("should correctly aggregate usage stats by provider", () => {
			const mockStats = [
				{
					periodLabel: "2023-01",
					provider: "Anthropic",
					keyOwner: "user1",
					keyHint: "key1",
					promptTokens: 1000,
					completionTokens: 2000,
					requestCount: 5,
				},
				{
					periodLabel: "2023-01",
					provider: "Anthropic",
					keyOwner: "user2",
					keyHint: "key2",
					promptTokens: 1500,
					completionTokens: 2500,
					requestCount: 8,
				},
				{
					periodLabel: "2023-01",
					provider: "OpenAI",
					keyOwner: "user1",
					keyHint: "key3",
					promptTokens: 3000,
					completionTokens: 4000,
					requestCount: 12,
				},
			]

			const result = aggregateUsageByProvider(mockStats)

			expect(result).toEqual({
				Anthropic: {
					promptTokens: 2500,
					completionTokens: 4500,
					requestCount: 13,
				},
				OpenAI: {
					promptTokens: 3000,
					completionTokens: 4000,
					requestCount: 12,
				},
			})
		})
	})

	describe("aggregateErrorsByProvider", () => {
		it("should correctly aggregate error stats by provider", () => {
			const mockStats = [
				{
					provider: "Anthropic",
					keyOwner: "user1",
					keyHint: "key1",
					totalRequests: 10,
					errorCount: 1,
					errorRate: 0.1,
					lastErrorCode: 429,
				},
				{
					provider: "Anthropic",
					keyOwner: "user2",
					keyHint: "key2",
					totalRequests: 20,
					errorCount: 2,
					errorRate: 0.1,
					lastErrorCode: 500,
				},
				{
					provider: "OpenAI",
					keyOwner: "user1",
					keyHint: "key3",
					totalRequests: 30,
					errorCount: 3,
					errorRate: 0.1,
					lastErrorCode: 404,
				},
			]

			const result = aggregateErrorsByProvider(mockStats)

			expect(result.Anthropic.totalRequests).toBe(30)
			expect(result.Anthropic.errorCount).toBe(3)
			expect(result.Anthropic.errorRate).toBeCloseTo(0.1)
		})
	})

	describe("formatTokens", () => {
		it("should format large numbers correctly", () => {
			expect(formatTokens(500)).toBe("500")
			expect(formatTokens(1500)).toBe("1.5k")
			expect(formatTokens(1500000)).toBe("1.5M")
		})
	})

	describe("AggregatedTotalsSection rendering", () => {
		it("should render provider totals section with correct data", () => {
			const mockData = {
				Anthropic: {
					promptTokens: 2500,
					completionTokens: 4500,
					requestCount: 13,
				},
				OpenAI: {
					promptTokens: 3000,
					completionTokens: 4000,
					requestCount: 12,
				},
			}

			const columns = [
				{ key: "promptTokens", label: "Prompt Tokens", align: "right", format: formatTokens },
				{ key: "completionTokens", label: "Completion Tokens", align: "right", format: formatTokens },
				{ key: "requestCount", label: "Requests", align: "right" },
			]

			render(
				<table>
					<tbody>
						<AggregatedTotalsSection aggregatedData={mockData} columns={columns} label="Provider" title="Test Totals" />
					</tbody>
				</table>,
			)

			expect(screen.getByText("Test Totals")).toBeInTheDocument()
			expect(screen.getByText("Anthropic")).toBeInTheDocument()
			expect(screen.getByText("OpenAI")).toBeInTheDocument()
			expect(screen.getByText("2.5k")).toBeInTheDocument()
			expect(screen.getByText("4.5k")).toBeInTheDocument()
		})

		it("renders nothing when there is no aggregated data", () => {
			const { container } = render(
				<table>
					<tbody>
						<AggregatedTotalsSection aggregatedData={{}} columns={[]} label="Provider" title="Empty Totals" />
					</tbody>
				</table>,
			)

			expect(screen.queryByText("Empty Totals")).not.toBeInTheDocument()
			expect(container.querySelectorAll("tr")).toHaveLength(0)
		})
	})
})

describe("KeypoolLiveDashboard - toolbar interactions", () => {
	const usageStat = {
		periodLabel: "2026-06",
		provider: "mistral",
		modelId: "devstral-latest",
		keyOwner: "tester",
		keyHint: "abcd1234",
		promptTokens: 1000,
		completionTokens: 500,
		requestCount: 3,
	}
	const errorStat = {
		provider: "mistral",
		keyOwner: "tester",
		keyHint: "abcd1234",
		totalRequests: 10,
		errorCount: 1,
		errorRate: 0.1,
		lastErrorCode: 429,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(ModelsServiceClient.keypoolGetUsageStats).mockResolvedValue({ stats: [usageStat] } as never)
		vi.mocked(ModelsServiceClient.keypoolGetErrorStats).mockResolvedValue({ stats: [errorStat] } as never)
		vi.spyOn(window, "confirm").mockReturnValue(true)
		// jsdom does not implement these; define them so downloadCsv() can run.
		URL.createObjectURL = vi.fn(() => "blob:mock")
		URL.revokeObjectURL = vi.fn()
	})

	it("does not fetch stats until the dashboard button is opened", () => {
		render(<KeypoolLiveDashboard />)

		expect(ModelsServiceClient.keypoolGetUsageStats).not.toHaveBeenCalled()
		expect(ModelsServiceClient.keypoolGetErrorStats).not.toHaveBeenCalled()
	})

	it("fetches usage and error stats for the default 24h period when opened", async () => {
		render(<KeypoolLiveDashboard />)

		fireEvent.click(screen.getByLabelText("KeypoolLive Dashboard"))

		await waitFor(() =>
			expect(ModelsServiceClient.keypoolGetUsageStats).toHaveBeenCalledWith(expect.objectContaining({ period: "day" })),
		)
		expect(ModelsServiceClient.keypoolGetErrorStats).toHaveBeenCalledWith(expect.objectContaining({ period: "day" }))
		expect(await screen.findByText("devstral-latest")).toBeInTheDocument()
	})

	it("re-fetches stats with the new period when a time-scale button is clicked", async () => {
		render(<KeypoolLiveDashboard />)
		fireEvent.click(screen.getByLabelText("KeypoolLive Dashboard"))
		await screen.findByText("devstral-latest")

		fireEvent.click(screen.getByText("1h"))

		await waitFor(() =>
			expect(ModelsServiceClient.keypoolGetUsageStats).toHaveBeenCalledWith(expect.objectContaining({ period: "hour" })),
		)
	})

	it("switches to the Error Rates tab and renders the error table", async () => {
		render(<KeypoolLiveDashboard />)
		fireEvent.click(screen.getByLabelText("KeypoolLive Dashboard"))
		await screen.findByText("devstral-latest")

		fireEvent.click(screen.getByText("Error Rates"))

		// "10.0%" also appears in the provider/model totals sections below, so
		// assert on the raw row's unique last-error-code cell instead.
		expect(await screen.findByText("429")).toBeInTheDocument()
		expect(screen.getAllByText("10.0%").length).toBeGreaterThan(0)
	})

	it("refetches the current period's stats when Refresh is clicked", async () => {
		render(<KeypoolLiveDashboard />)
		fireEvent.click(screen.getByLabelText("KeypoolLive Dashboard"))
		await screen.findByText("devstral-latest")
		vi.mocked(ModelsServiceClient.keypoolGetUsageStats).mockClear()

		fireEvent.click(screen.getByTitle("Refresh"))

		await waitFor(() =>
			expect(ModelsServiceClient.keypoolGetUsageStats).toHaveBeenCalledWith(expect.objectContaining({ period: "day" })),
		)
	})

	it("purges statistics after user confirmation and clears the tables", async () => {
		vi.mocked(ModelsServiceClient.keypoolPurgeStats).mockResolvedValue({ success: true } as never)
		render(<KeypoolLiveDashboard />)
		fireEvent.click(screen.getByLabelText("KeypoolLive Dashboard"))
		await screen.findByText("devstral-latest")

		fireEvent.click(screen.getByTitle("Purge statistics"))

		expect(window.confirm).toHaveBeenCalled()
		await waitFor(() => expect(ModelsServiceClient.keypoolPurgeStats).toHaveBeenCalled())
		await waitFor(() => expect(screen.queryByText("devstral-latest")).not.toBeInTheDocument())
		expect(screen.getByText("No usage data for this period.")).toBeInTheDocument()
	})

	it("does not purge statistics when the user cancels the confirmation dialog", async () => {
		vi.spyOn(window, "confirm").mockReturnValue(false)
		render(<KeypoolLiveDashboard />)
		fireEvent.click(screen.getByLabelText("KeypoolLive Dashboard"))
		await screen.findByText("devstral-latest")

		fireEvent.click(screen.getByTitle("Purge statistics"))

		expect(ModelsServiceClient.keypoolPurgeStats).not.toHaveBeenCalled()
		expect(screen.getByText("devstral-latest")).toBeInTheDocument()
	})

	it("triggers a CSV download for the current usage tab without throwing", async () => {
		render(<KeypoolLiveDashboard />)
		fireEvent.click(screen.getByLabelText("KeypoolLive Dashboard"))
		await screen.findByText("devstral-latest")

		fireEvent.click(screen.getByText("Export CSV"))

		expect(URL.createObjectURL).toHaveBeenCalled()
	})

	it("triggers an XLSx download for the current usage tab without throwing", async () => {
		const xlsx = await import("xlsx")
		render(<KeypoolLiveDashboard />)
		fireEvent.click(screen.getByLabelText("KeypoolLive Dashboard"))
		await screen.findByText("devstral-latest")

		fireEvent.click(screen.getByText("Export XLSx"))

		expect(xlsx.utils.json_to_sheet).toHaveBeenCalledWith([
			expect.objectContaining({ provider: "mistral", model_id: "devstral-latest" }),
		])
		expect(xlsx.writeFile).toHaveBeenCalled()
	})

	it("renders provider and model totals sections once usage data loads", async () => {
		render(<KeypoolLiveDashboard />)
		fireEvent.click(screen.getByLabelText("KeypoolLive Dashboard"))

		expect(await screen.findByText("Totals by Provider")).toBeInTheDocument()
		expect(screen.getByText("Totals by Model")).toBeInTheDocument()
	})

	it("closes the dashboard popup on outside click", async () => {
		render(
			<div>
				<div data-testid="outside">outside</div>
				<KeypoolLiveDashboard />
			</div>,
		)
		fireEvent.click(screen.getByLabelText("KeypoolLive Dashboard"))
		await screen.findByText("devstral-latest")

		fireEvent.mouseDown(screen.getByTestId("outside"))

		await waitFor(() => expect(screen.queryByText("devstral-latest")).not.toBeInTheDocument())
	})
})
