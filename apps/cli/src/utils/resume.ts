import type { ClineCore } from "@sctg/cline-core";
import type { Message } from "@sctg/cline-shared";

export async function loadInteractiveResumeMessages(
	sessionManager: ClineCore,
	resumeSessionId?: string,
): Promise<Message[] | undefined> {
	const target = resumeSessionId?.trim();
	if (!target) {
		return undefined;
	}
	return await sessionManager.readMessages(target);
}
