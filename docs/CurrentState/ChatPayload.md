# Chat payload (current state)

This document describes the frontend full-history contract, atomic commits of the full payload and metadata, and backend read-only pagination. These mechanisms must not be re-coupled into a frontend data window.

## 1. Core contract

The first non-empty record of a chat JSONL file is the header, and every non-empty record after it is a message. Once the current chat has finished loading:

- `chat[]` holds every message after the header, in the same order as on disk.
- `chat[i]` is always a 0-based absolute message index.
- Generation, extensions, editing, swipes, deletion, and saving share one canonical `chat[]`.
- A full replacement of the chat contents goes through `replaceChatContents()`, which writes the message references item by item and adjusts the length, keeping the `chat[]` instance stable instead of spreading the history out as function arguments. That is what keeps the V8 engine on Android from throwing a RangeError past 65,536 entries.
- If any JSONL record cannot be parsed, loading fails as a whole; a partial history must not be committed.
- Without an explicit chat switch, a character's `chat` file stem stays stable across shallow reads, full reads, and repeated reads.

The message set and its indexing follow SillyTavern's full-history contract; when on-demand loading while scrolling history is explicitly enabled, candidate content takes the restricted representation described below. TauriTavern no longer provides `chat_history_mode`, and there is no frontend window state, no backfill during generation, and no partial-patch saving.

### 1.1 Unified format baseline

- The header and every message must be a JSON object. `chat_metadata.integrity` may be absent; when present it must be a non-empty string, whitespace is preserved, and comparison uses the original value. First-party code still generates a UUID, and other fields are interpreted by the uses that read them.
- For `chat_metadata` in the header, and for fields of the same name inside it, the last occurrence wins; the integrity check runs against the metadata that finally takes effect.
- UTF-8 is decoded strictly, and structural whitespace is limited to space, Tab, CR, and LF. Whitespace and at most one BOM are allowed before the first record and are consumed once by the format layer; no BOM is allowed anywhere else.
- A file with no readable records is an empty chat; a new full commit must carry its own valid header, `force` included. A chat with no messages is written as header-only.
- Reads strictly validate the records they actually interpret and do not skip bad ones; a native full-byte commit validates only the header and does not scan the body as well.
- Reserialization by TT writes BOM-free UTF-8; pass-through transfer, backup, and copy preserve bytes. A metadata update preserves the body's original bytes, see §3.1.
- Byte offsets count against the original file; blank lines do not consume a logical record number. Pagination and cold message slices add no separate header/BOM preamble.

### 1.2 Directory query projections

Directory information is interpreted by the storage-core chat repository, and userdata only maps the result; each kind of query keeps the read scope it needs.

- When the header is valid, a damaged last-entry preview shows "Preview unavailable" while the entry and its message record position are kept. A missing body, an empty body, and header-only do not count as damaged.
- The date comes from the last valid `send_date`, otherwise from the mtime; an unavailable body does not erase a valid date.
- The character list returns the full last-entry body, while summaries cache only a short preview. When a search finds a projection unavailable, the whole query is not cached, even if that file did not match.
- Ordinary summaries, search results, and backup details use a lightweight projection; full `chat_metadata` is read only on explicit request and attached to that response.
- The directory index is a rebuildable cache, rebuilt on demand when its version does not match or the file is damaged. Legacy indexes are cleaned up on first load; a cleanup or persistence failure is recorded as a warning and does not block directory queries.
- Before deleting a chat or a character, identity is queried from the current header. A valid legacy chat without integrity has no identity; a read or format error stops the deletion concerned. Directory listings report per file and skip failed entries.

Directory search matches the raw JSONL. Visibility in the directory does not guarantee that the whole text is loadable; I/O, encoding, decompression, and required-header errors keep propagating.

The ordinary summary cache grows with entries and summary fields, not with the size of unknown metadata. Explicit full-metadata responses, full last-entry bodies, and the whole-line reads a search performs each carry their own data-size cost; constant memory across the whole chat chain is not promised here.

