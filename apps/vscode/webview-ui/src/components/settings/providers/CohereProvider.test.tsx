import { cohereDefaultModelId } from "@shared/api"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { CohereProvider } from "./CohereProvider"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: vi.fn(),
}))

// ModelInfoView reads live catalog data via this hook; it is not part of the
// Cohere customization, so it is stubbed out to keep this test focused.
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

describe("CohereProvider", () => {
	const handleFieldChange = vi.fn()
	const handleModeFieldChange = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleFieldChange,
			handleModeFieldChange,
		} as unknown as ReturnType<typeof useApiConfigurationHandlers>)
	})

	it("renders an empty API key field with the Cohere signup link when unset", () => {
		mockExtensionState({})

		const { container } = render(<CohereProvider currentMode="act" showModelOptions={false} />)

		expect(screen.getByPlaceholderText("Enter API Key...")).toHaveValue("")
		expect((container.querySelector("vscode-link") as unknown as { href?: string })?.href).toBe(
			"https://dashboard.cohere.ai/signup",
		)
	})

	it("commits API key edits through handleFieldChange('cohereApiKey', ...)", async () => {
		mockExtensionState({ cohereApiKey: "" })

		render(<CohereProvider currentMode="act" showModelOptions={false} />)

		fireEvent.input(screen.getByPlaceholderText("Enter API Key..."), { target: { value: "co-secret-key" } })

		await waitFor(() => expect(handleFieldChange).toHaveBeenCalledWith("cohereApiKey", "co-secret-key"))
	})

	it("hides the model selector when showModelOptions is false", () => {
		mockExtensionState({ cohereApiKey: "set", actModeApiProvider: "cohere" })

		render(<CohereProvider currentMode="act" showModelOptions={false} />)

		expect(screen.queryByLabelText("Model")).not.toBeInTheDocument()
	})

	it("selects the configured model and falls back to the Cohere default", () => {
		mockExtensionState({ cohereApiKey: "set", actModeApiProvider: "cohere" })

		render(<CohereProvider currentMode="act" showModelOptions={true} />)

		// No actModeApiModelId set: normalizeApiConfiguration falls back to the
		// provider's default model — this is the regression-prone wiring since
		// Cohere/Poolside/KeypoolLive each have their own default constant.
		expect(screen.getByLabelText("Model")).toHaveValue(cohereDefaultModelId)
	})

	it("commits model changes through handleModeFieldChange for the current mode", () => {
		mockExtensionState({
			cohereApiKey: "set",
			actModeApiProvider: "cohere",
			actModeApiModelId: cohereDefaultModelId,
		})

		render(<CohereProvider currentMode="act" showModelOptions={true} />)

		fireEvent.change(screen.getByLabelText("Model"), { target: { value: "command-a-plus-05-2026" } })

		expect(handleModeFieldChange).toHaveBeenCalledWith(
			{ plan: "planModeApiModelId", act: "actModeApiModelId" },
			"command-a-plus-05-2026",
			"act",
		)
	})

	it("reads the plan-mode model id when currentMode is 'plan'", () => {
		mockExtensionState({
			cohereApiKey: "set",
			planModeApiProvider: "cohere",
			planModeApiModelId: "command-a-plus-05-2026",
			actModeApiModelId: cohereDefaultModelId,
		})

		render(<CohereProvider currentMode="plan" showModelOptions={true} />)

		expect(screen.getByLabelText("Model")).toHaveValue("command-a-plus-05-2026")
	})
})
