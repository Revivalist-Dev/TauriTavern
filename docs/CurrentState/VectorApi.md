# Current contract of the Vector compatibility layer

This document records the native compatibility boundary TauriTavern provides for the SillyTavern
Vector extension.

## 1. Observable contract

The same-origin compatibility layer implements these `POST` routes:

- `/api/vector/list`
- `/api/vector/insert`
- `/api/vector/delete`
- `/api/vector/query`
- `/api/vector/query-multi`
- `/api/vector/purge`
- `/api/vector/purge-all`

Frontend requests funnel through `src/tauri/main/routes/vector-routes.js` into one typed Tauri command;
the presentation layer only passes DTOs along, while input validation, provider selection, and secrets
are all orchestrated by `VectorService`.

## 2. Boundary and storage

```text
same-origin route
  -> vector_handle
  -> VectorService
     -> VectorRepository             -> tt-adapter-vector / redb
     -> LocalEmbeddingRepository     -> tt-adapter-vector / Candle
     -> RemoteEmbeddingRepository    -> tt-adapter-provider-http
```

The index lives at `default-user/vectors/tauritavern-v1.redb`. Model caches live under
`_cache/embedding-models/`; purge deletes only index records and does not re-download models. The
database and the models are both loaded lazily, and an initialization failure fails only the current
Vector request without affecting application startup.

Each scope is determined jointly by the collection, the source, the model, and the endpoint/account
settings that change the embedding space. An insert first completes embedding for the whole batch, the
count/dimension/finite-value/non-zero validation, and L2 normalization, then commits the metadata and
`f32` bytes in a single redb write transaction. A retry with the same hash/index/text is an idempotent
upsert; delete still follows upstream hash semantics and removes every chunk.

File indexing treats a whole file as one `/insert` work unit. `VectorService` may batch its provider
requests internally, but it commits the index only after every embedding has succeeded, so a
recoverable mid-way failure does not leave behind the state where a hash exists but the content is
actually incomplete.

## 3. Retrieval baseline

Retrieval currently uses an exact cosine scan over normalized vectors and returns results in
descending score order. `query-multi` computes the query embedding once, then applies a global
threshold and top-K across collections. `hashes` and `metadata` always come from the same
post-threshold result set, which avoids the array misalignment in the upstream implementation.

Alongside the dense query, the chat generation interceptor calls the existing text retrieval in
`window.__TAURITAVERN__.api.chat` in parallel. Each path takes at most `insert * 4` candidates (bounded
by the backend's 1000-entry cap), and the lexical path scans at most the 1000 most recent messages.
After deduplication by hash, Reciprocal Rank Fusion merges the rankings and the top `insert` entries
are taken. Duplicate message chunks do not add ranking weight twice for the same path, and a message
matched by both dense and lexical retrieval moves up on its own. A text retrieval failure only falls
this round back to the dense results and leaves a console warning; it does not abort generation.

The final messages are formatted and injected in the original chat order rather than reordered by
similarity, which would reorder the narrative. The lexical query uses absolute `endIndex` values to
exclude `protect` ranges, and the final mapping excludes them once more across the dense and the
lexical results together. This hybrid path applies to chat only; Data Bank, files, and World Info keep
using the existing dense query.

This is a deliberate 60/95 baseline: chat and file collections are normally far smaller than the scale
that warrants an ANN lifecycle. ANN replaces the scan behind `VectorRepository` only when a real
profile shows collection-scan latency is unacceptable. GraphRAG, knowledge-graph extraction, rerankers,
and background indexing jobs are outside the SillyTavern Vector compatibility layer.

## 4. Embedding source

- `transformers`: uses `Qwen/Qwen3-Embedding-0.6B` locally, downloading it to `_cache/embedding-models/`
  on first use and caching it; queries carry the retrieval instruction, documents stay as written, and
  this model is the default when no `model` is supplied.
- `webllm`: reuses the frontend's precomputed mapping.
- `koboldcpp`: compatible with `/api/backends/kobold/embed`, and carries the actual embedding model the
  server reports into the Vector scope, so swapping models behind one endpoint does not mix vector
  spaces.
- OpenAI-compatible, Cohere, Nomic, Google AI Studio, Vertex AI, Extras, Ollama, llama.cpp, and vLLM:
  sent by the provider HTTP adapter using each one's own protocol.

Remote sources read the active secret before the call. An unknown source, missing credentials, an
invalid URL, or a mismatch in provider count or dimension fails explicitly, without creating an index
or writing part of one.

As upstream does, the Vector compatibility layer does not distinguish interactive from batch requests,
and it adds no generation-time or embedding-specific timeout; a call waits for local inference or the
remote request to finish and propagates errors normally.

The local model id, the quantisation/runtime version, the maximum token length, and the prompt version
together make up the Vector profile. The repository loads lazily and reuses the Qwen tokenizer and the
mmap'd weights.
