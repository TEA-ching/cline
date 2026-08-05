// KeypoolLive — handler: keypoolRotateKey
// © 2026 Ronan LE MEILLAT — MIT License

import { KeypoolRotateKeyRequest, KeypoolRotateKeyResponse } from "@shared/proto/cline/models"
import { configureSessionKeyManager, rotateSessionKey } from "@/core/keypoollive/SessionKeyManager"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

const KEYPOOLLIVE_SESSION_ID = "kpl-global"

/**
 * Manually rotates the active key for the current KeypoolLive session.
 */
export async function keypoolRotateKey(
	controller: Controller,
	request: KeypoolRotateKeyRequest,
): Promise<KeypoolRotateKeyResponse> {
	try {
		// configureSessionKeyManager is normally called in KeypoolLiveHandler constructor,
		// but the handler may not have been instantiated yet (no task started).
		// Read the vault URL directly from the persisted config as a fallback.
		const apiConfig = controller.stateManager.getApiConfiguration()
		if (apiConfig.keypoolliveVaultUrl) {
			if (apiConfig.keypoolliveSecret) {
				process.env.KEYPOOL_LIVE_SECRET = apiConfig.keypoolliveSecret
			}
			configureSessionKeyManager(apiConfig.keypoolliveVaultUrl)
		}

		const resolved = await rotateSessionKey(
			KEYPOOLLIVE_SESSION_ID,
			request.providerName,
			request.modelId || undefined,
			"user_request",
		)

		if (!resolved) {
			return KeypoolRotateKeyResponse.create({
				success: false,
				error: "No available key found for the requested provider/model",
			})
		}

		const hint = `***${resolved.apiKey.slice(-8)}`
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const vsc = require("vscode") as typeof import("vscode")
			vsc.window.showInformationMessage(`[KeypoolLive] Key rotated — owner: ${resolved.keyOwner} | key: ${hint}`)
		} catch {
			// standalone mode, vscode unavailable
		}
		return KeypoolRotateKeyResponse.create({
			success: true,
			newKeyHint: hint,
			newKeyOwner: resolved.keyOwner,
		})
	} catch (err) {
		Logger.error("[keypoolRotateKey] Failed to rotate key:", err)
		return KeypoolRotateKeyResponse.create({
			success: false,
			error: String(err),
		})
	}
}
