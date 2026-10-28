# Database API

`window.__TAURITAVERN__.api.db` provides local vectors, JSON, graph relations, text indexes and TQL on top of TriviumDB 0.8.8.

```js
await window.__TAURITAVERN__.ready;
const db = await window.__TAURITAVERN__.api.db.open('my-extension', {
    dim: 2,
    syncMode: 'full',
});
const id = await db.insert([1, 0], { text: 'Alice knows the password' });
await db.indexText(id, 'Alice knows the password');
await db.indexKeyword(id, 'Alice');
await db.buildTextIndex();
const hits = await db.search([1, 0], { queryText: 'Alice', topK: 5 });
```

For the full types, see [db-types.d.ts](../../src/tauri/main/api/db-types.d.ts). Data belongs to the current data root, and namespaces are physically isolated from one another; extensions in the same WebView still share the host trust boundary.

## Opening and lifecycle

`open(namespace, options?) -> Promise<DatabaseHandle>` waits until the database is genuinely usable and rejects on failure. A namespace is 1-128 characters drawn from lowercase ASCII letters, digits, `-` and `_`. Each namespace uses one database instance.

| Option | Default on first open | Meaning |
| --- | --- | --- |
| dim | 1536 for a new database | When omitted on an existing database, the actual dimension is read; when supplied explicitly it must match |
| storageMode | mmap | mmap or rom; interpreted by the native storage implementation |
| syncMode | normal | normal, full or off; follows the native WAL sync semantics |
| loadTextIndex | true | Text index preload preference; see below |
| autoBuildQuiver | true | Native automatic index building |
| memoryLimitMb | 0 | Native memory budget, where 0 means no budget; this is not an RSS ceiling for the whole process |

When a database of the same name is already open, unsupplied options reuse that instance's configuration; explicitly supplying a different dimension, storage or sync mode, memory budget or auto-build option reports a conflict, and the caller can close and reopen. Preloading happens only on an actual open; an instance that is already open is never reloaded.

The handle's `namespace`, `dim` and `options` are the effective configuration snapshot for that open. 0.8.8 writes the in-memory text index back on flush, so when a text sidecar already exists the host always loads it to avoid overwriting existing content; even when `loadTextIndex: false` is passed, the effective configuration returned is still true.

`db.close()` closes the shared namespace and affects every handle for it. A failed close keeps the instance alive and permits a retry. Operations after closing report that the database is not open; after a new `open`, the namespace can be used again. `api.db.listNamespaces()` lists only the namespaces currently open.

The application attempts a flush when it moves to the background and waits for a flush before a normal exit. When the exit flow keeps the application alive because some other save failed, the database remains usable. If a mobile system force-kills the process, these callbacks are not guaranteed to run.

## Nodes, graphs and text

NodeId is a JS `number` in every interface, used as a non-negative safe integer (no greater than `Number.MAX_SAFE_INTEGER`, 9,007,199,254,740,991). A returned ID can be used directly for CRUD, graph operations and TQL parameters. The payload is plain JSON and the host does not rewrite its fields.

| Method | Result / semantics |
| --- | --- |
| insert(vector, payload?) | New NodeId |
| batchInsert(vectors, payloads) | An array of NodeIds; the lengths must match and the whole batch commits atomically |
| upsert(id, vector, payload?) | Inserts or overwrites at the given ID |
| get(id) | `{ id, vector, payload, edges }` or null |
| updatePayload(id, payload) | Replaces the payload |
| patchPayload(id, patch) | Native `$set`, `$inc`, `$unset` and other patch semantics |
| updateVector(id, vector) | Updates the vector |
| delete(id) | Deletes the node |
| link(src, dst, label='related', weight=1) | Creates or updates a relation |
| unlink(src, dst) | Removes the edge between that pair of nodes |
| shortestPath(source, target, options?) | An array of NodeIds, or null; `options` are maxDepth and label |
| subgraph(id, options?) | nodes, edges; `options` are maxDepth, labels and direction |
| indexText(id, text) | Adds content to the native text index |
| indexKeyword(id, keyword) | Adds content to the native keyword index |
| buildTextIndex() | Compiles the text index and performs one flush |

`direction` is outgoing, incoming or both. Edge fields are targetId, label, weight and metadata; subgraph edges additionally carry sourceId.

