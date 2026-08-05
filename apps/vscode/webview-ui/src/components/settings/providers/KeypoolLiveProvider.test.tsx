import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ModelsServiceClient } from "@/services/grpc-client"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { KeypoolLiveProvider } from "./KeypoolLiveProvider"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		keypoolPurgeStats: vi.fn(),
		keypoolGetRecentLogs: vi.fn(),
		keypoolSaveLogMarkdown: vi.fn(),
		updateApiConfiguration: vi.fn(),
	},
}))

const { useExtensionState } = await import("@/context/ExtensionStateContext")

function mockExtensionState(apiConfiguration: Record<string, unknown> = {}) {
	vi.mocked(useExtensionState).mockReturnValue({
		apiConfiguration,
		planActSeparateModelsSetting: false,
	} as ReturnType<typeof useExtensionState>)
}

describe("KeypoolLiveProvider", () => {
	const handleFieldChange = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleFieldChange,
		} as unknown as ReturnType<typeof useApiConfigurationHandlers>)
		// Every mount fetches recent logs; default to an empty list unless a
		// test overrides it.
		vi.mocked(ModelsServiceClient.keypoolGetRecentLogs).mockResolvedValue({ entries: [] } as never)
	})

	describe("field rendering", () => {
		it("renders the vault URL, remote storage URL, and vault secret with their configured values", () => {
			mockExtensionState({
				keypoolliveVaultUrl: "https://vault.example/ai.json.enc",
				keypoolliveRemoteStorageUrl: "https://storage.example",
				keypoolliveSecret: "s3cr3t",
			})

			render(<KeypoolLiveProvider currentMode="act" />)

			expect(screen.getByPlaceholderText("https://example.com/ai.json.enc")).toHaveValue(
				"https://vault.example/ai.json.enc",
			)
			expect(screen.getByPlaceholderText("https://example.com/remote-storage")).toHaveValue(
				"https://storage.example",
			)
			expect(screen.getByPlaceholderText("Vault decryption secret")).toHaveValue("s3cr3t")
		})

		it("defaults the aggressive-rotation checkbox to unchecked and the DB size to 50MB", () => {
			mockExtensionState({})

			render(<KeypoolLiveProvider currentMode="act" />)

			expect(screen.getByLabelText("Aggressive Rotation")).not.toBeChecked()
			expect(screen.getByLabelText("Stats DB max size (MB)")).toHaveValue(50)
		})
	})

	describe("simple field toggles (immediate handleFieldChange)", () => {
		it("toggles aggressive rotation", () => {
			mockExtensionState({})
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.click(screen.getByLabelText("Aggressive Rotation"))

			expect(handleFieldChange).toHaveBeenCalledWith("keypoolliveAggressiveRotation", true)
		})

		it("commits a valid Stats DB max size", () => {
			mockExtensionState({})
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.change(screen.getByLabelText("Stats DB max size (MB)"), { target: { value: "120" } })

			expect(handleFieldChange).toHaveBeenCalledWith("keypoolliveMaxDbSizeMb", 120)
		})

		it("ignores a Stats DB max size below the 1MB minimum", () => {
			mockExtensionState({})
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.change(screen.getByLabelText("Stats DB max size (MB)"), { target: { value: "0" } })

			expect(handleFieldChange).not.toHaveBeenCalledWith("keypoolliveMaxDbSizeMb", 0)
		})

		it("toggles the Cloudflare gateway checkboxes", () => {
			mockExtensionState({})
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.click(screen.getByLabelText("Route requests through Cloudflare AI Gateway"))
			expect(handleFieldChange).toHaveBeenCalledWith("keypoolliveUseGateway", true)

			fireEvent.click(screen.getByLabelText("Skip Cloudflare AI Gateway cache"))
			expect(handleFieldChange).toHaveBeenCalledWith("keypoolliveGatewayCacheSkip", true)
		})
	})

	describe("debounced fields (ModelsServiceClient.updateApiConfiguration)", () => {
		it("commits an edited vault URL under options.keypoolliveVaultUrl", async () => {
			mockExtensionState({ keypoolliveVaultUrl: "" })
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.input(screen.getByPlaceholderText("https://example.com/ai.json.enc"), {
				target: { value: "https://new-vault.example/ai.json.enc" },
			})

			await waitFor(() =>
				expect(ModelsServiceClient.updateApiConfiguration).toHaveBeenCalledWith(
					expect.objectContaining({
						// `.create()` always fills in the map-typed `openAiHeaders` default
						// alongside whatever fields were actually set, so match loosely here.
						updates: {
							options: expect.objectContaining({
								keypoolliveVaultUrl: "https://new-vault.example/ai.json.enc",
							}),
						},
						updateMask: ["options.keypoolliveVaultUrl"],
					}),
				),
			)
		})

		it("commits an edited vault secret under secrets.keypoolliveSecret", async () => {
			mockExtensionState({ keypoolliveSecret: "" })
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.input(screen.getByPlaceholderText("Vault decryption secret"), {
				target: { value: "new-secret-value" },
			})

			await waitFor(() =>
				expect(ModelsServiceClient.updateApiConfiguration).toHaveBeenCalledWith(
					expect.objectContaining({
						updates: { secrets: { keypoolliveSecret: "new-secret-value" } },
						updateMask: ["secrets.keypoolliveSecret"],
					}),
				),
			)
		})

		it("commits an edited remote storage URL under options.keypoolliveRemoteStorageUrl", async () => {
			mockExtensionState({ keypoolliveRemoteStorageUrl: "" })
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.input(screen.getByPlaceholderText("https://example.com/remote-storage"), {
				target: { value: "https://new-storage.example" },
			})

			await waitFor(() =>
				expect(ModelsServiceClient.updateApiConfiguration).toHaveBeenCalledWith(
					expect.objectContaining({
						updates: {
							options: expect.objectContaining({
								keypoolliveRemoteStorageUrl: "https://new-storage.example",
							}),
						},
						updateMask: ["options.keypoolliveRemoteStorageUrl"],
					}),
				),
			)
		})

		it("commits an edited model id in providerName/modelId format", async () => {
			mockExtensionState({ actModeApiModelId: "mistral/devstral-latest" })
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.input(screen.getByPlaceholderText("e.g. openai/gpt-4o or anthropic/claude-3-5-sonnet"), {
				target: { value: "openai/gpt-4o" },
			})

			await waitFor(() =>
				expect(ModelsServiceClient.updateApiConfiguration).toHaveBeenCalledWith(
					expect.objectContaining({
						updates: { options: expect.objectContaining({ actModeApiModelId: "openai/gpt-4o" }) },
						updateMask: ["options.actModeApiModelId"],
					}),
				),
			)
		})

		it("does not fire an update when the model id field mounts empty and stays empty", async () => {
			mockExtensionState({ actModeApiModelId: "" })
			render(<KeypoolLiveProvider currentMode="act" />)

			// Give the debounce a chance to fire; the guard should suppress the
			// call since both the incoming and saved values are empty.
			await new Promise((resolve) => setTimeout(resolve, 150))

			expect(ModelsServiceClient.updateApiConfiguration).not.toHaveBeenCalledWith(
				expect.objectContaining({ updateMask: ["options.actModeApiModelId"] }),
			)
		})

		it("commits edited Cloudflare gateway ID and secret", async () => {
			mockExtensionState({ keypoolliveGatewayId: "", keypoolliveGatewaySecret: "" })
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.input(screen.getByPlaceholderText("Cloudflare account/gateway ID"), {
				target: { value: "acct/gw-1" },
			})
			fireEvent.input(screen.getByPlaceholderText("cf-aig-authorization Bearer token"), {
				target: { value: "bearer-token" },
			})

			await waitFor(() =>
				expect(ModelsServiceClient.updateApiConfiguration).toHaveBeenCalledWith(
					expect.objectContaining({
						updates: { options: expect.objectContaining({ keypoolliveGatewayId: "acct/gw-1" }) },
						updateMask: ["options.keypoolliveGatewayId"],
					}),
				),
			)
			await waitFor(() =>
				expect(ModelsServiceClient.updateApiConfiguration).toHaveBeenCalledWith(
					expect.objectContaining({
						updates: { secrets: { keypoolliveGatewaySecret: "bearer-token" } },
						updateMask: ["secrets.keypoolliveGatewaySecret"],
					}),
				),
			)
		})
	})

	describe("purge statistics", () => {
		it("shows a success message after purging", async () => {
			mockExtensionState({})
			vi.mocked(ModelsServiceClient.keypoolPurgeStats).mockResolvedValue({ success: true } as never)
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.click(screen.getByText("Purge statistics"))

			expect(ModelsServiceClient.keypoolPurgeStats).toHaveBeenCalled()
			await waitFor(() => expect(screen.getByText("Statistics purged.")).toBeInTheDocument())
		})

		it("shows the server-reported error message when purging fails", async () => {
			mockExtensionState({})
			vi.mocked(ModelsServiceClient.keypoolPurgeStats).mockResolvedValue({
				success: false,
				error: "vault locked",
			} as never)
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.click(screen.getByText("Purge statistics"))

			await waitFor(() => expect(screen.getByText("Purge failed: vault locked")).toBeInTheDocument())
		})

		it("shows a generic failure message when the purge call rejects", async () => {
			mockExtensionState({})
			vi.mocked(ModelsServiceClient.keypoolPurgeStats).mockRejectedValue(new Error("network down"))
			render(<KeypoolLiveProvider currentMode="act" />)

			fireEvent.click(screen.getByText("Purge statistics"))

			await waitFor(() => expect(screen.getByText("Purge failed: network down")).toBeInTheDocument())
		})
	})

	describe("recent log entries", () => {
		it("fetches the 20 most recent log entries on mount", async () => {
			mockExtensionState({})
			render(<KeypoolLiveProvider currentMode="act" />)

			await waitFor(() =>
				expect(ModelsServiceClient.keypoolGetRecentLogs).toHaveBeenCalledWith(
					expect.objectContaining({ count: 20 }),
				),
			)
		})

		it("populates the log entry dropdown and downloads the selected entry as Markdown", async () => {
			mockExtensionState({})
			vi.mocked(ModelsServiceClient.keypoolGetRecentLogs).mockResolvedValue({
				entries: [{ timestamp: 1_700_000_000_000, provider: "mistral", modelId: "devstral-latest" }],
			} as never)
			vi.mocked(ModelsServiceClient.keypoolSaveLogMarkdown).mockResolvedValue({ success: true } as never)

			render(<KeypoolLiveProvider currentMode="act" />)

			const select = await screen.findByDisplayValue("Select a log entry")
			fireEvent.change(select, { target: { value: "1700000000000" } })

			fireEvent.click(screen.getByText("Download as Markdown"))

			await waitFor(() =>
				expect(ModelsServiceClient.keypoolSaveLogMarkdown).toHaveBeenCalledWith(
					expect.objectContaining({ timestamp: 1_700_000_000_000 }),
				),
			)
		})

		it("shows an error when downloading without a selected log entry", async () => {
			mockExtensionState({})
			render(<KeypoolLiveProvider currentMode="act" />)

			// The download button only renders once the mount-time log fetch
			// resolves (loadingLogs flips from true to false).
			const downloadButton = await screen.findByText("Download as Markdown")

			// The button is disabled with no selection, so nothing should have
			// been requested yet — this guards the `!selectedLogEntry` branch.
			expect(downloadButton.closest("button")).toBeDisabled()
			expect(ModelsServiceClient.keypoolSaveLogMarkdown).not.toHaveBeenCalled()
		})

		it("surfaces a download error message (but not a user-initiated cancel)", async () => {
			mockExtensionState({})
			vi.mocked(ModelsServiceClient.keypoolGetRecentLogs).mockResolvedValue({
				entries: [{ timestamp: 1_700_000_000_000, provider: "mistral", modelId: "devstral-latest" }],
			} as never)
			vi.mocked(ModelsServiceClient.keypoolSaveLogMarkdown).mockResolvedValue({
				success: false,
				error: "disk full",
			} as never)

			render(<KeypoolLiveProvider currentMode="act" />)

			const select = await screen.findByDisplayValue("Select a log entry")
			fireEvent.change(select, { target: { value: "1700000000000" } })
			fireEvent.click(screen.getByText("Download as Markdown"))

			await waitFor(() => expect(screen.getByText("disk full")).toBeInTheDocument())
		})

		it("does not show an error message when the user cancels the save dialog", async () => {
			mockExtensionState({})
			vi.mocked(ModelsServiceClient.keypoolGetRecentLogs).mockResolvedValue({
				entries: [{ timestamp: 1_700_000_000_000, provider: "mistral", modelId: "devstral-latest" }],
			} as never)
			vi.mocked(ModelsServiceClient.keypoolSaveLogMarkdown).mockResolvedValue({
				success: false,
				error: "Save cancelled",
			} as never)

			render(<KeypoolLiveProvider currentMode="act" />)

			const select = await screen.findByDisplayValue("Select a log entry")
			fireEvent.change(select, { target: { value: "1700000000000" } })
			fireEvent.click(screen.getByText("Download as Markdown"))

			await waitFor(() => expect(ModelsServiceClient.keypoolSaveLogMarkdown).toHaveBeenCalled())
			expect(screen.queryByText("Save cancelled")).not.toBeInTheDocument()
		})
	})
})
