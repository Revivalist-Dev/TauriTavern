# Third-party frontend extension compatibility: current status

This document describes the third-party frontend extension compatibility **as it is already
implemented**, to guide ongoing development.

The following browser resource contracts have also landed:

- Avatars: `/thumbnail`, `/characters/*`, and `/User Avatars/*`, with the thumbnail DOM monkey patch
  removed
- User static assets: `/backgrounds/*`, `/assets/*`, `/user/images/*`, and `/user/files/*`

## 1. Scope and conclusions

The compatibility target is a SillyTavern-style **pure-frontend third-party extension**, meaning one
that depends on:

- the same-origin static resource prefix `/scripts/extensions/third-party/<ext>/<path>`
- native browser subresource loading semantics

The core conclusion of the current approach is:

> The key to compatibility is not interpreting extension code inside the frontend runtime, but making
> the third-party resource path a real endpoint the WebView can load natively.

## 2. The current path

### 2.1 Discovery and activation

1. `startOfflineExtensionsDiscovery()` in `src/scripts/extensions.js` requests
   `/api/extensions/discover` after Host Ready
2. `src/tauri/main/routes/extensions-routes.js` hands the request to the Rust command `get_extensions`
3. `ExtensionService -> tt-adapter-extension::FileExtensionRepository::discover_extensions()`
4. Once the extension list comes back, the frontend continues reading manifests and caches the
   activation plan
5. During startup it runs `activateStartupSystemExtensions()` first, activating system extensions only
6. If any enabled local/global third-party extensions exist, it runs
   `activateDeferredThirdPartyExtensions()` after `APP_READY`

Additional constraints:

- discovery returns only the extension name and type and skips third-party directories without a
  `manifest.json`; Git and source information is read on demand by version queries and management
  operations.
- The frontend reads the raw `manifest.json` and publishes to the available-extension list only the
  JSON objects that loaded successfully; a failure is reported and isolated without blocking other
  extensions. Every entry point consumes that same list, and enabling and activation still go through
  the existing mechanism.
- The install/update/switch candidate preflight still requires a root `manifest.json` that exists, is
  a regular file, and holds a JSON object; `display_name`, `version`, and `author` are extracted only
  as display metadata for the install result, so a missing or non-string value does not affect
  candidate validity.

Extension naming conventions:

- System extensions: `regex`, `quick-reply`, and so on
- Third-party extensions: always named `third-party/<folder>`

Current startup ordering constraints:

- third-party extension discovery may run early, but evaluating local/global third-party modules no
  longer blocks `APP_READY`
- After `APP_READY` is emitted, late-loaded third-party extensions can still rely on the auto-fire
  semantics of `eventSource` for `APP_READY` to complete their ready hooks
- When third-party extensions are waiting for activation, `EXTENSION_SETTINGS_LOADED` is deferred
  until the deferred activation finishes

### 2.2 Installation, versions, branches, and updates

Third-party extension management now uses a Rust-native gitoxide vertical slice:

- A new install accepts only an anonymous `http(s)` Git remote; GitHub, GitLab, and Gitee are all
  allowed, but provider web tree URLs, query and fragment components, URL userinfo, SSH, and
  credential helpers are not.
- With no ref specified, the remote's born symbolic `HEAD` is used; an explicit ref resolves branch
  first and tag second. Arbitrary revision expressions and OIDs are outside the current input
  contract.
- A new install produces a standard non-bare embedded `.git/` directly and no longer writes
  `_tauritavern/extension-sources` JSON. A branch uses a symbolic HEAD plus upstream; a tag uses a
  detached peeled HEAD plus an exact tag refspec.
- version reads only the Git ref advertisement and compares the peeled remote OID with the deployed
  HEAD; it does not fetch, write locally, or call a provider REST API.
- branches returns, through `ls-refs refs/heads/` only, sorted unique remote branch short names with a
  7-character OID, the current flag, and an empty label; it does not unshallow, download branch
  objects, or modify local state.
- switch accepts remote branches only (`main` and `origin/main` are both understood) and runs an exact
  depth-1 fetch, the candidate preflight, and a managed worktree rebuild, finishing by committing the
  standard symbolic HEAD and upstream; switching to the current branch is a no-op with no network
  access, and when a different branch points at the currently deployed OID only refs and config
  change, with no update hook implied.
