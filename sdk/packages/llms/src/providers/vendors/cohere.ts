import { createCohere } from "@ai-sdk/cohere";
import type { GatewayResolvedProviderConfig } from "@sctg/cline-shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

export async function createCohereProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const provider = createCohere({
		apiKey: await resolveApiKey(config),
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: config.fetch,
	});
	return {
		model: (modelId) => provider(modelId),
	};
}
