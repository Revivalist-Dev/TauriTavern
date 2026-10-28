# Embedded runtime maintenance guide

The Embedded Runtime (ER) manages the iframe pages in static chats by visibility and resource budget, and currently supports JS-Slash-Runner (JSR) and LittleWhiteBox (LWB). While `chat_virtualization_enabled` is on, chat pages are managed by the [ChatSurface participant](../API/ChatSurface.md) instead.

## Configuration and activation

The configuration item is `tauritavern-settings.embedded_runtime_profile`:

| Value | Behavior |
| --- | --- |
| `off` | ER off; the extension manages the iframes |
| `auto` | `compat` on the desktop host, `mobile-safe` on the mobile host |
| `compat` | Uses the looser residency budget |
| `mobile-safe` | Uses the smaller residency budget and widens the preload range around the viewport |

The budget parameters are defined in [embedded-runtime-profiles.js](../../src/tauri/main/services/embedded-runtime/embedded-runtime-profiles.js): the number of slots, the number of iframes, the weight ceiling, and the soft-parking capacity and retention time.

At startup the bootstrap reads the `tt:embeddedRuntimeProfile` mirror in `localStorage`; once the service is ready it reads the real configuration, creates the manager, and installs the chat adapter on `APP_READY`.

## Runtime flow

### Discovery and sync

The wrapper an extension generates is the slot's `host`: JSR uses `.TH-render` and LWB uses `.xiaobaix-iframe-wrapper`. The adapter derives a stable `slotId` from the message id, the source signature, and the block index.

Chat events and the DOM observer are responsible for discovering render blocks. A slot is registered on first discovery; when the iframe of an existing slot is replaced, or its `src`/`srcdoc` changes, `manager.invalidate(id)` is called, the current source is refreshed with `refresh()`, and scheduling is arranged.

When the user clicks a paused placeholder, `manager.touch(id)` raises that slot's interaction priority. Ordinary source updates only sync resources and leave the priority alone.

### Scheduling and placeholders

The manager picks resident pages from visibility, priority, and budget. `isResident()` reports actual residency, and `canHydrate()` says whether recovery is currently possible. `appliedState` records the scheduling result applied last, where `cold` means a first application or one that has to be reapplied.

While a source is not ready or its read failed, the existing page stays resident and counts against the budget. Pages that have been removed join the contest for a slot once they are eligible for recovery. The manager reclaims the losing pages first, then hands out the remaining capacity against actual residency.

| Situation | Page behavior |
| --- | --- |
| Over budget | `.tt-runtime-placeholder` keeps the height and supports click-to-restore |
| Outside the visible range | `.tt-runtime-ghost` keeps the height |
| Page removed and source unavailable | The current block shows a prompt to reopen the chat |

`hydrate()` and `dehydrate()` perform DOM work synchronously. The soft-parking pool holds reusable iframe elements per profile; `dispose()` releases the elements, source caches, and URLs that slot holds.

### Source and cold recovery

A Blob page starts reading its original source when it is registered. The read settles as `pending`, `ready`, or `failed`; on completion `onSourceSettled` invalidates the current slot, and the manager then schedules recovery or reclamation.

Recovery reuses the original renderer element and its load listener; the slot owns its Blob URL and reuses it within the same source. That URL is released when the source is replaced or the slot is destroyed, and the old source's read result stops being valid with it.

Cold recovery reloads the current page. The cache holds the top-level source, while dependent resources stay under the renderer's control. Recovery touches only the current slot and sends no `MESSAGE_UPDATED`, and other pages of the same floor are not rebuilt with it.

After upstream removes an iframe, the chat adapter inspects the wrapper. If JSR's source block or collapse button is still hidden, the adapter restores the matching source UI and arranges a local recovery; otherwise it unregisters the slot.

## Code entry points

| What is maintained | Entry point |
| --- | --- |
| Startup wiring | [install.js](../../src/tauri/main/services/embedded-runtime/install.js) |
| Configuration reads and the startup mirror | [embedded-runtime-profile-state.js](../../src/tauri/main/services/embedded-runtime/embedded-runtime-profile-state.js) |
| Chat events, DOM changes, and click handling | [chat-embedded-runtime-adapter.js](../../src/tauri/main/adapters/embedded-runtime/chat-embedded-runtime-adapter.js) |
| Renderer detection and registration | [JSR adapter](../../src/tauri/main/adapters/embedded-runtime/js-slash-runner-runtime-adapter.js), [LWB adapter](../../src/tauri/main/adapters/embedded-runtime/littlewhitebox-runtime-adapter.js) |
| Budget and scheduling | [embedded-runtime-manager.js](../../src/tauri/main/services/embedded-runtime/embedded-runtime-manager.js) |
| Source, recovery, and reclamation | [managed-iframe-slot.js](../../src/tauri/main/adapters/embedded-runtime/managed-iframe-slot.js) |
| Soft-parking pool | [managed-iframe-parking-lot.js](../../src/tauri/main/adapters/embedded-runtime/managed-iframe-parking-lot.js) |
| Slot interface definitions | [types.js](../../src/tauri/main/services/embedded-runtime/types.js) |

Message HTML writes go through `replaceMesTextHtmlWithRuntimePolicy()` in [mes-text-write.js](../../src/scripts/tauri/message/mes-text-write.js), and the wrapper reuse it involves is handled by [message-render-transaction.js](../../src/tauri/main/adapters/embedded-runtime/message-render-transaction.js). The source mask shown while a chat opens is managed by [frontend-source-handoff.js](../../src/tauri/main/adapters/chat-surface/frontend-source-handoff.js).

## Debugging and verification

With ER enabled, residency and scheduling counters can be inspected from the console:

```js
globalThis.__TAURITAVERN_EMBEDDED_RUNTIME__.getPerfSnapshot();
```

`Ctrl+Alt+P` opens the performance HUD, whose `Runtime:` line reads the same snapshot. To locate a single render block, look at `data-tt-runtime-slot-id` on the host.

From the repository root, `pnpm run test:contracts` runs the frontend contract tests and `pnpm run check` runs the full check.

For browser acceptance testing, start a local server from the same directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open the [cold recovery acceptance page](http://127.0.0.1:8000/tests/browser/embedded-runtime-recovery.html); every item should read `PASS`. The page uses a real browser to check cold recovery for JSR and LWB, and whether a healthy page's Document, form values, and load count stay unchanged while not-ready or failed candidates compete for budget.
