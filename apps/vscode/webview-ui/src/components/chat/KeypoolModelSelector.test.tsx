import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ModelsServiceClient } from "@/services/grpc-client"
import KeypoolModelSelector from "./KeypoolModelSelector"

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		keypoolGetVaultModels: vi.fn(),
	},
}))

vi.mock("./keypoolliveModelCache", () => ({
	setKplModelCache: vi.fn(),
}))

const { setKplModelCache } = await import("./keypoolliveModelCache")

function vaultModel(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		vaultProviderName: "mistral",
		vaultModelId: "devstral-latest",
		title: "[KeypoolLive] mistral/devstral-latest",
		combinedId: "mistral/devstral-latest",
		...overrides,
	}
}

describe("KeypoolModelSelector", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does not fetch vault models until the popup is opened", () => {
		render(<KeypoolModelSelector currentModelId="mistral/devstral-latest" onSelect={vi.fn()} />)

		expect(ModelsServiceClient.keypoolGetVaultModels).not.toHaveBeenCalled()
	})

	it("fetches and lists vault models when the toggle button is clicked", async () => {
		vi.mocked(ModelsServiceClient.keypoolGetVaultModels).mockResolvedValue({
			models: [
				vaultModel(),
				vaultModel({
					vaultModelId: "mistral-large",
					title: "[KeypoolLive] mistral/mistral-large",
					combinedId: "mistral/mistral-large",
				}),
			],
		} as never)

		render(<KeypoolModelSelector currentModelId="mistral/devstral-latest" onSelect={vi.fn()} />)

		fireEvent.click(screen.getByLabelText("Select KeypoolLive model"))

		expect(ModelsServiceClient.keypoolGetVaultModels).toHaveBeenCalledTimes(1)
		expect(await screen.findByText("mistral/devstral-latest")).toBeInTheDocument()
		expect(screen.getByText("mistral/mistral-large")).toBeInTheDocument()
		// Populates the shared in-memory cache so other UI (e.g. model info
		// views) can resolve context window / capability metadata immediately.
		expect(setKplModelCache).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ combinedId: "mistral/devstral-latest" })]),
		)
	})

	it("shows a loading state while the vault models request is in flight", async () => {
		let resolveRequest: (value: unknown) => void = () => {}
		vi.mocked(ModelsServiceClient.keypoolGetVaultModels).mockReturnValue(
			new Promise((resolve) => {
				resolveRequest = resolve
			}) as never,
		)

		render(<KeypoolModelSelector currentModelId="" onSelect={vi.fn()} />)
		fireEvent.click(screen.getByLabelText("Select KeypoolLive model"))

		expect(screen.getByText("Loading…")).toBeInTheDocument()

		resolveRequest({ models: [] })
		await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument())
	})

	it("shows a helpful empty state when the vault has no models", async () => {
		vi.mocked(ModelsServiceClient.keypoolGetVaultModels).mockResolvedValue({ models: [] } as never)

		render(<KeypoolModelSelector currentModelId="" onSelect={vi.fn()} />)
		fireEvent.click(screen.getByLabelText("Select KeypoolLive model"))

		expect(await screen.findByText("No models found. Check vault settings.")).toBeInTheDocument()
	})

	it("recovers to the empty state when the vault fetch rejects", async () => {
		vi.mocked(ModelsServiceClient.keypoolGetVaultModels).mockRejectedValue(new Error("network error"))

		render(<KeypoolModelSelector currentModelId="" onSelect={vi.fn()} />)
		fireEvent.click(screen.getByLabelText("Select KeypoolLive model"))

		expect(await screen.findByText("No models found. Check vault settings.")).toBeInTheDocument()
	})

	it("calls onSelect with the combined id and closes the popup when a model is clicked", async () => {
		vi.mocked(ModelsServiceClient.keypoolGetVaultModels).mockResolvedValue({
			models: [
				vaultModel({
					vaultModelId: "mistral-large",
					title: "[KeypoolLive] mistral/mistral-large",
					combinedId: "mistral/mistral-large",
				}),
			],
		} as never)
		const onSelect = vi.fn()

		render(<KeypoolModelSelector currentModelId="" onSelect={onSelect} />)
		fireEvent.click(screen.getByLabelText("Select KeypoolLive model"))

		const modelButton = await screen.findByText("mistral/mistral-large")
		fireEvent.click(modelButton)

		expect(onSelect).toHaveBeenCalledWith("mistral/mistral-large")
		await waitFor(() => expect(screen.queryByText("mistral/mistral-large")).not.toBeInTheDocument())
	})

	it("re-fetches vault models on every open (no stale caching across popup toggles)", async () => {
		vi.mocked(ModelsServiceClient.keypoolGetVaultModels).mockResolvedValue({ models: [] } as never)

		render(<KeypoolModelSelector currentModelId="" onSelect={vi.fn()} />)
		const toggle = screen.getByLabelText("Select KeypoolLive model")

		fireEvent.click(toggle) // open
		await screen.findByText("No models found. Check vault settings.")
		fireEvent.click(toggle) // close
		fireEvent.click(toggle) // open again

		await waitFor(() => expect(ModelsServiceClient.keypoolGetVaultModels).toHaveBeenCalledTimes(2))
	})
})
