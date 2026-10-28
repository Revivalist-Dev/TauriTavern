# TauriTavern tech stack

This document describes the main technologies, architectural constraints, and engineering guards TauriTavern uses today. It is not an exhaustive dependency list; exact versions come from `package.json`, `src-tauri/Cargo.toml`, and each crate's `Cargo.toml`.

## 1. Project positioning

TauriTavern ports the SillyTavern frontend into a Tauri v2 native app, currently synced to 1.19.0, and replaces the upstream Node/Express backend with a Rust backend.

Core trade-offs:

- Keep the upstream frontend experience, data formats, asset paths, and behavior that extensions can observe.
- Split the backend into Rust workspace crates, with Clean Architecture as the highest-level architectural constraint.
- Have the frontend intercept `fetch` and `jQuery.ajax` through a Tauri injection layer, turning upstream same-origin requests into local Rust capabilities.
- Expose new TauriTavern capabilities in `window.__TAURITAVERN__.api.*` first, without polluting the upstream `/api/*` compatibility layer.

## 2. Base runtime stack

| Technology | Current use |
| --- | --- |
| Tauri v2 | Native app shell, WebView, plugins, cross-platform packaging, mobile entry points |
| Rust stable / edition 2024 | Rust backend, workspace crates, native integration |
| Cargo workspace | Backend crate boundaries, dependency direction, focused tests |
| Node.js `>=22.13.0` | Frontend toolchain and guard scripts |
| pnpm | JavaScript package management and project scripts |
| Rspack | Building the frontend vendor, Agent, Settings, and first-party React extensions |
| TypeScript | Strict type checking for the Tauri Host Kernel and first-party React UI |

## 3. Backend architecture

The backend is built around Clean Architecture: code closer to domain semantics sits further in, code that depends on frameworks, the file system, the network, or platform APIs sits further out, and source dependencies may only point from the outer layers to the inner ones.

Main crates today:

| crate | Responsibility |
| --- | --- |
| `tauritavern` | Tauri host, commands, composition root, host-bound infrastructure, platform glue |
| `tt-domain` | Domain models, value objects, domain errors, pure rules |
| `tt-contracts` | Cross-crate DTOs, events, payloads, host resource contracts |
| `tt-ports` | Repository / gateway / runtime traits |
| `tt-application` | Use cases, services, job coordinator, policy orchestration |
| `tt-adapter-http` | Shared HTTP client pool/profile/helpers |
| `tt-adapter-mcp` | RMCP Streamable HTTP discovery, protocol version policy, pagination and schema validation |
| `tt-adapter-provider-http` | HTTP repositories for LLM, SD, Translate, and provider metadata |
| `tt-adapter-tokenization` | Tokenizer concrete repository |
| `tt-adapter-storage-core` | `DataDirectory`, base file system helpers, and base storage for chat/settings/user/theme/secret |
| `tt-adapter-storage-userdata` | Character, world info, agent workspace/profile, skill local package store, PNG card metadata |
| `tt-adapter-media` | Avatar/background/user media/image metadata, browser-visible host resource file store |
| `tt-adapter-extension` | Third-party extension discovery, installation, version checks, updates, branch queries/switching, deletion and moving; Gitoxide smart HTTP and the embedded worktree |
| `tt-adapter-sync` | LAN Sync, TT-Sync v2 runtime, client/server, sync jobs |
| `tt-adapter-archive` | Data archive import/export executor, archive path safety |

`docs/BackendStructure.md` is the authority on the detailed boundaries.

## 4. Rust dependency groups

| Dependency | Main use |
| --- | --- |
| `tauri` / Tauri plugins | Host shell, and platform capabilities such as files/notifications/opener/dialogs/window state/barcode scanner |
| `serde` / `serde_json` / `serde_yaml` | DTOs, configuration, SillyTavern-compatible data formats |
| `tokio` / `tokio-util` | Async tasks, file IO, cancellation, and runtime capabilities |
| `reqwest` / `tokio-tungstenite` / `jsonwebtoken` | Provider HTTP/stream/WebSocket, Service Account JWT signing |
| `rmcp` / `jsonschema` | MCP lifecycle/protocol and offline JSON Schema 2020-12 validation |
| `gix` / `gix-transport` | Third-party extension Git smart HTTP, embedded repository/worktree |
| `tracing` / `tracing-subscriber` / `tracing-appender` | Backend logging, filtering, rolling files, Dev observability |
| `thiserror` | Layered error types |
| `async-trait` | Repository / gateway async traits |
| `miktik` | Tokenizer counting and encoding/decoding |
| `image` / `mime_guess` | Character cards, media, image metadata |
| `zip` / `tar` / `flate2` / `async-compression` | Skills, archives, Dev bundles, compressed data handling |
| `axum` / `axum-server` / `ttsync-*` | LAN Sync / TT-Sync v2 |
| `uuid` / `chrono` / `rand` | Identifiers, time, random values |

