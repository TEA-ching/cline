// KeypoolLive — handler: keypoolSaveLogMarkdown
// © 2026 Ronan LE MEILLAT — MIT License

import { Uri, window, workspace } from "vscode"
import { KeypoolLogTimestampRequest, KeypoolSaveLogResponse } from "@shared/proto/cline/models"
import { KeypoolLog } from "@/core/keypoollive/KeypoolLog"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

export async function keypoolSaveLogMarkdown(
	_controller: Controller,
	request: KeypoolLogTimestampRequest,
): Promise<KeypoolSaveLogResponse> {
	try {
		const entry = KeypoolLog.getLogEntryByTimestamp(request.timestamp)
		if (!entry) {
			return KeypoolSaveLogResponse.create({ success: false, error: "Log entry not found" })
		}

		const markdown = KeypoolLog.logEntryToMarkdown(entry)

		const defaultName = `keypool-log-${entry.timestamp}.md`
		const selectedUri = await window.showSaveDialog({
			defaultUri: Uri.file(defaultName),
			filters: { Markdown: ["md"] },
		})

		if (!selectedUri) {
			return KeypoolSaveLogResponse.create({ success: false, error: "Save cancelled" })
		}

		await workspace.fs.writeFile(selectedUri, new TextEncoder().encode(markdown))
		return KeypoolSaveLogResponse.create({ success: true })
	} catch (err) {
		Logger.error("[keypoolSaveLogMarkdown] Failed to save log entry:", err)
		return KeypoolSaveLogResponse.create({
			success: false,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}
