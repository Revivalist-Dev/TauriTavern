# `window.__TAURITAVERN__.api.mcp` — MCP Manager API

This document describes the MCP Manager host ABI as shipped, together with the consumption contracts for Agent and Legacy generation. MCP is a standalone platform capability: it provides registration, a persistent tool catalog, model-facing tool description overrides, explicit refresh and a first-party Manager test call, and both Agent and Legacy generation consume the cached tools.

Status: the Manager, Agent and Legacy generation integrations are implemented. This is a Project Contract (experimental).

The first-party management UI lives in the built-in MCP extension in the Extensions drawer. That extension is only a React/strict TSX presentation of `api.mcp`; TauriTavern Settings no longer offers a parallel entry point.

## 1. Entry point

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const mcp = window.__TAURITAVERN__.api.mcp;
```

## 2. API

```ts
type TauriTavernMcpApi = {
  servers: {
    list(): Promise<{ servers: McpServer[]; storageIssues: McpStorageIssue[] }>;
    create(input: {
      displayName: string;
      endpoint: string;
      headers?: Record<string, string>;
      protocolVersion?: McpProtocolVersion;
    }): Promise<McpServer>;
    update(input: {
      registrationId: string;
      displayName: string;
      endpoint: string;
      headers: Record<string, string>;
      protocolVersion: McpProtocolVersion;
    }): Promise<McpServer>;
    setState(input: { registrationId: string; state: 'active' | 'paused' }): Promise<McpServer>;
    remove(input: string | { registrationId: string }): Promise<void>;
    discover(input: string | { registrationId: string }): Promise<McpDiscoveryResult>;
    refresh(input: string | { registrationId: string }): Promise<McpDiscoveryResult>;
  };
  tools: {
    setPermission(input: {
      registrationId: string;
      nativeName: string;
      permission: 'off' | 'ask' | 'allow';
    }): Promise<McpServer>;
    setDescriptionOverride(input: {
      registrationId: string;
      nativeName: string;
      override: ToolDescriptionOverride | null;
    }): Promise<McpServer>;
    testCall(input: {
      registrationId: string;
      nativeName: string;
      argumentsJson: string;
    }, options?: { signal?: AbortSignal }): Promise<McpTestCallOutcome>;
  };
};
```

There is no `connect`, `disconnect` or `connected`. Only cold discovery, explicit refresh and test calls create a short-lived RMCP client; a memory or disk catalog hit does not connect to the server. `active` means the registration's snapshot may be read and, when needed, discovery or a user test call may be sent to its endpoint.

## 3. DTO

```ts
type McpServer = {
  id: string;                    // canonical lowercase UUID
  displayName: string;
  endpoint: string;              // normalized HTTP(S) URL
  headers: Record<string, string>;
  protocolVersion: McpProtocolVersion;
  state: 'active' | 'paused';
  toolPermissions: Record<string, 'ask' | 'allow'>;
  toolDescriptionOverrides: Record<string, ToolDescriptionOverride>;
};

type ToolDescriptionOverride = {
  description?: string;
  properties?: Record<string, string>;
};

type McpProtocolVersion =
  | 'auto'
  | '2026-07-28'
  | '2025-11-25'
  | '2025-06-18'
  | '2025-03-26';

type McpDiscoveryResult = {
  registrationId: string;
  protocolVersion: string;
  serverName?: string;
  serverVersion?: string;
  tools: Array<{
    id: string;                  // mcp/<registration-uuid>:<native-name>
    nativeName: string;
    title?: string;
    description?: string;
    inputSchema: object;
    outputSchema?: object;
    annotations: object;         // untrusted hints only
    permission: 'off' | 'ask' | 'allow';
  }>;
  diagnostics: Array<{
    code: string;
    nativeName?: string;
    message: string;
  }>;
  staleTools: Array<{
    nativeName: string;
    permission: 'ask' | 'allow';
  }>;
};

type McpTestCallOutcome =
  | {
      outcome: 'known_response';
      response:
        | {
            kind: 'tool_result';
            isError: boolean;
            textBlocks: Array<{ index: number; text: string }>;
            structuredJson?: string;
            diagnostics: Array<{ code: string; message: string; contentIndex?: number }>;
          }
        | { kind: 'server_error'; code: number; message: string; dataJson?: string }
        | { kind: 'unsupported_response'; responseType: string; message: string };
    }
  | { outcome: 'not_sent'; code: string; message: string }
  | { outcome: 'outcome_unknown'; code: string; message: string };
