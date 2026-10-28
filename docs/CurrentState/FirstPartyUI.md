# First-party UI architecture

This page describes the current architecture of TauriTavern's own frontend and the boundaries for maintaining it. The SillyTavern frontend still owns the pages, extension loading, and the global lifecycle; TauriTavern only mounts independent React client islands inside the existing pages and does not build a second page shell or router.

## 1. Scope

The first-party UI covers:

- the Agent System;
- the In-App Assistant;
- the MCP Manager;
- Tauri Settings, Dev Logs, and Sync.

These interfaces all use React, React DOM, and strict TypeScript/TSX. The upstream SillyTavern frontend, third-party extensions, and host scripts loaded directly by the WebView are not part of the React component sources.

## 2. Ownership and data flow

```text
Rust / Host services
  -> feature composition root
  -> typed controller / model / external store, as needed
  -> React client island
  -> the island's own DOM subtree
```

- Rust and host services own persisted data, cross-window facts, file and network I/O, Tauri commands, and platform events.
- The feature composition root acquires and validates host capabilities and assembles DTOs, typed actions, subscriptions, translators, and mount arguments.
- A controller, model, or external store carries asynchronous orchestration and view projections only where the feature genuinely needs them; a simple interface uses local React state.
- React components own rendering, unsaved drafts, and current view state. They do not copy persisted facts and do not call Tauri `invoke()` directly.
- Page-level events must use the `eventSource` and `eventTypes` that `window.SillyTavern.getContext()` provides; subscribing and unsubscribing use the same page instance.
- A missing required host API, event, or DTO field fails immediately and surfaces the context, rather than assuming a default capability.

## 3. Source and build boundaries

Rspack owns the following TypeScript/TSX sources directly:

```text
src/scripts/extensions/agent-system/src
src/scripts/extensions/in-app-agent/src
src/scripts/extensions/mcp-manager/src
src/scripts/tauri/setting/settings-app
src/scripts/tauri/setting/dev-logs-app
src/scripts/tauri/setting/sync-app
```

Entry points and stable outputs:

| Feature | Rspack entry | Output | Loaded by |
| --- | --- | --- | --- |
| Agent System | `agent-system/src/index.tsx` | `agent-system/dist/index.bundle.js` | Agent manifest |
| In-App Assistant | `in-app-agent/src/index.ts` | `in-app-agent/dist/index.bundle.js`, `index.bundle.css` | Assistant manifest |
| MCP Manager | `mcp-manager/src/index.tsx` | `mcp-manager/dist/index.bundle.js` | MCP manifest |
| Settings | `settings-app/SettingsApp.tsx` | `setting/dist/settings.bundle.js` | `setting-panel/settings-popup.js` |
| Dev Logs | `dev-logs-app/DevLogsApp.tsx` | `setting/dist/dev-logs.bundle.js` | `setting/dev-logs.js` |
| Sync | `sync-app/index.ts` | `setting/dist/sync.bundle.js` | The Sync popup and listener shell |

The In-App Assistant manifest loads the build-generated `dist/index.bundle.css`, because the cursor styles have to be imported from the app-use package; the Agent System and MCP Manager manifests load `style.css` directly. A change to the assistant's `style.css` therefore only takes effect after an rspack rebuild.

Local TS/TSX modules use extensionless relative imports. An explicit `.js` import points only at a real JavaScript module on disk that the browser executes.

[app-use](../../packages/app-use/README.md) is the exception: its relative imports carry an explicit `.ts`, which the build rewrites to `.js`. The package type-checks and lints with its own tsconfig (NodeNext). TT imports the package's source directly, which is why `tsconfig.ui.json` enables `allowImportingTsExtensions`. ESLint names the tsconfig explicitly per directory, because automatic lookup would pick up upstream's `src/jsconfig.json`.

`src/scripts/tauri/setting/*.js` and `setting-panel/*.js` are host adapter layers the WebView loads directly. They own the popup lifecycle, the save/close timing, native event wiring, and dynamic bundle imports, so they continue to ship as browser ESM. `format-bytes.js` serves both the host scripts and the TS bundles, and provides type information in the implementation through `// @ts-check` and JSDoc.

