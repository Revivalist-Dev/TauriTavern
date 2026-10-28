# `window.__TAURITAVERN__.api.dev` — API reference

The normalized debugging API TauriTavern offers developer tools, debug panels and extension authors.

> Design goal: let callers depend on a stable host ABI rather than on Tauri event names, Rust command names or the internals of a particular Settings panel.

## 0. Quick start

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const dev = window.__TAURITAVERN__.api.dev;
```

## 1. `frontendLogs`

```js
const entries = await dev.frontendLogs.list({ limit: 50 });

const unsubscribe = await dev.frontendLogs.subscribe((entry) => {
  console.log('[frontend]', entry.level, entry.message);
});
```

### Methods

| Method | Returns | Notes |
| --- | --- | --- |
| `list(options?)` | `Promise<FrontendLogEntry[]>` | Fetches the tail of the frontend logs captured so far |
| `subscribe(handler)` | `Promise<unsubscribe>` | Subscribes to new frontend log entries |
| `getConsoleCaptureEnabled()` | `Promise<boolean>` | Reads the console capture switch |
| `setConsoleCaptureEnabled(enabled)` | `Promise<void>` | Sets the console capture switch |

### `FrontendLogEntry`

```ts
type FrontendLogEntry = {
  id: number;
  timestampMs: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  target?: string;
};
```

### Semantics

- The host manages the frontend log capture switch as a whole.
- Callers should no longer read or write the related `localStorage` key themselves.
- `unsubscribe` is safe to call repeatedly.
- Once the page begins unloading (a `pagehide` that is not a bfcache restore), the host stops capturing logs, and subscribers are not called while the page is being destroyed.
- So that DEBUG and INFO noise cannot crowd out critical warnings, the host retains entries per level: 400 `debug`, 300 `info`, and 100 shared between `warn` and `error`.
- `message` is a **preview** for UI display: it may be truncated, and object arguments are summarized. For a full request or response body, use `llmApiLogs.getRaw()` or an exported log bundle.

## 2. `backendLogs`

```js
const recent = await dev.backendLogs.tail({ limit: 100 });

const unsubscribe = await dev.backendLogs.subscribe((entry) => {
  console.log('[backend]', entry.target, entry.message);
});
```

### Methods

| Method | Returns | Notes |
| --- | --- | --- |
| `tail(options?)` | `Promise<BackendLogEntry[]>` | Fetches the tail of the backend logs |
| `subscribe(handler)` | `Promise<unsubscribe>` | Subscribes to new backend log entries |

### `BackendLogEntry`

```ts
type BackendLogEntry = {
  id: number;
  timestampMs: number;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  target: string;
  message: string;
};
```

### Semantics

- The host owns the shared backend log stream.
- When several subscribers coexist, the host reference-counts the start and stop of the underlying stream, so subscribers must not interfere with one another.
- `message` may be truncated for performance; for a full investigation rely on the file logs or an exported bundle.

## 3. `llmApiLogs`

```js
const index = await dev.llmApiLogs.index({ limit: 20 });
const preview = await dev.llmApiLogs.getPreview(index[0].id);
const raw = await dev.llmApiLogs.getRaw(index[0].id);
```

### Methods

| Method | Returns | Notes |
| --- | --- | --- |
| `index(options?)` | `Promise<LlmApiLogIndexEntry[]>` | Fetches the index of recent requests |
| `getPreview(id)` | `Promise<LlmApiLogPreview>` | Fetches a preview suited to UI display |
| `getRaw(id)` | `Promise<LlmApiLogRaw>` | Fetches the complete raw request and response |
| `subscribeIndex(handler)` | `Promise<unsubscribe>` | Subscribes to new index entries |
| `getKeep()` | `Promise<number>` | Reads the retention count |
| `setKeep(value)` | `Promise<void>` | Sets the retention count |

### `LlmApiLogIndexEntry`

```ts
type LlmApiLogIndexEntry = {
  id: number;
  timestampMs: number;
  level: 'INFO' | 'WARN' | 'ERROR';
  ok: boolean;
  source: string;
  model: string | null;
  endpoint: string;
  durationMs: number;
  stream: boolean;
};
```

### `LlmApiLogPreview`

```ts
type LlmApiLogPreview = {
  id: number;
  timestampMs: number;
  level: 'INFO' | 'WARN' | 'ERROR';
  ok: boolean;
  source: string;
  model: string | null;
  endpoint: string;
  durationMs: number;
  stream: boolean;
  errorMessage: string | null;
  requestReadable: string;
  responseReadable: string;
  responseRawKind: 'json' | 'sse' | null;
};
```

### `LlmApiLogRaw`

```ts
type LlmApiLogRaw = {
  id: number;
  requestRaw: string;
  responseRaw: string;
  responseRawKind: 'json' | 'sse' | null;
};
```

### Semantics

- `getPreview()` and `getRaw()` read the matching log file from disk, loading it on demand rather than keeping it in memory.
- `requestReadable` and `responseReadable` are not truncated by default for developer debugging (very large content may slow the UI when opened); the full content is also available through `getRaw()` or an exported bundle.
- They show the visible or summarized reasoning a provider returns, such as `[reasoning]`, `[thinking]` and `[thought]` blocks; provider-private continuation such as `signature`, `thoughtSignature` and `encrypted_content` appears only as a `native_state=present` marker and is not expanded as interpretable text.

## 4. `exportBundle()`

```js
const delivered = await dev.exportBundle();
```

### Methods

| Method | Returns | Notes |
| --- | --- | --- |
| `exportBundle()` | `Promise<boolean>` | Builds and delivers a debug bundle (zip); returns `false` when cancelled and throws on failure |

### Semantics

- The user picks the location in the system save panel; see [file transfer](../CurrentState/FileTransfer.md).
- The export contains the backend file logs, a frontend log snapshot, LLM API logs (including raw bodies), and settings and version information.
- The exported file may contain sensitive information such as prompts and response bodies; check it yourself before sharing.

## 5. Boundaries and stability

- `tauritavern-backend-log`
- `tauritavern-llm-api-log`
- `devlog_*`

These event names and command names are all host implementation details, not a Public Contract for third-party extensions. Extensions should depend on `api.dev` only.
