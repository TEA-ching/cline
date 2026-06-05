import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseLine(line: string): [string, string] | null {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("#")) {
		return null;
	}

	const eqIndex = trimmed.indexOf("=");
	if (eqIndex <= 0) {
		return null;
	}

	const key = trimmed.slice(0, eqIndex).trim();
	let value = trimmed.slice(eqIndex + 1).trim();
	if (!key) {
		return null;
	}

	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}

	return [key, value];
}

export function loadWorkspaceEnvFile(): void {
	let dir = dirname(fileURLToPath(import.meta.url));

	while (true) {
		const candidate = join(dir, ".env");
		if (existsSync(candidate)) {
			const content = readFileSync(candidate, "utf8");
			for (const line of content.split(/\r?\n/)) {
				const parsed = parseLine(line);
				if (!parsed) {
					continue;
				}
				const [key, value] = parsed;
				if (!process.env[key]) {
					process.env[key] = value;
				}
			}
			return;
		}

		const parent = dirname(dir);
		if (parent === dir) {
			return;
		}
		dir = parent;
	}
}
