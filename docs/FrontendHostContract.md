# Frontend host contract (TauriTavern)

> Purpose: make the behavior the host platform layer (Host Kernel) promises to the outside explicit, so refactoring `src/tauri/main/*` does not accidentally break upstream SillyTavern, third-party extensions, userscripts, or character cards.
> Scope: covers only the contract observable from the frontend host layer (the Host Kernel running inside the WebView); it does not describe Rust backend internals.
> Reference: `docs/FrontendGuide.md` (integration architecture and development approach)

---

## 1. Stability tiers (which parts may change, and which may not change freely)

To avoid treating everything as an API, this repository sorts frontend host behavior into 3 stability tiers:

1. **Public Contract (a promise to upstream, plugins, scripts, and character cards)**
   - A change must be recorded in this file and verified by the smoke tests (see section 6).
2. **Project Contract (an internal project agreement)**
   - For example, the coordination signal between `init.js` and `bootstrap.js`; it may evolve, but the related modules and documentation must be updated with it.
3. **Internal (implementation detail)**
   - Free to refactor, but it must not change the externally observable behavior of a Public Contract.

---

## 2. Startup chain and readiness signals (Public + Project)

### 2.1 Startup order (fact)

Current startup chain (see `docs/FrontendGuide.md`):

Before any page script runs, the host has already written `window.__TAURITAVERN_HOST__` (see 2.2).

The readiness contract of the development resource bridge is in 2.2, and its installation and takeover mechanism is in [third-party extensions](CurrentState/ThirdPartyExtensions.md).

1. `src/init.js`: handles the earliest environment markers, the optional perf switch, and dynamic imports.
2. `src/tauri-main.js`: a thin entry point that only calls `bootstrapTauriMain()`.
3. `src/tauri/main/bootstrap.js`: the composition root, which creates the context, registers routes, and installs interceptors and patches.
4. `src/script.js`: the upstream SillyTavern main application entry (vendor).

### 2.2 Readiness signals (Public/Project)

- `window.__TAURITAVERN_DEV_SW_READY__ : Promise<void> | undefined` (Project)
  - The development resource bridge bootstrap script publishes it synchronously when it installs the bridge; it resolves once the service worker has taken over the page and rejects if registration fails.
  - It is not published, and the app starts as usual, in these cases: a packaged run (nothing is injected); mobile dev (loaded through the app protocol, with resources served by the host); a WebView without service worker support (which warns that development resources are unavailable); an old session that is unregistering and reloading.
  - `init.js` awaits it before importing `lib.js`.
- `window.__TAURITAVERN_MAIN_READY__ : Promise<void>`
  - Written synchronously by `src/tauri/main/bootstrap.js` before the main application modules load; it resolves when initialization succeeds and rejects when it fails, and the caller propagates the failure.
  - Before it resolves, the Rust `BackendReadiness` wait must complete, so the first commands that need `AppState` never rely on retrying from a "state not managed" message as normal control flow.
- `window.__TAURITAVERN_PERF_READY__ : Promise<unknown> | undefined`
  - Present only when the perf HUD is enabled (see section 5).
- `globalThis.__TAURITAVERN_PERF_ENABLED__ : boolean`
  - Written by `src/init.js` before the dynamic import; `bootstrap` reads it first (avoiding duplicate computation and ordering differences).
- `window.__TAURI_RUNNING__ : true`
  - Written by `src/init.js` as the outward marker of the TT frontend; internal code does not read it, and new code uses the API provided by `__TAURITAVERN__`.
- `window.__TAURITAVERN_HOST__ : { platform, kind }` (Project)
  - Host identity: the host writes it to the TT page's `window` before page scripts run, and the object is frozen. In the native app, Rust produces it from the compile target.
  - `platform`: fixed to `'windows'`; `kind`: fixed to `'desktop'`. This branch builds the Windows x64 desktop app only, and the host hardcodes both values on the Rust side.
  - First-party code reads it only through `src/scripts/util/host-identity.js`; see `docs/FrontendGuide.md` §2.1.

---

## 3. Global APIs (Public)

`SillyTavern.getContext().macros` provides macro registration and standalone evaluation; see [the macro evaluation API](API/Macros.md) for the interface and its scope.

