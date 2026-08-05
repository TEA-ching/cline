// KeypoolLive — handler: keypoolInstallUpdate
// © 2026 Ronan LE MEILLAT — MIT License

import * as fs from "fs"
import * as path from "path"
import { Uri, commands } from "vscode"
import { KeypoolInstallUpdateRequest, KeypoolInstallUpdateResponse } from "@shared/proto/cline/models"
import { ClineTempManager } from "@/services/temp/ClineTempManager"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

export async function keypoolInstallUpdate(
	_controller: Controller,
	request: KeypoolInstallUpdateRequest,
): Promise<KeypoolInstallUpdateResponse> {
	if (!request.downloadUrl || !request.assetName) {
		return KeypoolInstallUpdateResponse.create({ success: false, error: "Missing download URL or asset name" })
	}

	const tempDir = ClineTempManager.getTempDir()
	const tempPath = path.join(tempDir, `keypool-update-${Date.now()}-${request.assetName}`)

	try {
		const response = await fetch(request.downloadUrl)

		if (!response.ok) {
			return KeypoolInstallUpdateResponse.create({
				success: false,
				error: `Download failed: ${response.status} ${response.statusText}`,
			})
		}

		const buffer = await response.arrayBuffer()
		await fs.promises.writeFile(tempPath, Buffer.from(buffer))

		await commands.executeCommand("workbench.extensions.installExtension", Uri.file(tempPath))

		// Temp file cleanup is handled by ClineTempManager's periodic cleanup
		return KeypoolInstallUpdateResponse.create({ success: true })
	} catch (err) {
		Logger.error("[keypoolInstallUpdate] Failed to install update:", err)

		// Best-effort cleanup on error
		fs.promises.unlink(tempPath).catch(() => undefined)

		return KeypoolInstallUpdateResponse.create({
			success: false,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}
