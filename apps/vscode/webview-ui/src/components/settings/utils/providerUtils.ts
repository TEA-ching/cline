import {
	type ApiConfiguration,
	type ApiProvider,
	clinePassDefaultModelId,
	type ModelInfo,
	openAiModelInfoSafeDefaults,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
	resolveClinePassModelInfo,
	cohereDefaultModelId,
	cohereModels,
	poolsideModels,
	poolsideDefaultModelId,
} from "@shared/api"
import { Mode } from "@shared/storage/types"
import * as reasoningSupport from "@shared/utils/reasoning-support"
import { getKplModelInfo } from "@/components/chat/keypoolliveModelCache"

export function supportsReasoningEffortForModelId(modelId?: string, _allowShortOpenAiIds = false): boolean {
	return reasoningSupport.supportsReasoningEffortForModel(modelId)
}

/**
 * Interface for normalized API configuration
 */
export interface NormalizedApiConfig {
	selectedProvider: ApiProvider;
	selectedModelId: string;
	selectedModelInfo: ModelInfo;
}

/**
 * Normalizes API configuration to ensure consistent values.
 * Handles our custom providers (cohere, poolside, keypoollive) fully;
 * for upstream SDK-backed providers, returns provider + modelId from config
 * with a generic ModelInfo fallback.
 */