- update performs one exact depth-1 fetch on an embedded repo; when the OID matches it leaves the
  payload untouched, and when it differs it validates the complete candidate tree first, then rebuilds
  the payload and index, and finally advances the branch ref or detached HEAD.
- For a legacy JSON extension, version and branches only read the Git advertisement; the central
  source JSON takes precedence, with the early in-extension root inline V1/V2 JSON as a read-only
  fallback, and nothing is migrated at startup or read time. On the first update (even with an
  identical OID), or on a switch to a different branch, it creates a standard embedded repo in a
  sibling `.tmp-*` directory and, once validation completes, replaces the active snapshot and either
  deletes the JSON or lets it fall away naturally. A failure keeps the old snapshot and source state.
- The provider REST, archive ZIP, and host allowlist backends are gone; every Git error fails fast, and
  there is no REST or ZIP runtime fallback.

The candidate preflight validates the complete tree before the active payload is deleted: portable
UTF-8 paths, case and NFC collisions, file/directory shape, ODB object header kind, and the JSON object
structure of the root `manifest.json`. Checkout runs no external filter, LFS, or submodule; a symlink
is materialized as a regular file, and a gitlink produces only an empty directory placeholder.

install/update/switch/delete/move share one application-layer fail-fast permit with LAN/TT Sync local
writes, and busy maps to 409. discovery, version, and branches are read-only and do not take the
permit. The update frontend no longer uses `AbortSignal` to pretend-cancel a disk write that has
already entered Rust.

### 2.3 Frontend resource loading

Resource URLs are generated in one place by `src/scripts/extensions/runtime/resource-paths.js`:

- `getExtensionResourceUrl(name, path)`
- for a third-party extension the final URL is `/scripts/extensions/third-party/<folder>/<path>`

At activation:

- the JS entry is injected by `asset-loader.js` directly as `<script type="module" src="...">`
- CSS loads as a plain `<link rel="stylesheet" href="...">` by default
- only when an old WebView does not support the CSS `@layer` rule does `third-party-runtime.js` append
  `ttCompat=layer` to the stylesheet URL, with the Rust endpoint returning flattened CSS bytes
- the `js` and `css` fields explicitly accept a `string` or a single-element `string[]`; multi-element
  arrays get no new load-order semantics

Additional compatibility layers:

- `src/lib.js` hangs some of the libraries upstream uses on `window`; `window._` (lodash) is a formal
  compatibility ABI, because ecosystem extensions such as JS-Slash-Runner, ST-Prompt-Template, and
  MagVarUpdate access `_` directly during module evaluation

### 2.4 Backend resource serving

Production and packaged runtime:

- `src-tauri/crates/tauritavern/src/lib.rs` installs `on_web_resource_request` on the main window
- `src-tauri/crates/tt-application/src/services/host_resource_service/user_css.rs` handles
  `/css/user.css`
- `src-tauri/crates/tt-application/src/services/host_resource_service/third_party.rs` handles
  `/scripts/extensions/third-party/*`
- `src-tauri/crates/tt-application/src/services/host_resource_service/thumbnail.rs` handles
  `/thumbnail`
- `src-tauri/crates/tt-application/src/services/host_resource_service/user_data.rs` handles the user
  data static resources: `/characters/*`, `/User Avatars/*`, `/backgrounds/*`, `/assets/*`,
  `/user/images/*`, `/user/files/*`

Request handling steps:

1. Validates the request method and accepts only `GET`, `HEAD`, and `OPTIONS`
2. Parses and validates the path through
   `src-tauri/crates/tt-contracts/src/client_asset_paths.rs`, then routes it to a specific resource
   handler through
   `src-tauri/crates/tt-application/src/services/host_resource_service/route_classifier.rs`
3. Uses `src-tauri/crates/tt-adapter-media/src/host_resources.rs` to select the local or global
   source, open the file, and build the metadata and revision in one step
   - third-party resources do not support Range and are read into memory whole; on a mobile host a
     source file over 32 MiB returns `413` (`GET`, `HEAD`, and conditional requests alike)
4. Returns the real bytes, the correct `Content-Type`, `Cache-Control: private, no-cache`, a weak ETag,
   and Last-Modified; on a conditional hit it returns 304 or a full 200 according to the transport
   capability (see `docs/CurrentState/HostResourceCaching.md`)
   - for a user static asset endpoint (such as `/backgrounds/*`), a request carrying `Range` supports
     a single range and returns `206 + Content-Range` (see `docs/CurrentState/MediaAssetContract.md`)
