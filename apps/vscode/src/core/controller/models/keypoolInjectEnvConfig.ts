// KeypoolLive — shared helper: inject env vars from API configuration
// © 2026 Ronan LE MEILLAT — MIT License

import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/**
 * Injects KEYPOOL_LIVE_SECRET and KEYPOOL_LIVE_REMOTE_STORAGE_URL into
 * process.env so that KeypoolUsageDb.getEffectiveRemoteConfig() can pick them
 * up regardless of which handler is called first after an extension host restart.
 *
 * Must be called at the start of every KeypoolLive gRPC handler that touches
 * KeypoolUsageDb (stats, purge, and vault-model listing).
 */
export function keypoolInjectEnvConfig(controller: Controller): void {
	const apiConfig = controller.stateManager.getApiConfiguration()
	const secret = apiConfig.keypoolliveSecret
	const remoteStorageUrl = apiConfig.keypoolliveRemoteStorageUrl
	const aggressiveRotation = apiConfig.keypoolliveAggressiveRotation

	if (secret) {
		process.env.KEYPOOL_LIVE_SECRET = secret
	}

	if (remoteStorageUrl) {
		Logger.debug("[keypoolInjectEnvConfig] Injecting remote storage URL:", remoteStorageUrl)
		process.env.KEYPOOL_LIVE_REMOTE_STORAGE_URL = remoteStorageUrl
	}

	if (aggressiveRotation) {
		Logger.debug("[keypoolInjectEnvConfig] Injecting aggressive rotation flag")
		process.env.KEYPOOL_LIVE_AGGRESSIVE_ROTATION = "true"
	}
}
