import { ClineAsk, ClineSayTool } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import axios from "axios"
import { ClineEnv } from "@/config"
import { createVaultCrawlerResolver } from "@core/keypoollive/CrawlerKeyResolver"
import { AuthService } from "@/services/auth/AuthService"
import { buildClineExtraHeaders } from "@/services/EnvUtils"
import { featureFlagsService } from "@/services/feature-flags"
import { telemetryService } from "@/services/telemetry"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@/shared/ClineAccount"
import { fetchWithFirecrawl, type WebFetchOptions } from "@/shared/crawlerFetch"
import { getAxiosSettings } from "@/shared/net"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

function tryParseJSON<T>(raw: string | undefined): T | undefined {
	if (!raw) return undefined;
	try { return JSON.parse(raw) as T; } catch { return undefined; }
}

function parseWebFetchOptions(params: Partial<Record<string, string>>): WebFetchOptions {
	const opts: WebFetchOptions = {};

	const formats = tryParseJSON<WebFetchOptions["formats"]>(params.formats);
	if (formats) opts.formats = formats;

	if (params.onlyMainContent !== undefined) opts.onlyMainContent = params.onlyMainContent !== "false";
	if (params.onlyCleanContent !== undefined) opts.onlyCleanContent = params.onlyCleanContent === "true";

	if (params.waitFor) {
		const ms = parseInt(params.waitFor, 10);
		if (!isNaN(ms)) opts.waitFor = ms;
	}

	if (params.mobile !== undefined) opts.mobile = params.mobile !== "false";

	if (params.proxy === "basic" || params.proxy === "enhanced" || params.proxy === "auto") {
		opts.proxy = params.proxy;
	}

	const headers = tryParseJSON<Record<string, string>>(params.headers);
	if (headers && Object.keys(headers).length > 0) opts.headers = headers;

	const includeTags = tryParseJSON<string[]>(params.includeTags);
	if (includeTags?.length) opts.includeTags = includeTags;

	const excludeTags = tryParseJSON<string[]>(params.excludeTags);
	if (excludeTags?.length) opts.excludeTags = excludeTags;

	const location = tryParseJSON<WebFetchOptions["location"]>(params.location);
	if (location) opts.location = location;

	const actions = tryParseJSON<WebFetchOptions["actions"]>(params.actions);
	if (actions?.length) opts.actions = actions;

	return opts;
}

export class WebFetchToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.WEB_FETCH

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.url}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const url = block.params.url || ""
		const sharedMessageProps: ClineSayTool = {
			tool: "webFetch",
			path: uiHelpers.removeClosingTag(block, "url", url),
			content: `Fetching URL: ${uiHelpers.removeClosingTag(block, "url", url)}`,
			operationIsLocatedInWorkspace: false, // web_fetch is always external
		} satisfies ClineSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		// For partial blocks, we'll let the ToolExecutor handle auto-approval logic
		// Just stream the UI update for now
		await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
		await uiHelpers.ask("tool" as ClineAsk, partialMessage, block.partial).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			const url: string | undefined = block.params.url
			const prompt: string | undefined = block.params.prompt

			// Extract provider information for telemetry
			const apiConfig = config.services.stateManager.getApiConfiguration()
			const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
			const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

			// Gather Cline-backend gate values (used later in execution fallback)
			const clineWebToolsEnabled = config.services.stateManager.getGlobalSettingsKey("clineWebToolsEnabled")
			const featureFlagEnabled = featureFlagsService.getWebtoolsEnabled()

			// Validate required parameters
			if (!url) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "url")
			}
			if (!prompt) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError(this.name, "prompt")
			}
			config.taskState.consecutiveMistakeCount = 0

			// Create message for approval
			const sharedMessageProps: ClineSayTool = {
				tool: "webFetch",
				path: url,
				content: `Fetching URL: ${url}`,
				operationIsLocatedInWorkspace: false,
			}
			const completeMessage = JSON.stringify(sharedMessageProps)

			if (config.callbacks.shouldAutoApproveTool(this.name)) {
				// Auto-approve flow
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
				telemetryService.captureToolUsage(
					config.ulid,
					"web_fetch",
					config.api.getModel().id,
					provider,
					true,
					true,
					undefined,
					block.isNativeToolCall,
				)
			} else {
				// Manual approval flow
				showNotificationForApproval(
					`Cline wants to fetch content from ${url}`,
					config.autoApprovalSettings.enableNotifications,
				)
				await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

				const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
				if (!didApprove) {
					telemetryService.captureToolUsage(
						config.ulid,
						block.name,
						config.api.getModel().id,
						provider,
						false,
						false,
						undefined,
						block.isNativeToolCall,
					)
					return formatResponse.toolDenied()
				}
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					config.api.getModel().id,
					provider,
					false,
					true,
					undefined,
					block.isNativeToolCall,
				)
			}

			// Run PreToolUse hook after approval but before execution
			try {
				const { ToolHookUtils } = await import("../utils/ToolHookUtils")
				await ToolHookUtils.runPreToolUseIfEnabled(config, block)
			} catch (error) {
				const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
				if (error instanceof PreToolUseHookCancellationError) {
					return formatResponse.toolDenied()
				}
				throw error
			}

			// Try vault-based Firecrawl executor first (works with any provider)
			const crawlerResolver = createVaultCrawlerResolver()
			if (crawlerResolver) {
				const crawlerConfig = await crawlerResolver.resolve()
				if (crawlerConfig?.protocol === "firecrawl") {
					const webFetchOptions = parseWebFetchOptions(block.params)
					const result = await fetchWithFirecrawl(url, prompt, crawlerConfig, 30000, webFetchOptions)
					return formatResponse.toolResult(result)
				}
			}

			// Fall back to Cline backend (requires cline provider + feature flag)
			if (provider !== "cline" || !clineWebToolsEnabled || !featureFlagEnabled) {
				return formatResponse.toolError("Cline web tools are currently disabled and no crawler key is configured.")
			}

			const baseUrl = ClineEnv.config().apiBaseUrl
			const authToken = await AuthService.getInstance().getAuthToken()

			if (!authToken) {
				throw new Error(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE)
			}

			const response = await axios.post(
				`${baseUrl}/api/v1/search/webfetch`,
				{
					Url: url,
					Prompt: prompt,
				},
				{
					headers: {
						Authorization: `Bearer ${authToken}`,
						"Content-Type": "application/json",
						"X-Task-ID": config.ulid || "",
						...(await buildClineExtraHeaders()),
					},
					timeout: 15000,
					...getAxiosSettings(),
				},
			)

			const result = response.data.data.result

			return formatResponse.toolResult(result)
		} catch (error) {
			return `Error fetching web content: ${(error as Error).message}`
		}
	}
}
