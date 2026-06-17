import { Mode } from "@shared/storage/types"
import { poolsideModels } from "@shared/api"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface PoolsideProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export function PoolsideProvider({ showModelOptions, isPopup, currentMode }: PoolsideProviderProps) {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.poolsideApiKey || ""}
				onChange={(value) => handleFieldChange("poolsideApiKey", value)}
				providerName="Poolside"
				signupUrl="https://platform.poolside.ai"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={poolsideModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