`SillyTavern.getContext().messageFormatter` exposes the upstream [MessageFormatter](../src/scripts/message-formatter.js) singleton. Synchronous hooks run before HTML sanitization and may run repeatedly; a failing hook is reported and isolated. After deferred extension initialization finishes, already mounted content is refreshed in one pass through ChatSurface.

> Third-party scripts, extensions, and character cards call these symbols directly, so changing them needs extreme care.

### 3.1 Resources and thumbnails (Public)

Installed by `createTauriMainContext()` (implementation: `src/tauri/main/context/index.js`, compatibility entry point: `src/tauri/main/context.js`):

- `window.__TAURITAVERN_THUMBNAIL__(type, file, useTimestamp?) -> string`
  - Builds a `/thumbnail?...` Host Resource URL for `bg`, `avatar`, or `persona`; an unknown type throws.
  - Normal first-party paths do not use `useTimestamp`; the argument remains only for an explicit force or debug cache bust.
- `window.__TAURITAVERN_BACKGROUND_PATH__(file) -> string`
  - Builds a `/backgrounds/<encoded file>` Host Resource URL.

The **observable behavior** of these APIs must stay the same:

- the URL shape for the same input (the meaning of the path and its query parameters);
- the return-value semantics on failure (for example `null` versus throwing versus a fallback string);
- no synchronous blocking (third parties call these frequently on the render path).

### 3.3 Back key handling (Public)

Installed by `src/tauri/main/back-navigation.js`:

- `window.__TAURITAVERN_HANDLE_BACK__() -> boolean`
  - Returning `true` means the back key was consumed (for example by closing a dialog, overlay, drawer, or chat); otherwise it returns `false`.

### 3.4 Native share bridge (Public)

Installed by `src/tauri/main/share-target-bridge.js`:

- `window.__TAURITAVERN_NATIVE_SHARE__ = { push(payload), subscribe(handler) }`
  - `push()`: injects a share payload (a url or a png).
  - `subscribe()`: subscribes to consumption; a payload that arrives early goes into a backlog, and the first subscription drains it.

### 3.5 Upstream library compatibility globals (Public)

Installed by `src/lib.js:initLibraryShims()`:

- `window._ : lodash`
  - A third-party extension in the SillyTavern ecosystem may externalize lodash as `_` and access it directly while its ESM module is being evaluated.
  - The symbol must be available before a third-party extension module loads, and must not rely on a bundler such as webpack or Rspack leaking a global by accident.

This ABI belongs to the SillyTavern compatibility layer and is not placed in `window.__TAURITAVERN__.api`. New TauriTavern code still imports `lodash` explicitly from `src/lib.js`.

The `writeSecret`, `deleteSecret`, `readSecretState`, `rotateSecret`, and `renameSecret` functions of the ESM `/scripts/secrets.js` reject their promise when the request fails, or when the state refresh that follows it fails; they raise no notification themselves, and the caller handles the failure and reports it. When `writeSecret` writes successfully but the refresh fails, the secret is already saved and must not be rewritten for that reason; without `allowEmpty`, passing an empty value is the same as deleting.

### 3.6 Platform ABI (Public, new)

To keep `window.__TAURITAVERN_*` symbols from spreading further, the host layer provides one additional **single entry point**:

