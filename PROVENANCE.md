# TauriTavern - pinned reference

- Upstream: `https://github.com/Darkatse/TauriTavern`
- Remote: `https://github.com/Darkatse/TauriTavern.git`
- Commit: `f6126b4fc9243eb3990f2c0bad86e2afcb502f22`
- Commit date: `2026-10-10T00:40:00-04:00` (`2026-10-10T04:40:00Z`)
- Commit subject: `ci: sync default-branch GitHub config from dev (#344)`
- Licence: AGPL-3.0
- Extracted: 2026-10-20
- Method: `git init`, `git fetch --depth 1 origin <commit>`, `git checkout --detach FETCH_HEAD`
- Working tree: clean at extraction; no local edits
- Size: 2,510 files, 96.1 MB
- Excluded: none

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

## Working copy

Promoted from `zedon-byok/.references/tauri-tavern` on 2026-10-25. The pinned commit is unchanged.
Local additions:

- `src-tauri/crates/tt-adapter-control/` - a loopback HTTP control adapter with a per-launch bearer
  token. It exposes the operations the Zedon bridge needs without changing TauriTavern's chat
  pipeline.
- `src-tauri/crates/tauritavern/src/app/host/control.rs` - the host side of the adapter: forwards
  control methods to the webview and installs the injected shim after page load.
- `src-tauri/crates/tauritavern/src/presentation/commands/registry.rs` - registers
  `control_respond`.

These are Zedon integration code, not upstream. The parity page
`.cursor/documents/harness/tauritavern-port-parity.md` lists the deviations.
