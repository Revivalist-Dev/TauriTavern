# Web Host

Web Host is the TT host implementation for browser embedders, in `src/tauri/web-host/`. The side that
Tauri provides in the native app — `window.__TAURI__` and the host identity `__TAURITAVERN_HOST__` —
is what this layer provides in a browser. Today the only consumer is
[Tavern Studio](https://github.com/Darkatse/TavernStudio), which runs the TT frontend in its preview.
The native app does not load these files. Contract level: Project Contract.

## Day-to-day development does not need to consider it

TT's frontend code does not know which host it runs on and needs no branch for Web Host. Only these
three cases require changing it:

- `tests/browser/web-host-startup.test.mjs` or `web-host-session.test.mjs` fails: a command Web Host
  does not support yet, or a request the test backend does not prepare, has broken startup, session
  writes, or generation. Add the mapping in `src/tauri/web-host/` and, when needed, the matching
  endpoint to `tests/browser/web-host-fixture.mjs`.
- the `web_host_defaults` test in `tt-application` fails: the native defaults or a DTO changed, so
  regenerate the default state as described under Maintenance.
- a command's DTO or protocol in the table below changed, for example settings commits, chat file
  reads, or the Persona delta: update the mapping here in the same change.

## Release artifacts

The stable and canary GitHub Releases provide web artifacts:

- stable: `TauriTavern-<version>-web.zip`.
- canary: `TauriTavern-<YYYYMMDD>-canary-web.zip`.

The contents are the whole `src/` produced by `pnpm web:build`, the same frontend directory the native
app uses. The zip root is the vendor root, and after extracting it you install Web Host before
`init.js` as described below.

Embedders record the asset name and the SHA-256 digest the GitHub Release provides, and verify it
after downloading. Use stable for a long-term pinned version; canary is replaced with each release and
old assets are cleaned up.

## Installation

```js
import { installWebHost } from '/tauri/web-host/install.js';

const host = installWebHost({
    identity: { platform: 'windows', kind: 'desktop' },
    backend: { handle(request) { /* returns the ST HTTP response synchronously */ } },
    store: {
        load() { /* returns the previously saved document synchronously; null on the first call */ },
        save(value) { /* saves the document synchronously */ },
    },
});
```

- Call it before `init.js`. When the call returns, `window.__TAURI__` and the frozen host identity are
  both in place. `identity` may only name a real platform, with the same values as the native app.
- The TT page may run inside the embedder's iframe.
- All three ports return synchronously:
  - `backend.handle({ method, url, headers, body })` handles a request with ST's HTTP semantics and
    returns `{ status, headers, body }`:
    - JSON requests and responses use strings, and a GET request body is `null`;
    - character editing uses a data-only form `{ kind: 'form', entries: [name, value][] }` that
      carries text fields only;
    - for streaming responses see "Generation streams";
    - a non-2xx response becomes an error whose message includes the method, path, status code, and
      response body, so `body` must be a string in that case.
  - `store.load()` and `store.save(value)` read and write Web Host's own document, which holds the TT
    settings DTO. The embedder stores it as it is and needs to understand nothing inside it.
- The backend data and the `store` both belong to the embedder. Page templates and `default-state.json`
  are read as static files, so the embedder has to serve them unchanged from the vendor image.
- The returned `host.emit(name, payload)` delivers an event to listeners registered through
  `__TAURI__.event.listen`, with the same shape the callback receives under Tauri:
  `{ event, id, payload }`.
- `await host.exit()` before removing the page. It follows the native close-window flow: TT saves
  settings and chats, calls `getCurrentWindow().destroy()`, and the promise resolves with that. When
  saving fails, TT logs the error and keeps the page open, the promise stays pending, and calling
  again retries.

## Commands

The table covers the three paths that have been tested: startup through chat, session writes, and
Replay generation. A request whose method is not stated is a POST.

| Command | Backend request or behaviour |
| --- | --- |
| `wait_for_backend_ready`, `backend_error_bridge_ready` | Immediately ready; there is no undelivered native error |
| `get_client_version` | `GET /version` |
| `get_tauritavern_settings`, `update_tauritavern_settings` | Read and partially update the `store` document; see "TT settings" |
| `get_sillytavern_settings`, `get_personas` | `/api/settings/get`, converted to the TT shape |
| `read_secret_state` | `/api/secrets/read`; the connect button refreshes secret state |
| `get_character` | `/api/characters/get`; see "Characters" |
| `get_bootstrap_metadata` | `/api/characters/all`, `/api/groups/all`, `/api/avatars/get`, `/api/secrets/read` |
| `get_character_chats_by_id` | `/api/characters/chats`; the result must be an array, `[]` when there are no chats. The `{ error: true }` ST returns in that case is rejected |
| `get_chat_payload_path`; `plugin:fs\|open`, `plugin:fs\|fstat`, `plugin:fs\|read`; `plugin:resources\|close` | `/api/chats/get`; see "Reading chats" |
| `list_active_agent_runs` | Returns an empty set; a browser host owns no native agent run |
| `get_all_backgrounds`, `get_background_folders`, `get_all_background_metadata` | `/api/backgrounds/all`, `/api/backgrounds/folders`, `/api/image-metadata/all` |
| `get_extensions` | `GET /api/extensions/discover`, converting ST's `type` back into the native `extension_type` |
| `read_frontend_template`, `read_frontend_extension_template` | Reads the page template and the system extension templates |
| `open_extension_store_entry` | `null`; a fresh install has no extension-private data yet |
| `list_agent_profiles` | The default Writer list generated by Rust |
| `list_mcp_servers`, `list_skills` | Empty lists for a fresh install |
| `register_agent_extension_tool` | Acknowledges the tool declarations the page sends at startup; rejects them when an agent runs |
| `database_handle` | `flushAll` returns `null`: no database is open. Any other request is rejected |
| `list_sprites` | `GET /api/sprites/get?name=<name>` |
| `sd_handle` | `/api/sd/<path>`, returning the status code and response body as they are, exactly as the native app does; the SD extension handles failure itself |
| `get_world_info` | `/api/worldinfo/get`; opening a chat pre-reads the associated World Info |
| `begin_settings_commit`, `append_settings_commit_chunk`, `finish_settings_commit`, `abort_settings_commit` | Ultimately writes to `/api/settings/save`; see "Settings commits" |
| `begin_chat_commit`, `append_chat_commit_chunk`, `finish_chat_commit`, `abort_chat_commit` | The full chat, the metadata, and the metadata extension, ultimately written to `/api/chats/save` |
| `begin_world_info_commit`, `append_world_info_commit_chunk`, `finish_world_info_commit`, `abort_world_info_commit` | The submitted `{ name, data }` is written to `/api/worldinfo/edit` as it is |
| `save_theme` | `/api/themes/save` |
| `save_quick_reply_set` | `/api/quick-replies/save` |
| `update_character_card_data` | Converts the card DTO into the text form for `/api/characters/edit`, then reads `/api/characters/get` and returns the updated DTO |
| `merge_character_card_data` | `/api/characters/merge-attributes`, then reads the updated DTO |
| `generate_chat_completion` | `/api/backends/chat-completions/generate`, a non-streaming JSON response |
| `get_chat_completions_status` | `/api/backends/chat-completions/status`, the connection and model list |
| `start_chat_completion_stream`, `read_chat_completion_stream`, `close_chat_completion_stream` | The SSE stream of the same generation endpoint, turned into an `afterSeq` session |
| `cancel_chat_completion_generation` | Acknowledged; a non-streaming request completes synchronously, so there is nothing to cancel |
| `chat_history_generation_started`, `chat_history_generation_finished` | Acknowledged; a session's chat write is the record, and no native history repository is created |
| `get_notification_permission_state` | `denied`: a preview has no native system notification capability |
| `get_window_snapshot` | `null`: the browser manages the viewport |
| `devlog_append_frontend_logs` | Acknowledged; logs stay in the frontend collector, since a browser has no native log file |

Every other command, and `core.convertFileSrc`, is rejected with `{ Unsupported: message }`:

- Out of scope: agent runs, MCP operations, sync, QR scanning, native share and export, the clipboard,
  external open, update installation, extension store writes, group chat and cold swipe assets, and
  the native screenshot command `capture_content_viewport`.
- Commands whose caller can handle the failure itself are not implemented, such as token counting (ST
  falls back to an estimate) and the update check at startup (skipped).
- On a desktop window `isFullscreen()` returns `false`, and `setFullscreen()` is unsupported.

## Implementation notes

**Settings commits**

- The revision is the SHA-256 of the backend's current settings string. Comparing the revision and
  writing happen in one synchronous call, so when two pages save from the same version one after the
  other, the later one receives `{ Conflict: message }`.
- `power_user.personas` and `persona_descriptions` in a commit carry only the personas that changed,
  and one that is not mentioned is not a deletion. Web Host keeps the remaining personas in the
  backend, replaces the matching ID wholesale with the committed record, and then saves the complete
  ST settings. The conversion between personas and ST settings is shared with the frontend through
  `tauri/main/kernel/persona-projection.js`.
- Chunk encoding matches the native app: Android uses `chunk-encoding: base64`, and other platforms
  pass bytes directly. The protocol constants are shared with the kernel through
  `tauri/main/kernel/byte-protocol.js`.
- Settings, chats, and World Info share the chunked-session mechanism in `protocols/byte-commit.js`.

**Chat commits.** The full payload is encoded as JSONL; a metadata commit replaces only
`chat_metadata` in the header; a metadata extension replaces its namespace, and `null` deletes it.
When an integrity value already exists, TT requires the new one to match exactly, rejects an omission
too, and returns `{ BadRequest: 'integrity' }` on a mismatch. The full payload's `force` is passed to
ST unchanged, and a metadata commit passes `false`; without a forced save, ST refuses to overwrite a
chat file whose first line is corrupted.

**Reading chats.** The message records the backend returns are encoded as JSONL and then read through
the `plugin:fs` command group; every read response ends with an 8-byte big-endian length, as native
does. ST signals a missing chat with the empty object `{}`: when `allowNotFound` is true Web Host
returns an empty path, and otherwise rejects with `{ NotFound }`.

**Characters.** `get_bootstrap_metadata` keeps the `shallow` flag the backend provides, and a shallow
card's `json_data` is `null`. `get_character`, and the read-back after an edit, return the full card,
with `json_data` set to the raw card text ST returned. When ST fails to read a card it still returns
200 with a shell that has no `json_data`, and Web Host treats that as an error. A full-card update is
converted back into ST's text form and keeps the other fields in `json_data`; avatar files and cropping
are out of scope.

**TT settings.** A read merges the defaults with the `store` document, and the defaults fill in any
field added since. An update follows the Rust DTO's `Option` semantics: an ordinary field that is
absent or `null` is kept, nested sections update field by field, and arrays are replaced.
`request_proxy` is a complete DTO and replaces the whole section;
`updates.startup_popup.dismissed_release_token` accepts `null` to clear it. An update reads, merges,
and saves within one task.

**System extensions.** The read during initialization returns a fresh-install result and tool
declarations are acknowledged; rejection comes only when one of those capabilities is actually used.

**Generation streams.** The backend returns the response headers synchronously, and `body` is a
`ReadableStream<Uint8Array>` carrying standard SSE. The stream is transferable; a same-origin call may
return it directly, and handing it over through structured clone requires adding it to the transfer
list. Cancellation and close travel back to the backend through the reader's `cancel()`.

SSE parsing uses upstream's `scripts/sse-stream.js`. Each read returns one event and keeps the batch
that has not been acknowledged yet; the same `afterSeq` replays that batch, including a read that is
still blocking. End and error produce terminal events, and closing the stream releases a blocking read.

## Maintenance

The settings DTO and the default Writer list in `default-state.json` are generated by Rust:

```sh
cargo run --quiet --manifest-path src-tauri/Cargo.toml -p tt-application --example web_host_defaults > src/tauri/web-host/default-state.json
```

`tt-application/tests/web_host_defaults.rs` regenerates them with the same code and checks that the
committed file matches.

The browser tests verify the startup and session paths with the real frontend, the system extensions,
and a minimal third-party extension, checking extension activation results and any error during the
run; integration with Studio's real Session Backend, JSR, and Replay is accepted by Studio itself.
