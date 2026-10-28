# `window.__TAURITAVERN__.api.chat` — API reference

The enhanced API TauriTavern offers developers of memory, database and retrieval extensions.

> **Core idea:** turn the most common grunt work in SillyTavern extension development — finding messages, searching content, storing data — into a single API call. The Rust backend does the heavy lifting; the JS side just calls the interface.

## 0. Quick start

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const api = window.__TAURITAVERN__.api.chat;
const handle = api.current.handle();
```

> TauriTavern follows SillyTavern's full-history contract: `getContext().chat` is the complete, ordered message array of the current chat. The enhanced APIs below are meant for bounded reads, lookups, retrieval and independent state persistence in the Rust backend, so an extension does not have to reimplement a heavy rescan or copy large data.

## 1. Core entry points

When [on-demand history paging](../CurrentState/ChatPayload.md#21-on-demand-loading-while-scrolling-history) is enabled, historical candidate slots in `getContext().chat` may be null; the backend read APIs on this page still return complete content.

| Method | Returns | Notes |
| --- | --- | --- |
| `api.chat.open(ref)` | `ChatHandle` | Opens the given chat |
| `api.chat.current.ref()` | `ChatRef` | A reference to the current chat |
| `api.chat.current.handle()` | `ChatHandle` | An operation handle for the current chat |
| `api.chat.current.windowInfo()` | `Promise<WindowInfo>` | Compatibility state for the current full history |

**`ChatRef` type**:

- Character chat: `{ kind: 'character', characterId, fileName }`
- Group chat: `{ kind: 'group', chatId }`

**`WindowInfo` type**:

| Field | Meaning |
| --- | --- |
| `mode` | Always `'off'` |
| `chatKind` | `'character' \| 'group'` |
| `chatRef` | The current `ChatRef` |
| `totalCount` | Total message count of the chat (excluding the header) |
| `windowStartIndex` | Always `0` |
| `windowLength` | Full message count, identical to `totalCount` |

`windowInfo()` keeps its Promise and its field shape to hold the public ABI stable; it triggers no backend summary query, and it does not correspond to any configurable load mode. A message array index is the absolute index:

```js
const info = await api.current.windowInfo();
const absIndex = info.windowStartIndex + chatIndex; // identical to chatIndex
```

## 2. ChatHandle capabilities

Get a `ChatHandle` from `api.open(ref)` or `api.current.handle()`.

---

### `locate.findLastMessage()` — pinpoint a message without walking the array

> 💡 **The pain point:** finding the last message that contains particular data usually means walking the array by hand with `chat.slice().reverse().find(...)`. A backend lookup can bound the scan and spares the extension from copying and scanning a long array again.

```js
const hit = await handle.locate.findLastMessage({
  role: 'assistant',                              // optional: restrict the role
  hasExtraKeys: ['TavernDB_ACU_IsolatedData'],     // optional: extra keys the message must have
  scanLimit: 2000,                                 // optional: how many messages to scan at most
});
```

**Returns**:
- Hit: `{ index, message }` — the absolute index plus the original message object
- Miss: `null`

The Rust backend does all of it efficiently; even 10,000 messages are no trouble.

---

### `searchMessages()` — built-in full-text search

> 💡 **The pain point:** SillyTavern has no built-in message search API, so extension developers hand-write `filter/includes` scans, and CJK content does not match properly at all.

```js
const hits = await handle.searchMessages({
  query: 'so what are we eating',
  limit: 20,
  filters: {
    role: 'assistant',          // optional: restrict the role
    startIndex: 100,            // optional: start index
    endIndex: 5000,             // optional: end index
    scanLimit: 5000,            // optional: maximum number of messages to scan backwards from the end
  },
});
```

**Returns `SearchHit[]`**:

| Field | Meaning |
| --- | --- |
| `index` | Absolute index (0-based) |
| `score` | Relevance score (0-1, higher is a better match) |
| `snippet` | A short excerpt ready to display in a UI |
| `role` | `'user' \| 'assistant' \| 'system' \| 'tool'` |
| `text` | Full `mes` text of the matching message |

**Technical notes**:
- Fragment-hit scoring plus TopK recall (not vector search; lightweight and fast)
- Automatic bigram segmentation for CJK and space-free text, which greatly improves match rates for Chinese, Japanese and Korean
- In a query made only of punctuation or symbols, each contiguous run is matched as a literal substring of the original character sequence; a mixed query keeps the existing tokenized scoring semantics
- `scanLimit` caps the cost, which keeps it mobile-friendly

---

### `store.*` — extension data persistence

> 💡 **The pain point:** SillyTavern **never provided** a way for extensions to persist data. Developers either stuff data into the message body (bloating the payload and coupling data to messages) or hack it into `chat_metadata` (limited capacity, unclear semantics).

TauriTavern provides a separate KV JSON store for each chat:

```js
// write
await handle.store.setJson({ namespace: 'my-ext', key: 'index', value: largeData });

// read
const data = await handle.store.getJson({ namespace: 'my-ext', key: 'index' });

// update (objects are deep-merged; non-objects are replaced)
await handle.store.updateJson({
  namespace: 'my-ext',
  key: 'index',
  value: { lastFloor: 42, updatedAt: Date.now() },
});

// rename a key
await handle.store.renameKey({
  namespace: 'my-ext',
  key: 'index',
  newKey: 'index-v2',
});

// list every key
const keys = await handle.store.listKeys({ namespace: 'my-ext' });

// delete
await handle.store.deleteJson({ namespace: 'my-ext', key: 'old-key' });
```

Compatibility: `updateJSON()` is an alias for `updateJson()`, and `updateKey()` is an alias for `renameKey()`.

**When to use it:** large JSON data such as tables, indexes and database snapshots. The data is fully decoupled from messages and does not bloat the chat file.

---

### `metadata.*` — lightweight config storage

Suited to small state such as progress, configuration values and short summaries:

```js
// read chat metadata
const meta = await handle.metadata.get();

// write extension config
await handle.metadata.setExtension({ namespace: 'my-ext', value: { lastFloor: 42 } });

// delete (set value to null)
await handle.metadata.setExtension({ namespace: 'my-ext', value: null });
```

Data lives in `chat_metadata.extensions[namespace]` and migrates with the chat file. Each call modifies only the given namespace and does not merge into the live metadata of the current page automatically.

---

### `summary()` / `stableId()`

```js
// get a chat summary without loading the full message list
const summary = await handle.summary({ includeMetadata: true });

// get a stable ID you can persist
const id = await handle.stableId();
```

By default `summary()` returns only a lightweight summary. `includeMetadata: true` returns the full metadata, and the read cost grows with the size of the returned data.

---

### `history.*` — paged reads on demand

Use these when an extension wants to process history in bounded pages and avoid building another full array:

```js
let page = await handle.history.tail({ limit: 100 });
while (page.hasMoreBefore) {
  // page.messages: ChatMessage[]
  // page.startIndex: absolute index of the first message on this page
  page = await handle.history.before(page, { limit: 100 });
}
```

| Method | Notes |
| --- | --- |
| `history.tail({ limit })` | Fetches the newest N messages |
| `history.before(page, { limit })` | Pages back one page |
| `history.beforePages(page, { limit, pages })` | Pulls several pages at once (fewer IPC round trips; recommended on mobile) |

The return value carries `startIndex` (the absolute 0-based index of the first message on the page) and `hasMoreBefore` (whether older messages remain).