5. Returns a genuine `404` on a miss and never falls back to `index.html`

Host Resource validates only the path segments of the browser URL and does not forbid a symlink inside
the data root from pointing at an external directory or file. That lets a user share one data
directory layout between SillyTavern and TauriTavern.

`.git` is a deliberately allowed path component and is not a name-level exclusion in Host Resource or
TT-Sync. An extension migrated from SillyTavern may carry a standard embedded `.git/`; an explicit
request for a file such as `/scripts/extensions/third-party/<folder>/.git/config` or `.git/HEAD` goes
through the same local-first, file-level read and cache path as any other extension file, and still
exposes no directory browsing. TT-Sync's `extensions.local` and `extensions.third_party` datasets
likewise do not exclude these paths by `.git` name. At the repository layer a managed extension's root
`.git` is a standard Git administrative directory; that does not change the path layer continuing to
reject `.`, `..`, encoded separators, control characters, and path escapes.

This compatibility semantics does not mean a remote URL may hold secrets. Third-party extensions are
already same-origin executable code; any embedded `.git/config` must persist only redacted URLs, and
if private repository authentication is supported in future it should use a device-local secret store.

Development-time local web entry point:

- `scripts/tauri-dev-server.mjs` injects `src/dev-sw-bootstrap.js` only into the main app entry, on the
  origin tagged with `devUrl`. The bootstrap script installs the resource bridge only for documents on
  that origin: mobile dev proxies the dev server through the Tauri app protocol, and these resources
  are served by the host web resource hook, exactly as in a packaged run. The production entry point
  registers no service worker
