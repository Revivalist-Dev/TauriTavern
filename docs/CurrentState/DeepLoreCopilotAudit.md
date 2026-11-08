# DeepLore and Copilot feature audit

Date: 2026-11-01

This matrix records the current behaviour of the two extension families. `PASS` means covered by a
passing automated test or a recorded live run. `UNTESTED` means the code exists but has no evidence
yet. `FAIL` means a live run failed.

## DeepLore

| Feature | Entry point | Automated evidence | Live result | Status |
|---|---|---|---|---|
| Native vault setup | DeepLore settings, Vault Explorer | `test/tauritavern-vault.test.js`, `test/vault-api.test.js` | The settings already contain a native vault named "TauriTavern Vault" (`native: true`, with the user-selected `subfolder`, for example `World/World of Umamusume`). The extension's own `enabled` flag is false, so no index or injection runs | PARTIAL |
| Vault browsing and entry read | Drawer Browse, Vault Explorer | `test/read-vault.test.js`, `test/vault.test.js` | Native Vault Explorer lists entries; DeepLore drawer showed none while disabled | PARTIAL |
| Index build, refresh, cache | `/dle-refresh`, drawer Refresh | `test/refresh.test.js`, `test/indexing.test.js` | Not reached | UNTESTED |
| Search, retrieval, gating | `/dle-search`, automatic injection | `test/search.test.js`, `test/gating.test.js` | Not reached | UNTESTED |
| Write, merge, delete, import/export | AI Notepad, Librarian | `test/write-vault.test.js`, `test/import.test.js` | Not reached | UNTESTED |
| Prompt overrides and prompt store | `/dle-prompts` | `test/prompts.test.js` | Not reached | UNTESTED |
| Circuit breaker and health monitor | Diagnostics | `test/circuit-breaker.test.js`, `test/health.test.js` | Not reached | UNTESTED |
| Telemetry and monitor mirror | Settings | `test/telemetry.test.js` | Not reached | UNTESTED |
| Diagnostics export | Diagnostics | `test/diagnostics.test.js`, `test/diagnostic-export.test.js` | Not reached | UNTESTED |
| DAG, verdicts, contracts | Pipeline internals | `test/dag.test.js`, `test/verdict.test.js`, `test/contracts.test.js` | Not reached | UNTESTED |
| Gateway key storage | Settings | None | Key is stored in extension settings in plaintext | FAIL |
| Native Lore Directory | `#LoreDirectoryIcon` | Removed | Feature retired; DeepLore is the only lore UI | REMOVED |
| Extension source sync | `pnpm run sync:extensions` | N/A | DeepLore and Copilot are built into the core; no source copy remains | REMOVED |

DeepLore's automated suite contains 26 files; `npm test` reports 1,912 passing unit tests and
`npm run test:all` reports 21 passing integration suites. DeepLore is not gateway-only: it has a
native transport (`src/vault/tauritavern-vault.js`) and the settings contain a native vault named
"TauriTavern Vault" that points at the same `lore` folder as the right-pane Vault Explorer. Copilot
and DeepLore therefore share one vault. In the live run DeepLore's own `enabled` flag was false, so
it had no index; the drawer's gateway wording made that look like a transport failure instead of a
disabled extension.

## Copilot

| Feature | Entry point | Automated evidence | Live result | Status |
|---|---|---|---|---|
| Provider selection and generation | Main Copilot chat | `tests/tools-provider.test.mjs` plus Tauri layout test | Copilot completed `COPILOT LIVE OK` and a native lore request through Zedon BYOK | PASS |
| Native `get_lorebooks` | Tool call | `tests/native-context.test.mjs` | Vault folders were available to the model | PASS |
| Native `search_lorebook_entry` / `search_deeplore` | Tool call | `tests/native-context.test.mjs` | Found `shadowfang` in the native vault | PASS |
| Native `read_deeplore_note` | Tool call | `tests/native-context.test.mjs` | Read the matching note and summarized it correctly | PASS |
| Tool enable/disable gating | Settings | `tests/tools-provider.test.mjs` | Not exercised in the live UI | PASS (unit) |
| MCP tool path | Tool settings | None | Not exercised | UNTESTED |
| Agent Workspace hook path | Tool settings | None | Not exercised | UNTESTED |
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
| DeepLore drawer | PARTIAL | PARTIAL | Readable but the fixed drawer background lets the welcome screen show through; it now reports "DeepLore disabled — enable in Extensions" while the extension is off |
| Native Lore Directory | REMOVED | REMOVED | Feature retired; DeepLore is the only lore UI |
| API Connections | PASS | PASS | Connection profile controls and Discover usable |
| Minimum window | PASS | PASS | Minimum raised to 1024x700 to avoid the broken legacy top-bar layout |

## Changes landed in this pass

