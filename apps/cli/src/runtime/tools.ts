import {
	type BuiltinToolAvailabilityContext,
	getCoreBuiltinToolCatalog,
	resolveDisabledToolNames,
	type ToolCatalogEntry,
} from "@sctg/cline-core";

export type { ToolCatalogEntry } from "@sctg/cline-core";

export function getToolCatalog(
	availabilityContext?: BuiltinToolAvailabilityContext,
): ToolCatalogEntry[] {
	return getCoreBuiltinToolCatalog({
		disabledToolIds: resolveDisabledToolNames(),
		...availabilityContext,
	});
}
