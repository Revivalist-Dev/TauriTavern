# DeepLore and Copilot feature audit

Date: 2026-11-01

This matrix records the current behaviour of the two extension families. `PASS` means covered by a
passing automated test or a recorded live run. `UNTESTED` means the code exists but has no evidence
yet. `FAIL` means a live run failed.

## DeepLore

| Feature | Entry point | Automated evidence | Live result | Status |
|---|---|---|---|---|
| Vault setup and gateway connection | `/dle-setup`, setup wizard | `test/settings.test.js`, `test/remote-vault.test.js` | No gateway vault was configured; after 10 seconds the drawer now reports "Gateway unavailable — open Setup" instead of waiting forever | PARTIAL |
| Vault browsing and entry read | Drawer Browse | `test/read-vault.test.js`, `test/vault.test.js` | Not reached without a gateway vault | UNTESTED |
| Index build, refresh, cache | `/dle-refresh`, drawer Refresh | `test/refresh.test.js`, `test/indexing.test.js` | Not reached | UNTESTED |
| Search, retrieval, gating | `/dle-search`, automatic injection | `test/search.test.js`, `test/gating.test.js` | Not reached | UNTESTED |
| Write, merge, delete, import/export | AI Notepad, Librarian | `test/write-vault.test.js`, `test/import.test.js` | Not reached | UNTESTED |
| Prompt overrides and prompt store | `/dle-prompts` | `test/prompts.test.js` | Not reached | UNTESTED |
| Circuit breaker and health monitor | Diagnostics | `test/circuit-breaker.test.js`, `test/health.test.js` | Not reached | UNTESTED |
| Telemetry and monitor mirror | Settings | `test/telemetry.test.js` | Not reached | UNTESTED |
| Diagnostics export | Diagnostics | `test/diagnostics.test.js`, `test/diagnostic-export.test.js` | Not reached | UNTESTED |
| DAG, verdicts, contracts | Pipeline internals | `test/dag.test.js`, `test/verdict.test.js`, `test/contracts.test.js` | Not reached | UNTESTED |
| Gateway key storage | Settings | None | Key is stored in extension settings in plaintext | FAIL |
| Native Lore Directory | `#LoreDirectoryIcon` | Tauri integration tests | Opened and listed four entries | PASS |
| Extension source sync | `pnpm run sync:extensions` | `pnpm run check:extensions` | Top-level files were copied but the `src/` tree was not; the app could run stale drawer code. Sync and check now cover `src/` recursively | PASS |

DeepLore's automated suite contains 26 files; `npm test` reports 1,912 passing unit tests and
`npm run test:all` reports 21 passing integration suites. The extension is built around the
zedon-byok gateway. TauriTavern's native Lore Directory and Copilot tool path are a separate vault
implementation. In the live app the native path worked while the DeepLore drawer never received a
vault.

## Copilot

| Feature | Entry point | Automated evidence | Live result | Status |
|---|---|---|---|---|
| Provider selection and generation | Main Copilot chat | `tests/tools-provider.test.mjs` plus Tauri layout test | Copilot completed `COPILOT LIVE OK` and a native lore request through Zedon BYOK | PASS |
| Native `get_lorebooks` | Tool call | `tests/native-context.test.mjs` | Vault folders were available to the model | PASS |
| Native `search_lorebook_entry` / `search_deeplore` | Tool call | `tests/native-context.test.mjs` | Found `shadowfang` in the native vault | PASS |
| Native `read_deeplore_note` | Tool call | `tests/native-context.test.mjs` | Read the matching note and summarized it correctly | PASS |
| Tool enable/disable gating | Settings | `tests/tools-provider.test.mjs` | Not exercised in the live UI | PASS (unit) |
| MCP tool path | Tool settings | None | Not exercised | UNTESTED |
| Customize hook path | Tool settings | None | Not exercised | UNTESTED |
| Lorebook manager / vault manager | Lorebook tab | `tests/vault-lore-manager.test.mjs` | Not opened in the live run | UNTESTED |
| Character manager | Character tab | None | Not exercised | UNTESTED |
| Chat editing | Chat actions | None | Not exercised | UNTESTED |
| Memory | Memory tab | None | Not exercised | UNTESTED |
| Usage stats | Stats tab | None | Not exercised | UNTESTED |
| Attachments and image captioning | Attachment controls | None | Not exercised | UNTESTED |
| Evolution integration | Settings | None | Not exercised | UNTESTED |
| Regex integration | Settings | None | Not exercised | UNTESTED |
| Summaryception integration | Settings | None | Not exercised | UNTESTED |
| TauriTavern integration | Native context and tools | Tauri layout tests | Native tools worked | PASS (partial) |

Copilot now has six extension tests. Most feature modules still have no direct test, and only the
provider and native lore paths have live evidence.

## UI audit

| Surface | 1024x700 | 1280x800 | Finding |
|---|---|---|---|
| Copilot window | PASS | PASS | Fits; no horizontal overflow; input and tools usable |
| DeepLore drawer | PARTIAL | PARTIAL | Readable but the fixed drawer background lets the welcome screen show through; the gateway failure state now appears after 10 seconds |
| Native Lore Directory | PASS | PASS | Entries and controls render |
| API Connections | PASS | PASS | Connection profile controls and Discover usable |
| Minimum window | PASS | PASS | Minimum raised to 1024x700 to avoid the broken legacy top-bar layout |

## Changes landed in this pass

- Added Copilot tests for tool gating, provider ownership, and the native lore manager.
- Added a DeepLore gateway failure state after a ten-second cold start, plus explicit no-vault and gateway-unavailable strings.
- Fixed `sync:extensions` and `check:extensions` so DeepLore's `src/` tree is copied and verified recursively. Previously the installed extension could keep stale drawer code after a source change.
- Removed DeepLore's unused generic vault-delete bridge so the delete cage holds: the only HTTP DELETE path is the prompt API.
- Registered the vault commands and `merge_character_card_data` in the perf replay environment, and gave the perf app a real `LoreDirectory` state so traces from the current frontend can be replayed at HEAD.
- Raised the minimum window to `1024x700` in the shell configuration.

## Highest-value improvements

1. Unify the lore source. Either make DeepLore fall back to TauriTavern's native Lore Directory when
   no gateway is configured, or explicitly present DeepLore and the native directory as separate
   products. The current split is the largest source of confusion.
2. Give DeepLore a native vault path, or an explicit bridge, so the drawer can use the entries that
   TauriTavern already serves. The timeout now explains the failure, but the vault gap remains.
3. Move DeepLore gateway keys out of plaintext extension settings into a scoped native secret.
4. Extend Copilot tests beyond native lore and provider routing: MCP/customize tool dispatch,
   character manager, memory, stats, attachments, and each integration that calls an LLM.
5. Make the shared drawer surface opaque or sufficiently blurred. Copilot is fine; DeepLore is hard
   to read over the welcome page.
6. Run the live matrix for the remaining Copilot modules before calling the extension complete.
7. Add a live check for the native vault path used by both the Lore Directory and Copilot tools, so
   a broken vault state fails the gate instead of only appearing in the drawer.

## Verification commands

```powershell
cd tauri-tavern-extensions\TauriTavern-DeepLore
npm test

cd ..\TauriTavern-DeepLore-Copilot
npm test
npm run build

cd ..\..\tauri-tavern
pnpm run sync:extensions
pnpm test
```