- The bootstrap script registers `/tt-ext-sw.js`, provides the window proxy, and publishes the
  [readiness signal](../FrontendHostContract.md#22-readiness-signals-publicproject). If a new WebView session
  inherits an old controller, it unregisters the old registration and reloads first, so a dead Wry
  protocol filter is not reused
- While the page is uncontrolled (a first install or a hard refresh), the bootstrap script listens for
  `controllerchange` first and then asks the active worker to run `clients.claim()`; the readiness
  signal is published only once the page is controlled
- The service worker forwards `/css/user.css`, `/scripts/extensions/third-party/*`, `/thumbnail`,
  `/characters/*`, `/User Avatars/*`, `/backgrounds/*`, `/assets/*`, `/user/images/*`, and
  `/user/files/*` to the `tt-ext` custom scheme
- On the Rust side, `register_uri_scheme_protocol("tt-ext", ...)` dispatches all of those resource
  requests under dev
- The result of `convertFileSrc('', 'tt-ext')` may appear as `tt-ext://localhost/` or
  `http(s)://tt-ext.localhost/` depending on the platform and WebView
- A direct `tt-ext` fetch from the service worker keeps the original request's cache mode; `Range`,
  `If-Range`, `If-None-Match`, and `If-Modified-Since` keep the same Host Resource semantics on the
  direct and IPC paths, and `Access-Control-Expose-Headers: *` preserves the complete representation
  headers of a direct response
- `If-Range`, `If-None-Match`, and `If-Modified-Since` trigger a cross-origin preflight on the custom
  scheme and must enter the IPC directly through the generic header wire; any other service worker
  `fetch(tt-ext)` falls back to a window-context `fetch(tt-ext)` on failure, with the body returned as
  a transferable `ArrayBuffer`. Ordinary binary resources must not travel through serde JSON IPC
- The window proxy calls `startMessages()` during document parsing and starts accepting requests right
  away: the `/css/user.css` in `<head>` may load through it while a module script waits for that
  stylesheet, so delivering only at DOMContentLoaded would leave both sides waiting on each other
- Production on a non-Android platform, `tt-ext`, and the IPC fallback can all proxy a 304; Android
  returns a full 200 under Wry's hard constraint. The IPC path builds no separate Cache API, so how an
  auto-generated validator is stored still depends on the specific transport

So although development and production enter through different points, the third-party path semantics
stay consistent.

## 3. Data directories and precedence

The current directory layout is:

- local third-party extensions: `data/default-user/extensions/<folder>`
- global third-party extensions: `data/extensions/third-party/<folder>`
- legacy extension source metadata: `data/_tauritavern/extension-sources/{local|global}/` is read
  first, with the older `<extension>/.tauritavern-source.json` as read-only input for compatibility (a
  new embedded install no longer writes it)

Current precedence rules:

- At discovery: when a local and a global share a name and the local one has a manifest, the local one
  wins; a leftover local directory without a manifest does not shadow the global one
- When reading a resource: local is checked first, then global

That means a local extension can override a global extension with the same name.

## 4. Compatibility boundaries currently supported

The goal is to restore the static resource contract that SillyTavern third-party extensions depend on.
The following therefore have to work with default browser semantics:

- `<script type="module" src="...">`
- `<link rel="stylesheet" href="...">`
- ESM relative imports
- `fetch('/scripts/extensions/third-party/...')`
- CSS `url(...)`
- iframe pages and their relative resources
- `/css/user.css` as the user CSS override file
- `/thumbnail`, `/characters/*`, and `/User Avatars/*` as native browser subresource endpoints for
  avatars
- `/backgrounds/*`, `/assets/*`, `/user/images/*`, and `/user/files/*` as native browser subresource
  endpoints for user static assets

Current security constraints:

- Rejects a missing extension directory, `.`, and `..`
- Rejects encoded path separators and other invalid paths
- A redundant `/` in a relative resource path is normalized as equivalent and does not widen the
  accessible scope
- Names such as `.git` and `.Git` are accepted as ordinary path segments; they are not the same thing
  as `.` and `..`
- Only file-level reads under the third-party prefix are allowed, and no directory browsing is offered

## 5. Explicitly unsupported or uncommitted today

- SillyTavern's Node-only backend plugins are not supported
- There is no general-purpose frontend pseudo-static server and no arbitrary file read capability
- No private auth, SSH, credential helper, Git hook, external filter, LFS, submodule execution, or
  recursive clone
- Non-local Git layouts such as a gitfile or linked worktree, an external common dir, or an external
  `core.worktree` are not supported; a management operation fails fast and requires a reinstall, and
  it neither repairs automatically nor reads a stale JSON fallback
- The branch UI offers no local-only branch, no tag, OID, or revision switch, no commit subject label,
  no unshallow, and no full history
- An extension with neither a root `.git/` nor legacy source JSON can still be discovered and loaded,
  but `update` requires a reinstall
- The third-party runtime no longer rewrites general JS source and should not be extended back into a
  do-everything interpreter

## 6. Constraints for ongoing development

Before changing third-party compatibility further, ask three questions:

1. Is the browser resource contract wrong, or does a platform runtime lack a capability?
2. Should this be fixed in the frontend load orchestration, or in the backend resource endpoint?
3. Would this fix push the system back towards a simulated frontend server?

Recommended maintenance principles:

- Keep `/scripts/extensions/third-party/*` as the single resource contract and do not change the path
  lightly
- Do not merge `/api/*` request interception and the third-party static resource endpoint back into
  one layer
- Make a new compatibility fix the smallest capability patch you can, and do not reintroduce broad
  source scanning or eager prefetching
- If you change the path rules, check at least the following in the same change:
  - `src/scripts/extensions/runtime/resource-paths.js`
  - `src-tauri/crates/tt-contracts/src/client_asset_paths.rs`
  - `src-tauri/crates/tt-application/src/services/host_resource_service/route_classifier.rs`
  - `src-tauri/crates/tt-application/src/services/host_resource_service/third_party.rs`
  - the relevant tests
- If you change the development proxy chain, verify `scripts/tauri-dev-server.mjs`,
  `src/dev-sw-bootstrap.js`, and `src/tt-ext-sw.js` in the same change as well

## 7. Suggested minimum regression surface

After every change, regress at least these capabilities:

- a third-party extension can be discovered and enabled
- `manifest.json`, JS, CSS, and image and font resources all load correctly
- an explicit `.git/HEAD`, or a `.git/config` from a secret-free fixture, follows the same path
  semantics as an ordinary file
- a resource that does not exist returns 404, not an HTML fallback
- when a local and a global share a name, local still wins
- the CSS `@layer` degradation on an old WebView shows no regression

When a problem falls outside these boundaries, first decide whether it belongs in third-party frontend
extension compatibility at all, and only then whether to handle it on this path.
