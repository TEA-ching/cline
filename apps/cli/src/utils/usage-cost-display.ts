import { Llms } from "@sctg/cline-core";

export function shouldShowCliUsageCost(providerId: string): boolean {
	return Llms.shouldShowProviderUsageCost(providerId);
}