- Added `list_vault_files`, `read_vault_file`, and `write_vault_file` native tools. They operate from the active vault root and can read or edit `.cursor/hooks`, `.cursor/rules`, `.cursor/agents`, `.cursor/tools`, prompts, JSON and MJS files. `edit_deeplore_note` also accepts `vault_root: true` for repository files.
- Kimi models are clamped to 16,384 output tokens in both TauriTavern and DeepLore Copilot. This prevents Bedrock from receiving `max_tokens: 262144` and rejecting the request with a context-length error.
- Tool-call cards preserve their expanded/collapsed state while a Copilot response streams. Each live render captures the open tool-call IDs before replacing the message body and restores them after the new tool cards are inserted.
- `lorebook-changes` blocks are extracted by locating the closing fence at the start of a line, not by the first triple-backtick match. This prevents code fences inside note content from truncating the block, parses every block in a message, deduplicates repeat proposals, and renders the proposal card instead of raw JSON.
- `ask_user` accepts `options` (and `allow_custom`). Two or more options render as clickable choice buttons in the message body; selecting one resumes the tool loop with that answer. Free-text input remains available by default when `allow_custom` is not false.
- If the Copilot send composer is not mounted, including non-streaming and regenerated responses, `ask_user` opens the same choice prompt in a centered modal instead of failing with “requires the send composer”.
- Successful `write_vault_file` calls, and `edit_deeplore_note` calls made with `vault_root: true`, render an **Open** button in the tool-call header. It opens the edited or created file in a center tab; the native write result carries its vault mount id so older result payloads can still fall back to the active mount.
- The center-tabs preview now treats `.mjs`, `.cjs`, `.tsx`, `.jsx`, YAML, JSONC, shell, SQL and related code/text extensions as inline text files.
- Copilot now runs the tool loop from swipe regeneration as well as normal sends, and persists the final swipe content, reasoning and tool calls.
- Added a finalization pass when the tool-round limit is reached or a post-tool follow-up is empty, so a tool-call-only response no longer leaves the assistant stopped.
- `get_char_info` now accepts a group member name (`char` is accepted as an alias) and resolves cards from `getActiveCharacterEntities()`. In a group with no name it returns the member list instead of `No active character`.
- Copilot now parses ` thinking`/`<thinking>` blocks incrementally: content remains reasoning until the matching close tag, including tags split across stream chunks, and partial tags are held rather than flashing as answer text.
- DeepLore now exposes `deepLoreEnhanced_writeNote` and `deepLoreEnhanced_readNote`. The write API supports `overwrite`, `append` (with `target_text` ignored) and `patch` (`target_text` required), and returns `{ ok, error, path, mode }` so Copilot reports a useful failure instead of "API isn't available".
- Removed the stale forced `lore` subfolder for native vaults and added a migration that clears it only when the mounted root has no `lore` directory.
- Added a DeepLore gateway failure state after a ten-second cold start, plus explicit disabled, no-vault and gateway-unavailable strings.
- Fixed `sync:extensions` and `check:extensions` so DeepLore's `src/` tree is copied and verified recursively. Previously the installed extension could keep stale drawer code after a source change.
- Removed DeepLore's unused generic vault-delete bridge so the delete cage holds: the only HTTP DELETE path is the prompt API.
- Registered the vault commands and `merge_character_card_data` in the perf replay environment, and gave the perf app a real `LoreDirectory` state so traces from the current frontend can be replayed at HEAD.
- Raised the minimum window to `1024x700` in the shell configuration.
- Persisted the Vault Explorer's open/closed state so a relaunch resumes the same file-browser state.

## Highest-value improvements

1. Make the drawer state explicit when the native vault is present but DeepLore's `enabled` flag is
   false. The current "gateway unavailable" copy sends the reader toward transport setup when the
   extension is simply switched off.
2. Exercise the native vault path end-to-end with the extension enabled: index, search, read, write,
   and refresh against the same `lore` folder that Vault Explorer and Copilot use.
3. Move DeepLore gateway keys out of plaintext extension settings into a scoped native secret.
4. Extend Copilot tests beyond native lore and provider routing: MCP/customize tool dispatch,
   character manager, memory, stats, attachments, and each integration that calls an LLM.
5. Make the shared drawer surface opaque or sufficiently blurred. Copilot is fine; DeepLore is hard
   to read over the welcome page.
6. Run the live matrix for the remaining Copilot modules before calling the extension complete.
7. Add a live check for the native vault path used by the DeepLore drawer and Copilot tools, so a
   broken vault state fails the gate instead of only appearing in the drawer.

## Verification commands

```powershell
cd tauri-tavern
node --test tests/layout/deeplore-system.test.mjs
node --test tests/layout/copilot-lore-manager.test.mjs
node --test tests/layout/zedon-byok-provider.test.mjs
pnpm run check:extensions
```
