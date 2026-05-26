// KeypoolLive — AiVault: fetch + AES-256-CBC decrypt vault; 5-min cache
// © 2026 Ronan LE MEILLAT — MIT License

import { fetch } from "@/shared/net"
import type { AiConfig, AiVaultConfig } from "./types"

interface VaultCache {
	config: AiVaultConfig
	fetchedAt: number
}

const VAULT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
let vaultCache: VaultCache | null = null

/**
 * Decrypt a vault file encrypted with:
 *   openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000 -salt -in ai.json -out ai.json.enc -pass pass:"SECRET"
 *
 * The base64-encoded ciphertext starts with "Salted__" magic bytes (8 bytes),
 * followed by 8 bytes of salt, then the actual ciphertext.
 * Key + IV are derived from the password + salt using PBKDF2-SHA256 with 100000 iterations.
 */
export async function decryptAiConfig(base64Ciphertext: string, password: string): Promise<AiConfig> {
	const raw = Uint8Array.from(atob(base64Ciphertext.trim()), (c) => c.charCodeAt(0))

	// Verify "Salted__" magic header (bytes 0-7)
	const magic = String.fromCharCode(...raw.slice(0, 8))
	if (magic !== "Salted__") {
		throw new Error("Invalid vault format: missing 'Salted__' magic header")
	}

	const salt = raw.slice(8, 16)
	const ciphertext = raw.slice(16)

	// Derive 32-byte key + 16-byte IV using PBKDF2-SHA256
	const enc = new TextEncoder()
	const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"])
	const derived = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt,
			iterations: 100000,
		},
		keyMaterial,
		(32 + 16) * 8, // 48 bytes = 32 key + 16 IV
	)

	const keyBytes = new Uint8Array(derived, 0, 32)
	const iv = new Uint8Array(derived, 32, 16)

	const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"])
	const plaintext = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, ciphertext)

	return JSON.parse(new TextDecoder().decode(plaintext)) as AiConfig
}

async function fetchEncryptedVault(url: string): Promise<string> {
	const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
	if (!response.ok) {
		throw new Error(`Failed to fetch vault from ${url}: HTTP ${response.status}`)
	}
	return response.text()
}

function transformAiConfigToVaultConfig(aiConfig: AiConfig): AiVaultConfig {
	const vaultConfig: AiVaultConfig = { version: aiConfig.version, providers: {} }
	for (const [providerName, provider] of Object.entries(aiConfig.providers)) {
		vaultConfig.providers[providerName] = {
			protocol: provider.protocol,
			endpoint: provider.endpoint,
			keys: provider.keys.map((k) => ({
				key: k.key,
				owner: k.owner ?? "unknown",
				type: k.type ?? "paid",
			})),
			models: provider.models.map((m) => ({
				id: m.id,
				name: m.name,
				contextLength: m.contextLength,
				usage: m.usage,
				supportsImages: m.supportsImages,
				supportsPromptCache: m.supportsPromptCache,
				inputPrice: m.inputPrice,
				outputPrice: m.outputPrice,
				defaultDimensions: m.defaultDimensions,
			})),
		}
	}
	return vaultConfig
}

export async function loadAiVault(vaultUrl: string): Promise<AiVaultConfig> {
	if (vaultCache && Date.now() - vaultCache.fetchedAt < VAULT_CACHE_TTL_MS) {
		return vaultCache.config
	}

	const secret = process.env.KEYPOOL_LIVE_SECRET
	if (!secret) {
		throw new Error("KEYPOOL_LIVE_SECRET environment variable is not set")
	}

	const base64Ciphertext = await fetchEncryptedVault(vaultUrl)
	const aiConfig = await decryptAiConfig(base64Ciphertext, secret)
	const config = transformAiConfigToVaultConfig(aiConfig)

	vaultCache = { config, fetchedAt: Date.now() }
	return config
}

export function clearVaultCache(): void {
	vaultCache = null
}
