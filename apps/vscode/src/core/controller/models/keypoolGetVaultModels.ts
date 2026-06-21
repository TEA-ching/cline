// KeypoolLive — handler: keypoolGetVaultModels
// © 2026 Ronan LE MEILLAT — MIT License

import { EmptyRequest } from "@shared/proto/cline/common"
import { KeypoolVaultModel, KeypoolVaultModelsResponse } from "@shared/proto/cline/models"
import { loadAiVault } from "@/core/keypoollive/AiVault"
import { buildModelDescriptions } from "@/core/keypoollive/KeyPool"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."
import { keypoolInjectEnvConfig } from "./keypoolInjectEnvConfig"

/**
 * Returns the list of models available in the KeypoolLive vault.
 */
export async function keypoolGetVaultModels(controller: Controller, _request: EmptyRequest): Promise<KeypoolVaultModelsResponse> {
	try {
		keypoolInjectEnvConfig(controller)

		const apiConfig = controller.stateManager.getApiConfiguration()
		const vaultUrl = apiConfig.keypoolliveVaultUrl
		const secret = apiConfig.keypoolliveSecret

		if (!vaultUrl || !secret) {
			return KeypoolVaultModelsResponse.create({ models: [] })
		}
		const vault = await loadAiVault(vaultUrl)
		const kplConfig = {
			vaultUrl,
			secret,
			useGateway: apiConfig.keypoolliveUseGateway ?? false,
			gatewaySecret: apiConfig.keypoolliveGatewaySecret,
			gatewayId: apiConfig.keypoolliveGatewayId,
			gatewayCacheSkip: apiConfig.keypoolliveGatewayCacheSkip ?? false,
		}

		const descriptions = buildModelDescriptions(vault, kplConfig)
		const models: KeypoolVaultModel[] = descriptions.map((d) =>
			KeypoolVaultModel.create({
				vaultProviderName: d.vaultProviderName,
				vaultModelId: d.vaultModelId,
				title: d.title,
				combinedId: `${d.vaultProviderName}/${d.vaultModelId}`,
				clineProvider: d.clineProvider ?? undefined,
				contextWindow: d.contextWindow,
				maxOutputTokens: d.maxOutputTokens,
				supportsImages: d.supportsImages,
				supportsPromptCache: d.supportsPromptCache,
			}),
		)

		return KeypoolVaultModelsResponse.create({ models })
	} catch (err) {
		Logger.error("[keypoolGetVaultModels] Failed to load vault models:", err)
		return KeypoolVaultModelsResponse.create({ models: [] })
	}
}