```

`storageIssues` explicitly reports read failures that have been pinned to a specific file, along with corruption, an unknown schema or kind, a non-canonical file name, or an ID inside the file that does not match. Healthy registrations are still returned. If the registration directory itself cannot be enumerated, `list()` still rejects.

## 4. Registration contract

- `create()` always creates a `paused` registration; the Manager shows and confirms the exact endpoint before switching it to Active.
- On first load the Manager adds a paused Exa Search recommendation once through the existing `create()` contract; the handled flag is kept in the extension store. Deleting that ordinary registration does not clear the flag, so it is not restored automatically within the same data root.
- `update()` changes the display name, endpoint, custom request headers and protocol version atomically, without affecting the UUID, ToolId, Active/Paused state or saved permissions. A real change to endpoint, headers or protocol deletes that registration's memory and disk catalog; renaming alone neither clears the catalog nor touches the network.
- Header names and values are stored verbatim. A registration keeps no reserved-header list and no count or size limit; configuration the HTTP transport cannot accept (an invalid header, or the RMCP-reserved `Accept`, `Mcp-Session-Id` and `Last-Event-Id`) returns `not_sent` before sending. Endpoint credentials and header values are stored in plaintext in the registration file, handed back by `servers.list()` to the editor in the same WebView, and travel with any backup that includes that data root.
- The protocol version defaults to `auto`. A pinned `2026-07-28` uses the `server/discover` lifecycle only and does not fall back to legacy; a pinned 2025 version initializes directly at that version without a discover probe. If the version the server finally negotiates falls outside that preference's accepted range, the connection is treated as a startup failure. The available options match what the Streamable HTTP transport actually supports.
- `off` is the default and is not written to `toolPermissions`; `setPermission(..., 'off')` deletes the corresponding persisted setting.
- `setDescriptionOverride()` stores model-facing description and property-description overrides by native name; strings are stored verbatim, with no trimming or rewriting. `override: null` is the only deletion semantics, and an empty object is rejected explicitly. The values neither write to nor rewrite the discovery catalog, and they do not change the ToolId, schema structure, permission or execution target.
- Model description precedence is fixed: server catalog → registration override → Agent profile `tools.toolDescriptions`. Legacy consumes the first two layers; an Agent profile overrides the registration value when the same field is present.
- Ask/Allow settings for tools that have disappeared from discovery come back as `staleTools`, but those tools never become available.
- A registration is stored as a strict v1 single-file record at `_tauritavern/mcp/registrations/<uuid>.json`, and the persistent catalog as a separate strict v1 record at `_tauritavern/mcp/catalogs/<uuid>.json`. Neither has a legacy schema reader or a revision graph.
- The Manager's Add dialog accepts manual input and JSON. JSON accepts exactly one Streamable HTTP server per import and supports both `{ "name": { "url": "...", "headers": {...}, "protocolVersion": "auto" } }` and the standard `mcpServers` wrapper. The Edit dialog for a saved server reuses the same manual form to edit the name, endpoint, headers and protocol version. Invalid JSON, multiple servers, non-string headers, an unknown protocol version or an unsupported transport are rejected as a whole; there is no partial import.

## 5. Discovery contract

- The only supported transport is Streamable HTTP. No OAuth flow is implemented; authentication can be supplied through registration custom headers.
- Registration headers apply to every HTTP request for initialize, discovery, session and tool calls; the system does not copy or rebuild authentication state across consumption paths.
- An endpoint accepts any HTTP(S) URL that carries a host, including public HTTP, userinfo and a query; the Manager warns about unencrypted HTTP before activation. A fragment never reaches the HTTP request, so it is still reported explicitly as an invalid endpoint. Redirects remain forbidden by the transport.
- `protocolVersion: 'auto'` uses RMCP `ClientLifecycleMode::Auto` and starts `server/discover` at `2026-07-28`. `-32022` version negotiation is handled by RMCP; when a server rejects with another non-modern JSON-RPC error, or with a 4xx response that carries no session (other than 401/403), RMCP falls back to a `2025-11-25` initialize on the same transport. RMCP currently treats a JSON-RPC error inside a startup SSE response as a closed connection, so when an Auto startup fails with `ConnectionClosed`, the adapter makes one `2025-11-25` initialize attempt with a new peer, keeping both failure reasons in the error; that extra path matches no other error. For pinned values see section 4. If the version negotiated after startup falls outside the accepted range, this discovery fails.
- `tools/list` must page to completion; a cursor loop, exceeding the page, tool or total catalog limit, or a paging failure fails that server's discovery without returning a partial catalog.
- A duplicate native name quarantines the whole group sharing that name; an invalid input schema, a single tool over the limit, or an invalid name quarantines only that tool and returns a diagnostic. An invalid optional output schema drops only that field and returns a diagnostic, without preventing use of the tool.
- Input and output schemas are compiled and validated against JSON Schema 2020-12; remote `$ref` is never fetched.
- Annotations are shown verbatim and grant no permission.
- `servers.discover()` reads in the order application memory, persistent file, then a real discovery. A disk snapshot is bound to the registration UUID and the normalized endpoint, and application canonical validation runs again after it is loaded.
- `servers.refresh()` always uses a new RMCP peer and bypasses the memory and disk snapshots. A cold discovery or refresh is published only after complete paging and all validation succeed; if writing to disk fails it returns a usable memory-only catalog with an `mcp.catalog_persistence_failed` diagnostic and keeps the old disk snapshot. A network or validation failure still rejects; the old snapshot is kept but is not returned for that request.
- Permissions and `staleTools` are projected from the current registration every time and are not written into the catalog snapshot. The paused gate runs before the snapshot lookup; deleting a registration is not affected by a failure to clean up the derived catalog, and such a failure only logs a warning.
- The catalog survives application restarts and only a user-initiated refresh decides when it updates; there is no TTL, background refresh, list-changed subscription, automatic retry, source or age field, or migration reader. Corruption, an unknown schema, a UUID or endpoint mismatch is reported explicitly, and a refresh can bypass and repair it.

## 6. User test call contract

`tools.testCall()` is an explicit user action of the first-party Manager, not a general raw RPC for arbitrary extensions:

- The frontend submits only the registration ID, the native tool name and the raw `argumentsJson`; the endpoint, headers and RMCP session are all determined by the backend registration and transport.
- The server must be Active. Off/Ask/Allow does not block a user test call, and the call does not modify the saved permission.
- `argumentsJson` is capped at 256 KiB and the backend authoritatively parses it as a JSON object; it does not fill defaults from the input schema, convert types, drop fields or run business validation before the server. The string host boundary together with Rust's `serde_json` parsing preserves JavaScript-unsafe integers in the `i64/u64` range.
- Each click sends exactly one `tools/call`, with no automatic retry. When `2026-07-28` is negotiated it pages `tools/list` on the same peer until it finds the target tool, purely so that RMCP can generate the SEP-2243 `Mcp-Param-*` headers (RMCP takes the tool schema only from a `tools/list` response on the same transport and silently omits those headers when it is missing); it walks the whole catalog only when the target never appears. That listing does not become the application catalog cache and does not change the call arguments.
- It uses a low-level request handle with a single response and never drives `input_required`, Tasks or other MRTR follow-up rounds automatically; such server responses are shown explicitly as `unsupported_response`.
- `AbortSignal` means stop waiting locally; it cannot undo remote side effects. Before the call, the host establishes the fact of cancellation with a private start acknowledgement to avoid a cancel-before-register race; that command is not part of the public API.

The top-level outcome states a remote fact rather than a UI loading state:

- `known_response`: the server responded definitively. `isError: true` is still a tool result, and a JSON-RPC error becomes `server_error`; neither turns into a command rejection.
- `not_sent`: the backend can prove the target `tools/call` never reached the transport, because the registration could not be read at that moment, was paused, the JSON was invalid, the HTTP client or header configuration failed, the negotiated version was outside the accepted range, metadata hydration failed, or the call was cancelled before sending.
- `outcome_unknown`: a cancel, timeout, disconnect or unconfirmable response occurred after the request handle had been established; the call may already have run, and the system never retries automatically.

A known tool result projects text, deterministic structured JSON, `isError` and diagnostics in their original order. The Manager test call and Legacy chat do not display images; image, audio and resource blocks and metadata produce visible diagnostics, and never erase the fact that the server responded. Text and structured data are projected verbatim and are not truncated; when a server explicitly returns `structuredContent: null`, `structuredJson` is `"null"` (`2026-07-28` allows any JSON value), and the field is omitted when absent. The adapter sets no response body limit of its own; when the transport cannot read or parse the response to a call it has already sent (including a response over the RMCP per-event SSE limit), the outcome is `outcome_unknown`. A client close or join failure after a known response is only logged and never rewrites the outcome.

This entry point follows the current WebView trust model: first-party and vendor extension scripts in the same WebView are treated as code the user authorized, and the backend does not claim to prove that a command came from a physical click or to isolate a hostile extension. If the trust model changes, add a real command capability boundary rather than faking a click flag in the DTO.

## 7. Agent consumption contract

Agent adds no public raw-call API. Profile v3 selects tools by `mcp/<registration-uuid>:<native-name>`; every root, return-mode child and handoff invocation reads the memory-then-disk persistent snapshot through `McpService`, and never triggers an implicit cold discovery just because an agent started. When there is no snapshot, or a tool is not in the cache, that tool is omitted from the invocation and a diagnostic is left behind; only after a user runs discovery or refresh in the Manager does the next invocation observe the new catalog.

Only tools that are Active, whose permission is Ask or Allow, and whose input schema root is explicitly `type: "object"` can enter an Agent binding. The shared resolver first applies the registration description override to a copy of the catalog descriptor, then the Agent invocation applies the profile's `tools.toolDescriptions`, so the profile wins. As requested, no Ask approval UI is implemented: Ask and Allow both run automatically; Off and paused tools are filtered before advertising, and the registration is re-read to confirm before the actual send. Arguments must be a JSON object within 256 KiB, and the host does not rewrite them to fit the schema. Aliases are generated from the Agent snapshot and are not part of the Manager DTO or the MCP identity.

A known result becomes an `AgentToolResult`: text stays verbatim, structured content is presented with duplicates removed, and image blocks enter the Agent's shared [result handling](../Agent/ToolSystem.md#how-results-enter-the-next-round). Audio and resources produce visible diagnostics, and metadata stays in the internal record. Long results also go through the shared result handling, without changing the shared `McpService` call contract. `outcome_unknown` terminates the current Agent run, with no automatic retry and no fabricated tool result.

## 8. Legacy consumption contract

The Legacy integration does not extend the public `api.mcp` above. Legacy uses first-party internal commands to fetch Active + Ask/Allow cached descriptors from `McpService` and executes them through a permission-aware call use case; third parties still have no public raw MCP executor.

- Catalog preparation reads the memory and disk snapshots only, and a cache miss does not touch the network; a snapshot read or validation failure for one registration produces a diagnostic and does not block healthy MCP or local tools, or ordinary generation.
- The registration description override is applied in the shared resolver, and a Legacy root freezes the overridden descriptor; later Manager edits affect only the next root.
- Each actual Legacy root generation freezes its descriptors; recursive tool rounds reuse the descriptor snapshot but reassign aliases and rebuild provider schemas from the current local view on every round. Execution resolves only the current round's binding; MCP does not enter the global ToolManager, slash commands or extension enumeration.
- A local alias wins; after the settings hook, only the original MCP alias that is still unique is accepted. An alias that was deleted, renamed, duplicated or lost its binding is never guessed back to a canonical ToolId by name or schema.
- `custom_include_body` / `custom_exclude_body` remain the user's final intent for the upstream body; Legacy MCP does not protect, reject or re-inject `tools` / `tool_choice`.
- A call submits only the canonical ToolId, the `argumentsJson` serialized by ToolManager and an independent UUID `executionCallId`, with no input-schema coercion. The provider `tool_call_id` is used only to associate chat messages. Before sending, registration Active state, Off and cancellation are re-checked; Ask and Allow both run automatically today.
- A known error and an ordinary NotSent go into the existing error Tool message so that the model can correct itself on the next round. `outcome_unknown` does not retry, does not fabricate a result, does not partially commit the tool turn, and terminates the current root or group generation.
- Saving, events and recursion continue to use SillyTavern Legacy's first-class tool-turn contract; the old `extra.tool_invocations` is read-only and is never written again.

## 9. Explicitly unsupported

The following APIs and behaviors do not exist today:

- Ask approval, a public raw-call API, and interactive recovery from a Legacy unknown outcome;
- OAuth, credentials, stdio, and 2024 HTTP+SSE;
- Resources, Prompts, Tasks, Apps, and subscriptions/list-changed;
- Background discovery, a general retry for discovery or list, and catalog TTL or revision history;
- A description scope hierarchy beyond registration and profile, and Manager-defined or global model aliases.

A model alias belongs to a short-lived Agent or Legacy invocation binding, not to registration, discovery or test calls. The Legacy integration does not register MCP tools into the global SillyTavern `ToolManager`.
