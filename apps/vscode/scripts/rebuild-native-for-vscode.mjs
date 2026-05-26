#!/usr/bin/env node
/**
 * Rebuilds the better-sqlite3 native module for VS Code's bundled Electron version.
 *
 * Called automatically by `vscode:prepublish` (which runs when `vsce package` is invoked).
 * Can also be run manually: `npm run rebuild:native`
 *
 * Detection order for the Electron version:
 *   1. VSCODE_ELECTRON_VERSION env var (for CI overrides)
 *   2. Installed VS Code app on macOS / Windows / Linux
 *   3. Hardcoded fallback for VS Code 1.121 (Electron 39.8.8)
 */

import { spawnSync } from "child_process"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, "..")

// ---------- Detect VS Code's Electron version ----------

function readElectronVersionFromVsCodePkg(pkgPath) {
	if (!existsSync(pkgPath)) return null
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
		const v = pkg.devDependencies?.electron
		if (v) return v.replace(/^[^0-9]*/, "") // strip semver prefix
	} catch {
		// ignore parse errors
	}
	return null
}

function detectElectronVersion() {
	// 1. Explicit override (useful in CI environments)
	if (process.env.VSCODE_ELECTRON_VERSION) {
		return process.env.VSCODE_ELECTRON_VERSION
	}

	// 2. macOS default install path
	const macVersion = readElectronVersionFromVsCodePkg(
		"/Applications/Visual Studio Code.app/Contents/Resources/app/package.json",
	)
	if (macVersion) return macVersion

	// 3. Windows default install path
	if (process.platform === "win32" && process.env.LOCALAPPDATA) {
		const winVersion = readElectronVersionFromVsCodePkg(
			path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "resources", "app", "package.json"),
		)
		if (winVersion) return winVersion
	}

	// 4. Linux default install paths
	for (const linuxPkg of [
		"/usr/share/code/resources/app/package.json",
		"/opt/visual-studio-code/resources/app/package.json",
		`${process.env.HOME}/.local/share/code/resources/app/package.json`,
	]) {
		const v = readElectronVersionFromVsCodePkg(linuxPkg)
		if (v) return v
	}

	// 5. Hardcoded fallback (VS Code 1.121 → Electron 39.8.8)
	const fallback = "39.8.8"
	console.warn(
		`⚠  Could not detect installed VS Code's Electron version.` +
			`\n   Using fallback: ${fallback} (VS Code 1.121).` +
			`\n   Override via: VSCODE_ELECTRON_VERSION=<version> npm run rebuild:native`,
	)
	return fallback
}

// ---------- Run prebuild-install ----------

const electronVersion = detectElectronVersion()
const arch = process.env.TARGET_ARCH || process.arch

console.log(`\n⚙  Rebuilding better-sqlite3 for Electron ${electronVersion} (${arch})…`)

const bsqliteDir = path.join(rootDir, "node_modules", "better-sqlite3")
const prebuildBin = path.join(rootDir, "node_modules", "prebuild-install", "bin.js")

if (!existsSync(bsqliteDir)) {
	console.error("✗ better-sqlite3 not found in node_modules. Run `npm install` first.")
	process.exit(1)
}

const result = spawnSync(
	process.execPath, // reuse the same Node.js binary
	[prebuildBin, "--runtime", "electron", "--target", electronVersion, "--arch", arch],
	{ cwd: bsqliteDir, stdio: "inherit" },
)

if (result.status !== 0) {
	// prebuild-install failed (no prebuilt binary available for this version).
	// Fall back to compiling from source with node-gyp.
	console.warn(
		`\n⚠  prebuild-install failed (exit ${result.status}).` + "\n   Falling back to node-gyp rebuild (requires build tools)…",
	)
	const fallback = spawnSync("npx", ["node-gyp", "rebuild", "--release"], {
		cwd: bsqliteDir,
		stdio: "inherit",
		shell: true,
	})
	if (fallback.status !== 0) {
		console.error("\n✗ Both prebuild-install and node-gyp rebuild failed.")
		console.error("  The extension will load without KeypoolLive usage-stats (graceful degradation).")
		// Non-fatal: exit 0 so the VSIX packaging can still continue.
	} else {
		console.log(`\n✓ better-sqlite3 compiled from source for Electron ${electronVersion}`)
	}
} else {
	console.log(`\n✓ better-sqlite3 ready for Electron ${electronVersion} (${arch})`)
}
