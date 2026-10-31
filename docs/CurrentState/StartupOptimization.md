# Startup optimization (stage-based boot): current status

This document describes the startup optimization **as it is already implemented**: what problem it
solves, how the end-to-end path works, what the stage semantics and contracts are, and which
boundaries ongoing development most easily breaks.

> Planning and design background is in `docs/StartupOptimizationPlan.md`; this document covers only
> how it runs now.

---

## 1. Scope and conclusions

The core of the startup optimization is splitting boot from one huge serial init into **visible and
clickable (Shell) → core usable (Core) → main app interactive (Full / APP_READY)**, while also
reducing the first-paint JS and library parse cost.

Key points already landed:

- **Shell arrives first**: `#preloader` is removed during the Shell phase of `firstLoadInit()`, so the
  main page becomes visible and clickable as early as possible.
- **Explicit Host Ready wait**: the code waits for `__TAURITAVERN_MAIN_READY__` before the first
  `/api/*` access, which guarantees the interceptors and routes are installed and the Tauri backend
  has reached a readiness state that can accept `AppState` commands.
- **Concurrent startup reads**: settings and bootstrap metadata are read in parallel, applied in order,
  and reused for the rest of that boot.
- **Layered extension startup**: extension discovery can start in the background early; system
  extensions still complete in the Full phase, and local/global third-party extensions are deferred to
  a serial activation after `APP_READY`, which takes them off the startup critical path.
- **lib.bundle split into core and optional**: `highlight.js` loads on demand through the async helper
  in `lib.js`; the upstream-synced `/lib.js` ABI stays in the core bundle.
- **Heavy tasks moved later**: `initTokenizers()` and `initScrapers()` start in the background after
  `APP_READY` and after two paints.

---

## 2. The end-to-end path (from index.html to APP_READY)

### 2.1 HTML entry and preload overlay

- `src/index.html`
  - First-paint overlay: `<div id="preloader"></div>`
  - Module entry: `<script type="module" src="init.js"></script>`
  - Constraint: no modulepreload (mobile WebViews have had cache and preload failures before).

### 2.2 Bootloader: layered imports and Android import retry

- `src/init.js`
  - Sets `window.__TAURI_RUNNING__ = true` and computes `globalThis.__TAURITAVERN_PERF_ENABLED__`
  - Waits for the
    [optional dev-resource bridge readiness signal](../FrontendHostContract.md#22-readiness-signals-publicproject)
  - Loads these in order through `importWithRetry()`:
    1) `./lib.js` (static dependency on `src/dist/lib.core.bundle.js`)
    2) `./tauri-main.js` (installs the Host Kernel: routes, interceptors, ABI)
    3) `./script.js` (the SillyTavern main frontend)
  - Purpose: make module loading more deterministic on Android WebView, where first-launch I/O is
    jittery.

### 2.3 Host Kernel: turning same-origin /api into routable endpoints

- `src/tauri/main/bootstrap.js`
  - Installs `window.__TAURITAVERN__` (the stable Host ABI): the invoke broker, resource path helpers,
    and so on
  - Patches:
    - `fetch` interception (same-origin requests that hit the route table go through
      `router.handle(...)`)
    - `jQuery.ajax` interception (same-origin requests that hit the route table are forwarded)
    - same-origin iframe and window patching, so extensions and scripts inside an iframe also hit the
      routing and download bridges
  - Sets readiness:
    - `window.__TAURITAVERN_MAIN_READY__ = readyPromise`
  - After Host Ready it loads only modules that do not transitively import the main app. The settings
    entry point registers the sync and pairing listeners first, and event presentation shares one
    `APP_READY` promise with the settings UI; the request-parameters panel itself depends on the main
    app, so it is imported directly after `APP_READY`.

### 2.4 Frontend startup orchestration: Shell → Core → Full (keeping APP_READY semantics)

- `src/script.js:firstLoadInit()`
  - **Shell phase**
    - `initLocales()` runs before any visible UI: the locale data is a static resource that does not
      depend on Host readiness, so the first frame and the startup status copy are already in the
      user's language
    - `removePreloader()` (`src/scripts/loader.js`) removes `#preloader`
    - Initialises pure frontend UI and DOM handlers and the base patches (no `/api/*`)
  - **Core phase**
    - `await window.__TAURITAVERN_MAIN_READY__` guarantees Host interceptors and Rust backend
      readiness; a failure propagates directly
    - `/csrf-token`, plus `/api/bootstrap` and `/api/settings/get` started concurrently
    - `initSecrets()` + `primeSecretStateSnapshot(...)` + `readSecretState()`
    - Initialises core modules such as the default slash commands and models/settings
  - **Full phase**
    - Applies the read results in the order settings, characters, groups, avatars.
    - Extensions (when enabled):
      - Background: `startOfflineExtensionsDiscovery()` (may start early, during the Core phase)
      - Full: `activateStartupSystemExtensions({ parallelism })` activates system extensions only,
        and completes Extras auto-connect early when needed
    - Outward-facing events keep their original semantics:
      - `event_types.APP_INITIALIZED` → `event_types.APP_READY`
  - **Post-ready (background)**
    - `initTokenizers()` and `initScrapers()` run asynchronously after `APP_READY`, so they do not
      block the first paint.
    - When enabled third-party extensions exist, `activateDeferredThirdPartyExtensions({ parallelism:
      1 })` activates them in the background after the first paint and emits
      `EXTENSION_SETTINGS_LOADED` when it finishes.

