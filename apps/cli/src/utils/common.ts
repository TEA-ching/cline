import * as os from "node:os";
import type { RuntimeEnv } from "@sctg/cline-shared";
import { displayName, version } from "../../package.json";

export function getCliBuildInfo(): RuntimeEnv {
	return {
		name: displayName,
		version: version + " " + "2026-08-05T06-46-50Z",
		platform: "terminal",
		platform_version: process.version,
		os_type: os.platform(),
		os_version: os.version(),
	};
}
