/**
 * Example usage of browser-compatible KeypoolLive provider
 *
 * This example demonstrates how to use the KeypoolLive provider in a browser environment.
 */

import {
	createKeypoolliveProvider,
	initializeBrowserEnv,
} from "@cline/llms/providers/vendors/keypoollive-browser";

// Initialize browser environment with required configuration
initializeBrowserEnv({
	KEYPOOL_VAULT_URL: "https://your-vault-url.example.com/encrypted-vault.json",
	KEYPOOL_LIVE_SECRET: "your-decryption-password",
});

// Create the KeypoolLive provider
const keypoolliveProvider = createKeypoolliveProvider({
	apiKey: "auto", // Use "auto" to enable vault-based key rotation
	// Other provider configuration as needed
});

// Example usage in a browser application
async function exampleUsage() {
	try {
		// The provider can now be used with the AI SDK
		// For example, with @ai-sdk/core:
		/*
        const { streamText } = await import('@ai-sdk/core');

        const result = await streamText({
            model: keypoolliveProvider("mistral/devstral-latest"),
            prompt: "Hello, how are you?",
        });

        console.log(result.text);
        */
	} catch (error) {
		console.error("Error using KeypoolLive provider:", error);
	}
}

// Run the example
exampleUsage();
