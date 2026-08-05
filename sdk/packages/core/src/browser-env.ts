/**
 * Browser-compatible environment configuration for Cline SDK
 *
 * This module provides browser-compatible alternatives to Node.js environment variables
 * and file system operations, enabling the SDK to run in browser environments.
 */

// Type definitions for Node.js compatibility
export type BufferEncoding =
	| "ascii"
	| "utf8"
	| "utf-16le"
	| "ucs2"
	| "base64"
	| "latin1"
	| "binary"
	| "hex";

// Global configuration object that can be set by the application
const browserEnv: Record<string, string | undefined> = {};

// Browser-compatible storage for persistent state
const browserStorage: Record<string, any> = {};

/**
 * Get environment variable (browser-compatible)
 * @param name Environment variable name
 * @returns Value or undefined
 */
export function getEnv(name: string): string | undefined {
	// Check if we're in a browser environment
	if (typeof process === "undefined" || !process.env) {
		return browserEnv[name];
	}
	// Node.js environment
	return process.env[name];
}

/**
 * Set environment variable (browser-compatible)
 * @param name Environment variable name
 * @param value Value to set
 */
export function setEnv(name: string, value: string | undefined): void {
	if (typeof process === "undefined" || !process.env) {
		browserEnv[name] = value;
	} else {
		// In Node.js, we can't modify process.env directly in a way that affects other modules
		// that have already imported process, but we can store it for our own use
		browserEnv[name] = value;
	}
}

/**
 * Browser-compatible file system storage
 */
export class BrowserFileStorage {
	private storageKey: string;

	constructor(storageKey: string) {
		this.storageKey = storageKey;
	}

	async read(): Promise<any | undefined> {
		if (typeof localStorage !== "undefined") {
			const data = localStorage.getItem(this.storageKey);
			return data ? JSON.parse(data) : undefined;
		}
		return browserStorage[this.storageKey];
	}

	async write(data: any): Promise<void> {
		const jsonData = JSON.stringify(data);
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(this.storageKey, jsonData);
		} else {
			browserStorage[this.storageKey] = data;
		}
	}

	async clear(): Promise<void> {
		if (typeof localStorage !== "undefined") {
			localStorage.removeItem(this.storageKey);
		} else {
			delete browserStorage[this.storageKey];
		}
	}
}

/**
 * Browser-compatible path resolution
 * @param paths Path segments to join
 * @returns Joined path
 */
export function joinPaths(...paths: string[]): string {
	return paths.join("/").replace(/\\/g, "/").replace(/\/\/+/g, "/");
}

/**
 * Detect if we're running in a browser environment
 * @returns true if running in browser, false otherwise
 */
export function isBrowserEnvironment(): boolean {
	// Use type assertion to avoid TypeScript errors
	const globalObj = typeof globalThis !== "undefined" ? globalThis : {};
	return (
		typeof (globalObj as any).window !== "undefined" &&
		typeof (globalObj as any).window.document !== "undefined"
	);
}

/**
 * Initialize browser environment with configuration
 * @param config Configuration object
 */
export function initializeBrowserEnv(
	config: Record<string, string | undefined>,
): void {
	Object.assign(browserEnv, config);
}

// Export browser-compatible alternatives to common Node.js modules
export const browserFs = {
	readFile: async (
		path: string,
		encoding?: BufferEncoding | { encoding: BufferEncoding; flag?: string },
	): Promise<string> => {
		if (isBrowserEnvironment()) {
			// In browser, we'll use our storage system
			const storage = new BrowserFileStorage(path);
			const data = await storage.read();
			return data ? JSON.stringify(data) : "";
		}
		// Fallback to Node.js fs if available
		const fs = await import("node:fs/promises");
		const enc =
			typeof encoding === "string" ? encoding : encoding?.encoding || "utf8";
		return fs.readFile(path, enc);
	},

	writeFile: async (
		path: string,
		data: string,
		encoding?:
			| BufferEncoding
			| { encoding?: BufferEncoding; mode?: number; flag?: string },
	): Promise<void> => {
		if (isBrowserEnvironment()) {
			const storage = new BrowserFileStorage(path);
			await storage.write(JSON.parse(data));
		} else {
			const fs = await import("node:fs/promises");
			await fs.writeFile(path, data, encoding);
		}
	},

	mkdir: async (
		path: string,
		options?: { recursive?: boolean; mode?: number },
	): Promise<void> => {
		if (!isBrowserEnvironment()) {
			const fs = await import("node:fs/promises");
			await fs.mkdir(path, options);
		}
		// No-op in browser
	},
};

// Export browser-compatible process-like object
export const browserProcess = {
	env: browserEnv,
	cwd: () => {
		if (isBrowserEnvironment()) {
			return "/";
		}
		return process.cwd();
	},
};