export function normalizeApiConfiguration(
	apiConfiguration: ApiConfiguration | undefined,
	currentMode: Mode,
	options: {
		isClinePassEnabled?: boolean;
		clinePassModelInfoByName?: Record<string, ModelInfo>;
	} = {},
): NormalizedApiConfig {
	const configuredProvider =
		(currentMode === "plan"
			? apiConfiguration?.planModeApiProvider
			: apiConfiguration?.actModeApiProvider) || "anthropic";
	const provider =
		configuredProvider === "cline-pass" && options.isClinePassEnabled === false
			? "cline"
			: configuredProvider;

	const modelId =
		currentMode === "plan"
			? apiConfiguration?.planModeApiModelId
			: apiConfiguration?.actModeApiModelId;

	const getProviderData = (
		models: Record<string, ModelInfo>,
		defaultId: string,
	) => {
		let selectedModelId: string;
		let selectedModelInfo: ModelInfo;
		if (modelId && modelId in models) {
			selectedModelId = modelId;
			selectedModelInfo = models[modelId];
		} else {
			selectedModelId = defaultId;
			selectedModelInfo = models[defaultId];
		}
		return {
			selectedProvider: provider,
			selectedModelId,
			selectedModelInfo,
		};
	};

	switch (provider) {
		case "openrouter": {
			const openRouterModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeOpenRouterModelId
					: apiConfiguration?.actModeOpenRouterModelId;
			const openRouterModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeOpenRouterModelInfo
					: apiConfiguration?.actModeOpenRouterModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: openRouterModelId || openRouterDefaultModelId,
				selectedModelInfo: openRouterModelInfo || openRouterDefaultModelInfo,
			};
		}
		case "requesty": {
			const requestyModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeRequestyModelId
					: apiConfiguration?.actModeRequestyModelId;
			const requestyModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeRequestyModelInfo
					: apiConfiguration?.actModeRequestyModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: requestyModelId || requestyDefaultModelId,
				selectedModelInfo: requestyModelInfo || requestyDefaultModelInfo,
			};
		}
		case "cline": {
			const fallbackOpenRouterModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeOpenRouterModelId
					: apiConfiguration?.actModeOpenRouterModelId;
			const fallbackOpenRouterModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeOpenRouterModelInfo
					: apiConfiguration?.actModeOpenRouterModelInfo;
			const configuredClineModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeClineModelId
					: apiConfiguration?.actModeClineModelId;
			const clineModelId =
				configuredClineModelId ||
				fallbackOpenRouterModelId ||
				openRouterDefaultModelId;
			const clineModelInfo =
				(currentMode === "plan"
					? apiConfiguration?.planModeClineModelInfo
					: apiConfiguration?.actModeClineModelInfo) ||
				fallbackOpenRouterModelInfo ||
				openRouterDefaultModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: clineModelId,
				selectedModelInfo: clineModelInfo,
			};
		}
		case "cline-pass": {
			const configuredClinePassModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeClinePassModelId
					: apiConfiguration?.actModeClinePassModelId;
			const clinePassModelId = configuredClinePassModelId?.startsWith(
				"cline-pass/",
			)
				? configuredClinePassModelId
				: clinePassDefaultModelId;
			const clinePassModelInfo =
				(currentMode === "plan"
					? apiConfiguration?.planModeClinePassModelInfo
					: apiConfiguration?.actModeClinePassModelInfo) ||
				resolveClinePassModelInfo(
					clinePassModelId,
					options.clinePassModelInfoByName,
				);
			return {
				selectedProvider: provider,
				selectedModelId: clinePassModelId,
				selectedModelInfo: clinePassModelInfo,
			};
		}
		case "openai": {
			const openAiModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeOpenAiModelId
					: apiConfiguration?.actModeOpenAiModelId;
			const openAiModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeOpenAiModelInfo
					: apiConfiguration?.actModeOpenAiModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: openAiModelId || "",
				selectedModelInfo: openAiModelInfo || openAiModelInfoSafeDefaults,
			};
		}
		case "hicap": {
			const hicapModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeHicapModelId
					: apiConfiguration?.actModeHicapModelId;
			return {
				selectedProvider: provider,
				selectedModelId: hicapModelId || "",
				selectedModelInfo: openAiModelInfoSafeDefaults,
			};
		}
		case "ollama": {
			const ollamaModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeOllamaModelId
					: apiConfiguration?.actModeOllamaModelId;
			return {
				selectedProvider: provider,
				selectedModelId: ollamaModelId || "",
				selectedModelInfo: {
					...openAiModelInfoSafeDefaults,
					contextWindow: Number(
						apiConfiguration?.ollamaApiOptionsCtxNum ?? 32768,
					),
				},
			};
		}
		case "lmstudio": {
			const lmStudioModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeLmStudioModelId
					: apiConfiguration?.actModeLmStudioModelId;
			return {
				selectedProvider: provider,
				selectedModelId: lmStudioModelId || "",
				selectedModelInfo: {
					...openAiModelInfoSafeDefaults,
					contextWindow: Number(apiConfiguration?.lmStudioMaxTokens ?? 32768),
				},
			};
		}
		case "vscode-lm": {
			const vsCodeLmModelSelector =
				currentMode === "plan"
					? apiConfiguration?.planModeVsCodeLmModelSelector
					: apiConfiguration?.actModeVsCodeLmModelSelector;
			return {
				selectedProvider: provider,
				selectedModelId: vsCodeLmModelSelector
					? `${vsCodeLmModelSelector.vendor}/${vsCodeLmModelSelector.family}`
					: "",
				selectedModelInfo: {
					...openAiModelInfoSafeDefaults,
					supportsImages: false,
				},
			};
		}
		case "litellm": {
			const liteLlmModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeLiteLlmModelId
					: apiConfiguration?.actModeLiteLlmModelId;
			const liteLlmModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeLiteLlmModelInfo
					: apiConfiguration?.actModeLiteLlmModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: liteLlmModelId || "",
				selectedModelInfo: liteLlmModelInfo || openAiModelInfoSafeDefaults,
			};
		}
		case "groq": {
			const groqModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeGroqModelId
					: apiConfiguration?.actModeGroqModelId;
			const groqModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeGroqModelInfo
					: apiConfiguration?.actModeGroqModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: groqModelId || "",
				selectedModelInfo: groqModelInfo || openAiModelInfoSafeDefaults,
			};
		}
		case "baseten": {
			const basetenModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeBasetenModelId
					: apiConfiguration?.actModeBasetenModelId;
			const basetenModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeBasetenModelInfo
					: apiConfiguration?.actModeBasetenModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: basetenModelId || "",
				selectedModelInfo: basetenModelInfo || openAiModelInfoSafeDefaults,
			};
		}
		case "huawei-cloud-maas": {
			const huaweiCloudMaasModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeHuaweiCloudMaasModelId
					: apiConfiguration?.actModeHuaweiCloudMaasModelId;
			const huaweiCloudMaasModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeHuaweiCloudMaasModelInfo
					: apiConfiguration?.actModeHuaweiCloudMaasModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: huaweiCloudMaasModelId || "",
				selectedModelInfo: huaweiCloudMaasModelInfo || openAiModelInfoSafeDefaults,
			};
		}
		case "huggingface": {
			const huggingFaceModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeHuggingFaceModelId
					: apiConfiguration?.actModeHuggingFaceModelId;
			const huggingFaceModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeHuggingFaceModelInfo
					: apiConfiguration?.actModeHuggingFaceModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: huggingFaceModelId || "",
				selectedModelInfo: huggingFaceModelInfo || openAiModelInfoSafeDefaults,
			};
		}
		case "dify":
			return {
				selectedProvider: provider,
				selectedModelId: "dify-workflow",
				selectedModelInfo: {
					maxTokens: 8192,
					contextWindow: 128000,
					supportsImages: true,
					supportsPromptCache: false,
					inputPrice: 0,
					outputPrice: 0,
					description:
						"Dify workflow - model selection is configured in your Dify application",
				},
			};
		case "vercel-ai-gateway": {
			const vercelModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeVercelAiGatewayModelId
					: apiConfiguration?.actModeVercelAiGatewayModelId;
			const vercelModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeVercelAiGatewayModelInfo
					: apiConfiguration?.actModeVercelAiGatewayModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: vercelModelId || "",
				selectedModelInfo: vercelModelInfo || openRouterDefaultModelInfo,
			};
		}
		case "oca": {
			const ocaModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeOcaModelId
					: apiConfiguration?.actModeOcaModelId;
			const ocaModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeOcaModelInfo
					: apiConfiguration?.actModeOcaModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: ocaModelId || "",
				selectedModelInfo: ocaModelInfo || openAiModelInfoSafeDefaults,
			};
		}
		case "aihubmix": {
			const aihubmixModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeAihubmixModelId
					: apiConfiguration?.actModeAihubmixModelId;
			const aihubmixModelInfo =
				currentMode === "plan"
					? apiConfiguration?.planModeAihubmixModelInfo
					: apiConfiguration?.actModeAihubmixModelInfo;
			return {
				selectedProvider: provider,
				selectedModelId: aihubmixModelId || "",
				selectedModelInfo: aihubmixModelInfo || openAiModelInfoSafeDefaults,
			};
		}
		case "nousResearch": {
			const nousResearchModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeNousResearchModelId
					: apiConfiguration?.actModeNousResearchModelId;
			return {
				selectedProvider: provider,
				selectedModelId: nousResearchModelId || "",
				selectedModelInfo: openAiModelInfoSafeDefaults,
			}
		}
		case "fireworks": {
			const fireworksModelId =
				currentMode === "plan"
					? apiConfiguration?.planModeFireworksModelId
					: apiConfiguration?.actModeFireworksModelId;
			return {
				selectedProvider: provider,
				selectedModelId: fireworksModelId || "",
				selectedModelInfo: openAiModelInfoSafeDefaults,
			};
		}
		case "cohere":
			return getProviderData(cohereModels, cohereDefaultModelId)
		case "poolside":
			return getProviderData(poolsideModels, poolsideDefaultModelId)
		case "keypoollive": {
			const kplCached = modelId ? getKplModelInfo(modelId) : undefined
			const kplModelInfo: ModelInfo = {
				// Use vault data when available; omit contextWindow if unknown rather than
				// showing an incorrect hardcoded 128k for every vault model.
				...(kplCached?.contextWindow ? { contextWindow: Number(kplCached.contextWindow) } : {}),
				maxTokens: kplCached?.maxOutputTokens
					? Number(kplCached.maxOutputTokens)
					: kplCached?.contextWindow
						? Math.floor(Number(kplCached.contextWindow) * 0.8)
						: undefined,
				supportsImages: kplCached?.supportsImages ?? false,
				supportsPromptCache: kplCached?.supportsPromptCache ?? false,
			}
			return {
				selectedProvider: provider,
				selectedModelId: modelId || "",
				selectedModelInfo: kplModelInfo,
			}
		}
		default:
			return {
				selectedProvider: provider,
				selectedModelId: modelId || "",
				selectedModelInfo: openAiModelInfoSafeDefaults,
			};
	}
}

