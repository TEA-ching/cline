// KeypoolLive — in-memory model info cache for the webview.
// Populated when keypoolGetVaultModels is called; read by normalizeApiConfiguration()
// to display accurate context windows in the model picker and task header.

import type { KeypoolVaultModel } from "@shared/proto/cline/models"

const cache = new Map<string, KeypoolVaultModel>()

export function setKplModelCache(models: KeypoolVaultModel[]): void {
	cache.clear()
	for (const m of models) {
		cache.set(m.combinedId, m)
	}
}

export function getKplModelInfo(combinedId: string): KeypoolVaultModel | undefined {
	return cache.get(combinedId)
}
