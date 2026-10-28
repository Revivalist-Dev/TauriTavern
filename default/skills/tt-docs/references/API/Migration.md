# Porting a SillyTavern extension to TauriTavern

This guide takes an existing SillyTavern extension and gets it running on TauriTavern quickly, **unlocking capabilities SillyTavern does not have**.

> **The good news:** most of the port is replacing the hand-rolled logic that found messages, searched messages and stored data with a single API call. The code usually ends up shorter and clearer.

## Quick reference

First, check whether your code contains any of these patterns. If it does, TauriTavern has a better native replacement:

| What you did before | Problem | TauriTavern replacement |
| --- | --- | --- |
| `chat.slice().reverse().find(...)` | Copies and walks a long array by hand | ✅ `handle.locate.findLastMessage()` |
| Hand-written keyword `filter/includes` | Not CJK-friendly, no relevance ranking | ✅ `handle.searchMessages()` |
| Stuffing data into the message body + `saveChat()` | Bloats the payload, couples data to messages | ✅ `handle.store.setJson()` |
| Hacking values into `chat_metadata` | Limited capacity, unclear semantics | ✅ `handle.metadata.setExtension()` |
| Reading `context.chat.length` repeatedly | Accurate, but the backend is better when you need a stable handle or summary | `windowInfo().totalCount` or `handle.summary()` |
| Copying `context.chat.slice(-N)` for background tasks | Copies extra references to message objects | ✅ `handle.history.tail({ limit: N })` |

## Background: full history and enhanced queries

Like SillyTavern, TauriTavern guarantees that **`getContext().chat` contains the complete, ordered message history of the current chat**. Upstream extensions that rely on the full array and absolute indexes therefore need no compatibility branch for a partial data window.

The enhanced APIs (`findLastMessage`, `searchMessages`, `history.*`) are not a workaround for an incomplete array; they are optional, efficient backend capabilities. They suit bounded scans, CJK retrieval, paged work, and cases where you want to avoid building a second large array inside the extension.

One more thing that trips people up:

- If your extension **modifies chat messages themselves** and wants the change persisted (cleanup, redaction, bulk replacement), call `await getContext().saveChat()`. That goes through the host's unified save queue.
- Do not import or call `saveChat()` directly from `script.js`. That is an internal implementation detail, and it bypasses the public context boundary and its call semantics.

## Step 1: initialize the API

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const api = window.__TAURITAVERN__.api.chat;
const handle = api.current.handle();
```

> 💡 **Work on both:** test for `window.__TAURITAVERN__` to detect the runtime, so the same extension runs on both SillyTavern and TauriTavern.

## Step 2: replace "find the last message"

This is the most common porting scenario; almost every memory or database extension does it.

**Before**:
```js
const hit = context.chat.slice().reverse().find(
  msg => msg.extra?.MyExtData
);
```

**After**:
```js
const hit = await handle.locate.findLastMessage({
  role: 'assistant',
  hasExtraKeys: ['MyExtData'],
  scanLimit: 2000,
});
// hit = { index, message } or null
```

The Rust backend handles it, and even ten thousand messages come back in milliseconds.

## Step 3: replace keyword search

**Before**:
```js
const results = context.chat.filter(msg =>
  msg.mes.includes('keyword')
);
```

**After**:
```js
const hits = await handle.searchMessages({
  query: 'keyword or Chinese phrase',
  limit: 20,
  filters: { role: 'assistant', scanLimit: 5000 },
});
```

Built-in CJK optimization, automatic segmentation, relevance scoring and snippet excerpts.

## Step 4: migrate data persistence

This is the most exciting improvement. SillyTavern **never provided** a standard way for extensions to persist data.

### Large data → `store.*`

**Before** (the usual hack):
```js
// Stuff the data into the last message...
lastMsg.extra.myData = hugeJsonObject;
saveChat(); // bloats the chat file
```

**After**:
```js
await handle.store.setJson({
  namespace: 'my-ext',
  key: 'index',
  value: hugeJsonObject,
});
```

Separate storage, with no effect on the size of the chat file.

### Small configuration → `metadata.*`

```js
await handle.metadata.setExtension({
  namespace: 'my-ext',
  value: { lastProcessedFloor: 42, enabled: true },
});
```

Stored in `chat_metadata.extensions[namespace]`, with clear semantics.

## Step 5: index semantics

If your extension persists progress such as how far through the message list it has processed, use **absolute indexes**:

```js
const info = await api.current.windowInfo();
const total = info.totalCount;       // total number of messages
const absIndex = info.windowStartIndex + chatIndex;  // currently always equals chatIndex
```

> ⚠️ Persist 0-based absolute message indexes; the JSONL header does not count toward the index.

## Step 6 (optional): walking the history

If you really do need to walk historical messages, read them in pages:

```js
let page = await handle.history.tail({ limit: 100 });
while (page.hasMoreBefore) {
  for (const msg of page.messages) { /* process the message */ }
  page = await handle.history.before(page, { limit: 100 });
}
```

On mobile, fetch in batches to reduce IPC calls:

```js
const pages = await handle.history.beforePages(page, { limit: 200, pages: 5 });
```

## Mobile performance tips

TauriTavern runs on desktop and mobile. A few simple rules keep your extension smooth on low-end devices:

- ✅ Use `findLastMessage` / `searchMessages` instead of iterating on the JS side
- ✅ Store large data in `store.*`, not in the message body
- ✅ Always set `scanLimit` to avoid a full scan
- ✅ Use `beforePages()` for batched paging to cut IPC round trips
