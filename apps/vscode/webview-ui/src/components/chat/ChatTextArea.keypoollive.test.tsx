/**
 * Regression coverage for the KeypoolLive-specific controls rendered inside
 * ChatTextArea's toolbar: the model dropdown, the key-rotation button, and
 * the usage dashboard button, plus the gate that hides them for every other
 * provider. ChatTextArea itself is a large, general-purpose component; every
 * concern unrelated to KeypoolLive is stubbed out so this file only exercises
 * that one integration point.
 */
import { KeypoolRotateKeyRequest } from "@shared/proto/cline/models"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import ChatTextArea from "./ChatTextArea"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/context/PlatformContext", () => ({
	usePlatform: () => ({ togglePlanActKeys: "Meta+Shift+A", showNavbar: true }),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		keypoolRotateKey: vi.fn(),
		updateApiConfiguration: vi.fn(),
		resolveModelInfo: vi.fn(() => new Promise(() => {})),
	},
	FileServiceClient: { searchCommits: vi.fn(() => Promise.resolve({ commits: [] })) },
	StateServiceClient: {},
}))

// Everything below is unrelated to the KeypoolLive toolbar; stub to keep this
// test focused and avoid needing to satisfy their own dependency graphs.
vi.mock("@/components/chat/ContextMenu", () => ({ default: () => null }))
vi.mock("@/components/chat/SlashCommandMenu", () => ({ default: () => null }))
vi.mock("@/components/common/Thumbnails", () => ({ default: () => null }))
vi.mock("../cline-rules/ClineRulesToggleModal", () => ({ default: () => null }))
vi.mock("./ServersToggleModal", () => ({ default: () => null }))
vi.mock("./KeypoolModelSelector", () => ({
	default: ({ currentModelId, onSelect }: { currentModelId: string; onSelect: (id: string) => void }) => (
		<div data-testid="keypool-model-selector">
			{currentModelId}
			<button onClick={() => onSelect("openai/gpt-4o")} type="button">
				pick-openai-gpt-4o
			</button>
		</div>
	),
}))
vi.mock("./KeypoolLiveDashboard", () => ({ default: () => <div data-testid="keypool-dashboard" /> }))

function chatTextAreaProps() {
	return {
		inputValue: "",
		activeQuote: null,
		setInputValue: vi.fn(),
		sendingDisabled: false,
		placeholderText: "Type a message",
		selectedFiles: [],
		selectedImages: [],
		setSelectedImages: vi.fn(),
		setSelectedFiles: vi.fn(),
		onSend: vi.fn(),
		onSelectFilesAndImages: vi.fn(),
		shouldDisableFilesAndImages: false,
	}
}

function mockExtensionState(apiConfiguration: Record<string, unknown>) {
	vi.mocked(useExtensionState).mockReturnValue({
		mode: "act",
		apiConfiguration,
		openRouterModels: {},
		platform: "vscode",
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		remoteWorkflowToggles: {},
		remoteConfigSettings: undefined,
		navigateToSettingsModelPicker: vi.fn(),
		mcpServers: [],
	} as unknown as ReturnType<typeof useExtensionState>)
}

