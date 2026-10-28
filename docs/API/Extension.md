# `window.__TAURITAVERN__.api.extension.store` — API reference

The **global** persistence layer TauriTavern offers third-party extensions, in two data forms: KV JSON and Blob.

Data lives under `data_root/_tauritavern/extension-store/`, so it is backed up, migrated and cleared together with the data root.

## 0. Quick start

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const store = window.__TAURITAVERN__.api.extension.store;
```

### KV JSON storage

```js
await store.setJson({ namespace: 'my-ext', key: 'settings', value: { enabled: true } });
const settings = await store.getJson({ namespace: 'my-ext', key: 'settings' });

const maybeSettings = await store.tryGetJson({ namespace: 'my-ext', key: 'settings' });
if (!maybeSettings.found) {
  // Use in-code defaults; write only when the user changes settings.
}
```

### Multiple JSON tables (extra `json` / `table`)

> When `table` is not supplied, the primary table `main` is used by default.

```js
await store.setJson({
  namespace: 'my-ext',
  table: 'index',
  key: 'v1',
  value: { lastId: 42 },
});

const tables = await store.listTables({ namespace: 'my-ext' });
```

### Blob storage

```js
await store.setBlob({
  namespace: 'my-ext',
  key: 'icon.png',
  data: myBlob, // Blob | ArrayBuffer | Uint8Array | base64 string
});

const blob = await store.getBlob({ namespace: 'my-ext', key: 'icon.png' });
```

For large files, `getBlobStream()` reads chunk by chunk; cancel the stream if you stop early:

```js
const stream = await store.getBlobStream({ namespace: 'my-ext', key: 'archive.bin' });
await stream.pipeTo(destination); // destination is the caller's WritableStream
```

## 1. KV JSON methods

Every KV method accepts an optional `table` field:

- Omitted: the primary table `main` is used.
- Provided: data is written to that table.

### When should you use KV JSON?

Use KV JSON for the vast majority of cases, and treat it as the extension's structured data store:

- Extension settings (settings / feature flags)
- Indexes, maps and progress snapshots (index / map / progress)
- Cases where you want `updateJson()` to deep-merge an object

| Method | Returns | Notes |
| --- | --- | --- |
| `getJson({ namespace, key, table? })` | `Promise<any>` | Reads a JSON value |
| `tryGetJson({ namespace, key, table? })` | `Promise<{ found: boolean; value?: any }>` | Optional read; returns `{ found: false }` when the key does not exist, and still throws on other errors |
| `setJson({ namespace, key, value, table? })` | `Promise<void>` | Writes a JSON value (overwrites) |
| `updateJson({ namespace, key, value, table? })` | `Promise<void>` | Merge update: objects are deep-merged, while non-objects are replaced |
| `renameKey({ namespace, key, newKey, table? })` | `Promise<void>` | Renames a key |
| `deleteJson({ namespace, key, table? })` | `Promise<void>` | Deletes a key |
| `listKeys({ namespace, table? })` | `Promise<string[]>` | Lists every key in the table |
| `listTables({ namespace })` | `Promise<string[]>` | Lists the existing tables (the union of KV and Blob) |
| `deleteTable({ namespace, table })` | `Promise<void>` | Deletes a table, including its KV and Blob data |

Compatibility: `updateJSON()` is an alias for `updateJson()`, and `updateKey()` is an alias for `renameKey()`.

## 2. Blob methods

### When should you use Blob?

For large files, and only when you actually need one:

- Binary data such as images, audio, archives and model files
- Content large enough that you would rather not spend CPU formatting it as JSON (a large plain-text cache, for example)
- Cases where the data is fed straight to a Web API (the return value is a `Blob`, so `URL.createObjectURL()` works)

| Method | Returns | Notes |
| --- | --- | --- |
| `getBlob({ namespace, key, table? })` | `Promise<Blob>` | Reads a blob (the mimeType is guessed from the key's file extension) |
| `getBlobStream({ namespace, key, table? })` | `Promise<ReadableStream<Uint8Array>>` | Reads raw bytes at the consumer's pace; cancelling closes the reader |
| `setBlob({ namespace, key, data, table? })` | `Promise<void>` | Writes a blob; empty content is allowed |
| `deleteBlob({ namespace, key, table? })` | `Promise<void>` | Deletes a blob |
| `listBlobKeys({ namespace, table? })` | `Promise<string[]>` | Lists every blob key in the table |

## 3. Naming rules (namespace / table / key)

- Only these characters are allowed: `[A-Za-z0-9_.-]`
- Must not be empty
- Must not start with `.`
- `.` and `..` are not allowed

## 4. Semantics of `table` (multiple tables)

`table` is a **logical grouping**: it keeps different data domains of the same extension apart, and lets you clear a whole group in one call (`deleteTable`).

In the current implementation:

- **Every `(namespace, table, key)` is its own file.**
- `KV JSON`: `.../kv/<table>/<key>.json`
- `Blob`: `.../blobs/<table>/<key>` (the file name is used verbatim; no extension is enforced)

Examples (using `my-ext`):

- `setJson({ namespace: 'my-ext', key: 'settings', value })`
  - Stored at `data_root/_tauritavern/extension-store/my-ext/kv/main/settings.json`
- `setJson({ namespace: 'my-ext', table: 'index', key: 'v1', value })`
  - Stored at `data_root/_tauritavern/extension-store/my-ext/kv/index/v1.json`
- `setBlob({ namespace: 'my-ext', key: 'icon.png', data })`
  - Stored at `data_root/_tauritavern/extension-store/my-ext/blobs/main/icon.png`

A small all-in-one state can use a fixed key; data that keeps growing should be split across keys and read on demand.

## 5. Read/write boundaries

- A write persists a snapshot taken at call time and publishes it by atomically replacing a single file; a failure never exposes partial content, and durability across power loss is not promised. Wait for the writes you need confirmed before reloading the page.
- Concurrent modifications take effect in publication order; the read, merge and publish of `updateJson()` form a single atomic update. A delete does not cancel an in-flight write, and there are no cross-key transactions.
- A read that has already opened keeps the original file version and is unaffected by later overwrites or deletes.
- `getJson()` and `getBlob()` return the whole value, and JSON writes and base64 input still cost memory for the entire payload. For large binaries, prefer Blob writes and `getBlobStream()` reads.
