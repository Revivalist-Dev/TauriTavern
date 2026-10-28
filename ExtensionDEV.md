# TauriTavern Extension Development Guide

This document is for **SillyTavern extension developers**. It covers the dedicated APIs TauriTavern provides, so your extensions can be more capable and more elegant.

> **In one sentence**: TauriTavern gives extensions `findLastMessage()` for precise lookup, `searchMessages()` for full-text search, and `store.*` for state persistence. SillyTavern never shipped any of these, so developers kept building them by hand.

---

## Why adapt?

Inside SillyTavern, extension developers have long lived with these pain points:

| Pain point | Traditional approach | TauriTavern approach |
| --- | --- | --- |
| **Find the last message of a given kind** | Walk the chat by hand with `chat.slice().reverse().find(...)` | ✅ `findLastMessage()` in one line; the backend locates it efficiently |
| **Search message history** | Hand-rolled keyword scans; CJK word splitting left to luck | ✅ `searchMessages()` with built-in full-text search, tuned for CJK |
| **Persist extension data** | Push it into the message body and call `saveChat()` by hand; data coupled to messages | ✅ `store.*` as standalone KV storage, clean and reliable |
| **Save small config or progress** | Assorted hacks writing into `chat_metadata` | ✅ `metadata.*` as a standardized interface with clear semantics |

**TauriTavern makes building extensions simpler.**

---

## About windowed chat

TauriTavern loads a **windowed payload**: the frontend keeps only the most recent N messages in memory instead of loading the whole chat at once. Long conversations and mobile run better this way, and the consequence is that `getContext().chat` only reflects the messages inside the current window.

You do **not** need to care about the details underneath. `findLastMessage()`, `searchMessages()`, `history.*` and the other APIs listed above already handle window boundaries transparently, because the backend scans the full history. Call the API and leave the rest to Rust.

---

## 1. Getting started

### 1.1 Extension directories

TauriTavern's third-party extension directories are compatible with SillyTavern:

- local: `data/default-user/extensions/<folder>`
- global: `data/extensions/third-party/<folder>`
- when both exist, **local wins**

Asset endpoint: `/scripts/extensions/third-party/<folder>/<path>`

> More detail: [ThirdPartyExtensions.md](docs/CurrentState/ThirdPartyExtensions.md)

