# `window.__TAURITAVERN__.api.worldInfo` — API reference

TauriTavern's normalized World Info API for character card authors, World Info tooling and related extensions.

> Design goal: expose only the three genuinely stable platform capabilities — the last activation result, live subscription and navigation — and never turn upstream's internal scan-loop state directly into a public contract.

## 0. Quick start

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const worldInfo = window.__TAURITAVERN__.api.worldInfo;
```

## 1. Data structures

### `WorldInfoEntryRef`

```ts
type WorldInfoEntryRef = {
  world: string;
  uid: string | number;
};
```

### `WorldInfoActivationEntry`

```ts
type WorldInfoActivationEntry = {
  world: string;
  uid: string | number;
  displayName: string;
  constant: boolean;
  position?:
    | 'before'
    | 'after'
    | 'an_top'
    | 'an_bottom'
    | 'depth'
    | 'em_top'
    | 'em_bottom'
    | 'outlet';
};
```

### `WorldInfoActivationBatch`

```ts
type WorldInfoActivationBatch = {
  timestampMs: number;
  trigger: string;
  entries: WorldInfoActivationEntry[];
};
```

## 2. `getLastActivation()`

```js
const last = await worldInfo.getLastActivation();
if (last) {
  console.table(last.entries);
}
```

### Return value

- `Promise<WorldInfoActivationBatch | null>`
- `null` means only that the current session has not yet captured any final activation result.

### Semantics

- It returns the final result of the most recent real generation pass.
- It does not return intermediate state from the scan.

## 3. `subscribeActivations(handler)`

```js
const unsubscribe = await worldInfo.subscribeActivations((batch) => {
  console.log('Activated entries:', batch.entries.map((entry) => entry.displayName));
});
```

### Return value

- `Promise<unsubscribe>`

### Semantics

- Only final activation batches are pushed.
- Past results are not replayed.
- If a UI needs to show the latest result while initializing, it should call `getLastActivation()` first.

## 4. `openEntry(ref)`

```js
const result = await worldInfo.openEntry({
  world: 'My Lorebook',
  uid: 42,
});

if (!result.opened) {
  console.warn('World info entry not found');
}
```

### Return value

```ts
Promise<{ opened: boolean }>
```

### Semantics

- `opened: true`
  - The host opened the target lorebook and attempted to locate the entry.
- `opened: false`
  - The target lorebook or the target entry does not exist.
- Other errors are thrown directly.
  - This is deliberate, so problems surface promptly during development.

## 5. v1 scope boundaries

- `api.worldInfo` does not expose the raw `WORLD_INFO_ACTIVATED` or `WORLDINFO_SCAN_DONE` payloads.
- It promises only the stable display fields of an activated entry:
  - `world`
  - `uid`
  - `displayName`
  - `constant`
  - `position?`
- Scan budgets, recursion control and intermediate state objects are not promoted to the Public Contract.
- `openEntry()` must reuse the navigation capability of the upstream World Info module itself; the host ABI layer does not promise anything about DOM structure directly.
