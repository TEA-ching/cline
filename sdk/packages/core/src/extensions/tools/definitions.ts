/**
 * Default AgentTool Definitions
 *
 * Factory functions for creating the default tools.
 */

import {
    type AgentTool,
    type AgentToolContext,
    createTool,
    validateWithZod,
    zodToJsonSchema,
} from "@cline/shared";
import { captureRunCommandsTimeout } from "../../services/telemetry/core-events";
import { getToolContextTelemetry } from "../../services/telemetry/tool-context";
import {
    formatError,
    formatReadFileQuery,
    formatRunCommandQuery,
    getEditorSizeError,
    getReadFileRangeError,
    normalizeRunCommandsInput,
    TimeoutError,
    withTimeout,
} from "./helpers";