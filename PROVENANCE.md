# TauriTavern - pinned reference and Windows-only working copy

- Upstream: `https://github.com/Darkatse/TauriTavern`
- Remote: `https://github.com/Darkatse/TauriTavern.git`
- Pinned tag: `v2.4.0`
- Pinned commit: `fff9af0333be97697be2313981699ab0ce35c236`
- Commit date: `2026-10-23T08:46:55+08:00`
- Commit subject: `Merge pull request #393 from Darkatse/dev`
- Previous pin: `2.3.0` (`f6126b4fc9243eb3990f2c0bad86e2afcb502f22`)
- Licence: AGPL-3.0
- Extracted: 2026-10-20; updated to 2.4.0 on 2026-10-27
- Method: `git fetch origin tag v2.4.0 --no-tags`, merged into the local adapter branch
- Working tree: local fork branch, Windows-only divergence (see below)

## Why it is on the shelf

TauriTavern is a native Tauri/Rust rewrite of SillyTavern. Its backend is a Clean Architecture
workspace: `tt-domain`, `tt-contracts`, `tt-ports`, `tt-application`, and adapters for HTTP, MCP,
provider HTTP, tokenization, storage, vectors and QuickJS. It is the reference for the Zedon creative
crate split, particularly:

- `tt-domain/src/models/{character,chat,group,persona,preset,world_info,agent}.rs`
- `tt-application/src/services/` (prompt assembly, agent runtime, model gateway)
- `tt-adapter-mcp/` (RMCP lifecycle, discovery, bounded tool calls)
- `docs/BackendStructure.md` (crate boundaries and dependency direction)
- `tests/*.contract.test.mjs`, `rstest.config.mjs`, `scripts/check-rust-crate-boundaries.mjs`

It is not a dependency. No TauriTavern source is copied into Zedon. If a specific behaviour is ported,
the module carries a `ref:`/`port:` trail and a row on the parity page as required by
`.cursor/rules/35-port-parity.mdc`.

## Licence note

AGPL-3.0. Zedon is private and not redistributed, so no distribution obligation is triggered. The
licence is recorded because publishing Zedon would re-trigger it. Application logic and prompt text
remain reimplementations; only UI assets may be copied under the parity rule, with a `ref:` header.

## Local additions

Promoted from `zedon-byok/.references/tauri-tavern` on 2026-10-25, updated to 2.4.0 on 2026-10-27.
The merged tree keeps these Zedon integration additions:

- `src-tauri/crates/tt-adapter-control/` - a loopback HTTP control adapter with a per-launch bearer
  token. It exposes the operations the Zedon bridge needs without changing TauriTavern's chat
  pipeline.
- `src-tauri/crates/tauritavern/src/app/host/control.rs` - the host side of the adapter: forwards
  control methods to the webview and installs the injected shim after page load.
- `src-tauri/crates/tauritavern/src/presentation/commands/registry.rs` - registers
  `control_respond`.

## Windows-only fork divergence

This working copy is deliberately diverged from upstream. It builds and runs on Windows x64 only.
The divergence is recorded here so future upstream merges are manual and reviewable.

### Build, CI and packaging

- Release workflows are reduced to a Windows x64 matrix (NSIS/MSI plus the portable executable).
  macOS, Linux, Android, iOS and HarmonyOS jobs, Apple signing, TestFlight and mobile artifact
  collection are gone.
- Deleted workflows: `public-testflight.yml`, `nix-package-check.yml`, `fastools-build.yml`,
  `issue-platform-labels.yml`.
- Deleted packaging: `packaging/flatpak`, Android and iOS Tauri projects, mobile build scripts and
  the `android`/`ios`/`linux`/`macos`/`flatpak` package scripts.
- `tauri.conf.json` bundles Windows targets only; mobile and Linux/macOS bundle sections and icons
  are gone.

### Rust and runtime

- Non-Windows `cfg` branches are removed across the host crate and adapters: window creation,
  shutdown, setup, runtime paths, presentation gating, resource delivery and IPC budgets.
- The frontend iOS policy layer (`ios-policy.js`, `ios-policy-ui.js`) and its consumers were removed;
  Windows builds have no policy gate, so request proxy, LAN sync, updates and third-party tool
  registration are always available.
- `HOST_IDENTITY` is fixed to `windows` + `desktop`. `platform/ipc.rs` exposes constant WebView
  transfer budgets instead of per-OS values.
- Target-specific dependencies were removed: Android `webpki-roots`, the Apple `async-dnssd`
  discovery backend and the mobile QuickJS bindings. mDNS discovery now has one backend.
- `tt-contracts::host::{HostPlatform, HostKind}` keeps its full wire enum. The frontend contract and
  the sync platform label still carry the value; the host only ever constructs `windows`/`desktop`.
  This is a wire-protocol exception, not a live platform branch.
- Other surviving mentions are data, not builds: `__MACOSX` archive entries, the SillyTavern
  `mobile` extension folder name and the `mobile_immersive_fullscreen` layout key.

### Documentation and skills

- Deleted platform-only docs: `AndroidDevelopment.md`, `iOSDevelopment.md`,
  `OpenHarmonyDevelopment.md`, `CurrentState/iOSPolicy.md`, `CurrentState/LinuxRepository.md`,
  `CurrentState/MobileStyleAdaptation.md`, `CurrentState/TTS.md`.
- The Windows build guide, README, frontend contract, frontend guide, backend structure and the
  built-in skills describe Windows only. The translated READMEs remain upstream text until a later
  documentation pass.

### SillyBunny desktop UI

- The desktop SillyBunny surface is ported as a first-party host UI layer; no mobile shell, phone
  breakpoints, Android/iOS branches or platform-specific window chrome are carried over.

The parity page `.cursor/documents/harness/tauritavern-port-parity.md` lists the deviations.
