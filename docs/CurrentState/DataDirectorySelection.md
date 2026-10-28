# Data directory selection (current state)

This page records the desktop data directory selection capability that has **already landed**: what problem it solves, how the current chain works, what it supports and does not, and which contracts later development is most likely to break by accident.

> For the design background and the proposal, see: `docs/DataDirectorySelection.md`. This page covers only "how it runs now".

## 1. The problem being solved

Desktop users can now migrate the application data root (`data_root`) to a path of their choosing instead of being pinned to the standard `app_data_dir()/data` or, in portable mode, to a location beside the executable.

The capability is not about "hot switching at runtime". Its goals are:

- write a runtime bootstrap configuration once, from inside the application;
- settle the data root early on the next launch;
- if needed, migrate the data first, and then have every later subsystem read the same `data_root`.

## 2. The current end-to-end chain

### 2.1 Frontend settings panel

- Location: `src/scripts/tauri/setting/setting-panel/settings-popup.js`
- Only the desktop host shows `System -> Data Directory` (a collapsible block), matching the backend, which registers these commands only under `cfg(desktop)`
- The system directory picker opens through `plugin:dialog|open`, called via `openDialog(...)` in `src/tauri-bridge.js` (to avoid a bare module import)
- After a selection, the backend commands are called:
  - `get_runtime_paths`
  - `set_data_root`

### 2.2 Runtime configuration file

- File: `{app_root}/tauritavern-runtime.json`
- Parse entry point: `src-tauri/crates/tauritavern/src/infrastructure/paths.rs`
- Fields:
  - `version`
  - `data_root`
  - `migration`
  - `migration_error`

That file is a **startup bootstrap configuration** and is not part of the regular settings; the point is to avoid the bootstrapping loop where `data_root` has to be known before settings can be read.

### 2.3 Startup path resolution

- `src-tauri/crates/tauritavern/src/lib.rs` calls `resolve_runtime_paths(...)` early in `setup`
- Once `RuntimePaths` is determined, it is injected as managed state and used for:
  - the asset protocol and the plugin-fs runtime scope
  - the Host Resource Service user resources and third-party extension directories
  - the data archive directory
  - backend initialization

In short: **a change of data directory takes effect only after a restart**.

## 3. Semantics currently supported

### 3.1 Directory validation

- `set_data_root` requires the target path to:
  - be an absolute path
  - already exist and be a directory
  - be **effectively empty**
  - be normalized through `dunce` on Windows, so a UNC/extended-length prefix such as `\\?\\C:\\...` is not written into the runtime configuration

"Effectively empty" currently permits a target holding only system metadata files:

- `.DS_Store`
- `.localized`
- `desktop.ini`
- `Thumbs.db`
- `Icon\r`

These semantics hold on both sides:

- validation in the settings command
- the migration target check at startup

The two sides must agree.

### 3.2 Migration strategy

- Prefer a whole-directory `rename` (same volume)
- Fall back to a recursive copy when `rename` fails
- The recursive copy currently supports:
  - regular files
  - regular directories
  - symlinks (recreated as links on the target side rather than downgraded to regular files)

### 3.3 Failure recovery

- If the migration fails but the old `data_root` still exists:
  - startup keeps using the old directory
  - `tauritavern-runtime.json` keeps `migration`
  - `migration_error` is written
- If the old `data_root` no longer exists but the target directory already looks like an initialized data root (currently decided by the presence of `default-user/`):
  - startup takes it that "the previous migration finished but its marker was not cleared"
  - `migration` is cleared
  - the target directory is switched to
- If the old `data_root` no longer exists and the target directory does not look like a finished data root either:
  - the state is treated as unrecoverable
  - startup fails fast

## 4. What is explicitly not supported

- Data directory selection on Android / iOS
- Hot switching `data_root` at runtime
- Automatic merge migration into an arbitrary target directory
- Continuing a migration after silently ignoring unknown files and directories

These boundaries are deliberately conservative: the goal is to reduce the risk of data forking and silent corruption.

## 5. Constraints for continued development

- **Path policy must keep converging in `src-tauri/crates/tauritavern/src/infrastructure/paths.rs`**
  - do not scatter `data_root` resolution logic across commands, services, and the frontend
- **`tauritavern-runtime.json` is the only startup bootstrap configuration**
  - do not write `data_root` back into the regular settings
- **The "effectively empty" semantics must be identical on both sides**
  - a change in one place must be mirrored in the startup migration check
- **Migration failure recovery and the unrecoverable state must stay separate**
  - "the old directory is still there" is recoverable
  - "the old directory is gone and the target is unusable" must fail fast
- **Configuration file replacement reuses the shared infrastructure implementation**
  - do not copy another temp+rename/copy fallback implementation

## 6. Key code locations

- `src-tauri/crates/tauritavern/src/infrastructure/paths.rs`
- `src-tauri/crates/tauritavern/src/presentation/commands/runtime_paths_commands.rs`
- `src/scripts/tauri/setting/setting-panel/settings-popup.js`
- `src/tauri-bridge.js`
