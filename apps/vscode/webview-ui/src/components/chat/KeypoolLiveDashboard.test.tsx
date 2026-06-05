import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"

// Import direct des fonctions nécessaires
import { aggregateErrorsByProvider, aggregateUsageByProvider, formatTokens, ProviderTotalsSection } from "./KeypoolLiveDashboard"

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

	describe("ProviderTotalsSection rendering", () => {
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
						<ProviderTotalsSection aggregatedData={mockData} columns={columns} title="Test Totals" />
					</tbody>
				</table>,
			)

			expect(screen.getByText("Test Totals")).toBeInTheDocument()
			expect(screen.getByText("Anthropic")).toBeInTheDocument()
			expect(screen.getByText("OpenAI")).toBeInTheDocument()
			expect(screen.getByText("2.5k")).toBeInTheDocument()
			expect(screen.getByText("4.5k")).toBeInTheDocument()
		})
	})
})
