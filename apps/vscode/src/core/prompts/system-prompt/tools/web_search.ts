import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.WEB_SEARCH,
	name: "search_web",
	description: `Performs a web search and returns relevant results
- Takes a search query as input and returns search results with titles and URLs
- Optionally filter results by allowed or blocked domains
- Use this tool when you need to search the web for information
- This tool rely on a third-party search API and may have limitations on query length and number of results
- The query must be at least 2 characters
- You may provide either allowed_domains OR blocked_domains, but NOT both
- Domains should be provided as a JSON array of strings
- This tool is read-only and does not modify any files
- For fetching specific URLs, use fetch_web_content instead`,
	contextRequirements: (context) => context.providerInfo.providerId !== "cline" || context.clineWebToolsEnabled === true,
	parameters: [
		{
			name: "query",
			required: true,
			instruction: "The search query to use",
			usage: "latest developments in AI",
		},
		{
			name: "allowed_domains",
			required: false,
			instruction: "JSON array of domains to restrict results to",
			usage: '["example.com", "github.com"]',
		},
		{
			name: "blocked_domains",
			required: false,
			instruction: "JSON array of domains to exclude from results",
			usage: '["ads.com", "spam.com"]',
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id: ClineDefaultTool.WEB_SEARCH,
	name: "search_web",
	description:
		"Performs a web search and returns relevant results with titles and URLs. This tool rely on a third-party search API and may have limitations on query length and number of results. Use this tool when you need to search the web for information.",
	contextRequirements: (context) => context.providerInfo.providerId !== "cline" || context.clineWebToolsEnabled === true,
	parameters: [
		{
			name: "query",
			required: true,
			instruction: "The search query to use",
		},
		{
			name: "allowed_domains",
			required: false,
			instruction: "JSON array of domains to restrict results to",
		},
		{
			name: "blocked_domains",
			required: false,
			instruction: "JSON array of domains to exclude from results",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const web_search_variants = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN]
