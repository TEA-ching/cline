import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const BASE_DESCRIPTION = `Fetches content from a specified URL and analyzes it using your prompt
- Takes a URL and analysis prompt as input
- Fetches the URL content and processes based on your prompt
- Use this tool when you need to retrieve and analyze web content
- This tool can access standard web pages and javascript-rendered content.
- The URL must be a fully-formed valid URL
- The prompt must be at least 2 characters
- HTTP URLs will be automatically upgraded to HTTPS
- This tool is read-only and does not modify any files
- This tool returns the extracted content rendered in markdown, not the raw webpage content`

const FIRECRAWL_DESCRIPTION = `${BASE_DESCRIPTION}
- Supports multiple output formats: markdown (default), HTML, raw HTML, links, screenshot, summary, structured JSON extraction, Q&A, and text highlights
- Supports browser automation actions before scraping: click, type, scroll, wait, execute JavaScript, take screenshot
- Supports mobile device emulation, geographic location context, custom HTTP headers, and HTML tag filtering`

const BASE_DESCRIPTION_NATIVE = "Fetches and analyzes content from a specified URL. This tool can access standard web pages and javascript-rendered content. This tool return the content of the rendered web page as a markdown code block in the response. Use this tool when you need to retrieve and analyze web content."

const FIRECRAWL_DESCRIPTION_NATIVE = `${BASE_DESCRIPTION_NATIVE} Supports multiple output formats (markdown, HTML, links, screenshot, JSON extraction, Q&A, highlights), browser automation actions (click, type, scroll, wait, JavaScript execution), mobile emulation, geographic location context, custom HTTP headers, and HTML tag filtering.`

const FIRECRAWL_CONTEXT = (context: { firecrawlEnabled?: boolean }) => !!context.firecrawlEnabled

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.WEB_FETCH,
	name: "fetch_web_content",
	description: (context) => context.firecrawlEnabled ? FIRECRAWL_DESCRIPTION : BASE_DESCRIPTION,
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
		{
			name: "formats",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON array of output format objects. Supported types: {\"type\":\"markdown\"} (default), {\"type\":\"html\"}, {\"type\":\"rawHtml\"}, {\"type\":\"links\"}, {\"type\":\"screenshot\"}, {\"type\":\"summary\"}, {\"type\":\"json\",\"prompt\":\"Extract title and price\"}, {\"type\":\"question\",\"question\":\"What are the main features?\"}, {\"type\":\"highlights\",\"query\":\"pricing\"}. Multiple formats can be requested in one call.",
			usage: "[{\"type\":\"question\",\"question\":\"What is the return policy?\"},{\"type\":\"links\"}]",
		},
		{
			name: "onlyMainContent",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "When true (default), strips navigation, ads, headers, and footers from the output. Set to false to include the full page content.",
			usage: "false",
		},
		{
			name: "waitFor",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "Milliseconds to wait for JavaScript-rendered content to load before scraping. Use for SPAs, React/Vue apps, or pages with lazy-loaded content.",
			usage: "2000",
		},
		{
			name: "actions",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON array of browser automation steps to run before scraping. Supported: {\"type\":\"click\",\"selector\":\"#btn\"}, {\"type\":\"write\",\"text\":\"hello\"}, {\"type\":\"press\",\"key\":\"Enter\"}, {\"type\":\"wait\",\"milliseconds\":500}, {\"type\":\"wait\",\"selector\":\"#loaded\"}, {\"type\":\"scroll\",\"direction\":\"down\"}, {\"type\":\"screenshot\"}, {\"type\":\"executeJavascript\",\"script\":\"...\"}. Note: use a click action to focus an input before write.",
			usage: "[{\"type\":\"click\",\"selector\":\"#load-more\"},{\"type\":\"wait\",\"milliseconds\":1000}]",
		},
		{
			name: "mobile",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "Set to true to emulate a mobile device viewport when scraping. Useful for testing responsive pages or accessing mobile-specific content.",
			usage: "true",
		},
		{
			name: "proxy",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "Proxy level for anti-bot evasion: \"basic\" (fast, default), \"enhanced\" (stronger, costs 5 credits), \"auto\" (retries with enhanced if basic fails).",
			usage: "enhanced",
		},
		{
			name: "headers",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON object of custom HTTP headers to send with the request. Useful for authenticated endpoints.",
			usage: "{\"Authorization\":\"Bearer my-token\"}",
		},
		{
			name: "includeTags",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON array of HTML tag names to include in the scraped output. All other tags are excluded.",
			usage: "[\"article\",\"main\",\"section\"]",
		},
		{
			name: "excludeTags",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON array of HTML tag names to exclude from the scraped output.",
			usage: "[\"nav\",\"footer\",\"aside\",\"script\"]",
		},
		{
			name: "location",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON object specifying geographic context for locale-specific content. country is an ISO 3166-1 alpha-2 code.",
			usage: "{\"country\":\"DE\",\"languages\":[\"de-DE\"]}",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id: ClineDefaultTool.WEB_FETCH,
	name: "fetch_web_content",
	description: (context) => context.firecrawlEnabled ? FIRECRAWL_DESCRIPTION_NATIVE : BASE_DESCRIPTION_NATIVE,
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
		{
			name: "formats",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON array of output format objects. Supported: {\"type\":\"markdown\"} (default), {\"type\":\"html\"}, {\"type\":\"rawHtml\"}, {\"type\":\"links\"}, {\"type\":\"screenshot\"}, {\"type\":\"summary\"}, {\"type\":\"json\",\"prompt\":\"...\"}, {\"type\":\"question\",\"question\":\"...\"}, {\"type\":\"highlights\",\"query\":\"...\"}",
		},
		{
			name: "onlyMainContent",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "When true (default), strips navigation, ads, headers, and footers. Set to false to include full page content.",
		},
		{
			name: "waitFor",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "Milliseconds to wait for JavaScript-rendered content before scraping. Use for SPAs and lazy-loaded pages.",
		},
		{
			name: "actions",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON array of browser automation steps before scraping: {\"type\":\"click\",\"selector\":\"...\"}, {\"type\":\"write\",\"text\":\"...\"}, {\"type\":\"press\",\"key\":\"...\"}, {\"type\":\"wait\",\"milliseconds\":N}, {\"type\":\"wait\",\"selector\":\"...\"}, {\"type\":\"scroll\",\"direction\":\"down\"}, {\"type\":\"screenshot\"}, {\"type\":\"executeJavascript\",\"script\":\"...\"}",
		},
		{
			name: "mobile",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "Set to true to emulate a mobile device viewport.",
		},
		{
			name: "proxy",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "Proxy level for anti-bot evasion: \"basic\" (fast), \"enhanced\" (stronger, 5 credits), \"auto\" (retries with enhanced on failure).",
		},
		{
			name: "headers",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON object of custom HTTP headers, e.g. {\"Authorization\":\"Bearer token\"}.",
		},
		{
			name: "includeTags",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON array of HTML tags to include in output, e.g. [\"article\",\"main\"].",
		},
		{
			name: "excludeTags",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON array of HTML tags to exclude from output, e.g. [\"nav\",\"footer\"].",
		},
		{
			name: "location",
			required: false,
			contextRequirements: FIRECRAWL_CONTEXT,
			instruction: "JSON object for geo-specific content, e.g. {\"country\":\"DE\",\"languages\":[\"de-DE\"]}.",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const web_fetch_variants = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN]
