# Bootstrap optimization (current state)

This page records the implementation snapshot of the **already landed** bootstrap / startup optimizations that are most closely tied to the "cold-start memory baseline".

> For the full staged startup chain (Shell/Core/Full/APP_READY), see: `docs/CurrentState/StartupOptimization.md`.

## TokenCache (Chat Completions) avoids a cold-start whole-load

### Problem being solved

The historical implementation read the entire `tokenCache` object (the whole database) from IndexedDB into JS memory inside `initTokenizers()`, which inflated the resident set of a mobile cold start.

### Current implementation (contract)

- **Storage partitioning**: the whole-database key `tokenCache` is no longer used; the cache is persisted per chat as `tokenCache:${chatId}`.
- **Nothing loaded at startup**: `loadTokenCache()` only performs legacy key cleanup (deleting `tokenCache`) and no longer reads the whole-database object.
- **Only the current bucket stays resident**: memory holds nothing but "one bucket for the current chat" (`tokenCacheState`); switching chats resets to the new bucket and lazily loads it on demand.
- **Consistent event semantics**:
  - `CHAT_CHANGED`: preloads the current chat bucket (the lazy-load trigger)
  - `CHAT_DELETED` / `GROUP_CHAT_DELETED`: deletes the corresponding `tokenCache:${chatId}` so the disk copy does not pile up
- **Write-back policy**: `saveTokenCache()` flushes only the current chat bucket (written back when dirty) and no longer writes the whole database back.

### Compatibility boundaries

- The cache is a performance optimization and does not affect the correctness of token counting; after an upgrade the legacy whole-database cache is cleaned up, so caches go cold again for a while (an acceptable tradeoff).

### Key code locations

- `src/scripts/tokenizers.js`: `loadTokenCache()` / `saveTokenCache()` / `resetTokenCache()` / `tokenCacheState` / event wiring in `initTokenizers()`

---

## ItemizedPrompts (Prompt Inspector) avoids a whole-load on chat open

### Problem being solved

The historical implementation ran `loadItemizedPrompts(getCurrentChatId())` when a chat was opened, loading the entire `chatId -> itemizedPrompts[]` array from IndexedDB in one go.

Each record in that array carries a large number of long strings (`rawPrompt/finalPrompt/worldInfo/...`); the array is usually far larger than the chat body itself, which significantly inflated the resident set of the mobile WebView renderer.

### Current implementation (contract)

- **Storage shape (Index + Record)**:
  - Index: `tt_prompts_index:${chatId}` → `Array<{ mesId, recordId }>`
  - Record: `tt_prompts_record:${chatId}:${recordId}` → one prompt artifact (the original record in full)
- **Opening a chat loads only the index**: `loadItemizedPrompts(chatId)` restores just the `mesId -> recordId` mapping and loads no record at all.
- **Records load on click**: after `.mes_prompt` is clicked, `promptItemize()` lazily loads the matching record by `mesId` (plus, optionally, the previous record for the diff) and renders the Inspector.
- **The generation path no longer keeps records resident**: when generation finishes it writes the record and updates the index, and no longer `push`es the record into a global array that stays resident.
- **Message-edit semantics preserved**:
  - `swapItemizedPrompts()`: swaps only the `mesId` mapping in the index
  - `deleteItemizedPromptForMessage()`: shifts the subsequent `mesId` values the way upstream does, and deletes the record of the removed message
- **Deletion and cleanup fully covered**:
  - Deleting a chat cleans up the index and the records (no residue left on disk)
  - `clearPrompts` empties the whole instance

### Compatibility boundaries

- The `localforage` instance name `SillyTavern_Prompts` is still reused, so the assumption upstream and the ecosystem make about the storage instance name holds.
- The legacy format (`chatId -> array`) is migrated to Index + Records, and the old key deleted, the first time that chat is entered and no index exists (a one-time cost; later opens no longer whole-load).

### Key code locations

- `src/scripts/itemized-prompts.js`: index/record keys, loading and migration, Inspector lazy loading, swap/delete semantics
- `src/script.js`: generation write, button visibility (index presence)