- `window.__TAURITAVERN__ : { abiVersion, traceHeader, ready, invoke, assets, dialog, api }`
  - `abiVersion: 2`: incremented when a published extension contract changes in a breaking way.
  - `traceHeader: string`: the request tracing header name (see 4.4).
  - `ready: Promise<void> | null`: same semantics as `__TAURITAVERN_MAIN_READY__`.
  - `invoke.safeInvoke(...)` / `invoke.flushAll()`: stable wrappers around the `context` invoke capability.
  - `assets.thumbnailUrl` / `assets.backgroundPath`: uniform references to the stable Host Resource URL helpers in 3.1.
  - `dialog.pickDirectory(options?)`: native folder picker for extensions. Resolves to the selected absolute path, or `null` when the user cancels; `options` is passed to the Tauri dialog plugin and cannot turn off directory mode.
  - `api.layout`: reads and subscribes to the content viewport with native occlusion already excluded; `capture()` is a Project Contract used by first-party code, see [API/Layout.md](API/Layout.md).
  - `api.chat`: the TauriTavern-specific chat and memory extension API (chat summary, metadata, history paging, stable storage, backend addressing, plain-text retrieval).
    - Full signatures and examples: `docs/API/Chat.md`.
  - `api.characterCards`: selects character card files and adopts the lorebook inside a card.
    - `isNativePickerAvailable()`: `true` on every host.
    - `pickFiles(options?: { multiple?: boolean }) -> Promise<File[] | null>`: selects `json`/`png` character cards and returns a standard `File[]`; multi-select is supported; cancelling returns `null`, and failure throws.
    - Project, used by first-party code, with the avatar file name as the argument:
      - `adoptLorebook(avatar)`: adopts the lorebook inside the card according to the character's current binding.
      - `resolveLorebookAdoption(avatar, choice, token)`: submits `adopt` or `update`. When the decision is stale, it rejects with `LorebookAdoptionConflictError`.
      - Both methods return `TauriTavernCharacterLorebookAdoption` (`src/types.d.ts`) and reject on failure. For the rules, see [character lorebook](CurrentState/CharacterIdentityContract.md#10-character-lorebook).
  - `api.extension.store`: extension-level **global persistence** (not bound to a chat) that provides KV JSON plus Blob, with multiple tables and streaming Blob reads.
    - Signatures, read/write boundaries, and examples: [Extension Store API](API/Extension.md).
  - `api.db`: the local vector, JSON, text index, graph, and TQL database. `open` waits for availability asynchronously; `NodeId` is an integer; signatures, index-recovery boundaries, and shared-close semantics: [Database API](API/Database.md).
  - `api.dev`: the normalized TauriTavern development and debugging API. The built-in Settings development panel and third-party extensions should both consume this layer rather than depending directly on Tauri event names or Rust command names.
    - `api.dev.frontendLogs`
      - `list(options?: { limit?: number }) -> Promise<FrontendLogEntry[]>`
      - `subscribe(handler) -> Promise<unsubscribe>`
      - `getConsoleCaptureEnabled() -> Promise<boolean>`
      - `setConsoleCaptureEnabled(enabled: boolean) -> Promise<void>`
      - Semantics: the host keeps the runtime switch, the persisted setting, and the local bootstrap flag in sync; callers must not read or write `localStorage` themselves.
    - `api.dev.backendLogs`
      - `tail(options?: { limit?: number }) -> Promise<BackendLogEntry[]>`
      - `subscribe(handler) -> Promise<unsubscribe>`
      - Semantics: the host owns the shared backend log stream; with several subscribers it manages enabling and disabling the stream by reference count, so they never interfere with each other.
    - `api.dev.llmApiLogs`
      - `index(options?: { limit?: number }) -> Promise<LlmApiLogIndexEntry[]>`
      - `getPreview(id: number) -> Promise<LlmApiLogPreview>`
      - `getRaw(id: number) -> Promise<LlmApiLogRaw>`
      - `subscribeIndex(handler) -> Promise<unsubscribe>`
      - `getKeep() -> Promise<number>`
      - `setKeep(value: number) -> Promise<void>`
      - Semantics: the host owns the history index, the live index stream, and persistence of the keep setting; callers must not work with the `devlog_*` commands directly.
    - `api.dev.exportBundle() -> Promise<boolean>`: generates and delivers the debug bundle (zip) and returns whether it was delivered; see `docs/API/Dev.md`.

Long-term contract requirements for `api.dev.*`:

- DTO fields stay camelCase, and new fields may only be backward-compatible additions.
- The `unsubscribe` returned by `subscribe()` / `subscribeIndex()` must be idempotent and safe to call late.
- The Tauri event names `tauritavern-backend-log` / `tauritavern-llm-api-log` and the `devlog_*` command names are Internal implementation details, not a third-party Public Contract.

- `api.worldInfo`: the normalized TauriTavern World Info / Lorebook activation and navigation API.
  - `getLastActivation() -> Promise<WorldInfoActivationBatch | null>`
    - Returns the final activation result of the most recent real generation run.
    - `null` means only that this session has not captured any final activation result yet.
  - `subscribeActivations(handler) -> Promise<unsubscribe>`
    - Pushes final activation results only and does not expose the intermediate loop state of `WORLDINFO_SCAN_DONE`.
    - Does not replay past results; if you need the most recent one, call `getLastActivation()` first.
  - `openEntry(ref: { world: string; uid: string | number }) -> Promise<{ opened: boolean }>`
    - A best-effort navigation entry point.
    - `opened: true` means the host successfully opened the target world and tried to locate the target entry.
    - `opened: false` means the target world or entry does not exist; any other failure is thrown so it can be debugged.

v1 contraction boundaries for `api.worldInfo`:

- Expose only the "final activation batch", never the raw `WORLD_INFO_ACTIVATED` / `WORLDINFO_SCAN_DONE` payloads.
- An activated-entry DTO promises only `world`, `uid`, `displayName`, `constant`, and an optional `position`.
- Scan loop control, internal budget state, and mutable intermediate objects are never promoted to Public Contract.
- `openEntry()` must reuse the navigation the upstream World Info module already provides; the host ABI layer must not depend on DOM details such as `#WorldInfo`, `#world_editor_select`, or `[uid="..."]`.

- `api.agent`: run control, history, workspace details, and Profile management, see [Agent API](API/Agent.md).
  - Chat and Session accept one unified Agent snapshot; Run events and live projection are independent of SillyTavern generation events.
  - Chat uses a stable chat identity, and the host commit bridge reuses the chat save flow; generation state is released after a successful save or an explicit failure. A continuation keeps the Run identity, while a fork creates a new chat identity and copies the persisted version.
  - A Session is independent of the current character chat and writing generation state and dispatches no SillyTavern chat or generation events; the backend manages directories, shared configuration, and continuous history, and the prompt and macro environment are covered in [Prompt assembly](Agent/PromptAssembly.md). Agent Mode controls only whether Chat routes through Agent or Legacy.
  - Extensions register, toggle, and query tools through `tools.register/setEnabled/list`, filtered by Chat or Session and sharing the Agent tool execution path; usage: [registering extension tools](API/Agent.md#registering-extension-tools).
  - Run control is a Public Contract; model turns, task details, the tool catalog, and Timeline relationships are Project Contracts, and the corresponding APIs provide their display DTOs.
  - In session history, `compaction`, the `compacting_context` run state, the `context_compaction_started` / `context_compacted` events, the `context` of `model_request_created`, `sessions.compact()`, and `contextLimits: { context, response, tokenizerModel }` in the Agent snapshot are all Project Contracts; field and event shapes are in the [Agent API](API/Agent.md).

- `api.llmConnections`: manages the model connections a Profile references, see [LLM Connection API](API/LlmConnections.md). A Profile binds through a connection ID and a model ID; the Model Target is where the interface takes its configuration from.

- `api.skill`: manages import, editing, scope, and export of local knowledge packages, see [Skill API](API/Skill.md). The model reads material through the read-only `skills/` workspace view and runs scripts through `workspace.shell`; the management interface handles installation and replacement.

- `api.mcp`: a separate platform API for MCP registration, read-only tool discovery, model-facing description overrides, and the first-party Manager's user test call. Agent and Legacy generation already consume MCP through an internal application seam, but MCP does not depend on Agent Mode, and the public API still provides no raw model-call executor.
  - It is an experimental Project Contract today; full signatures are in `docs/API/MCP.md`.
  - It currently exposes `servers.list/create/update/setState/remove/discover/refresh`, `tools.setPermission`, `tools.setDescriptionOverride`, and `tools.testCall({ registrationId, nativeName, argumentsJson }, { signal? })`; a description override changes only the model's descriptor copy and never the discovery catalog, permissions, or execution identity; `update` can change the name, endpoint, custom headers, and protocol version; `discover` reads the application's persistent catalog, and `refresh` is the only entry point that forces a network call; no raw RPC or RMCP session is exposed.
  - `testCall` is the first-party Manager's Project Contract: an explicit user call against an Active registration is not blocked by Off/Ask/Allow and does not change permission; the typed outcome distinguishes `known_response`, `not_sent`, and `outcome_unknown`, and the AbortSignal stops only the local wait and promises no remote rollback.
  - Vendor and extension scripts inside the same WebView are still treated as user-authorized code under the platform's current trust model; this ABI makes no claim to verify a physical click or to isolate a hostile extension.
  - A newly created server is always Paused, and tools default to Off. Discovery annotations confer no authority.
  - Agent and Legacy model exposure both read only the application's persistent snapshot and apply the registration description override in the shared resolver; the Agent Profile's `tools.toolDescriptions` then overrides the same field. Rust re-checks permission before sending, and Legacy MCP never enters the global SillyTavern ToolManager, slash commands, or extension enumeration.
  - The first-party MCP management UI is a separate built-in extension; it only consumes this API, never promotes React state to a platform fact, and keeps no second entry point in TauriTavern Settings.

> Note: `window.__TAURITAVERN__` is the platform ABI and must stay **small and stable**; do not expose whole internal implementation objects.

### 3.7 ChatSurface (Project Contract)

- `window.__TAURITAVERN__.api.chatSurface`
  - It is an experimental Project Contract today and has not been published as a stable Public Contract.
  - It exposes `protocolVersion: 1`, `isManagedOwnershipRequired()`, `registerParticipant()`, and a separate `registerContentProcessor()`; the ownership query returns the boolean decision already frozen for this page, and the projection controller, DOM adapter, internal revision, admission budget, and virtual scrolling engine are not exposed at all.
  - A content processor registers before the first projection and returns display HTML asynchronously; the host stores the result for remount reuse, and `registration.refresh()` refreshes it explicitly. The synchronous participant v1 contract is unchanged.
  - A participant must declare its protocol version explicitly; hooks return a synchronous disposer, and the host expresses the three real lifetimes — mount, content, and runtime — with an `AbortSignal`.
  - Mount, remount, and content lifecycle must never be disguised as SillyTavern message business events.
  - The full protocol and a raw API integration example are in `docs/API/ChatSurface.md`.

- `SillyTavern.getContext().scrollChatSurfaceTo(options: ScrollToOptions): void`
  - A function TT adds in upstream `src/scripts/st-context.js`; it belongs to the Project Contract and is currently used by the first-party assistant.
  - It has the same effect as calling `scrollTo(options)` on the main page's `#chat`. Native scrolling of `#chat` is written only by ChatSurface, so go through it instead of touching the DOM directly.

---

## 4. Request interception and route contracts (Public)

### 4.1 Interception scope (fact)

Installed by `src/tauri/main/interceptors.js`:

- patch `window.fetch`
- patch `jQuery.ajax` (keeping jqXHR/Deferred behavior compatible)

Conditions under which interception applies (see `src/tauri/main/bootstrap.js`):

- It is installed by the host startup chain; `bootstrapTauriMain()` only prevents a second installation.
- Only **same-origin** requests are intercepted (including patched same-origin iframes and windows).
- Whether a request is taken is decided by `router.canHandle(method, pathname)` (which looks at `url.pathname` only).

### 4.2 Unmatched behavior (Public)

- The host takes over the whole `/api/*` namespace: an unimplemented endpoint (any method) and a handler that returns no response both return `404` JSON (`{ error: "Unsupported endpoint: <path>" }`, with the same text as `statusText`). Development and production behave the same.
- Other requests that match no route: `fetch` passes through to native fetch, and `ajax` passes through to the original `$.ajax`.

> Upstream and third parties rely on this behavior: do not turn it into a silent failure or an empty response. The production asset protocol falls back to `200 index.html` for a missing path, so `/api/*` must never pass through.

### 4.3 Route table (Public)

The routes live in `src/tauri/main/routes/*`; the public contract covers upstream compatibility and the interfaces the ecosystem actually depends on.

The `/api/characters/import` response has one extra `lorebook` field compared with upstream, with the same shape as `api.characterCards`. When the character has already been written but lorebook adoption failed, `lorebook.status` is `failed` and the backend reports the error.

`/api/characters/delete` deletes only the character and the chats the request names; it does not delete the lorebook. For how the interface cleans up a lorebook when a card is deleted, see [character lorebook](CurrentState/CharacterIdentityContract.md#10-character-lorebook).

First-party chat reads and writes go straight to the internal transport and produce no compatibility-route Fetch request; observe them through the existing business events. `/api/chats/get`, `/api/chats/group/get`, `/api/chats/save`, and `/api/chats/group/save` remain available to extensions. A successful save is `200 { ok: true }`; an integrity conflict is recognized by error code and returns `400 { error: 'integrity' }`.

Chat get/save follows [ChatPayload §1.1](CurrentState/ChatPayload.md#11-unified-format-baseline). The compatibility get returns a streaming array that preserves each record's original JSON text (header and every swipe included), and an empty array when there is no record. A body error makes `.json()`, `.text()`, or the jQuery request fail even when the HTTP status is 200; cancelling the request or the body read stops further reads.

`saveMetadata()` / `getContext().saveMetadata()` replaces `chat_metadata` only, leaving the message body at its original bytes; a message modification must call the full save. Scheduling, initialization, and error handling are in [ChatPayload §3.1](CurrentState/ChatPayload.md#31-metadata-save).

With [on-demand loading while scrolling history](CurrentState/ChatPayload.md#21-on-demand-loading-while-scrolling-history) enabled, history candidate slots in `getContext().chat` may be `null`; the compatibility get, exports, and saved files stay complete.

World Info get/edit reads and writes the disk directly, keeps unknown fields and key order, and merges no edit cache; get returns empty `entries` for a missing file. `WORLDINFO_UPDATED` is dispatched only after a successful save, and a failed read or save blocks generation that depends on that world.

The most critical startup dependencies:

- `/csrf-token`: returns a fixed token (to satisfy the upstream initialization assumption about CSRF)
- `/version`: returns version information

High-frequency and high-risk paths (examples, not a complete list):

- `/api/*`: the application's core API (settings/chats/characters/ai/worldinfo…)
  - User settings keep the upstream settings data shape; refreshing a list writes no profile data, and one failed item save does not affect other changes.
  - `/api/settings/save` takes the settings JSON: the Persona registry is submitted incrementally by ID, so a mentioned ID replaces that whole record and an unmentioned one is not deleted; every other setting is a complete snapshot. Reads and save confirmations return `tauritavern_settings_revision`; callers treat it as an opaque token and send it back JSON-encoded through `X-TauriTavern-Settings-Revision`. A stale token returns 409, and a request without one can still overwrite. Persona changes are confirmed independently.
  - `/api/settings/get` keeps the upstream response shape, with `settings` still a JSON string; the startup read and apply order is in [StartupOptimization §4](CurrentState/StartupOptimization.md#4-settings-and-bootstrap-metadata-reads).
- The streaming response of `/api/backends/chat-completions/generate` is held by an in-process Rust session that owns the generation task, the mobile best-effort background execution lease, and unacknowledged events; the frontend consumes and acknowledges through a monotonically increasing `after_seq` and, after a WebView pause, can replay missing events within the same Rust process. A single read failure retries once with the same cursor, and only a second failure closes the session. A background lease that fails or expires has no power to terminate generation; this guarantee does not survive a process restart and does not pretend to be an upstream provider's HTTP resumption.
- `/css/user.css`: the user CSS override file (data directory `_css/user.css`)
- `/scripts/extensions/third-party/*`: the third-party extension static resource endpoint (ESM/CSS/`url()`/fonts/images)
- `/thumbnail`: the thumbnail endpoint (tightly coupled with `__TAURITAVERN_THUMBNAIL__`)
- The user static resource endpoints (wildcard routes):
  - `/characters/*`, `/User Avatars/*`
  - `/backgrounds/*`, `/assets/*`
  - `/user/images/*`, `/user/files/*`

`/api/users/backup` differs from upstream: the host generates and delivers the backup and returns `{ ok, delivered, includes_secrets }`.

### 4.4 Browser resource contract (Public)

These paths must load as **native browser subresources** (`<img src>`, `<link href>`, `<script src>`, CSS `url()`), with the same semantics in development and production:

- `/scripts/extensions/third-party/*`
  - `.git` is an ordinary path component needed for SillyTavern migration compatibility; an explicit file request must not be rejected just because one component is named `.git`. `.`, `..`, encoded path separators, and path escapes must still be rejected.
- `/css/user.css`
- `/scripts/tauritavern/layout-kit.js` (ESM; an auxiliary entry point for `api.layout`, see [API/Layout.md](API/Layout.md))
- `/thumbnail?type={bg|avatar|persona}&file=...`
- `/characters/*`, `/User Avatars/*`
- `/backgrounds/*`, `/assets/*`
- `/user/images/*`, `/user/files/*`

The third-party extension management API keeps the upstream install/update/version/branches/switch DTOs and hook/event semantics, and its remote transport is Rust gitoxide smart HTTP. A mutating update does not take a frontend timeout or AbortSignal, because once a Tauri invoke has entered Rust it cannot cancel disk writes. The UI AbortSignal of version can still be used to close read-only check results. branches projects remote heads only (an empty label, no object fetch); a successful switch returns `204`, the current branch is a no-op, and it must not implicitly trigger the update hook.

The minimum observable semantics for these endpoints:

- only `GET` / `HEAD` / `OPTIONS` are accepted
- a miss returns a real `404` (no fallback to `index.html`)
- `Content-Type` is correct; a successful response uses `Cache-Control: private, no-cache`, a weak ETag, and Last-Modified where applicable, while errors, OPTIONS, and 416 use `no-store` (the complete conditional request and platform delivery semantics are in `docs/CurrentState/HostResourceCaching.md`)
- media files (`video/*` / `audio/*`) must support `Range` (single range) and return `206 + Content-Range` (see `docs/CurrentState/MediaAssetContract.md`)

Background preview and background consumption are two different representations:

- a system static-image preview uses the ordinary `/thumbnail`;
- GIF, WebP, and APNG use raw `/backgrounds/*` when animated preview is on, and the first-frame JPEG from `/thumbnail?...&static=true` when it is off;
- the MP4 picker uses a placeholder image and brings in no video decoder for a poster;
- the active background and `<video>` always keep raw `/backgrounds/*`, and `static=true` must never enter the playback path.

Prohibitions (to keep the contract stable):

- Do not "simulate" the loading behavior of these endpoints with a DOM prototype-level monkey patch (for example by rewriting `HTMLImageElement.src`); fill in real endpoints instead.

### 4.5 Request tracing (Project, recommended as a common debugging tool)

Every response from a host-taken route carries a tracing header:

- `x-tauritavern-trace-id: <traceId>`

Use: correlate a single request in DevTools Network with console logs and perf HUD data to locate exceptions and performance hot spots caused by third-party scripts.
The header name is also available from `window.__TAURITAVERN__?.traceHeader` (so it does not have to be hardcoded).

A first-party chat transport goes straight to the backend and produces no compatibility route Response, so it has no such response header; when an extension requests a compatibility route itself, it is traced by the rules above.

---

## 5. Compatibility patches and observability (Public/Project)

### 5.1 Perf HUD (Project, as an acceptance tool)

`window.__TAURITAVERN_PERF__` is the performance observability entry point; enabling it and exporting reports are covered in [FrontendGuide §10.1](FrontendGuide.md#101-lightweight-performance-hud).

### 5.2 Mobile runtime compatibility (removed)

This branch builds the Windows x64 desktop app only. The mobile runtime polyfills (`__TAURITAVERN_MOBILE_RUNTIME_COMPAT__`, `__TAURITAVERN_MOBILE_WINDOW_OPEN_COMPAT__`), the mobile layout variables (`--doc-height`, `--tt-inset-*`, `--tt-window-*`), and the safe-area contract have all been removed and are no longer provided.

---

### 5.3 Dialog compatibility (Public in practice)

> Purpose: keep the browser built-in popup semantics that the script ecosystem depends on, so a script continues only after the user makes a choice.

- On Windows, `window.alert/confirm/prompt` are implemented natively by WebView2 and keep their synchronous semantics. The host installs no JS replacement: the dialog plugin is registered without the script that replaces `alert/confirm`, so it does not grant `dialog:allow-message` either.
- If the runtime lacks `HTMLDialogElement.prototype.showModal`, the host installs `dialog-polyfill` and covers the main window plus same-origin iframes and windows (enabled only when it is missing).

### 5.4 Opening external links and `window.open()` (Public in practice)

Desktop (Windows):

- `window.open(url, name, features)`:
  - If `features` specifies a `size` or `position` (a typical OAuth popup), the host creates a new WebView window inside the app, keeping `window.opener` and `postMessage` callback semantics available.
  - Every other external link (`http/https/mailto/tel`) opens in the system browser by default (so documents and upgrade links do not open inside the app).

Engineering convention (Project):

- Explicit external links are opened through `openExternalUrl()` in `src/tauri-bridge.js`; the `tauritavern-version` extension and the auto-update dialog are examples.

### 5.5 Windows full-screen shortcut (Project)

- The main window toggles native window full screen with unmodified `F11`; holding the key responds only to the first `keydown`.
- The host captures the shortcut in the main document and its same-origin iframes; standalone popups and `F11` with a modifier are not part of this contract.
- The native window state is the only truth; full screen is not written to SillyTavern settings and is not included in window geometry persistence. A failed toggle is logged as an error, and later key presses can still retry.

### 5.6 Windows file drag and drop (Public in practice)

- The main window disables Tauri's native drag-and-drop handling when it is created and leaves file drops to the WebView's HTML5 `DataTransfer` and `drop`.
- The frontend handler at the actual drop target runs character card import, chat import, or attachment and gallery upload; no native file read or second import path is added.
- This entry point no longer produces Tauri's native `tauri://drag-*` events; extensions should use DOM drag-and-drop events.
- File format validation, import notices, and persistence remain with the existing frontend and backend import flows; ordinary file picker entry points are unchanged.
- The drag-and-drop policy of standalone popup WebViews is unchanged; HTML popups inside the main page are still handled by their own DOM drag-and-drop handlers.

## 6. Smoke tests (Public regression cases)

These cases are the "smallest but real" compatibility regression set (source: the `.cache` samples that were provided):

1. **JS-Slash-Runner**
   - It loads, its UI opens, and at least one command runs.
2. **database_script**
   - It injects and runs (at minimum it does not crash), and its UI and entry point open.
3. **V1.72 (heavy character card)**
   - The iframe loads and is not broken by same-origin patches or interception.
4. **Browser resource contract (endpoint level)**
   - `/thumbnail?type=bg|avatar|persona&file=...` returns image bytes (no `blob:` magic trick); a missing file returns a real `404`
   - `/thumbnail?type=bg&file=<animated>&static=true` returns a JPEG for a decodable animation; Range playback of a raw `/backgrounds/*` MP4 is unaffected
   - `/css/user.css` returns the user CSS from the data directory `_css/user.css`; a missing file returns a real `404`
   - `/characters/*`, `/User Avatars/*`, `/backgrounds/*`, `/assets/*`, `/user/images/*`, and `/user/files/*` load directly as subresources
   - ESM, CSS, images, and fonts under `/scripts/extensions/third-party/*` all load, and a miss returns `404`; for a secret-free fixture, `.git/HEAD` and `.git/config` use the same file-level path semantics
   - Media Range contract: `Range: bytes=0-1` on `/backgrounds/<file>.mp4` returns `206` and includes `Content-Range`
   - A cross-origin image without CORS can still be saved; when the address has no extension, the response type supplies one.
   - Images and `a[download]` in a same-origin iframe (including srcdoc) can both be saved.
   - When the page calls `preventDefault()` for the `contextmenu` event, no confirmation dialog appears.

Any change that touches the contracts in sections 3 and 4 must at least pass the smoke tests above.

---

## 7. Engineering constraints (Project, maintainers)

> These constraints are not a third-party "external API", but they are a long-term hard gate: they keep the host layer from sliding back into a monolith with implicit coupling.

- Guardrails: `pnpm run check:frontend` (`scripts/check-frontend-guardrails.mjs`)
  - Line budget: key aggregation files are held to `scripts/guardrails/frontend-lines-baseline.json`.
  - Dependency boundaries: `kernel/ports` must not import `services/routes/adapters`; `services` must not import `routes`.
  - Route contract: `src/tauri/main/routes/*` must not reference `window` directly (touch the browser, the DOM, or upstream ST through `adapters/*`).
- Type checking: `pnpm run check:types` (`tsc -p tsconfig.host.json`)
- Invoke surface: the command names the host layer knows are collected in `src/tauri/main/kernel/invokes/tauri-commands.js` (to reduce string drift and typos)
