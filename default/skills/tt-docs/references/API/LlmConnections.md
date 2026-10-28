# LLM Connection API

`api.llmConnections` manages the model connections that agents can reference. A connection stores the provider, endpoint, secret reference and routing, while the profile separately chooses the model ID.

## Entry point and methods

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const connections = window.__TAURITAVERN__.api.llmConnections;
```

| Method | Returns |
| --- | --- |
| `list()` | `{ connections }`, a list of connection summaries |
| `load(connectionId)` | `{ connection }`, or `null` if it does not exist |
| `save(connection)` | Resolves when the save completes |
| `delete(connectionId)` | Resolves when the delete completes |

`load` and `delete` also accept `{ connectionId }`, and `save` also accepts `{ connection }`.

## Connection contents

```ts
type LlmConnectionDefinition = {
  schemaVersion: 1;
  kind: 'tauritavern.llmConnection';
  id: string;
  displayName: string;
  description?: string;
  provider: {
    chatCompletionSource: string;
    customApiFormat?: string;
  };
  endpoint?: {
    baseUrl?: string;
    sourceSpecific?: Record<string, unknown>;
  };
  auth: {
    secretRef?: { key: string; id: string; labelSnapshot?: string };
  };
  routing?: {
    reverseProxy?: { url: string } | { preset: string };
  };
  adapterHints?: Record<string, string>;
  capabilities?: Record<string, string>;
};
```

`id` uses lowercase letters, digits, `-` or `_`, up to 128 characters. A direct connection references its secret through `auth.secretRef`; when a reverse proxy is used, `auth: {}` can be left as is.

`routing.reverseProxy.preset` references a reverse-proxy preset saved by the user. Resolving the connection reads that preset's URL and password, and preset updates apply to later resolutions; the model name is passed as the profile specifies it.

## Profiles and Model Targets

A profile uses `model.mode = "connectionRef"` and stores `connectionRef` and `modelId`. For the configuration itself, see [Profiles and presets](../Agent/ProfilesAndPreset.md).

Agent System materializes Connection Manager Model Targets as `model-target-<target.id>` connections and syncs them at startup, on target updates, on profile saves and on run start. Target configuration that cannot be represented reports an error and removes the corresponding old connection so that profile diagnostics can display it.

Connection sync updates the provider, endpoint, secret and adapter options. `modelId` belongs to the profile, so after changing a target's model name you must reselect it in the profile before the new value is used. Deleting a target keeps the connection that has already been materialized.

An invocation that has already been prepared keeps using its model request; connection updates apply to later resolutions. Exporting a standalone model binding strips local references, which have to be configured again after import.

## Implementation

- [llm_connection.rs](../../src-tauri/crates/tt-domain/src/models/llm_connection.rs): connection structures.
- [llm_connection_service.rs](../../src-tauri/crates/tt-application/src/services/llm_connection_service.rs): resolution and application of request fields.
- [model-target-llm-connection.js](../../src/scripts/tauritavern/agent/model-target-llm-connection.js): Model Target sync.
