// Browser stub: provider-request-capture.ts uses node:crypto (createHash)
// which is not available in the browser. These functions are debug/capture
// utilities only — no-op replacements are safe.

// biome-ignore lint: stubs intentionally use any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recordProviderRequestCapture(_input: any): void {
  // no-op in browser
}

// biome-ignore lint: stubs intentionally use any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapFetchForProviderRequestCapture(
  fetch: any,
  _request: any,
): any {
  return fetch
}