/**
 * Gets mode-specific field values from API configuration
 * @param apiConfiguration The API configuration object
 * @param mode The current mode ("plan" or "act")
 * @returns Object containing mode-specific field values for clean destructuring
 */
export function getModeSpecificFields(apiConfiguration: ApiConfiguration | undefined, mode: Mode) {
	if (!apiConfiguration) {
		return {
			// Core fields
			apiProvider: undefined,
			apiModelId: undefined,

			// Provider-specific model IDs
			togetherModelId: undefined,
			fireworksModelId: undefined,
			lmStudioModelId: undefined,
			ollamaModelId: undefined,
			liteLlmModelId: undefined,
			requestyModelId: undefined,
			openAiModelId: undefined,
			openRouterModelId: undefined,
			clineModelId: undefined,
			clinePassModelId: undefined,
			groqModelId: undefined,
			basetenModelId: undefined,
			huggingFaceModelId: undefined,
			huaweiCloudMaasModelId: undefined,
			hicapModelId: undefined,
			aihubmixModelId: undefined,
			nousResearchModelId: undefined,
			vercelAiGatewayModelId: undefined,

			// Model info objects
			openAiModelInfo: undefined,
			liteLlmModelInfo: undefined,
			openRouterModelInfo: undefined,
			clineModelInfo: undefined,
			requestyModelInfo: undefined,
			groqModelInfo: undefined,
			basetenModelInfo: undefined,
			huggingFaceModelInfo: undefined,
			vsCodeLmModelSelector: undefined,
			aihubmixModelInfo: undefined,

			// AWS Bedrock fields
			awsBedrockCustomSelected: undefined,
			awsBedrockCustomModelBaseId: undefined,

			// Huawei Cloud Maas Model Info
			huaweiCloudMaasModelInfo: undefined,

			// Other mode-specific fields
			thinkingBudgetTokens: undefined,
			reasoningEffort: undefined,
		}
	}

	const openRouterModelId =
		mode === "plan" ? apiConfiguration.planModeOpenRouterModelId : apiConfiguration.actModeOpenRouterModelId
	const openRouterModelInfo =
		mode === "plan" ? apiConfiguration.planModeOpenRouterModelInfo : apiConfiguration.actModeOpenRouterModelInfo

	const clineModelId = mode === "plan" ? apiConfiguration.planModeClineModelId : apiConfiguration.actModeClineModelId
	const clineModelInfo = mode === "plan" ? apiConfiguration.planModeClineModelInfo : apiConfiguration.actModeClineModelInfo
	const clinePassModelId =
		mode === "plan" ? apiConfiguration.planModeClinePassModelId : apiConfiguration.actModeClinePassModelId
	const clinePassModelInfo =
		mode === "plan" ? apiConfiguration.planModeClinePassModelInfo : apiConfiguration.actModeClinePassModelInfo

	return {
		// Core fields
		apiProvider: mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider,
		apiModelId: mode === "plan" ? apiConfiguration.planModeApiModelId : apiConfiguration.actModeApiModelId,

		// Provider-specific model IDs
		togetherModelId: mode === "plan" ? apiConfiguration.planModeTogetherModelId : apiConfiguration.actModeTogetherModelId,
		fireworksModelId: mode === "plan" ? apiConfiguration.planModeFireworksModelId : apiConfiguration.actModeFireworksModelId,
		lmStudioModelId: mode === "plan" ? apiConfiguration.planModeLmStudioModelId : apiConfiguration.actModeLmStudioModelId,
		ollamaModelId: mode === "plan" ? apiConfiguration.planModeOllamaModelId : apiConfiguration.actModeOllamaModelId,
		liteLlmModelId: mode === "plan" ? apiConfiguration.planModeLiteLlmModelId : apiConfiguration.actModeLiteLlmModelId,
		requestyModelId: mode === "plan" ? apiConfiguration.planModeRequestyModelId : apiConfiguration.actModeRequestyModelId,
		openAiModelId: mode === "plan" ? apiConfiguration.planModeOpenAiModelId : apiConfiguration.actModeOpenAiModelId,
		openRouterModelId,
		clineModelId,
		clinePassModelId,
		groqModelId: mode === "plan" ? apiConfiguration.planModeGroqModelId : apiConfiguration.actModeGroqModelId,
		basetenModelId: mode === "plan" ? apiConfiguration.planModeBasetenModelId : apiConfiguration.actModeBasetenModelId,
		huggingFaceModelId:
			mode === "plan" ? apiConfiguration.planModeHuggingFaceModelId : apiConfiguration.actModeHuggingFaceModelId,
		huaweiCloudMaasModelId:
			mode === "plan" ? apiConfiguration.planModeHuaweiCloudMaasModelId : apiConfiguration.actModeHuaweiCloudMaasModelId,
		ocaModelId: mode === "plan" ? apiConfiguration.planModeOcaModelId : apiConfiguration.actModeOcaModelId,
		hicapModelId: mode === "plan" ? apiConfiguration.planModeHicapModelId : apiConfiguration.actModeHicapModelId,
		aihubmixModelId: mode === "plan" ? apiConfiguration.planModeAihubmixModelId : apiConfiguration.actModeAihubmixModelId,
		nousResearchModelId:
			mode === "plan" ? apiConfiguration.planModeNousResearchModelId : apiConfiguration.actModeNousResearchModelId,
		vercelAiGatewayModelId:
			mode === "plan" ? apiConfiguration.planModeVercelAiGatewayModelId : apiConfiguration.actModeVercelAiGatewayModelId,

		// Model info objects
		openAiModelInfo: mode === "plan" ? apiConfiguration.planModeOpenAiModelInfo : apiConfiguration.actModeOpenAiModelInfo,
		liteLlmModelInfo: mode === "plan" ? apiConfiguration.planModeLiteLlmModelInfo : apiConfiguration.actModeLiteLlmModelInfo,
		openRouterModelInfo,
		clineModelInfo,
		clinePassModelInfo,
		requestyModelInfo:
			mode === "plan" ? apiConfiguration.planModeRequestyModelInfo : apiConfiguration.actModeRequestyModelInfo,
		groqModelInfo: mode === "plan" ? apiConfiguration.planModeGroqModelInfo : apiConfiguration.actModeGroqModelInfo,
		basetenModelInfo: mode === "plan" ? apiConfiguration.planModeBasetenModelInfo : apiConfiguration.actModeBasetenModelInfo,
		huggingFaceModelInfo:
			mode === "plan" ? apiConfiguration.planModeHuggingFaceModelInfo : apiConfiguration.actModeHuggingFaceModelInfo,
		vsCodeLmModelSelector:
			mode === "plan" ? apiConfiguration.planModeVsCodeLmModelSelector : apiConfiguration.actModeVsCodeLmModelSelector,
		hicapModelInfo: mode === "plan" ? apiConfiguration.planModeHicapModelInfo : apiConfiguration.actModeHicapModelInfo,
		aihubmixModelInfo:
			mode === "plan" ? apiConfiguration.planModeAihubmixModelInfo : apiConfiguration.actModeAihubmixModelInfo,
		vercelAiGatewayModelInfo:
			mode === "plan"
				? apiConfiguration.planModeVercelAiGatewayModelInfo
				: apiConfiguration.actModeVercelAiGatewayModelInfo,

		// AWS Bedrock fields
		awsBedrockCustomSelected:
			mode === "plan"
				? apiConfiguration.planModeAwsBedrockCustomSelected
				: apiConfiguration.actModeAwsBedrockCustomSelected,
		awsBedrockCustomModelBaseId:
			mode === "plan"
				? apiConfiguration.planModeAwsBedrockCustomModelBaseId
				: apiConfiguration.actModeAwsBedrockCustomModelBaseId,

		// Huawei Cloud Maas Model Info
		huaweiCloudMaasModelInfo:
			mode === "plan"
				? apiConfiguration.planModeHuaweiCloudMaasModelInfo
				: apiConfiguration.actModeHuaweiCloudMaasModelInfo,

		// Other mode-specific fields
		thinkingBudgetTokens:
			mode === "plan" ? apiConfiguration.planModeThinkingBudgetTokens : apiConfiguration.actModeThinkingBudgetTokens,
		reasoningEffort: mode === "plan" ? apiConfiguration.planModeReasoningEffort : apiConfiguration.actModeReasoningEffort,
		// Oracle Code Assist
		ocaModelInfo: mode === "plan" ? apiConfiguration.planModeOcaModelInfo : apiConfiguration.actModeOcaModelInfo,
	}
}

