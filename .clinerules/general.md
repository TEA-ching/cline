## Adding New Global State Keys
Adding a new key to global state requires updates in multiple places. Missing any step causes silent failures.

Required steps:
1. Type definition in `apps/vscode/src/shared/storage/state-keys.ts` - Add to `GlobalState` or `Settings` interface
2. Add any default value or transform in `apps/vscode/src/shared/storage/state-keys.ts` if the key needs one
3. Read from globalState in `apps/vscode/src/core/storage/utils/state-helpers.ts`:
   - Add `const myKey = context.globalState.get<GlobalStateAndSettings["myKey"]>("myKey")` in `readGlobalStateFromDisk()`
   - Add to the return object: `myKey: myKey ?? defaultValue,`
4. StateManager handles read/write via `setGlobalState()`/`getGlobalStateKey()` after initialization

Persistent state is file-backed through `StateManager`; do not add new runtime reads or writes against VS Code `ExtensionContext` storage. That storage is only a legacy migration source.

## StateManager Cache vs Direct globalState Access
StateManager uses an in-memory cache populated during `StateManager.initialize(context)` in `apps/vscode/src/common.ts`. For most state, use `controller.stateManager.setGlobalState()`/`getGlobalStateKey()`.