describe("ChatTextArea — KeypoolLive toolbar", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(ModelsServiceClient.resolveModelInfo).mockReturnValue(new Promise(() => {}))
	})

	it("hides the KeypoolLive controls for a non-KeypoolLive provider", () => {
		mockExtensionState({ actModeApiProvider: "anthropic", actModeApiModelId: "claude-sonnet-4-6" })

		render(<ChatTextArea {...chatTextAreaProps()} />)

		expect(screen.queryByTestId("keypool-model-selector")).not.toBeInTheDocument()
		expect(screen.queryByTestId("keypool-dashboard")).not.toBeInTheDocument()
		expect(screen.queryByLabelText("Rotate KeypoolLive key")).not.toBeInTheDocument()
	})

	it("shows the model dropdown, rotate button, and dashboard for the KeypoolLive provider", () => {
		mockExtensionState({
			actModeApiProvider: "keypoollive",
			actModeApiModelId: "mistral/devstral-latest",
		})

		render(<ChatTextArea {...chatTextAreaProps()} />)

		expect(screen.getByTestId("keypool-model-selector")).toHaveTextContent("mistral/devstral-latest")
		expect(screen.getByTestId("keypool-dashboard")).toBeInTheDocument()
		expect(screen.getByLabelText("Rotate KeypoolLive key")).toBeInTheDocument()
	})

	it("rotates the active key, parsing the provider/model out of the composite id", async () => {
		mockExtensionState({
			actModeApiProvider: "keypoollive",
			actModeApiModelId: "mistral/devstral-latest",
		})
		vi.mocked(ModelsServiceClient.keypoolRotateKey).mockResolvedValue({ success: true } as never)

		render(<ChatTextArea {...chatTextAreaProps()} />)
		fireEvent.click(screen.getByLabelText("Rotate KeypoolLive key"))

		await waitFor(() =>
			expect(ModelsServiceClient.keypoolRotateKey).toHaveBeenCalledWith(
				KeypoolRotateKeyRequest.create({ providerName: "mistral", modelId: "devstral-latest" }),
			),
		)
	})

	it("shows a rotating state while the request is in flight, then success", async () => {
		mockExtensionState({
			actModeApiProvider: "keypoollive",
			actModeApiModelId: "mistral/devstral-latest",
		})
		let resolveRotate: (value: unknown) => void = () => {}
		vi.mocked(ModelsServiceClient.keypoolRotateKey).mockReturnValue(
			new Promise((resolve) => {
				resolveRotate = resolve
			}) as never,
		)

		render(<ChatTextArea {...chatTextAreaProps()} />)
		const rotateButton = screen.getByLabelText("Rotate KeypoolLive key")
		fireEvent.click(rotateButton)

		// vscode-button is a custom element: `disabled` is reflected as a JS
		// property rather than a plain HTML attribute jest-dom's toBeDisabled()
		// recognizes, so check the property directly.
		expect((rotateButton as unknown as { disabled?: boolean }).disabled).toBe(true)
		expect(rotateButton.querySelector("i")).toHaveClass("codicon-loading")

		resolveRotate({ success: true })

		await waitFor(() => expect(rotateButton.querySelector("i")).toHaveClass("codicon-pass"))
		expect((rotateButton as unknown as { disabled?: boolean }).disabled).toBe(false)
	})

	it("shows an error state when the rotation call reports failure", async () => {
		mockExtensionState({
			actModeApiProvider: "keypoollive",
			actModeApiModelId: "mistral/devstral-latest",
		})
		vi.mocked(ModelsServiceClient.keypoolRotateKey).mockResolvedValue({ success: false } as never)

		render(<ChatTextArea {...chatTextAreaProps()} />)
		fireEvent.click(screen.getByLabelText("Rotate KeypoolLive key"))

		await waitFor(() =>
			expect(screen.getByLabelText("Rotate KeypoolLive key").querySelector("i")).toHaveClass("codicon-error"),
		)
	})

	it("shows an error state when the rotation call rejects outright", async () => {
		mockExtensionState({
			actModeApiProvider: "keypoollive",
			actModeApiModelId: "mistral/devstral-latest",
		})
		vi.mocked(ModelsServiceClient.keypoolRotateKey).mockRejectedValue(new Error("network down"))

		render(<ChatTextArea {...chatTextAreaProps()} />)
		fireEvent.click(screen.getByLabelText("Rotate KeypoolLive key"))

		await waitFor(() =>
			expect(screen.getByLabelText("Rotate KeypoolLive key").querySelector("i")).toHaveClass("codicon-error"),
		)
	})

	it("commits a model change to the mode-specific field when a vault model is selected", async () => {
		mockExtensionState({
			actModeApiProvider: "keypoollive",
			actModeApiModelId: "mistral/devstral-latest",
		})

		render(<ChatTextArea {...chatTextAreaProps()} />)
		fireEvent.click(screen.getByText("pick-openai-gpt-4o"))

		await waitFor(() =>
			expect(ModelsServiceClient.updateApiConfiguration).toHaveBeenCalledWith(
				expect.objectContaining({
					updates: { options: expect.objectContaining({ actModeApiModelId: "openai/gpt-4o" }) },
					updateMask: ["options.actModeApiModelId"],
				}),
			),
		)
	})
})
