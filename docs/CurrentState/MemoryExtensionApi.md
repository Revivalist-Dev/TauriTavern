# Memory-extension API (current state)

This document records the current state of TauriTavern's memory, database, and retrieval extension APIs.

TauriTavern follows SillyTavern's full-history contract: `getContext().chat` is the complete, ordered message array of the current chat, and an array subscript is a 0-based absolute message index. The enhanced API does not replace that contract; it hands bounded reads, location, search, and extension state persistence to the Rust backend.

## 1. Single entry point

The public ABI deliberately has one entry point and offers no alias:

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const api = window.__TAURITAVERN__.api.chat;
```

## 2. Current chat and identity

- `api.chat.current.ref()`: a reference to the current chat.
- `api.chat.current.handle()`: a handle for the current chat.
- `api.chat.current.windowInfo()`: keeps the six-field Promise ABI; `mode` is fixed to `'off'`, `windowStartIndex` is fixed to `0`, and `windowLength === totalCount === chat.length`.
- `handle.stableId()`: a persistent, stable chat identity.
- `handle.summary({ includeMetadata? })`: a summary obtained without reading the message bodies.

## 3. Bounded history reads

- `handle.history.tail({ limit })`
- `handle.history.before(page, { limit })`
- `handle.history.beforePages(page, { limit, pages })`

Each call returns only the page asked for, which suits background batch work and keeps an extension from making a second full array. None of them changes the frontend `chat[]` or the DOM.

A pagination cursor carries a file signature; once another write has changed the chat, an old cursor fails explicitly and the caller should start again from `tail()`.

## 4. Backend location and search

- `handle.locate.findLastMessage({ role?, hasTopLevelKeys?, hasExtraKeys?, scanLimit? })`
- `handle.searchMessages({ query, limit?, filters? })`

`filters` accepts:

- `role?: 'user' | 'assistant' | 'system'`
- `startIndex?: number`
- `endIndex?: number`
- `scanLimit?: number`

Search today is lightweight text recall and introduces no vector store or fully resident index. A CJK or space-less query is expanded into bigram tokens; an extension should use `scanLimit` to set its performance bound.

## 5. Built-in Summarize

TauriTavern keeps the three sources of the SillyTavern Summarize extension: the Main API, external Extras, and WebLLM. A new configuration defaults to the Main API, which TauriTavern already supports; a source that has been saved explicitly keeps its value. Extras remains an external service the user configures, and the host does not fake a same-origin `/api/summarize` module.

A summary is still written to `message.extra.memory` under upstream logic and injected through the original extension prompt; when the request completes only the current chat identity is checked, so the result cannot land in another chat.

For the design and boundaries of hybrid chat recall see `docs/CurrentState/VectorApi.md`.

## 6. Per-chat extension state

Small state is written into a namespace in the header:

- `handle.metadata.get()`
- `handle.metadata.setExtension({ namespace, value })`

Large state uses a separate KV JSON store:

- `handle.store.getJson({ namespace, key })`
- `handle.store.setJson({ namespace, key, value })`
- `handle.store.updateJson({ namespace, key, value })`
- `handle.store.renameKey({ namespace, key, newKey })`
- `handle.store.deleteJson({ namespace, key })`
- `handle.store.listKeys({ namespace })`

A change to a message itself should still be saved through `await getContext().saveChat()`; do not import `script.js` internals, and do not write JSONL directly.

## 7. Constraints for continued development

- Keep `getContext().chat` complete and ordered; do not change the data contract for a memory optimization.
- A DOM optimization may happen in the rendering layer only.
- History pagination stays explicit and read-only, taking no part in current chat state or generation.
- API errors propagate directly, with no silent fallback.
- Add no public alias, and do not stuff large extension state into message bodies.

## 8. Related documentation

- API reference: `docs/API/Chat.md`
- Migration guide: `docs/API/Migration.md`
- Chat payload: `docs/CurrentState/ChatPayload.md`