The primary store is not SQLite today. User data mostly uses the SillyTavern-compatible file layout, and the necessary TauriTavern private state lives under `_tauritavern`.

## 5. Frontend stack

The frontend body comes from SillyTavern, keeping its HTML/CSS/JavaScript organization and upstream dependency ecosystem.

Common technologies:

| Technology | Use |
| --- | --- |
| jQuery / jQuery UI | DOM, events, legacy UI behavior |
| Bootstrap | UI components and responsive layout |
| Handlebars | Template rendering |
| Showdown | Markdown rendering |
| DOMPurify | HTML sanitization |
| Highlight.js | Code highlighting |
| localForage | Browser-side storage |
| React / React DOM | The unified presentation layer for TauriTavern first-party stateful UI |
| strict TypeScript / TSX | React presentation, typed actions, and component tests |

The first-party React UI uses client islands: SillyTavern still owns the document and the extension lifecycle, Tauri/Rust and the Host ABI still own platform capabilities and data facts, and React mounts only into its own extension container.

The frontend integration layer TauriTavern maintains itself lives in `src/tauri/main/*`, split by `context/kernel/services/adapters/routes`:

- `context` exposes the stable Host Kernel facade and its types.
- `kernel` holds pure logic, such as policies, tracking, key generation, and formatting.
- `services` holds stateful capabilities.
- `adapters` touch `window`, the DOM, or upstream SillyTavern objects.
- `routes` handle the same-origin requests the host has taken over.

## 6. Frontend-backend communication

The main path for compatibility traffic:

```text
SillyTavern frontend / extension / script
  -> same-origin fetch / jQuery.ajax
  -> src/tauri/main/interceptors.js
  -> src/tauri/main/routes/*
  -> context.safeInvoke(...)
  -> tauritavern presentation command
  -> tt-application service
  -> tt-ports trait
  -> tt-adapter-* concrete implementation
```

Maintenance principles:

- `/api/*` carries upstream SillyTavern-compatible behavior only.
- New TauriTavern capabilities go through `window.__TAURITAVERN__.api.*` first.
- Rust command names are internal implementation details, not a stable API for extension authors.
- Browser subresources use real URL/Response semantics; do not disguise resource loading with IPC/base64.

## 7. Data and compatibility

TauriTavern's data compatibility target is the SillyTavern semantics that browsers, extensions, and user data can observe, not the Node/Express internals.

The following must stay stable:

- Directory semantics such as `default-user`, `characters`, `chats`, and `group chats`.
- The exact capitalization and spaces of `User Avatars`, `QuickReplies`, `OpenAI Settings`, and `TextGen Settings`.
- Formats such as chat JSONL, character card PNG metadata, World Info, presets, themes, and user directories.
- Third-party extension asset paths and host resource response semantics.

For the data directory selection and its current state, see `docs/CurrentState/DataDirectorySelection.md`.

## 8. Engineering guards

Common entry points:

```bash
pnpm run check
pnpm test
pnpm run check:frontend
pnpm run check:types
pnpm run test:contracts
pnpm run check:rust-boundaries
pnpm run test:rust
pnpm run check:rust:dev
```

Architecture-related guards:

- `scripts/check-rust-crate-boundaries.mjs` guards the Rust crate dependency direction.
- `scripts/check-frontend-guardrails.mjs` guards the frontend injection layer boundaries.
- `scripts/check-first-party-ui-guardrails.mjs` guards the React plus strict TS/TSX boundaries.
- `scripts/check-logging-boundaries.mjs` guards how logging targets are used.
- `tsconfig.host.json` supplies TypeScript checking for the Host Kernel.
- `tsconfig.ui.json` supplies strict TS/TSX checking for the Agent, MCP, and Tauri Settings owned UI.

## 9. Platform and distribution

This branch builds Windows x64 only:

- Windows: MSI / EXE installers and a portable single file
- Requires Windows 10/11 x64 and the WebView2 runtime

Portable mode is enabled with `TAURITAVERN_RUNTIME_MODE=portable` or `portable.flag`.

## 10. Related documents

| Topic | Document |
| --- | --- |
| Backend Clean Architecture and crate boundaries | `docs/BackendStructure.md` |
| Frontend integration structure | `docs/FrontendGuide.md` |
| Host ABI / request interception / resource contracts | `docs/FrontendHostContract.md` |
| Current implementation state | `docs/CurrentState/README.md` |
| First-party UI engineering baseline | `docs/CurrentState/FirstPartyUI.md` |
| Windows distribution | `docs/CurrentState/WindowsDistribution.md` |
| Extension API | `docs/API/README.md` |
| Agent architecture | [Agent](Agent/README.md) |