**Persistence boundary of the text index:** in 0.8.8, manual text and keyword index writes do not enter the WAL, and the native engine treats a failure to save the text sidecar as a recoverable index error. Callers should keep the source text needed to rebuild the index in the payload or in their own durable data, and call buildTextIndex after building indexes in bulk. A normal write to disk and a reopen preserve the index, but syncMode=full does not turn manual index operations into WAL transactions. Nodes, vectors, payloads and relations continue to use native transactions and the WAL. The host keeps no second index log.

## Retrieval

- `search(vector=null, options={}) -> Hit[]`: text recall is enabled by default when queryText is supplied. `filter` is kept as a convenience alias for payloadFilter; when both are supplied, payloadFilter wins.
- `searchBatch(vectors, options={}) -> Hit[][]`: hands a batch of vectors to native batch retrieval; `parallelism` is a native parallel setting, where 0 uses the native default.
- `searchAdvanced(vector=null, config={}) -> { hits, context }`: the advanced pipeline is on by default and returns timingsMs, stageCounts and observations. Individual stages remain governed by their own switches.

A Hit is `{ id, score, payload }`. topK defaults to 5; other search fields start from native defaults and only the values the caller supplies explicitly are overridden. Basic search has the advanced master switch off by default and advanced search has it on; either can be set explicitly through enableAdvancedPipeline. queryText is passed to the engine separately.

SearchOptions retains recallK, rerankK, expandDepth, expandLabels, maxEdgesPerNode, minEdgeWeight, edgeDirection, minScore, teleportAlpha, enableSparseResidual, fistaLambda, fistaThreshold, enableDpp, dppQualityWeight, enableRefractoryFatigue, enableInverseInhibition, lateralInhibitionThreshold, forceBruteForce, enableTextHybridSearch, textBoost, bm25K1, bm25B, payloadFilter and diffusionBias.

## TQL

```js
const result = await db.query('SEARCH VECTOR $vec TOP 5 RETURN *', { vec: [1, 0] });
const written = await db.query('CREATE ($payload)', { payload: { text: 'new memory' } });
const byId = await db.query('MATCH (n) WHERE n.id == $id RETURN n', { id });
```

`query(text, params={})` supports read and write statements together with whole-vector, scalar and JSON-literal parameters. The host expands parameters on the native lexer's whole-token boundaries, skipping strings and comments; the native parser decides whether a statement reads or writes. A `$name` inside a parameter is not expanded a second time, `$id` does not touch `$id2`, and document filter keys such as `$gte:` keep their meaning. A parameter that is actually referenced but missing reports an error; extra parameters do not affect execution.

Parameters are values and cannot stand in for keywords, field names or native filter operators. Where they may appear, and in which data structures, is still decided by TQL syntax; in 0.8.8, for example, CREATE property values do not accept arbitrary nested objects, so a complex JSON node can be written with insert/upsert directly.

Parameters use ordinary JSON values directly; numeric parameters stay numeric and string parameters stay strings. Integers use the JS safe-integer range and need no extra type wrapper.

The result is:

```ts
{ type: 'mutation', affected: number, createdIds: number[] }
// or
{ type: 'query', rows: Array<Record<string, QueryValue>> }
```

Each QueryValue has a type and a matching value: node, edge, integer, float, string, bool, path, list; null carries only a type. The value of an integer or float is a JS number, a list is a plain JSON array, and a node payload is plain JSON as well. Numbers keep the precision range of JS numbers.

## Maintenance, errors and data migration

- `flush()`: writes to disk explicitly.
- `compact()`: native compaction.
- `buildQuiverIndex()`: builds QuIVer explicitly.
- `stats()`: namespace, dim, nodeCount, estimatedMemoryBytes, graph.

Invalid input, not-open, conflict and genuine IO or recovery errors come back as Promise rejections. The caller can fix the configuration or the data and retry; the host does not retry writes automatically, and applies no cache, deduplication or delayed write-back to queries. Stopping a wait does not cancel an operation that has already entered native execution.

Data lives in `_tauritavern/databases/db-<namespace>/`. An archive import replaces whole namespaces and keeps the namespaces the backup does not contain.

Database operations pause during archive import and database sync. Receiving an import or a sync closes the instances, so once the task ends (including on failure or cancellation) the caller has to `open(namespace)` again.

For sync scope and overwrite policy, see [Sync](../CurrentState/Sync.md#the-triviumdb-database).
