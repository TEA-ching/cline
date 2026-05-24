// KeypoolLive — handler: keypoolRotateKey
// © 2026 Ronan LE MEILLAT — MIT License

import { KeypoolRotateKeyRequest, KeypoolRotateKeyResponse } from "@shared/proto/cline/models"
import { rotateSessionKey } from "@/core/keypoollive/SessionKeyManager"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

const KEYPOOLLIVE_SESSION_ID = "kpl-global"

/**
 * Manually rotates the active key for the current KeypoolLive session.
 */
export async function keypoolRotateKey(
	_controller: Controller,
	request: KeypoolRotateKeyRequest,
): Promise<KeypoolRotateKeyResponse> {
	try {
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

		return KeypoolRotateKeyResponse.create({
			success: true,
			newKeyHint: resolved.apiKey.slice(-8),
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
