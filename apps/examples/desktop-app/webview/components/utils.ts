import { formatDisplayUserInput } from "@sctg/cline-shared/browser";

export function normalizeTitle(title?: string): string {
	if (!title?.trim()) return "";
	return formatDisplayUserInput(title);
}
