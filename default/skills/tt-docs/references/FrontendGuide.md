# TauriTavern frontend guide

This document describes how the current TauriTavern frontend (based on SillyTavern 1.19.0) is integrated and developed inside the Tauri environment.

The host layer's outward contract is listed in `docs/FrontendHostContract.md` (preserve it above all when refactoring).

Shared controls and accessibility conventions are in [FrontendAccessibility](FrontendAccessibility.md).

## 1. Goals and principles

- **Minimal intrusion**: keep upstream SillyTavern frontend behavior unchanged wherever possible.
- **Modularity**: split Tauri injection logic into separate modules so no single file grows without bound.
- **Low coupling**: keep route registration, request interception, and business context apart.
- **Converged entry points**: always go through `init.js -> tauri-main.js -> tauri/main/*` and avoid duplicate entry points.

## 2. Startup chain

The current frontend startup order is below (the host identity is already written before page scripts run; see 2.1):

1. `src/init.js` waits for the [optional development resource bridge readiness signal](FrontendHostContract.md#22-readiness-signals-publicproject), then dynamically imports `lib.js` -> `tauri-main.js` -> `script.js`
2. `src/lib.js` statically imports `src/dist/lib.core.bundle.js`, which provides the ESM exports in one place; `highlight.js` is loaded on demand through `getHljs()`
3. `src/tauri-main.js` only calls `bootstrapTauriMain()` (a thin entry point)
4. `src/tauri/main/bootstrap.js` takes care of:
   - creating the runtime context (`context`)
   - registering frontend routes (`router + routes/*`)
   - installing the request interceptors (`fetch` and `jQuery.ajax`)
   - installing the platform ABI: `window.__TAURITAVERN__` (a small, stable host-facing interface)
   - installing the same-origin window download bridge (browser-style exports in every host window -> native delivery)
   - injecting the tracing header `x-tauritavern-trace-id` into responses of host-taken routes
   - installing the backend error bridge and awaiting `BackendReadiness`

### 2.1 Host identity

Rust hardcodes the host identity `{ platform, kind }` as `{ platform: 'windows', kind: 'desktop' }` (contract: `docs/FrontendHostContract.md` §2.2). The frontend reads it only through `src/scripts/util/host-identity.js`: `hostPlatform()` returns `'windows'`, `isDesktopHost()` is always true, and `isMobileHost()` is always false. Tests install the identity through the harness.

For a platform-related decision, first be clear about the question:

| Question | Basis | Example |
| --- | --- | --- |
| Which class of shell the host is | `isDesktopHost()` | F11 full screen, data directory selection |
| A Windows-specific implementation | `hostPlatform()` | System tray |
| Whether an optional capability exists | The plugin, native bridge, or DOM API itself | System file picker |
| Screen and interaction form | Upstream Bowser `isMobile()`, CSS media queries | Upstream responsive layout |

Constraints:

- Do not infer the host from the user agent, `navigator.platform`, or `maxTouchPoints`.
- This branch supports Windows desktop only; new code needs no branches reserved for other platforms.

### 2.2 Native capabilities

The TT frontend always runs on top of the host, so the code never tests "are we inside Tauri". Application modules use native capabilities only through `tauri-bridge.js`, and the bridge raises an error at the call site when a capability is missing. An optional plugin is checked for availability by the service that owns it, such as the availability check for the system file picker. `__TAURI_RUNNING__` is only an outward marker and is never read internally. `check:frontend` guards this boundary.

## 3. Directory structure (frontend integration)

```text
src/
├── tauri-bridge.js            # low-level bridge: invoke/listen/convertFileSrc
├── tauri-main.js              # new entry: bootstrap only
├── tauri/
│   └── main/
│       ├── bootstrap.js       # composition root
│       ├── context.js         # compatibility shim (re-exports `context/index`)
│       ├── context/           # Host Kernel facade + types (the outward contract stays stable)
│       ├── kernel/            # pure logic (policy/computation/key generation/tracing)
│       ├── services/          # stateful capabilities (assets/thumbnails/characters/settings…)
│       ├── adapters/          # adapter layer that touches window, the DOM, or upstream ST
│       ├── download-bridge.js # same-origin window download bridging
│       ├── http-utils.js      # URL/Body/Response helpers
│       ├── interceptors.js    # fetch/jQuery injection
│       ├── router.js          # lightweight route registration and dispatch
│       └── routes/
│           ├── system-routes.js
│           ├── settings-routes.js
│           ├── extensions-routes.js
│           ├── resource-routes.js
│           ├── character-routes.js
│           ├── chat-routes.js
│           └── ai-routes.js
└── scripts/
    ├── extensions/runtime/      # third-party plugin runtime (resource resolution/module rewriting/loader)
    └── ...                    # upstream SillyTavern feature modules
```

## 4. Core module responsibilities

### 4.1 `bootstrap.js`

- Assembles module dependencies and runs initialization.
- Ensures bootstrap runs exactly once.
- Retries runtime patches after the backend is ready (to handle load-order problems).
- Owns the host ABI visible to third parties (`window.__TAURITAVERN__`) and the request tracing header.

### 4.2 `context.js`

- `context.js` is only a compatibility entry point (so external import paths do not change).
- The real implementation is `src/tauri/main/context/index.js`, which assembles `kernel + services + adapters` as the Host Kernel facade.
- `safeInvoke` has configurable invoke policies (dedupe / write-behind / TTL cache) collected in `src/tauri/main/kernel/invokes/invoke-policies.js`.
- The Rust command names the host knows are collected into a type: `src/tauri/main/kernel/invokes/tauri-commands.js` (`TauriInvokeCommand`).
- Global symbols that third parties interact with directly (such as the thumbnail helpers) belong to the Public Contract (see `docs/FrontendHostContract.md`).

#### 4.2.1 `window.__TAURITAVERN__.api.chat` (extension and memory plugin API)

> **The only entry point** for APIs unique to TauriTavern (deliberately without an alias): it gives extensions bounded history reads, backend addressing, retrieval, and persistence. It enhances the complete upstream `chat[]` contract; it does not replace it.

- Installed at: `src/tauri/main/api/chat.js` (installed onto `window.__TAURITAVERN__.api.chat` in `src/tauri/main/bootstrap.js`).
- Type declarations: `src/types.d.ts` (so extension authors can get started with TS or JSDoc quickly).
- Detailed API documentation and an adaptation guide: `docs/API/`.

### 4.3 `interceptors.js`

- Proxies `window.fetch`.
- Proxies `$.ajax` and keeps Deferred/jqXHR behavior compatible.
- Takes over the whole `/api/*` namespace and the other registered routes; every remaining request passes through to the native implementation (see `FrontendHostContract.md` §4.2).

### 4.4 `download-bridge.js`

- Handles browser-style downloads in every same-origin host window (such as `blob:`, `data:`, or a same-origin URL plus `a[download]`).
- Content the page can read goes to `deliverBlob()`; remote images go to `deliverRemoteFile()` and are downloaded by the host. Both stage the data first and then deliver it; see [file transfer](CurrentState/FileTransfer.md).
- It takes no part in API route matching, so it stays separate from request interception.

### 4.5 `router.js` + `routes/*`

- `router.js` provides a concise registration interface: `get/post/all`.
- `routes/*` is organized by business domain, which lowers file complexity and edit conflicts.

## 5. Request injection flow

1. The frontend issues `fetch('/api/...')` or `$.ajax('/api/...')`
2. The interceptor asks `router.canHandle(method, path)` whether a local route takes the request
3. On a match, the request goes to the route in `routes/*`
4. The route calls the Rust command through `context.safeInvoke(...)`
5. A standard `Response` goes back to the frontend caller

Notes:

- `/csrf-token` in `system-routes.js` returns a fixed token, which gets the frontend initialization flow past its CSRF dependency check.
- Every response from a host-taken route carries `x-tauritavern-trace-id`, which correlates DevTools Network entries with console and perf HUD output when locating a problem (the header name is also available from `window.__TAURITAVERN__?.traceHeader`).

## 6. Route domains

| File | Scope |
|------|----------|
| `system-routes.js` | Basic system endpoints such as ping/version/csrf |
| `settings-routes.js` | Settings, snapshots, secrets, presets |
| `extensions-routes.js` | Extension discovery, installation, updates, deletion |
| `resource-routes.js` | Avatar, background, theme, and group resource endpoints |
| `character-routes.js` | Character list, creation, editing, import and export, renaming |
| `chat-routes.js` | Chat reads and writes, search, recent history, export |
| `ai-routes.js` | Chat Completion (OpenAI / Claude / Gemini / OpenCode) |
| `tokenizer-routes.js` | tokenizer count/encode/decode/bias and the routes compatible with the upstream local tokenizer |

## 6.1 Chat payload and the DOM boundary

- Upstream interception points: `src/script.js` (character chat) and `src/scripts/group-chats.js` (group chat).
- Single entry point: upstream code imports only `src/scripts/chat-payload-transport.js` and must not depend on `src/scripts/tauri/chat/*` directly.
- First-party code loads every message, with optional [on-demand loading while scrolling history](CurrentState/ChatPayload.md#21-on-demand-loading-while-scrolling-history). The header is separate from the message array, and generation, extensions, and saving share one complete, ordered canonical `chat[]`.
- `chat_truncation` limits the initial DOM only. Show More attaches messages from the complete `chat[]`, issues no paging I/O, and does not change absolute message indexes.
- Full saves of the current chat and metadata saves share `enqueueChatSave()` and the transport's commit session, and the transport never enqueues twice. A commit captures an independent snapshot and publishes it atomically, so edits made during the save do not enter this commit.
- `saveMetadata()` saves only `chat_metadata` from the header; it does not save messages and does not cancel a pending full save. An extension that modifies messages must call the full save explicitly.
- tail/before/beforePages belong to `api.chat.history` and to explicit read-only queries by the Agent only; they are not part of the frontend's current chat state.
- Chat format follows [ChatPayload §1.1](CurrentState/ChatPayload.md#11-unified-format-baseline); a parse failure must propagate, and partial history must never be committed.

Saving rules and responsibilities are in [ChatPayload](CurrentState/ChatPayload.md); the compatible get/save routes and their event contract are in [FrontendHostContract §4.3](FrontendHostContract.md#43-route-table-public).

## 6.2 ChatSurface ownership and participants

- `chat[]` is still the complete and only source of data truth; ChatSurface owns only the current view projection of `#chat > .mes`.
- `installChatSurfaceRuntime()` is the only concrete composition seam in `script.js`; structure and projection live in kernel, lifecycle coordination lives in services, and real DOM and scroll writes live in adapters.
- An external renderer joins through `window.__TAURITAVERN__.api.chatSurface.registerParticipant()`; it does not control the projection directly and does not rely on fabricated message events.
- An asynchronous template prepares its display HTML through a separate `registerContentProcessor()`; `content-preparation.js` stores the message content result, so a scroll remount does not evaluate it again. The manifest `hooks.chatSurface` registers before the first projection, and the content result reaches the participant through the existing synchronous transaction.
- Synchronous and batch formatting share one path and hand out only final HTML; message text and reasoning share the ChatSurface content refresh. The core awaits the content commit through `finalizeMessageContent()` before dispatching message events, and `commitContent()` commits prepared content only.
- A renderer calls `isManagedOwnershipRequired()` once at its entry point: on `true` only the participant owner is enabled, on `false` only the original static owner; neither the presence of the API nor the current DOM shape can replace that decision.
- Structural reconcile is separate from pure range projection: the former runs in O(N) only when the structure of the canonical `chat[]` changes, while the latter carries epoch/revision tokens and stays O(M).
- The mount lease is separate from the content lease; intermediate streaming frames commit content only, and decorator/runtime is restored on the final frame.
- `chat_virtualization_enabled=false` is the default and keeps the upstream Show More semantics; the "Chat DOM virtualization" toggle in TauriTavern Settings binds directly to this boolean and reloads after saving. Once the user turns it on explicitly, the experimental bounded path uses TanStack geometry to commit `V ∪ T`, the true tail stays resident, and the `.mes` upper bound is `32 + 1`.
- `lib.js`'s vendor facade injects the TanStack symbols as a single adapter at the composition root, so native ESM sources never resolve a bare package. The virtualizer's `scrollToFn` is injected into the existing ChatScrollAdapter as well, so `#chat` still has exactly one owner of physical scroll writes.
- Bounded runtime candidates are managed by a separate grant lease; viewport scrolling may revoke and re-grant without fabricating a content commit or message business events.
- Runtime demand is ordered by visible and overscan only, and the resident true tail reserves no extra runtime slots. A real global reflow keeps its own follow-tail intent, or restores its anchor from a stable message key plus a clamped in-message offset; ordinary settings saves and IME height-only resizes no longer discard every historical measurement.
- Message state that can be derived from `chat[mesid]` belongs to the materializer; after a bounded DOM commit, the private `syncMountedChatViewState()` idempotently replays transient core UI such as swipe and delete before the final measurement. This seam dispatches no SillyTavern business events.
- When a legacy extension deletes a message root directly, the compatibility bridge only releases that root's lease; it does not take over a third party's content writes or renumbering. The bounded policy must first pass the participant capability gate.
- For the project raw API, see `docs/API/ChatSurface.md`.

## 6.3 Theme scope and ownership

- `power_user.theme` always means the named Theme that is actually in effect; theme CRUD, slash commands, and the extension context keep following that upstream semantics.
- `power_user.theme_fallback` stores the global Theme used when there is no local binding; the system dynamic theme updates only this fallback and never overrides the current chat, character, or group binding.
- Theme resolution order is fixed: `chat_metadata.theme -> character/group binding -> theme_fallback`. A character binding is keyed by the untransformed avatar filename, and a group binding by the group id.
- A Theme file stores only a portable appearance snapshot and holds no local character or chat identity. Chat bindings persist with the JSONL header metadata, and character and group bindings persist with settings.
- Every effective switch must go through the single entry point in `src/scripts/power-user.js`; the Tauri appearance adapter does not simulate a DOM change event on `#themes`.

## 6.4 Chat Completion parameter management

The implementation lives in `src/scripts/tauri/generation-params/` and is imported and mounted after `APP_READY`. Parameter discovery, channel support, and reading and writing values continue to use the upstream settings and controls.

- Removing a request parameter means this generation does not send it while the stored value stays; removing a toggle means off; hiding a local block changes neither its content nor its behavior. When an old preset lacks the Fast Mode fields, they are explicitly off.
- The removal state of request parameters is stored in the preset's `extensions.tauritavern.omit_params`, while local block visibility is stored on the device only. Old presets keep their original behavior, removal is limited to optional parameters, and structural fields such as `messages` and `model` can never be removed.
- Prompt assembly and generation decisions use the settings in effect for this run, and `createGenerationParameters()` omits the fields in one place at its exit; Additional Parameters that the user configured explicitly still have the final say.
- The JSON view edits only the parameters available to the current format, and invalid input is not applied at all; it is not a final request preview, and the channel and model conversion rules still apply afterwards.

## 6.5 CodeMirror editor

Mounting and lifecycle live in `src/scripts/tauri/codemirror-editor.js`, and the editor itself lives in the on-demand `src/lib-bundle-editor.js`. When the setting is off, the native textarea stays.

- The source textarea is the only source of the value. The editor reports changes through `onChange`, and a caller that needs the text writes it back to the source textarea with `flush()`; `flush({ input: true })` dispatches `input` on the source, reusing the textarea's existing handler chain.
- The `.tt-codemirror-editor` shell takes over the source textarea's box and inherits its `resize`. Reading the size never lays out the source text, unless the source height is content-driven (`field-sizing: content`). Mounting first waits for the caller's current synchronous work to finish (for example a drawer revealing the source textarea), then completes before the next frame once the editor bundle has loaded, so the source textarea is never rendered on its own first; the editor is built off-page and then placed into the page in one step. Leaving full screen restores the height the user had set.
- Where the editor DOM sits depends on the engine, and the decision is centralized in `codemirror-editor.js`. A Chromium host (Windows, Android, OpenHarmony) puts it in the shell's open shadow root: Blink re-checks the `:has()` anchors around the editor on every DOM change, and once isolated, page selectors neither match it nor trigger a style recalc for it. A WebKit host (macOS, iOS, Linux) leaves it in the page: inside a WebKit shadow root, an edit that replaces a selection reaching into the last line pulls page content into the editor. Page CSS and scripts do not depend on whether the editor's internal DOM is visible.
- The editor's styles in the page are written by style-mod into a single `<style>` in `<head>`. It used to rewrite that text on every mount, forcing a whole-page style recalc; `patches/style-mod@4.1.3.patch` skips the rewrite when the text is unchanged, so check whether upstream has fixed it when upgrading style-mod.
- Raw `input` and `beforeinput` stop at the shell; keyboard and focus events bubble as usual, and focus checks must look into the shadow root (see `isInputElementInFocus()`).
- The page interacts with the editor styles in two places: theme custom properties inherit naturally, and `--tt-editor-tools: none` hides the toolbar (search and replace can still be opened); while the search panel is open, the shell carries `data-search-open`.
- It uses the native caret and selection, so each keystroke produces a single frame.

## 6.6 Style and compositing cost

- All `:has()` rules in Blink share one invalidation set, so the larger the interface an anchor covers, the more a DOM change costs to re-check. Therefore:
  - put `:has()` on the rule subject, not on large containers such as `body` or `#top-settings-holder`;
  - do not check the `style` attribute in the argument — when a selector must depend on display state, let the code that changes the state write a class or attribute;
  - the rightmost compound after `:has()` carries a class, id, or attribute;
  - do not switch to an allowlist of known class names to avoid `:has()`, because controls inserted by extensions fall through it.
- A sibling combinator must not end in `*` or a bare pseudo-class with nothing distinguishing on the left (such as `* + *`), or every child added to or removed from `body` forces the whole `body` to recalc. Write `> * + *` as `> :not(:first-child)`.
- In WebKit, when `:has()` is followed by a sibling combinator and the argument checks a state pseudo-class (such as `#a:has(#b:checked) ~ #c`), any change of that state anywhere in the page forces a whole-page re-check. Rewrite it as a descendant relationship: `#common-parent:has(#b:checked) #c`.
- Controls that appear in bulk must not become scroll containers; every visible scroll container adds compositing cost to every frame. World Info headings therefore size to their content and use `overflow: hidden`.
- WebKit recalculates the style of the whole document in two cases: every 30 s under high memory pressure (roughly 1.5 GB or more on macOS), and each time a modal `<dialog>` opens or closes. The cost grows with the number of elements in the render tree; native dropdowns additionally re-measure option text, and text containing U+FE0F (the emoji presentation selector) is especially slow. Dropdowns that appear in bulk therefore keep U+FE0F out of their option text, and rows in a long list that are far from the visible area stay out of the render tree.
- Long-list items use `content-visibility: auto` with `contain-intrinsic-block-size` set to their actual height. WebKit's `content-visibility` saves no style calculation, so World Info also puts entries far from the visible area to sleep: an `IntersectionObserver` decides how far away an entry is, a sleeping entry gets `content-visibility: hidden`, and its heading bar gets `display: none`. Sleeping must preserve two properties:
  - it does not change the item size — `hidden` keeps the height the item had when it was last rendered, because otherwise the item collapses before it wakes and the list keeps stretching and flickering after fast scrolling stops;
  - it does not make the content unmeasurable — only the heading bar is hidden, so the rest can still be read for layout, and an item opened while asleep can mount its editor correctly. Layout-dependent initialization (such as measuring the heading) happens on wake, and an item that holds focus never sleeps.
- Each time the mouse is pressed, or a node holding a selection is removed, WebKit searches the page for a place to put the selection, and in a long list of form fields that takes several seconds. The World Info list therefore calls `preventDefault()` on presses outside a field and blurs the current focus (`blur()`) at the same time — a field saved on `change` commits when it loses focus — and clears the selection inside the list before tearing it down. Do not use `user-select: none` instead: WKWebView still searches.

## 7. Frontend adaptation of the plugin system

### 7.1 Design goals

- Keep the calling semantics of upstream `scripts/extensions.js` unchanged (manifest structure, enabling logic, dependency checks).
- Keep Tauri-specific logic inside separate runtime submodules to reduce conflicts when syncing with upstream.
- Support third-party plugins loading JS, CSS, and static resources from the user data directory, with no dependency on a Node.js backend.

### 7.2 Module layering

- `src/scripts/extensions.js`: the plugin activation orchestration layer (discovery, ordering, dependency and version checks, triggering loads).
- `src/scripts/browser-fixes.js`: upstream browser fixes (kept in sync with SillyTavern).
- `src/tauri/main/compat/dialog/dialog-polyfill-coverage.js`: fills in the synchronous semantics of `<dialog>.showModal()` inside the unified event loop.
- `src/scripts/util/window-layout.js`: the window size snapshot; `src/scripts/window-backdrop.js`: the single writer and strip publication entry point for the first-party background.
- `src/scripts/extensions/runtime/resource-paths.js`: extension resource path normalization and third-party detection.
- `src/scripts/extensions/runtime/third-party-runtime.js`: the third-party extension style compatibility layer (under a legacy WebView it appends `ttCompat=layer` to a style URL and triggers the Rust endpoint to flatten `@layer`; it no longer goes through frontend prefetch or Blob injection).
- `src/scripts/extensions/runtime/asset-loader.js`: script and style injection, timeout protection, and idempotent control of repeated injection.

### 7.3 End-to-end loading chain

1. Extension discovery starts only after the core startup phase confirms the host is ready.
2. The frontend gets the extension list and types from `/api/extensions/discover`, reads the manifests, and enters `activateExtensions()`.
3. For each extension it runs `addExtensionLocale()` + `addExtensionScript()` + `addExtensionStyle()`.
4. When the extension is `third-party/*`:
   - the JS entry script loads straight from `/scripts/extensions/third-party/*` (a real same-origin static resource endpoint).
   - CSS receives a `ttCompat=layer` query from the runtime only when the old WebView does not support `@layer`; the Rust endpoint returns the flattened CSS bytes (otherwise the original URL is used).
5. `/scripts/extensions/third-party/*` is served by the Rust protocol-layer endpoint (the WebView `on_web_resource_request` hook), which returns bytes + `Content-Type` + 404 semantics uniformly.

### 7.3.1 Current implementation conclusions

- The implementation has settled from "the frontend emulates a static file server" to "the frontend only orchestrates, and Rust owns the third-party resource endpoint".
- `src/scripts/extensions/runtime/third-party-runtime.js` no longer rewrites JS source or acts as a fake server; it keeps mainly the third-party style compatibility fix.
- For the current state of ongoing development, see `docs/CurrentState/ThirdPartyExtensions.md`; before any change that touches implementation boundaries, read that document first, then decide whether to change the frontend runtime or the backend resource endpoint.

### 7.3.2 First-party React extension

TauriTavern's own stateful UI mounts React client islands as a SillyTavern first-party extension. The Agent, MCP, and Settings owned scopes all follow this baseline today:

- The manifest, locale, and SmartTheme CSS still follow the existing extension resource contract; no Next.js, standalone page shell, or second routing system is introduced.
- `src/index.tsx` only waits for the Host ABI, resolves concrete actions, and creates the extension container and `createRoot()`.
- React presentation receives only strict typed initial state, actions, and a translator; it must not call `invoke()` directly, operate on jQuery, or read Rust command names.
- Cross-window and long-lived data stay owned by Rust and the host services; local React state represents the current view only and cannot become a platform source of truth or a persistent cache.
- Styles must use the `--SmartTheme*`, font, animation, and border variables, keeping the SillyTavern vanilla look and the user's ability to override the theme.
- `tsconfig.ui.json`, React Hooks/TypeScript lint, and Rstest/Testing Library explicitly cover the three owned scopes — Agent, MCP, and `src/scripts/tauri/setting`; `pnpm check` is the single acceptance entry point.
- Production and development share `createRspackConfigs(mode)`. The standard Tauri dev server starts listening only after the first development compilation succeeds, and reloads only after a successful recompile.
- `scripts/check-first-party-ui-guardrails.mjs` confines the owned extension architecture to React plus Strict TypeScript.
The current engineering baseline, frozen handles, and bundle data are in `docs/CurrentState/FirstPartyUI.md`.

### 7.4 Contracts and constraints

- The third-party extension naming convention is `third-party/<folder>`, and both the frontend and the backend parse it that way.
- Extension command parameters use camelCase uniformly (such as `extensionName`) to avoid missing invoke arguments.
- The client version check still follows the upstream format `SillyTavern:<version>:TauriTavern`, which is compared against `minimum_client_version`.
- Whether the interceptor takes a request is decided by `router.canHandle(method, path)`; there is no scattered path allowlist any more.
- `/api/extensions/branches` returns `{ name, commit, current, label }` for remote branches; `label` is intentionally empty today, and the frontend shows it only when it is non-empty.
- `/api/extensions/switch` accepts a short branch name and returns an empty `204` on success; the existing reload/settings ordering is unchanged, and no switch hook is added or update hook triggered as a side effect.

### 7.5 Troubleshooting

- `Extension module is not JavaScript`:
  - usually means an HTML response arrived instead of a module file.
  - check first that `/scripts/extensions/third-party/*` is answered correctly by the protocol-layer endpoint (it should return 404 or JS bytes, not `index.html`).
- `missing required key extensionName`:
  - means the invoke argument names do not match; check the mapping from route body to command arguments.
- `@layer` still has no effect in a legacy WebView:
  - check whether the style request carries `?ttCompat=layer`, and verify that the `/scripts/extensions/third-party/*` endpoint returns `text/css` bytes (not 404 or HTML).

### 7.6 Rules for future development

- When adding plugin loading capability, extend `src/scripts/extensions/runtime/*` first and do not pour Tauri details back into `extensions.js`.
- When adding a plugin API, wrap it in `src/tauri/main/routes/extensions-routes.js` first, then call the Rust command through `context.safeInvoke()`.
- If the third-party static resource path convention changes, `resource-paths.js` and the prefix parsing of the Rust protocol-layer endpoint must change with it.

### 7.7 Windows desktop compatibility notes

This branch builds the Windows x64 desktop app only; the mobile runtime polyfills, mobile layout variables, and safe-area contract have all been removed. First-party code uses the native writers in `src/tauri-bridge.js` directly; the host grants only `clipboard-manager:allow-write-text` and grants no clipboard read capability.

The window background is still written in one place by `applyWindowBackdrop()` in `src/scripts/window-backdrop.js`; `util/window-layout.js` no longer accepts mobile window snapshots.

### 7.8 Embedded Runtime (in-message iframe)

> Architecture status: kept for static compatibility only. It is not the runtime owner of the ChatSurface bounded path, and new virtualization work must not keep extending the parking/ghost/slot system.

This legacy mechanism wraps in-message iframes into slots with a budget, park/hydrate, and self-healing, and it avoids iframe teardown as far as possible when a static message re-renders. A bounded start skips this chat owner; a renderer must join through the single ChatSurface participant, and the two owners must never coexist.

Current implementation points (code):

- Install entry: `src/tauri/main/services/embedded-runtime/install.js`
  - `bootstrap.js` decides whether to load it from the bootstrap mirror after main is ready, and installs the chat adapters after `APP_READY`.
- Manager and profiles: `src/tauri/main/services/embedded-runtime/*`
  - Global debug entry point: `globalThis.__TAURITAVERN_EMBEDDED_RUNTIME__`
  - Configuration source: `tauritavern-settings.embedded_runtime_profile`
  - Bootstrap mirror: `localStorage tt:embeddedRuntimeProfile = 'off' | 'auto' | 'compat' | 'mobile-safe'`
  - The legacy `localStorage tt:runtimeProfile` is used for migration only.
- DOM detectors: `src/tauri/main/adapters/embedded-runtime/*-runtime-adapter.js`
  - Supported today: JS-Slash-Runner (`.TH-render`) and LittleWhiteBox (`.xiaobaix-iframe-wrapper`).
- Message write facade: `src/scripts/tauri/message/mes-text-write.js`
  - Upstream call sites depend on the facade uniformly; on `off` it restores the plain `.mes_text` HTML write semantics directly.
- Render transaction: `src/tauri/main/adapters/embedded-runtime/message-render-transaction.js`
  - The underlying implementation the facade uses while ER is on, so the iframe runtime is not repeatedly destroyed and rebuilt as ordinary DOM.

Current boundary notes:

- Managed today: **the in-message iframe runtime** (JSR/LWB).
- Not managed yet: parking panel-style runtimes (the browser's own reclamation is enough for now).
- The boundaries above describe only today's legacy profile; they are not the expansion list for the future bounded architecture.

For more on "how it works today, which contracts must not break, and where the regression points are", see `docs/CurrentState/EmbeddedRuntime.md`.

### 7.9 Panel layout and layout tests

The shell rail is 58px wide. Every drawer content is fixed at `left: 58px; width: min(460px, 100vw - 58px)`, and `#WorldInfo` / `#floatingPrompt` are the only centred exceptions. Inside the Extensions drawer, the two settings columns stack in shell mode, keep `min-width: 0`, and scroll wide content inside the panel instead of widening the drawer. The drawer uses `scrollbar-gutter: stable` so a tall panel cannot narrow the columns.

Any extension that adds a settings panel or a shell panel must keep its root inside the drawer and must not use `position: fixed` or `100vw` for the panel root. Run the layout suite after any panel or drawer change:

```bash
pnpm run test:layout
pnpm run test:layout:installed
```

`test:layout` uses Playwright and the Web Host fixture with wide and tall extension panels. `test:layout:installed` is the Windows-only live audit over WebView2 CDP and writes `tests/layout/artifacts/layout-report.json`. The static guardrail is `node scripts/audit-css-layout.mjs`, also part of `check:frontend`. The perf gate runs the frontend trace (`test:perf`) and replays its host calls through the Windows-only backend harness (`test:perf:backend`); the Linux callgrind baseline is not part of this fork.

### 7.10 Vault file explorer

The right-hand dock at `src/tauri/main/ui/file-explorer/` browses folders the user mounts as vaults. `vault_pick_mount` opens the native folder picker; mounts are stored in `local-vault.json` under the runtime data directory and one is the primary vault.

All page-to-backend paths are relative to a mount. The `tt-adapter-local-vault` crate canonicalizes roots and candidates, rejects traversal and symlink escapes, validates Windows names and returns typed conflict codes. Deletes use the recycle bin. The commands are declared in `src-tauri/crates/tauritavern/src/presentation/commands/vault_commands.rs`.

`body.tt-fe-open` shrinks and re-centers `#sheld` and `#top-bar` via `--tt-fe-width`; the dock's left edge is a resizer. Below 900px the dock overlays instead. Run `pnpm run test:layout` after changing the dock or the explorer; the suite covers geometry, resizing, tree/cards, thumbnails, create/rename/delete and drag/drop.

## 8. Compatibility layer strategy

- `src/tauri-main.js`: the new main entry (recommended).
- New development is concentrated in `src/tauri/main/*` so duplicate implementations and multiple injection paths do not coexist.

## 9. Adding a Tauri injection endpoint

1. Add or confirm the command in the Rust backend (`src-tauri/crates/tauritavern/src/presentation/commands/*`).
2. If the host layer calls that command, add the command name to `src/tauri/main/kernel/invokes/tauri-commands.js` (`TauriInvokeCommand`, so string spelling cannot drift).
3. If the command is called often or can be merged into batched writes, add or adjust a policy (dedupe / write-behind) in `src/tauri/main/kernel/invokes/invoke-policies.js` as needed.
4. Add the route in the matching business domain under `src/tauri/main/routes/`: route code must not reference `window` directly; when browser capability is needed, push it down into `adapters/` or `services/`.
5. In a route, do only argument validation, DTO assembly, and the `context.safeInvoke` call; let errors surface (no silent fallback).
6. Keep the response structure stable (status code plus JSON structure) so upstream frontend calling assumptions are not broken.
7. Run `pnpm run check` and make sure the full project gate passes.

## 10. Debugging and verification

The recommended minimal verification flow:

1. `pnpm run check`
2. `pnpm run dev`
3. After launch, confirm:
   - the first screen loads normally
   - no CSRF initialization error appears
   - core endpoints such as characters, chats, and settings work

To locate a problem quickly:

- Check in DevTools whether the request hit the local injection path.
- Check the `invoke` error in the console and the status code the route returned.
- Check whether the matching `routes/*` is missing a request field mapping.

### 10.1 Lightweight performance HUD

Used to locate main-thread stalls, DOM bloat, and invoke hot spots quickly on mobile and low-end devices.

- Off by default.
- To enable (a reload is needed to capture startup marks):
  - console: `localStorage.setItem('tt:perf','1'); location.reload();`
  - or the URL: `?ttPerf=1`
- After enabling, wait for readiness: `await window.__TAURITAVERN_PERF_READY__`
- Common export commands:
  - `window.__TAURITAVERN_PERF__.downloadReport()` downloads JSON (handy for analysis by an AI)
  - `window.__TAURITAVERN_PERF__.exportJson({ includeResources: true })` returns the JSON string directly
  - `await window.__TAURITAVERN_PERF__.copyReport()` copies to the clipboard through the native writer
- HUD controls: drag the title bar to move it (the position persists), and click the title bar to expand or collapse it; on desktop, `Ctrl+Alt+P` toggles it.

### 10.2 Performance baseline

`tests/perf/` keeps the frontend optimizations from regressing. `pnpm run test:perf` (already part of `pnpm run check`) runs the built frontend through the Web Host in the Chromium headless shell of a pinned Playwright version: an 80-message chat and 200 World Info entries whose first entry is 100,000 characters, with a Windows desktop host identity. Each scenario step counts how much work the engine did and compares it with the committed `tests/perf/baseline.json`. Install the browser once before the first run: `pnpm exec playwright-core install --only-shell chromium`.

- It counts work, not elapsed time, so machine speed does not matter: event dispatches; style recalcs, how many of them were forced, and how many elements they covered; layouts, how many were forced, and how many objects they laid out; frames with style or layout work and compositing updates; and the page's size at the end of the step — requests, elements, visible scroll containers, nodes still alive after collection, layout objects, and event listeners.
- Any count that drifts more than 10% from the baseline (and by at least 2) fails, a decrease included. Record an intentional change again with `pnpm run test:perf -- --update`, and review the baseline change with the commit; record it again after upgrading `playwright-core` to a different Chromium as well.
- Counts stay independent of machine speed thanks to conventions in the measurement environment: animations and smooth scrolling are off; timers shorter than a frame run only before the next frame, so a chain of jQuery Deferred callbacks lands in the same frame; during a step, longer timers (up to 1 s) and network responses are held back and then released one at a time, or run once the page goes quiet (three consecutive frame intervals with no work on the main thread), so no work arrives late after the page looks quiet; and the page opens without a query. Under these conventions counts still stay within tolerance at 6x CPU throttling. Page errors, console errors, or failed requests fail the run outright, so a broken page is never compared.
- Adding a scenario: drop a `*.perf.mjs` into `tests/perf/` whose default export is `async (app) => {}`, and measure a group of inputs with `app.measure(name, ...inputs)`. The page goes quiet after each input before the next one starts, so how you divide inputs decides which work may coalesce: every token of a reply is its own input (fed through `__perfReply.push()` and `end()`); continuous typing goes in a single input separated by frames, so debounced work runs only once at the end. Take click coordinates before the step with `app.centerOf(locator)`, and send real input inside the step with `page.mouse` and `page.keyboard`, so the driver's own events are not counted. Check a new scenario's counts against the tolerance under CPU throttling (`Emulation.setCPUThrottlingRate`).

## 11. Engineering guards (guardrails + type checking)

Goal: keep the host layer (`src/tauri/main/*`) at a size and dependency shape that stays **maintainable long term**, so it does not slide back into bloated single files and implicit coupling.

- Single check: `pnpm run check` (host boundaries, types, architecture boundaries, all tests, and Clippy).
- Guardrails (`scripts/check-frontend-guardrails.mjs`):
  - Line budget: `<= 500` lines per file by default; key aggregation files are held to the baseline in `scripts/guardrails/frontend-lines-baseline.json`.
  - Dependency boundaries: `kernel/ports` must not import `services/routes/adapters`; `services` must not import `routes`.
  - Route contract: `src/tauri/main/routes/*` must not reference `window` directly (when you need to touch the browser, the DOM, or upstream ST, add an `adapters/*` module).
- Type checking (`tsc -p tsconfig.host.json`):
  - `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and other strong constraints.
  - JS files are not checked by default; add `// @ts-check` at the top of the file together with JSDoc (the Host Kernel directories already follow this standard).