/**
 * Synchronizes mode configurations by copying the source mode's settings to both modes
 * This is used when the "Use different models for Plan and Act modes" toggle is unchecked
 */
export async function syncModeConfigurations(
	apiConfiguration: ApiConfiguration | undefined,
	sourceMode: Mode,
	handleFieldsChange: (updates: Partial<ApiConfiguration>) => Promise<void>,
): Promise<void> {
	if (!apiConfiguration) {
		return
	}

	const sourceFields = getModeSpecificFields(apiConfiguration, sourceMode)
	const { apiProvider } = sourceFields

	if (!apiProvider) {
		return
	}

	// Build the complete update object with both plan and act mode fields
	const updates: Partial<ApiConfiguration> = {
		// Always sync common fields
		planModeApiProvider: sourceFields.apiProvider,
		actModeApiProvider: sourceFields.apiProvider,
		planModeThinkingBudgetTokens: sourceFields.thinkingBudgetTokens,
		actModeThinkingBudgetTokens: sourceFields.thinkingBudgetTokens,
		planModeReasoningEffort: sourceFields.reasoningEffort,
		actModeReasoningEffort: sourceFields.reasoningEffort,
	}

	// Handle provider-specific fields
	switch (apiProvider) {
		case "openrouter":
			updates.planModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.actModeOpenRouterModelId = sourceFields.openRouterModelId
			updates.planModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			updates.actModeOpenRouterModelInfo = sourceFields.openRouterModelInfo
			break

		case "cline":
			updates.planModeClineModelId = sourceFields.clineModelId
			updates.actModeClineModelId = sourceFields.clineModelId
			updates.planModeClineModelInfo = sourceFields.clineModelInfo
			updates.actModeClineModelInfo = sourceFields.clineModelInfo
			break

		case "requesty":
			updates.planModeRequestyModelId = sourceFields.requestyModelId
			updates.actModeRequestyModelId = sourceFields.requestyModelId
			updates.planModeRequestyModelInfo = sourceFields.requestyModelInfo
			updates.actModeRequestyModelInfo = sourceFields.requestyModelInfo
			break

		case "openai":
			updates.planModeOpenAiModelId = sourceFields.openAiModelId
			updates.actModeOpenAiModelId = sourceFields.openAiModelId
			updates.planModeOpenAiModelInfo = sourceFields.openAiModelInfo
			updates.actModeOpenAiModelInfo = sourceFields.openAiModelInfo
			break

		case "ollama":
			updates.planModeOllamaModelId = sourceFields.ollamaModelId
			updates.actModeOllamaModelId = sourceFields.ollamaModelId
			break

		case "lmstudio":
			updates.planModeLmStudioModelId = sourceFields.lmStudioModelId
			updates.actModeLmStudioModelId = sourceFields.lmStudioModelId
			break

		case "vscode-lm":
			updates.planModeVsCodeLmModelSelector = sourceFields.vsCodeLmModelSelector
			updates.actModeVsCodeLmModelSelector = sourceFields.vsCodeLmModelSelector
			break

		case "litellm":
			updates.planModeLiteLlmModelId = sourceFields.liteLlmModelId
			updates.actModeLiteLlmModelId = sourceFields.liteLlmModelId
			updates.planModeLiteLlmModelInfo = sourceFields.liteLlmModelInfo
			updates.actModeLiteLlmModelInfo = sourceFields.liteLlmModelInfo
			break

		case "groq":
			updates.planModeGroqModelId = sourceFields.groqModelId
			updates.actModeGroqModelId = sourceFields.groqModelId
			updates.planModeGroqModelInfo = sourceFields.groqModelInfo
			updates.actModeGroqModelInfo = sourceFields.groqModelInfo
			break

		case "huggingface":
			updates.planModeHuggingFaceModelId = sourceFields.huggingFaceModelId
			updates.actModeHuggingFaceModelId = sourceFields.huggingFaceModelId
			updates.planModeHuggingFaceModelInfo = sourceFields.huggingFaceModelInfo
			updates.actModeHuggingFaceModelInfo = sourceFields.huggingFaceModelInfo
			break

		case "baseten":
			updates.planModeBasetenModelId = sourceFields.basetenModelId
			updates.actModeBasetenModelId = sourceFields.basetenModelId
			updates.planModeBasetenModelInfo = sourceFields.basetenModelInfo
			updates.actModeBasetenModelInfo = sourceFields.basetenModelInfo
			break

		case "together":
			updates.planModeTogetherModelId = sourceFields.togetherModelId
			updates.actModeTogetherModelId = sourceFields.togetherModelId
			break

		case "fireworks":
			updates.planModeFireworksModelId = sourceFields.fireworksModelId
			updates.actModeFireworksModelId = sourceFields.fireworksModelId
			break

		case "bedrock":
			updates.planModeApiModelId = sourceFields.apiModelId
			updates.actModeApiModelId = sourceFields.apiModelId
			updates.planModeAwsBedrockCustomSelected = sourceFields.awsBedrockCustomSelected
			updates.actModeAwsBedrockCustomSelected = sourceFields.awsBedrockCustomSelected
			updates.planModeAwsBedrockCustomModelBaseId = sourceFields.awsBedrockCustomModelBaseId
			updates.actModeAwsBedrockCustomModelBaseId = sourceFields.awsBedrockCustomModelBaseId
			break
		case "huawei-cloud-maas":
			updates.planModeHuaweiCloudMaasModelId = sourceFields.huaweiCloudMaasModelId
			updates.actModeHuaweiCloudMaasModelId = sourceFields.huaweiCloudMaasModelId
			updates.planModeHuaweiCloudMaasModelInfo = sourceFields.huaweiCloudMaasModelInfo
			updates.actModeHuaweiCloudMaasModelInfo = sourceFields.huaweiCloudMaasModelInfo
			break

		case "dify":
			// Dify doesn't have mode-specific model configurations
			// The model is configured in the Dify application itself
			break

		case "hicap":
			updates.planModeHicapModelId = sourceFields.hicapModelId
			updates.actModeHicapModelId = sourceFields.hicapModelId
			updates.planModeHicapModelInfo = sourceFields.hicapModelInfo
			updates.actModeHicapModelInfo = sourceFields.hicapModelInfo
			break

		case "vercel-ai-gateway":
			// Vercel AI Gateway uses its own model fields
			updates.planModeVercelAiGatewayModelId = sourceFields.vercelAiGatewayModelId
			updates.actModeVercelAiGatewayModelId = sourceFields.vercelAiGatewayModelId
			updates.planModeVercelAiGatewayModelInfo = sourceFields.vercelAiGatewayModelInfo
			updates.actModeVercelAiGatewayModelInfo = sourceFields.vercelAiGatewayModelInfo
			break
		case "oca":
			updates.planModeOcaModelId = sourceFields.ocaModelId
			updates.actModeOcaModelId = sourceFields.ocaModelId
			updates.planModeOcaModelInfo = sourceFields.ocaModelInfo
			updates.actModeOcaModelInfo = sourceFields.ocaModelInfo
			break
		case "nousResearch":
			updates.planModeNousResearchModelId = sourceFields.nousResearchModelId
			updates.actModeNousResearchModelId = sourceFields.nousResearchModelId
			break

		case "aihubmix":
			updates.planModeAihubmixModelId = sourceFields.aihubmixModelId
			updates.planModeAihubmixModelInfo = sourceFields.aihubmixModelInfo
			updates.actModeAihubmixModelId = sourceFields.aihubmixModelId
			updates.actModeAihubmixModelInfo = sourceFields.aihubmixModelInfo
			break

		// Default branch: providers that use the common `apiProvider` +
		// `apiModelId` ApiConfiguration field pair (anthropic, claude-code,
		// vertex, gemini, openai-native, openai-codex, deepseek, qwen,
		// doubao, mistral, asksage, xai, nebius, wandb, sambanova,
		// cerebras, sapaicore, zai, minimax, cohere, poolside, keypoollive).
		default:
			updates.planModeApiModelId = sourceFields.apiModelId
			updates.actModeApiModelId = sourceFields.apiModelId
			break
	}

	// Make the atomic update
	await handleFieldsChange(updates)
}

export { filterOpenRouterModelIds } from "@shared/utils/model-filters"
