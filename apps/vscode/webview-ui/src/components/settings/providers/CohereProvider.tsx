import { Mode } from "@shared/storage/types"
import { cohereModels } from "@shared/api"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface CohereProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export function CohereProvider({ showModelOptions, isPopup, currentMode }: CohereProviderProps) {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.cohereApiKey || ""}
				onChange={(value) => handleFieldChange("cohereApiKey", value)}
				providerName="Cohere"
				signupUrl="https://dashboard.cohere.ai/signup"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={cohereModels}
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
