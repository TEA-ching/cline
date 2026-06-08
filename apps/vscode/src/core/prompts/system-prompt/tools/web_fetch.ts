import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.WEB_FETCH,
	name: "fetch_web_content",
	description: `Fetches content from a specified URL and analyzes it using your prompt
- Takes a URL and analysis prompt as input
- Fetches the URL content and processes based on your prompt
- Use this tool when you need to retrieve and analyze web content
- This tool can access standard web pages and javascript-rendered content.
- The URL must be a fully-formed valid URL
- The prompt must be at least 2 characters
- HTTP URLs will be automatically upgraded to HTTPS
- This tool is read-only and does not modify any files
- This tool returns the extracted content rendered in markdown, not the raw webpage content`,
	contextRequirements: (context) => context.providerInfo.providerId !== "cline" || context.clineWebToolsEnabled === true,
	parameters: [
		{
			name: "url",
			required: true,
			instruction: "The URL to fetch content from",
			usage: "https://example.com/docs",
		},
		{
			name: "prompt",
			required: true,
			instruction: "The prompt to use for analyzing the webpage content",
			usage: "Summarize the main points and key takeaways",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id: ClineDefaultTool.WEB_FETCH,
	name: "fetch_web_content",
	description:
		"Fetches and analyzes content from a specified URL. This tool can access standard web pages and javascript-rendered content. This tool return the content of the rendered web page as a markdown code block in the response. Use this tool when you need to retrieve and analyze web content.",
	contextRequirements: (context) => context.providerInfo.providerId !== "cline" || context.clineWebToolsEnabled === true,
	parameters: [
		{
			name: "url",
			required: true,
			instruction: "The URL to fetch content from",
		},
		{
			name: "prompt",
			required: true,
			instruction: "Prompt for analyzing the webpage content",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const web_fetch_variants = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN]
