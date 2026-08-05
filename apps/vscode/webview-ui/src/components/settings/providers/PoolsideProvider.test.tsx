import { poolsideDefaultModelId } from "@shared/api"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { PoolsideProvider } from "./PoolsideProvider"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: vi.fn(),
}))

// ModelInfoView reads live catalog data via this hook; it is not part of the
// Poolside customization, so it is stubbed out to keep this test focused.
vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: () => ({
		models: {},
		defaultModelId: "",
		isLoading: false,
		isStale: false,
		error: undefined,
		refresh: vi.fn(),
		fingerprint: "fingerprint",
	}),
}))

vi.mock("@vscode/webview-ui-toolkit/react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@vscode/webview-ui-toolkit/react")>()
	return {
		...actual,
		VSCodeDropdown: ({
			children,
			id,
			onChange,
			value,
		}: {
			children?: ReactNode
			id?: string
			onChange?: ChangeEventHandler<HTMLSelectElement>
			value?: string
		}) => (
			<select id={id} onChange={onChange} value={value}>
				{children}
			</select>
		),
		VSCodeOption: ({ children, value }: { children?: ReactNode; value?: string }) => (
			<option value={value}>{children}</option>
		),
	}
})

const { useExtensionState } = await import("@/context/ExtensionStateContext")

function mockExtensionState(apiConfiguration: Record<string, unknown> = {}) {
	vi.mocked(useExtensionState).mockReturnValue({
		apiConfiguration,
		planActSeparateModelsSetting: false,
	} as ReturnType<typeof useExtensionState>)
}

describe("PoolsideProvider", () => {
	const handleFieldChange = vi.fn()
	const handleModeFieldChange = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleFieldChange,
			handleModeFieldChange,
		} as unknown as ReturnType<typeof useApiConfigurationHandlers>)
	})

	it("renders an empty API key field with the Poolside signup link when unset", () => {
		mockExtensionState({})

		const { container } = render(<PoolsideProvider currentMode="act" showModelOptions={false} />)

		expect(screen.getByPlaceholderText("Enter API Key...")).toHaveValue("")
		expect((container.querySelector("vscode-link") as unknown as { href?: string })?.href).toBe(
			"https://platform.poolside.ai",
		)
	})

	it("commits API key edits through handleFieldChange('poolsideApiKey', ...)", async () => {
		mockExtensionState({ poolsideApiKey: "" })

		render(<PoolsideProvider currentMode="act" showModelOptions={false} />)

		fireEvent.input(screen.getByPlaceholderText("Enter API Key..."), { target: { value: "ps-secret-key" } })

		await waitFor(() => expect(handleFieldChange).toHaveBeenCalledWith("poolsideApiKey", "ps-secret-key"))
	})

	it("hides the model selector when showModelOptions is false", () => {
		mockExtensionState({ poolsideApiKey: "set", actModeApiProvider: "poolside" })

		render(<PoolsideProvider currentMode="act" showModelOptions={false} />)

		expect(screen.queryByLabelText("Model")).not.toBeInTheDocument()
	})

	it("selects the configured model and falls back to the Poolside default", () => {
		mockExtensionState({ poolsideApiKey: "set", actModeApiProvider: "poolside" })

		render(<PoolsideProvider currentMode="act" showModelOptions={true} />)

		// No actModeApiModelId set: normalizeApiConfiguration falls back to the
		// provider's default model — this is the regression-prone wiring since
		// Cohere/Poolside/KeypoolLive each have their own default constant
		// (and the "poolside/" prefix must be present in the fallback id).
		expect(screen.getByLabelText("Model")).toHaveValue(poolsideDefaultModelId)
	})

	it("commits model changes through handleModeFieldChange for the current mode", () => {
		mockExtensionState({
			poolsideApiKey: "set",
			actModeApiProvider: "poolside",
			actModeApiModelId: poolsideDefaultModelId,
		})

		render(<PoolsideProvider currentMode="act" showModelOptions={true} />)

		fireEvent.change(screen.getByLabelText("Model"), { target: { value: "poolside/laguna-m.1" } })

		expect(handleModeFieldChange).toHaveBeenCalledWith(
			{ plan: "planModeApiModelId", act: "actModeApiModelId" },
			"poolside/laguna-m.1",
			"act",
		)
	})

	it("reads the plan-mode model id when currentMode is 'plan'", () => {
		mockExtensionState({
			poolsideApiKey: "set",
			planModeApiProvider: "poolside",
			planModeApiModelId: "poolside/laguna-m.1",
			actModeApiModelId: poolsideDefaultModelId,
		})

		render(<PoolsideProvider currentMode="plan" showModelOptions={true} />)

		expect(screen.getByLabelText("Model")).toHaveValue("poolside/laguna-m.1")
	})
})