Production and development share `createRspackConfigs(mode)` in `rspack.config.js`. Every bundle is a self-contained ES module and depends on no page-level React global; React Compiler is used for the Agent System only.

## 4. Internal feature structure

### Agent System

- `index.tsx` is the extension bootstrap and the main composition root.
- `host-api.ts` centralizes access to `window.__TAURITAVERN__` and the SillyTavern context.
- Panel, Timeline, and Skill Manager each own their feature-local contract, controller/model, and React presentation.
- `i18n.ts` handles translation and interpolation, and message keys take their types from a static catalog.
- `chat-input-toggle.ts` and `embedded-assets-buttons.ts` are native adapters that hook into upstream DOM and create no additional React root.

### In-App Assistant

- One React island mounts in the original A drawer; SillyTavern keeps the surrounding DOM and the drawer behavior, and hiding does not unmount it.
- `host.ts` composes the shared APIs; the controller owns sessions, tasks, and the input draft, and the components own the settings draft and the view.

For the startup order, message ownership, and tool boundaries see [In-App Assistant](InAppAssistant.md).

### MCP Manager

- `index.tsx` mounts the app; `host.ts` owns the host and SillyTavern boundary.
- The manager and the server and test-call dialogs stay feature-local and depend on neither the Agent nor the Settings UI runtime.

### Settings, Dev Logs, and Sync

- The Raw Settings shell creates the popup, reads host data, and injects typed options, actions, and a translator into the React root.
- The React root reads no shell-internal state; the shell does not depend on a React component instance either, holding only the public mount handle.
- The extensions-menu shortcut is a device-local display preference; the Raw Settings shell reuses upstream popup management for the choice and a DOM adapter projects it into the existing `#extensionsMenu`, adding no React root and no backend setting.
- The three features share one Rspack compiler while keeping separate bundles and separate lifecycles.

## 5. Host call contract

The Settings bundles expose their mount functions as named exports:

| Mount function | Returns a handle offering |
| --- | --- |
| `mountTauriTavernSettingsApp()` | `getDraft()`, `setChatBackupStorageStats()`, `unmount()` |
| `mountTauriTavernDevLogsApp()` | `unmount()` |
| `mountTauriTavernSyncApp()` | `refresh()`, `refreshAutomationStatus()`, `unmount()` |
| `mountTauriTavernSyncProgressApp()` | `update()`, `unmount()` |
| `mountTauriTavernSyncScopeApp()` | `getSelection()`, `unmount()` |

Mount arguments are validated at the JS/TS boundary. A shell interacts with its island only through these handles; a new capability should extend the matching feature contract first, rather than reading the React DOM or a component's internal state.

Agent and MCP start themselves once a manifest has loaded them. Their external contract is the manifest path, the host ABI, event/DTO semantics, and the observable behavior of the DOM they mount.

## 6. Lifecycle, DOM, and styling

- Each React root manages only its own mount subtree; SillyTavern keeps managing the surrounding document and extension container.
- Host subscriptions are held by the composition root, a controller, or a dedicated hook, and released when the matching lifecycle ends.
- Asynchronous reads use explicit epoch, snapshot, or cancellation semantics to keep an old result from overwriting a newer state; timer-based waits do not stand in for coordination.
- A popup's Save, Cancel, Escape, `onClosing`, and native dialog behavior belong to the shell or composition root that created it.
- Styling reuses SillyTavern classes, SmartTheme CSS variables, and the mobile surface contract; React brings in no CSS-in-JS and no separate UI framework.
- A simple button that has to sit in an existing upstream control bar uses a native DOM adapter; only a fully stateful interface gets a React root.

## 7. Testing and development

Rstest, Testing Library, and `happy-dom` cover component interaction, controller behavior, subscription lifecycle, and the stable boundaries. Node contract tests cover the host ABI and the browser JavaScript integration; Rust tests cover backend domain and adapter behavior.

`happy-dom` provides no real layout, scrolling, or platform WebView behavior. A change touching pointers, focus, native dialogs, scroll anchors, the mobile viewport, or theme inheritance still has to be verified in a real Tauri WebView.

Common commands:

```bash
pnpm run check:types
pnpm run check:lint
pnpm run test:ui
pnpm run web:build
pnpm run check
```