### 1.2 Wait for the host to be ready

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const api = window.__TAURITAVERN__.api.chat;
```

TauriTavern exposes `window.__TAURITAVERN__` at the host layer. Wait on `ready` and every API is available.

### 1.3 Detect whether you are running inside TauriTavern

```js
if (window.__TAURITAVERN__) {
  // TauriTavern environment: the enhanced APIs are available
} else {
  // Standard SillyTavern environment: keep the original code path
}
```

That is all it takes for an extension to run **on both sides**.

---

## 2. Core capabilities at a glance

The single entry point for TauriTavern's dedicated APIs:

```
window.__TAURITAVERN__.api.chat
```

### `findLastMessage()` — stop walking the chat by hand

Finding the last message that carried particular extension data used to look like this:

```js
// ❌ The old way
const hit = context.chat.slice().reverse().find(
  msg => msg.extra?.TavernDB_ACU_IsolatedData
);
```

Now it looks like this:

```js
// ✅ TauriTavern
const hit = await handle.locate.findLastMessage({
  role: 'assistant',
  hasExtraKeys: ['TavernDB_ACU_IsolatedData'],
  scanLimit: 2000,
});
// hit = { index, message }, or null
```

Rust does the work in the backend: fast, efficient and accurate.

### `searchMessages()` — built-in full-text search, no hand-written scanning

Searching chat history for a keyword used to mean your own `filter/includes`, and for CJK users it was an ordeal.

Now:

```js
// ✅ TauriTavern
const hits = await handle.searchMessages({
  query: 'good morning',
  limit: 20,
  filters: { role: 'assistant' },
});
// hits = [{ index, score, snippet, role, text }, ...]
```

- Built-in CJK bigram tokenization
- Filtering by role and index range
- `scanLimit` bounds the cost

### `store.*` — real persistence for extension data

This is something **SillyTavern never implemented**. The old "standard practice" was to push data into the message body:

```js
// ❌ The old way: push the data into the last message
lastMsg.extra.myExtensionData = hugeJsonObject;
saveChat(); // bloats the payload and invites trouble
```

Now you have standalone per-chat KV storage:

```js
// ✅ TauriTavern
await handle.store.setJson({ namespace: 'my-ext', key: 'index', value: data });
const data = await handle.store.getJson({ namespace: 'my-ext', key: 'index' });
const keys = await handle.store.listKeys({ namespace: 'my-ext' });
await handle.store.deleteJson({ namespace: 'my-ext', key: 'old-key' });
```

Data is fully decoupled from messages: clean, reliable, and it does not inflate the payload.

### `metadata.*` — lightweight config storage

Suited to small state such as progress, config values and short summaries:

```js
await handle.metadata.setExtension({ namespace: 'my-ext', value: { lastFloor: 42 } });
const meta = await handle.metadata.get();
```

---

## 3. Full API reference

For detailed parameters and return values, see:

- 📖 **[API reference](docs/API/Chat.md)** — the complete interface documentation
- 🔄 **[Adaptation guide](docs/API/Migration.md)** — moving a SillyTavern extension across quickly

---

## 4. Performance advice for mobile

TauriTavern runs on desktop and on mobile (Android/iOS). The advice below keeps your extension smooth on mobile too:

- Leave searching and lookup to the backend APIs (`findLastMessage` / `searchMessages`) and avoid O(N) scans on the JS side.
- Persist large state with `store.setJson()` instead of pushing it into the message body; prefer `metadata.*` for small state.
- Use `scanLimit` to cap the scan range and protect performance on low-end devices.

---

## 5. Layout adaptation (Safe-Area / Viewport / IME)

If your extension contains UI such as a floating button, a full-screen panel, a popup or a same-origin iframe mini-app, integrate TauriTavern's Layout ABI:

- ✅ **Recommended (DX)**: use `/scripts/tauritavern/layout-kit.js` directly (less boilerplate, no string typos)
- ✅ **Hard ABI (stable long term)**: `data-tt-mobile-surface` + `--tt-inset-* / --tt-base-viewport-height / --tt-ime-bottom`
- ✅ **Stable API**: `window.__TAURITAVERN__.api.layout` (read and subscribe to safe-area, viewport and IME snapshots; layout-kit uses it internally as well)

### 5.1 A few lines: classify your UI as a surface

Full-screen panel:

```js
import { waitForHostReady, SURFACE, applySurface } from '/scripts/tauritavern/layout-kit.js';

await waitForHostReady();
applySurface(panelEl, SURFACE.FullscreenWindow);
applySurface(backdropEl, SURFACE.Backdrop);
```

Floating button / small window:

```js
applySurface(bubbleEl, SURFACE.FreeWindow);
```

Same-origin iframe (same-origin only is guaranteed):

```js
applySurface(iframe, SURFACE.ViewportHost);
iframe.src = '/scripts/extensions/third-party/my-ext/ui/index.html';
```

> Tip: the host's overlay classifier stays deliberately conservative to avoid a global subtree observer. Framework-style extensions should write `data-tt-mobile-surface` explicitly instead of relying on the host to guess their structure.

### 5.2 Subscribe to layout snapshots (for clamping, custom animation and similar)

```js
import { subscribeLayout } from '/scripts/tauritavern/layout-kit.js';

const unsubscribe = await subscribeLayout((snap) => {
  // snap.safeInsets / snap.safeFrame / snap.ime.keyboardOffset
});
```

Full reference:
- 📖 **[Layout API](docs/API/Layout.md)** — `api.layout` and the mobile surface contract