---

## 3. Stage semantics and global signals (contract)

### 3.1 Internal stages (UI experience)

- `Shell`: the UI may be visible and clickable; **it must not depend on extensions being active**.
- `Core`: the first `/api/*` calls and core data loading may run; extensions may still be inactive.
- `Full`: the initialisation the main app needs to be interactive, and system extension activation,
  are complete; third-party extensions may still be finishing in the background.

Signals exposed today:

- `globalThis.__TAURITAVERN_STARTUP_STAGE__`, written by `firstLoadInit()` (shell/core/full)
- `event_types.APP_READY`, the stable meaning of "the main app is interactive"; late-loaded
  extensions rely on its auto-fire behaviour to complete their ready hooks

### 3.2 Host readiness (interceptors, routes, and BackendReadiness)

- `window.__TAURITAVERN_MAIN_READY__`, set in `src/tauri/main/bootstrap.js`
- The main app awaits it once during the Core phase, and both extension discovery and activation
  happen after that; first-party extensions await the same promise through
  `window.__TAURITAVERN__.ready`. A failure propagates directly; see
  [Readiness contract](../FrontendHostContract.md#22-readiness-signals-publicproject).
- The Host init chain calls `wait_for_backend_ready` before any of the first work that needs
  `AppState`, which avoids retrying on Tauri's "state not managed" error text.

---

## 4. Settings and bootstrap metadata reads

`/api/settings/get` reads settings on its own; `/api/bootstrap` provides startup metadata such as
characters, groups, avatars, and secret state. The frontend fetches them concurrently and applies them
in the established order, and that boot reuses the read results so nothing is requested twice.

Settings and characters are required for startup, so a failure blocks startup and the error message
carries the reason the host returned; a single preset file whose contents cannot load, or whose preset
name is duplicated, is skipped as SillyTavern does, with a visible error. When groups, avatars, or
secret state fail, the visible error stays and only that capability is disabled; `APP_READY` is not
blocked.

Startup can fail at only two exits: `src/init.js` failing to load an application module, or
`firstLoadInit()` throwing. Both call `showStartupFailure(error)` to show a modal failure dialog that
cannot be dismissed (the error, the stage, and the stack trace, with copy and reload), and then
rethrow the original error while logging continues as usual. The presentation must not replace the
original error: a failure in `init.js` may come from module loading itself, so the dialog module loads
outside the error path, and a failure to load it is reported as a second error. The dialog renders in
a Shadow DOM and is unaffected by the theme and custom CSS.

The backend sampling entry point is
[bootstrap_commands.rs](../../src-tauri/crates/tauritavern/src/presentation/commands/bootstrap_commands.rs).

---

## 5. Extension loading (offline discovery and batched activation): current status

> The detailed extension compatibility path is in `docs/CurrentState/ThirdPartyExtensions.md`.

Current strategy in brief:

- Discovery: `startOfflineExtensionsDiscovery()` waits for Host Ready, calls
  `/api/extensions/discover`, and loads each extension's `manifest.json`.
- System extension activation: `activateStartupSystemExtensions({ parallelism })`
  - extensions with the same `loading_order` are grouped; within a group they run in `Promise.all`
    chunks sized by `parallelism`, with `delay(0)` between chunks to yield the event loop on purpose.
  - Android devices default to `parallelism = 1` and everything else to `parallelism = 2` (see
    `src/script.js`).
- third-party activation: `activateDeferredThirdPartyExtensions({ parallelism: 1 })`
  - handles `local/global` extensions only and runs after `APP_READY` by default, keeping large
    third-party module evaluation off the startup critical path.
- third-party compatibility (hljs):
  - activation awaits `getHljs()` before third-party extensions activate, which guarantees
    `window.hljs` exists (`src/scripts/extensions.js`).

---

## 6. lib.core and lib.optional (on-demand loading): current status

### 6.1 Build outputs and entry points

- Rspack entries: `rspack.config.js`
  - `lib.core` → `src/lib-bundle-core.js` → `src/dist/lib.core.bundle.js`
  - `lib.optional` → `src/lib-bundle-optional.js` → `src/dist/lib.optional.bundle.js`

### 6.2 Frontend facade (lib.js)

- `src/lib.js`
  - statically imports the core bundle and re-exports the libraries upstream uses most
  - optional libraries load on demand:
    - `getHljs()` dynamically imports the optional bundle and registers the `stscript` language
      (`src/scripts/slash-commands/stscript-hljs-language.js`)
  - `initLibraryShims()` hangs a few libraries on `window` for third-party compatibility;
    `window._ = lodash` is a formal ABI and must be in place before third-party extension modules are
    evaluated

### 6.3 Code highlighting (deferred)

- `src/scripts/tauri/perf/code-highlight-coordinator.js`
  - highlights near the viewport through `IntersectionObserver` plus `requestIdleCallback`
  - pulls in the optional bundle through `getHljs()` internally, keeping it out of the Shell/Core
    static dependency graph

---

## 7. Panel Runtime extension DOM parking and the compatibility allowlist

Panel Runtime installs after `APP_READY` and parks some panel DOM subtrees into a `DocumentFragment`
while a drawer is closed, reducing DOM and observer pressure on low-end devices.

Known compatibility points:

- `src/tauri/main/adapters/panel-runtime/extensions-subtree-gates.js`
  - currently enables the subtree gate plus park/hydrate for the extension settings container
  - **the allowlist stays connected at all times**: `regex_container`, `qr_container`
    - purpose: keep scripts such as SPresets from failing with `MutationObserver.observe(target not
      Node)` when they cannot find `#saved_regex_scripts` while the drawer is closed.
- `src/tauri/main/adapters/panel-runtime/top-settings-panel-parking.js`
  - the pinned anchors in the left rail fall into two classes, with different criteria:
    - `LEFT_NAV_REQUIRED_ANCHORS` (every level, correctness): nodes that code outside the panel
      reads stay connected, including `#range_block_openai`, which `onModelChange` reads for boundary
      values, and `#openai_reasoning_effort_block`, which the assistant reads for its supported
      sources.
    - `LEFT_NAV_COMPAT_ANCHORS` (`compat` only, a compatibility concession): `#openai_api-presets`
      and `#completion_prompt_manager`, so third-party scripts can still select them while the drawer
      is closed.
  - World Info drawer: `compat` parks only the entry list `#world_popup_entries_list` (the bulk of the
    World Info DOM), keeping the World Info dropdown, pagination, and edit buttons connected, while
    `aggressive` still parks the whole `#wi-holder`. The World Info module holds the list node, and
    normal rendering and updates during parking use the same target; reopening reattaches the original
    node without an extra refresh. Off-screen updates still do rendering work, but heavy entries are
    not connected to the document while parked, which keeps the DOM trimming gain; post-pagination
    measurement and entry positioning skip off-screen nodes.

---

## 8. Observability (perf and status)

- Perf switch: `localStorage tt:perf = '1'` or the URL parameter `?ttPerf=1`
- Marks (partial list):
  - `src/init.js`: `tt:init:*`
  - `src/tauri/main/bootstrap.js`: `tt:tauri:*`
  - `src/script.js`: `tt:startup:shell/core/full` and `tt:startup:ready`
- Runtime cues:
  - `src/scripts/tauri/startup/startup-status-overlay.js`: the non-blocking startup status overlay in
    the bottom-right corner (removed after `APP_READY`) and the startup failure dialog (see §4)
- `pnpm run test:browser` builds the vendor bundle and runs `tests/browser/*.test.mjs`. Among them,
  `startup-order.test.mjs` checks that the main app still initializes normally when a Host-ready
  module loads first, that an early event waits for app readiness before it is presented, and that on
  a startup failure the dialog shows the error while the error continues to propagate. This test group
  is part of `pnpm test` and `pnpm run check`.

---

## 9. Explicit support and non-support boundaries

Supported:

- The main page becomes visible and clickable early (Shell arrives first).
- `APP_READY` means the main app is interactive; late-loaded third-party extensions rely on its
  auto-fire semantics to finish initializing.
- Third-party extension resources load same-origin, and `window._` (lodash) and `window.hljs`
  compatibility is provided (see above).

Not guaranteed (extend the allowlist or contract as needed):

- That any third-party script can reach the extension settings DOM it expects while the **extension
  drawer is closed** (Panel Runtime may park subtrees, and only the allowlisted containers are
  guaranteed today).

---

## 10. Performance gates

`tests/perf/baseline.json` is the checked-in budget, not just a reference snapshot. `pnpm run test:perf`
replays the measured flows and fails when startup DOM size, node count, scroll containers, listener
count, host traffic, or JavaScript allocation exceeds the recorded value. Update it only after
reviewing the delta:

```powershell
pnpm run test:perf -- --update
pnpm run test:perf:backend
```

`tests/helpers/frontend-content.mjs` separates `systemExtensions` from
`webHostSystemExtensions`. Native-only extensions are excluded from Web Host and perf fixtures so a
Tauri-only import cannot masquerade as a startup regression. Keep that list current when an extension
gains a native dependency.

Heavy startup remains the main open performance risk: hidden panels and extension drawers are still
mounted even when closed. Lazy-mounting or parking those subtrees should be measured against the
baseline above before and after the change.