## 2. Full loading and a restricted DOM

First-party character chats and group chats load the full payload through a single internal transport entry point:

- Characters: `loadCharacterChatPayload()`
- Group chats: `loadGroupChatPayload()`

The transport parses the complete JSONL and hands the same object array straight to the core caller. The character and group chat callers own `allowNotFound`, the stale-selection guard, header handling, and the existing event ordering.

The extension compatibility get shares the repository reader, converting JSONL into JSON array bytes on demand for the consumer to parse; for the interface and streaming error semantics see [FrontendHostContract §4.3](../FrontendHostContract.md#43-route-table-public).

A character chat binds the character/chat snapshot of this payload request only after full hydration. If the character's current stem does not exist but the existing chat list is non-empty, `resolvePersistedChat` repairs it on demand under the recent-chat semantics and writes the result back; a new chat may be created only when the list is empty. Recovery happens only when the target character is opened, never as a full-library scan at startup.

Explicitly opening a given chat (home recent list, chat manager, bookmarks, branches) goes through `selectCharacterById(id, { chatFile })` and `openGroupById(id, { chatId })` uniformly: no pre-scan of the chat list, no recovery, no creation; the character `chat` field and the group `chat_id` are written back only after the target has loaded successfully.

Default first-party loading reads JSONL through a shared Tauri FileHandle stream, bounded by the same already-open file and its initial size; an early EOF counts as a failure, and the resource is closed on completion, cancellation, or failure. Every run mode reuses the resolved `data_root` scope.

`power_user.chat_truncation` limits only how many DOM nodes are mounted initially; it does not trim `chat[]`. `Show more messages` mounts earlier floors from the full array, issues no history I/O, and does not change array indices. If DOM virtualization is added later, it may replace the rendering layer only and must not change the canonical data contract.

### 2.1 On-demand loading while scrolling history

`cold_swipes_enabled` is off by default, takes effect on reload, and is independent of DOM virtualization. Once enabled, only the current chat uses the cold representation; the compatibility get, export, and the JSONL written to disk stay complete.

- Loading keeps every floor, the current body, variables, `swipe_id`, and the array length; eligible historical messages have their non-current swipe slots set to null, and the last floor stays complete. They are read back on demand later and are not put back into the cold representation automatically.
- `tt_swipe_cold: { sourceId, record }` references the source record of this load: `record` numbers non-empty records from 0, with the header as 0, and does not change when messages are reordered. The source file is held by the current chat, so replacing the path does not change the origin; it is released when the chat is switched or reloaded.
- null means not loaded; non-null values and appended slots follow the runtime data. Read-back and saving fill in by slot and preserve the runtime `swipe_id`. Reading another swipe or deleting a slot requires reading back first; shortening the array without reading back is rejected. Saving removes the marker and publishes atomically.

Projection and merging live in `cold_swipes.rs` in storage-core; the frontend plugs in through `chat-payload-transport.js`, and the host manages Tauri resource lifetimes.

## 3. Unified chat commit

First-party chat saving goes through `chat-payload-transport.js`; the current chat is scheduled serially by `enqueueChatSave()`, and the transport does not enqueue a second time. For the compatibility routes and the event contract see [FrontendHostContract §4.3](../FrontendHostContract.md#43-route-table-public).

A commit captures a JSON text snapshot before its first asynchronous yield, and the current chat captures one when its queue task starts; later edits do not leak into that save. Framing bounds transfer overhead, but the snapshot still grows with content size.

Chats and lorebooks share storage-core's commit session, frame limits, and staging lifetime, while each repository owns content validation and publication. The host publishes only after confirming the data is complete; the Windows host enforces the same frame and staging limits.

Commit and cancellation errors propagate to the caller; teardown and startup-cleanup failures are only logged as warnings and do not rewrite the commit result. Integrity conflicts are identified by a distinct error code.

Publishing a chat syncs the staging file first, then atomically replaces the target; a failure does not fall back to a copy-over. That guarantee does not include power-loss durability of the parent directory entry after the rename.

### 3.1 Metadata save

`saveMetadata()` / `getContext().saveMetadata()` replaces the whole `chat_metadata` inside the JSONL header, and field deletions reach disk too; the rest of the header keeps its semantics and the body is preserved byte for byte. Unlike SillyTavern 1.18.0, it does not save messages along the way: an extension that modifies messages must call the full save explicitly.

The current chat's metadata and full saves share `persistedChatMetadata()` and the save queue. That helper excludes `lastInContextMessageId` and does not modify live metadata; a metadata save neither walks nor transfers messages, saves no message-derived cache, and cancels no pending full save. The integrity prompt and its recovery stay inside the same queue task: confirming forces a full save, declining reloads; a missing file or an ordinary error does not fall back.

Metadata operations require the target file to exist. A new group chat binds its metadata and identity and publishes the initial header before the first greeting extension event, and later initialization must not overwrite what the event changed. An extension's [`metadata.setExtension()`](../API/Chat.md) modifies only the named namespace of the on-disk target; it does not join the current chat queue or merge live metadata.

`chat_metadata.rs` in storage-core reads the latest header under the path mutation lock, applies the change, and copies the body, reusing the unified publication mechanism; on success it invalidates caches and notifies the backup coordinator. The content signature must correspond to the fully published file and cannot be replaced by the uploaded metadata bytes. Integrity represents identity, not a content version, and the in-process lock provides no cross-process or Sync conflict isolation.

JS and IPC cost grows with the size of the metadata being committed; Rust working memory grows with the header and the new values, not with the body. Disk still has to read and write a complete replacement file at Θ(file size), and the file mtime updates with it. The header makes no guarantee about field order or formatting; the body keeps its original bytes.

### 3.2 Deletion and rename

Deleting or renaming the chat that is open goes through `prepareCurrentChatFileChange({ saveEdits })` first: it is refused while generation is running, and no further write lands on that file afterwards. Renaming keeps the content, so it saves fully first (`saveChatConditional()`) and aborts if that save fails; deletion does not need the content, so it cancels the scheduled debounce save and waits for queued writes to finish, and unsaved edits are deleted with the file. `doNewChat({ deleteCurrentChat: true })` saves before clearing, consistently with HEAD, so the deleted chat's backup is current; if the deletion fails after the new chat exists, it reports "created, but…".

A file operation fixes its target at the start (the avatar or group id plus the filename), and the character record is written by `updateRemoteChatName(characterId, name)`. The upstream exports `replaceCurrentChat`, `deleteCharacterChatByName`, and `deleteGroupChatByName` share the same deletion and replacement implementation as the UI. After the open chat is deleted, it is replaced in the order "clear → reset metadata → point the record at the replacement chat → load → save the record"; after a rename, `renameGroupOrCharacterChat` makes records still pointing at the old name follow. Once the file operation has succeeded, a later step failing reports "deleted / renamed, but…". Export saves first only when the target is the open chat.

Deleting by name also loads the replacement chat. Confirmed extension boundaries (2026-10-09):

- Discordia 0.7.3's flow of deleting and then clearing the host chat again is not supported; it may clear and, on a later save, overwrite the replacement chat.
- Folder Manager 3.0.15 creates its own new chat after a bulk deletion of the last current chat, which may leave one extra new chat; that difference is accepted.

Known boundary: the current chat has no explicit session; admission does not block a save started afterwards, nor does it cover bulk writes outside the queue (`renamePastChats`, `renameGroupMember`).

## 4. First-class tool messages

Tool turns from Legacy Generate are stored directly in the same flat `chat[]`:

```text
Assistant { mes, tool_calls[] }
Tool      { role: "tool", tool_call_id, mes: result }
```

An Assistant message with no body is a complete message as long as it carries `tool_calls`. Each tool result has a real absolute index and belongs, through `tool_call_id`, to the Assistant that issued that call earlier; the association does not depend on physical adjacency, because side-effect messages such as images may be appended while tools run.

The new writer always writes `is_user:false` and `is_system:true`, so extensions that understand only SillyTavern's legacy booleans filter tool messages out by default; history replay takes only `role === "tool"` as the role fact and is not blocked by the compatibility booleans or by edits to the display-only `name`/`error`. A tool message is a real floor that is visible, editable, and deletable on its own, reusing the compact `smallSysMes` styling of the legacy tool floor; the display layer reads the nearest preceding Assistant call by `tool_call_id` and, with the old formatter, shows Arguments and Result inside the same `<details>` that is collapsed by default, without copying persisted data. The physical order of `chat[]`, the DOM `mesid`, and `.last_mes` always express the same order, and the two separate notions of "physical tail Tool / logical tail Assistant" are no longer maintained.

Editing, deleting, moving, copying, hiding, and branching act only on the physical message the user picked; there is no owner/result cascade, and the user is not prevented from producing an incomplete tool turn. Pairing Assistant calls with tool results happens only at the provider prompt assembly boundary; only relationships the provider cannot replay — missing, orphan, duplicate, invalid ID/arguments/result — fail explicitly, with the original `chat[index]`. An empty `tool_calls`/legacy invocation array counts as no tool facts, and display metadata the protocol does not require does not block generation. Hiding an Assistant that carries tool calls also keeps its tool results out of the prompt.

The tool cascade deletion and its parameters added in SillyTavern 1.19.0 are outside what TT supports.

Tool calls do not enter `swipe_info`; the owner Assistant keeps only the ordinary single-swipe metadata `saveReply` originally created, and the core UI no longer maintains switchable state for tool turns. A tool message itself cannot be swiped. If the physical tail is a tool message, the result of append/continue/swipe is saved as a new Assistant floor, neither overwriting the tool message nor looking for a so-called "logical Assistant tail"; the user may keep, edit, or delete that result.

Calls and all results are committed at once, only after tool execution has completed, so a tool action cannot save a half-finished transcript. Legacy local and MCP tools share this writer; MCP `OutcomeUnknown` ends the current batch and neither fabricates nor partially commits results. The new writer does not write `extra.tool_invocations`; that field is used only to read old synthetic tool floors.

The Chat Completion preset's "strip old function call results" changes only the provider prompt: once enabled, a complete tool turn before the last user message (the Assistant message that issued the calls plus every tool result) is omitted, leaving only ordinary Assistant messages that carry no tool calls. That projection happens before prompt regexes, reasoning regexes, the generation interceptor, and the World Info scan, so omitted floors take no part in depth or activation calculation; the provider assembly boundary re-checks the history an interceptor may have modified against the same projection. A recursive tool chain after the current user message is still replayed in full. The option does not modify `chat[]`, the DOM, or persisted history, and does not apply to Agent prompt assembly.

In-progress tool feedback exists only as frontend runtime state: once the whole batch of calls validates, the UI shows pending cards on the owner Assistant and updates the results as each tool finishes; when every tool is done the pending state disappears and the persisted tool floors appear at their own physical positions. Pending state does not enter `chat[]`, is not saved, and does not emit tool events early, but it is restored from the same Assistant object when ChatSurface remounts.

A purely tool-only Assistant still keeps its owner floor and keeps updating the streaming/pending UI, but emits no legacy `MESSAGE_RECEIVED` / `CHARACTER_MESSAGE_RENDERED`; after the complete calls/results are committed atomically, `TOOL_CALLS_PERFORMED` / `TOOL_CALLS_RENDERED` are emitted once, and the final visible Assistant produced by recursion then emits character events under ordinary message semantics. An Assistant that carries a body, reasoning, or media is not tool-only and keeps the existing character event semantics.

## 5. Standalone read-only pagination

Rust still keeps JSONL tail/before reads, because an Agent or an extension may need only a bounded slice of history:

- `get_chat_payload_tail` / `get_group_chat_payload_tail`
- `get_chat_payload_before` / `get_group_chat_payload_before`
- `get_chat_payload_before_pages` / `get_group_chat_payload_before_pages`

A pagination cursor carries the offset plus a file-size and mtime signature. `before` must validate the signature; when the file has changed it returns an explicit error and the caller should establish a new read session from the tail.

Pagination is an explicit query capability and takes no part in the current chat's `chat[]`, DOM, generation, or saving. `history.tail/before/beforePages` on `window.__TAURITAVERN__.api.chat` is its public frontend entry point.

Chat summaries, recent records, and search are rebuildable projections: a single file failing excludes only that file and reports an error, and a failed write-back of the persisted summary index is only recorded as a warning. Full loading and saving of the actual target JSONL still fail as a whole.

## 6. `windowInfo()` ABI

`api.chat.current.windowInfo()` keeps the existing six-field Promise ABI but now describes the full history only:

```js
{
  mode: 'off',
  chatKind,
  chatRef,
  totalCount: chat.length,
  windowStartIndex: 0,
  windowLength: chat.length,
}
```

`mode: 'off'` is a stable value of the public API, not a configurable mode, and does not trigger a backend summary query.

## 7. Code boundaries

Frontend:

- `src/script.js`: canonical load/save for character chats, DOM truncation, Show More, the save queue.
- `src/scripts/group-chats.js`: canonical load/save for group chats.
- `src/scripts/chat-payload-transport.js`: common entry point for the full payload transport.
- `src/scripts/tauri/chat/transport.js`: full payload Tauri transport and the integration boundary for the shared FileHandle pull stream.
- `src/scripts/tauri/chat/jsonl.js`: synchronous JSON record snapshots, byte framing, and JSONL reads.
- `src/scripts/tauri/chat/commit.js`: snapshot capture timing, IPC sessions, ACK validation, and commit error classification.
- `src/tauri/main/services/files/readable-file-stream-service.js`: cross-platform plugin-fs open/read/close pull stream.
- `src/tauri/main/api/chat.js`: the extension history pagination API and `windowInfo()`.

Rust:

- DTO / service: `tt-application`.
- Repository ports: `tt-ports`.
- JSONL format and concrete I/O: `tt-adapter-storage-core`, with the shared format rules in `chat_jsonl.rs`.
- Tauri commands: the `tauritavern` presentation layer.
- The pagination read implementation currently lives in `windowed_payload.rs` and `windowed_payload_io.rs`; those filenames are internal historical names and do not imply a frontend window mode.

## 8. Verification focus

- After a long chat loads, `chat.length` equals the full message count, and the initial number of `.mes` nodes is limited by `chat_truncation`.
- Show More only adds DOM nodes; absolute `mesid` values do not change.
- A stale character/group load result does not overwrite a newer selection.
- A character missing the local `chat` field resolves to the same stem across shallow reads, full reads, and restarts; an existing mismatched chat is recovered on demand.
- After a full save and reopen, edits, deletions, swipes, hide scope, and metadata are all preserved.
- After a metadata save the header fields are updated and the body is byte-for-byte unchanged; a pending message deletion is not cancelled, and a new group chat's greeting event can save metadata immediately.
- Editing messages and nested metadata after a save has started does not change the snapshot in flight; a later save reads the new state.
- Integrity conflicts stay distinct from other failures; a non-integrity host rejection reaches the caller and the compatibility route's `details` with a readable message; the compatibility save route keeps its success and error response semantics.
- Tail/before return the same index semantics for character and group chats, and a stale cursor fails explicitly.
- `chat_history_mode` in old settings is ignored by serde as an unknown field and is not preserved on reserialization.
