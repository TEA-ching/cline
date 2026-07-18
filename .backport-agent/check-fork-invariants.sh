#!/usr/bin/env bash
# check-fork-invariants.sh — deterministic verification of keypool-live fork invariants.
#
# Run from the repository root:  bash .backport-agent/check-fork-invariants.sh
# (also exposed as `bun run test:invariants`)
#
# Each check maps to an invariant declared in .backport-agent/customizations.yaml.
# The script prints one line per check and exits non-zero if ANY check fails, so
# it can be used as a validation command by the backport agent and in CI.
#
# Rules for adding checks:
#  - grep anchors must target SOURCE files (never out/, dist/, src/generated/).
#  - Prefer positive greps on identifiers that exist today; verify before adding.

set -u
cd "$(dirname "$0")/.." || exit 1

FAIL=0
PASS_COUNT=0
FAIL_COUNT=0

ok()   { PASS_COUNT=$((PASS_COUNT + 1)); echo "OK   $1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); FAIL=1; echo "FAIL $1"; }

# check_grep <label> <pattern> <file>
check_grep() {
  if grep -q -- "$2" "$3" 2>/dev/null; then ok "$1"; else fail "$1 (pattern '$2' not found in $3)"; fi
}

# check_file <label> <path>
check_file() {
  if [ -e "$2" ]; then ok "$1"; else fail "$1 (missing: $2)"; fi
}

# check_absent <label> <pattern> <path...>  — passes when pattern is NOT found
check_absent() {
  local label="$1" pattern="$2"; shift 2
  if grep -rq -- "$pattern" "$@" 2>/dev/null; then fail "$label (forbidden pattern '$pattern' found)"; else ok "$label"; fi
}

echo "=== keypool-live fork invariants ==="

# ── 1. Provider registration chain (cohere / poolside / keypoollive) ─────────
check_grep "cohere in ApiProvider union"        '"cohere"'      apps/vscode/src/shared/api.ts
check_grep "poolside in ApiProvider union"      '"poolside"'    apps/vscode/src/shared/api.ts
check_grep "keypoollive in ApiProvider union"   '"keypoollive"' apps/vscode/src/shared/api.ts

check_grep "proto field cohere_api_key"             "cohere_api_key"             apps/vscode/proto/cline/models.proto
check_grep "proto field poolside_api_key"           "poolside_api_key"           apps/vscode/proto/cline/models.proto
check_grep "proto field keypoollive_secret"         "keypoollive_secret"         apps/vscode/proto/cline/models.proto
check_grep "proto field keypoollive_gateway_secret" "keypoollive_gateway_secret" apps/vscode/proto/cline/models.proto
check_grep "proto field keypoollive_vault_url"      "keypoollive_vault_url"      apps/vscode/proto/cline/models.proto

check_grep "secret key cohereApiKey in state-keys"           "cohereApiKey"             apps/vscode/src/shared/storage/state-keys.ts
check_grep "secret key poolsideApiKey in state-keys"         "poolsideApiKey"           apps/vscode/src/shared/storage/state-keys.ts
check_grep "secret key keypoolliveSecret in state-keys"      "keypoolliveSecret"        apps/vscode/src/shared/storage/state-keys.ts
check_grep "secret key keypoolliveGatewaySecret in state-keys" "keypoolliveGatewaySecret" apps/vscode/src/shared/storage/state-keys.ts

check_grep "proto conversion handles cohereApiKey" "cohereApiKey" apps/vscode/src/shared/proto-conversions/models/api-configuration-conversion.ts

# ── 2. VSCode ↔ SDK bridge (cline-session-factory) ──────────────────────────
check_grep "PROVIDER_API_KEY_MAP cohere entry"    'cohere: "cohereApiKey"'     apps/vscode/src/sdk/cline-session-factory.ts
check_grep "PROVIDER_API_KEY_MAP poolside entry"  'poolside: "poolsideApiKey"' apps/vscode/src/sdk/cline-session-factory.ts
check_grep "session-factory injects KEYPOOL_VAULT_URL"   "KEYPOOL_VAULT_URL"   apps/vscode/src/sdk/cline-session-factory.ts
check_grep "session-factory injects KEYPOOL_LIVE_SECRET" "KEYPOOL_LIVE_SECRET" apps/vscode/src/sdk/cline-session-factory.ts
check_grep "session-factory injects vault contextWindow" "keypooliveContextWindow" apps/vscode/src/sdk/cline-session-factory.ts
check_grep "keypoolEventHandler wired in session host"   "keypoolEventHandler" apps/vscode/src/sdk/vscode-session-host.ts

# ── 3. SDK vendors ───────────────────────────────────────────────────────────
check_file "SDK vendor cohere.ts"              sdk/packages/llms/src/providers/vendors/cohere.ts
check_file "SDK vendor poolside.ts"            sdk/packages/llms/src/providers/vendors/poolside.ts
check_file "SDK vendor keypoollive.ts"         sdk/packages/llms/src/providers/vendors/keypoollive.ts
check_file "SDK vendor keypoollive-browser.ts" sdk/packages/llms/src/providers/vendors/keypoollive-browser.ts

check_grep "poolside default URL in builtins"       "inference.poolside.ai" sdk/packages/llms/src/providers/builtins.ts
check_grep "poolside/ model-id prefix in builtins"  "poolside/laguna"       sdk/packages/llms/src/providers/builtins.ts
check_grep "poolside vendor re-adds poolside/ prefix" "startsWith"          sdk/packages/llms/src/providers/vendors/poolside.ts

check_grep "MAX_KEY_ATTEMPTS is dynamic (vault size)" "_poolKeys.length" sdk/packages/llms/src/providers/vendors/keypoollive.ts
check_absent "MAX_KEY_ATTEMPTS not hardcoded const"   "const MAX_KEY_ATTEMPTS = 5" sdk/packages/llms/src/providers/vendors/keypoollive.ts
check_grep "vendor normalizes supportsImages from inputModalities" "inputModalities" sdk/packages/llms/src/providers/vendors/keypoollive.ts
check_grep "AiVault normalizes supportsImages from inputModalities" "inputModalities" apps/vscode/src/core/keypoollive/AiVault.ts

# ── 4. Keypool RPCs and controllers ──────────────────────────────────────────
for rpc in keypoolGetVaultModels keypoolRotateKey keypoolGetUsageStats keypoolGetErrorStats; do
  check_grep "RPC $rpc declared in models.proto" "$rpc" apps/vscode/proto/cline/models.proto
done
for ctrl in keypoolGetVaultModels keypoolRotateKey keypoolGetUsageStats keypoolGetErrorStats \
            keypoolCheckUpdate keypoolGetLogMarkdown keypoolGetRecentLogs keypoolInjectEnvConfig \
            keypoolInstallUpdate keypoolPurgeStats keypoolSaveLogMarkdown; do
  check_file "controller $ctrl.ts" "apps/vscode/src/core/controller/models/$ctrl.ts"
done
check_grep "resolveModelInfo has vault fallback" "loadAiVault" apps/vscode/src/core/controller/models/resolveModelInfo.ts

# ── 5. Webview UI ────────────────────────────────────────────────────────────
check_file "KeypoolLiveDashboard component"  apps/vscode/webview-ui/src/components/chat/KeypoolLiveDashboard.tsx
check_file "KeypoolModelSelector component"  apps/vscode/webview-ui/src/components/chat/KeypoolModelSelector.tsx
check_file "keypoolliveModelCache"           apps/vscode/webview-ui/src/components/chat/keypoolliveModelCache.ts
check_file "KeypoolLiveProvider settings UI" apps/vscode/webview-ui/src/components/settings/providers/KeypoolLiveProvider.tsx
check_grep "Dashboard rendered in ChatTextArea" "KeypoolLiveDashboard" apps/vscode/webview-ui/src/components/chat/ChatTextArea.tsx
check_grep "Selector rendered in ChatTextArea"  "KeypoolModelSelector" apps/vscode/webview-ui/src/components/chat/ChatTextArea.tsx
check_grep "AboutSection shows Keypool Live"    "with Keypool Live"    apps/vscode/webview-ui/src/components/settings/sections/AboutSection.tsx
check_file "build-date util (extension)" apps/vscode/src/utils/build-date.ts
check_file "BuildDate config (webview)"  apps/vscode/webview-ui/src/config/BuildDate.ts

# ── 6. Smart web crawling ────────────────────────────────────────────────────
check_file "crawler types"     sdk/packages/core/src/extensions/tools/executors/crawler/types.ts
check_file "crawler firecrawl" sdk/packages/core/src/extensions/tools/executors/crawler/firecrawl.ts
check_file "crawler exa"       sdk/packages/core/src/extensions/tools/executors/crawler/exa.ts
check_grep "createSmartWebFetchExecutor in web-fetch" "createSmartWebFetchExecutor" sdk/packages/core/src/extensions/tools/executors/web-fetch.ts
check_file "VSCode crawlerFetch bridge" apps/vscode/src/shared/crawlerFetch.ts
check_file "shared crawler tool types"  sdk/packages/shared/src/tools/crawler.ts

# ── 7. Release workflow and package publishing ───────────────────────────────
check_grep "workflow triggers on keypool-live"    "keypool-live"  .github/workflows/keypool-live-preview.yml
check_grep "SCTG package rename step"             "Rename SDK package scope for SCTG publish" .github/workflows/keypool-live-preview.yml
check_grep "@sctg/cline- scope used in workflow"  "@sctg/cline-"  .github/workflows/keypool-live-preview.yml
check_grep "OIDC id-token permission"             "id-token: write" .github/workflows/keypool-live-preview.yml
check_absent "no @sctg/cline- in SDK sources" "@sctg/cline-" sdk/packages/llms/src sdk/packages/core/src sdk/packages/shared/src sdk/packages/agents/src
check_file "clinepool-download workflow" .github/workflows/build-clinepool-download.yml

# ── 8. Standalone apps and chatbot integration ───────────────────────────────
check_file "clinepool-download app"       apps/clinepool-download/Cargo.toml
check_file "chatbot useKeypoolRotation"   apps/chatbot/src/hooks/useKeypoolRotation.ts
check_file "chatbot keypool-usage lib"    apps/chatbot/src/lib/keypool-usage.ts

# ── 9. Branding / docs ───────────────────────────────────────────────────────
# displayName "ClinePool" was silently clobbered by an upstream merge once
# (commit 0e093700a) — this check exists to catch that regression class.
check_grep "extension displayName is ClinePool" '"displayName": "ClinePool"' apps/vscode/package.json
check_grep "extension publisher is sctg-development" '"publisher": "sctg-development"' apps/vscode/package.json
check_file "fork icon (extension)" apps/vscode/assets/icons/icon.png
check_file "fork icon (repo root)" assets/icons/icon.png
check_grep "publisher patched by release workflow" "sctg-development" .github/workflows/keypool-live-preview.yml
check_grep "docs mention keypoollive" "eypool" docs/sdk/model-providers.mdx

# ── 10. Backport-agent infra ─────────────────────────────────────────────────
check_file "customizations manifest" .backport-agent/customizations.yaml
check_file "clinerules general"      .clinerules/general.md

# ── 11. Checkpoint run-count fix (BUGFIX, not a feature — see customizations.yaml
#         id "checkpoint-runcount-fix" for the full rationale and the exact
#         removal criteria to apply once upstream fixes this itself) ─────────
check_file "fork-owned checkpoint-run-counting.ts (AgentMessage layer)" sdk/packages/core/src/hooks/checkpoint-run-counting.ts
check_file "fork-owned checkpoint-message-filter.ts (LlmsProviders.Message layer)" sdk/packages/core/src/session/checkpoint-message-filter.ts
check_grep "checkpoint-hooks uses message-based run counting" "countGenuineUserPromptMessages" sdk/packages/core/src/hooks/checkpoint-hooks.ts
check_absent "checkpoint-hooks has no initialRunCount option (redundant under message counting)" "initialRunCount" sdk/packages/core/src/hooks/checkpoint-hooks.ts
check_absent "local-runtime-bootstrap has no countSeededRootRuns (redundant under message counting)" "countSeededRootRuns" sdk/packages/core/src/services/local-runtime-bootstrap.ts
check_grep "checkpoint-restore uses the shared genuine-user-message filter" "isGenuineUserPromptMessage" sdk/packages/core/src/session/checkpoint-restore.ts
check_grep "agent-runtime tags the completion-tool reminder as synthetic" "completion_reminder" sdk/packages/agents/src/agent-runtime.ts
check_grep "orchestrator tags the recovery notice as synthetic" "recovery_notice" sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
check_grep "orchestrator tags the soft loop-detection warning as synthetic" "loop_detection_notice" sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
check_grep "orchestrator tags the mistake-limit stop notice as synthetic" "mistake_stop_notice" sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts

echo "===================================="
echo "Invariant checks: $PASS_COUNT passed, $FAIL_COUNT failed"
exit $FAIL
