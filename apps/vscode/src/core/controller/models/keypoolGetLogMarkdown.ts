// KeypoolLive — handler: keypoolGetLogMarkdown
// © 2026 Ronan LE MEILLAT — MIT License

import { KeypoolLogTimestampRequest, KeypoolLogMarkdownResponse } from "@shared/proto/cline/models"
import { KeypoolLog } from "@/core/keypoollive/KeypoolLog"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

export async function keypoolGetLogMarkdown(
	_controller: Controller,
	request: KeypoolLogTimestampRequest,
): Promise<KeypoolLogMarkdownResponse> {
	try {
		const entry = KeypoolLog.getLogEntryByTimestamp(request.timestamp)
		if (!entry) {
			return KeypoolLogMarkdownResponse.create({ found: false, markdown: "" })
		}
		const markdown = KeypoolLog.logEntryToMarkdown(entry)
		return KeypoolLogMarkdownResponse.create({ found: true, markdown })
	} catch (err) {
		Logger.error("[keypoolGetLogMarkdown] Failed to get log entry:", err)
		return KeypoolLogMarkdownResponse.create({ found: false, markdown: "" })
	}
}
