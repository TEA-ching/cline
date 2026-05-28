/**
 * KeypoolLive — in-memory model info cache for the webview.
 *
 * This cache is populated when `keypoolGetVaultModels` is called from the UI.
 * It is primarily read by `normalizeApiConfiguration()` to ensure that the model picker
 * and task header display accurate technical specifications (like context window sizes)
 * for models provided via KeypoolLive, which might not be hardcoded in the extension.
 */

import type { KeypoolVaultModel } from "@shared/proto/cline/models"

/**
 * Internal map storing model metadata keyed by their unique combined ID.
 * The combined ID typically follows the format "provider/model-name".
 */
const cache = new Map<string, KeypoolVaultModel>()

/**
 * Updates the in-memory cache with a new set of vault models.
 * Existing entries are cleared before the new models are added.
 *
 * @param models - The list of models retrieved from the KeypoolLive vault.
 */
export function setKplModelCache(models: KeypoolVaultModel[]): void {
	cache.clear()
	for (const m of models) {
		cache.set(m.combinedId, m)
	}
}

/**
 * Retrieves metadata for a specific model from the cache.
 *
 * @param combinedId - The unique identifier of the model.
 * @returns The model metadata if found, otherwise undefined.
 */
export function getKplModelInfo(combinedId: string): KeypoolVaultModel | undefined {
	return cache.get(combinedId)
}
