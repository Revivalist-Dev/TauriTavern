# MCP (current state)

## What the current design solves

The MCP platform rests on stable registrations, strict persistence, explicit start/stop, read-only discovery, and permissions that are off by default. It provides the first-party Manager with model-facing tool description overrides and user test calls, and stores a complete, successful catalog as an application-owned persistent snapshot. The Rust Agent Runtime and Legacy generation both consume MCP tools from that same snapshot, and Legacy generation does not pollute the global ToolManager.

## End-to-end chain

```text
First-party MCP extension (React / strict TSX)
  -> window.__TAURITAVERN__.api.mcp
  -> presentation::mcp_commands
  -> tt-application::McpService
     -> McpServerRepository -> tt-adapter-storage-core
     -> McpGateway          -> tt-adapter-mcp -> shared HttpClientPool
  -> complete ToolCatalog / test-call outcome

Agent Profile v3
  -> AgentRuntimeService invocation preparation
  -> McpService memory/disk-only catalog + registration description override
  -> Agent Profile description override
  -> InvocationToolSnapshot / tool_request_gate
  -> McpService permission recheck
  -> McpGateway::call_tool
  -> Agent journal + tool-results (image files + result references) + next model turn

Legacy Generate root
  -> McpService memory/disk-only permitted catalog + registration description override
  -> private generation descriptors + per-round aliases
  -> existing provider hook / streaming and non-streaming parsers
  -> McpService permission recheck + cancellable call
  -> existing Assistant/Tool rows + TOOL_CALLS events + recursive Generate
```

Crate responsibilities:

- `tt-domain::models::tool` / `mcp`: the general `ToolDescriptionOverride`, registration UUID, endpoint, protocol version preference, Active/Paused, Off/Ask/Allow, and the domain constraints.
- `tt-ports::mcp` / `repositories::mcp_server_repository`: Tauri-free, RMCP-free outbound ports and the MCP call outcome.
- `tt-application::McpService`: intent CRUD, permissions, persistent catalog policy, discovery, the test-call Active/JSON gate, and the cached model-tool resolution plus pre-send permission/arguments gate shared by Agent and Legacy.
- `tt-adapter-storage-core`: strict v1 single-file storage for registrations and endpoint-bound catalog snapshots.
- `tt-adapter-mcp`: mapping the protocol version preference onto the RMCP lifecycle and validating the negotiated result, the one bounded legacy-initialize retry under `auto`, Streamable HTTP over RMCP's built-in reqwest backend, manual full pagination, discovery validation, and projection of a single `tools/call` result.
- `tt-adapter-http`: an MCP client profile with no redirects and no retries; for each discovery/call the MCP adapter takes the current proxy/TLS/UA configuration from the shared pool.
- `tauritavern`: composition, commands, and the Manager host ABI.

The management UI lives in `src/scripts/extensions/mcp-manager/`, is activated by SillyTavern's built-in extension loader, and appears in the Extensions drawer at the same level as Skill. React components consume only typed state and actions; waiting for the host ABI, parsing the MCP API, and every SillyTavern popup interaction stay in the extension's host adapter. The Add dialog supports manual header rows, a protocol version choice, and JSON input for a single server given either as a bare object or under `mcpServers`; both forms call the same create use case. The Edit dialog for a saved server reuses the manual connection form and can change the name, endpoint, headers, and protocol version. The tool description dialog edits only the top-level description and keeps property overrides; "Reset all customizations" removes the whole override through `override: null`. Test calls are consolidated into a test console dialog reached from a single toolbar entry: after choosing an active server it discovers automatically, then lets the user pick a tool, fill in a form built from the schema, and inspect that one result; there is no history, replay, or automatic retry. TauriTavern Settings no longer has a parallel entry point.

## Standing invariants

1. Canonical IDs follow the current tool contract: the provider is `mcp/<registration-uuid>` and the ToolId is `mcp/<registration-uuid>:<native-name>`.
2. The endpoint does not enter the ToolId; a user may edit the endpoint, and the registration UUID, ToolId, and permissions stay the same while the connection catalog is invalidated.
3. Discovery produces candidate descriptions only, never execution authority; a new tool is always Off.
4. Annotations are untrusted hints and cannot change a permission.
5. A new catalog is published only after full pagination and application canonical validation succeed; if the write to disk fails, it is explicitly marked memory-only with a visible diagnostic and no protocol partial is published, and another refresh failure does not pass an old snapshot off as this request's result.
6. A read or parse error located in a specific registration file is isolated as a storage issue, and a bad tool or duplicate is isolated to the smallest tool group; a failure that cannot be attributed, such as an unenumerable registration directory or incomplete pagination, still fails explicitly.
7. One click on a user test call is this call's authority; Off/Ask/Allow neither blocks the call nor is changed by it. In Agent and Legacy model calls, Ask/Allow both mean automatic execution, and the approval system is left to a later unified tool-interaction design.
8. Only a failure before the request handle exists may be marked NotSent; after it exists, a cancel/timeout/disconnect that cannot prove the remote state must be marked OutcomeUnknown.
9. A Manager test call hands the user's `argumentsJson` to the backend for parsing exactly as entered; Legacy reuses the ToolManager's provider argument normalization and serialization result. Neither path coerces against the input schema.
10. RMCP/reqwest types must not enter domain, ports, application, or presentation DTOs.
11. MCP does not enter the global Legacy ToolManager, slash commands, or extension enumeration; Legacy dispatches only through the request-scoped resolver, and the local registry keeps live lookup.
12. `custom_include_body` / `custom_exclude_body` express the user's final intent for the upstream body; Legacy MCP does not protect, refuse, reinject, or rewrite `tools` / `tool_choice`.
13. The endpoint, custom headers, and protocol version update atomically as one connection configuration. Every discovery/call consumer path reads that configuration from the registration, and the list DTO returns the endpoint and plaintext headers to the editor in the same WebView.
14. The discovery catalog stores only the server's raw descriptors; the registration stores sparse model-facing description overrides. The shared resolver applies the registration first, an Agent invocation then applies the Profile override, and Legacy consumes only the registration layer.

## Persistent catalog and Peer semantics

`McpService` keeps an in-memory hot copy per registration, and `tt-adapter-storage-core` saves a strict v1 persistent snapshot at `_tauritavern/mcp/catalogs/<uuid>.json`. The file binds both the canonical UUID and the registration's normalized endpoint; permissions, description overrides, and `staleTools` are not written into the catalog. Permissions and overrides live in the registration, and the model descriptor is projected on every read.

An ordinary `servers.discover` reads in the order memory, disk, real network discovery. An RMCP Peer is created only when neither memory nor disk has anything; an explicit `servers.refresh` always bypasses both snapshot levels. A cold discovery/refresh publishes after full pagination and adapter/application validation succeed; a failed atomic write does not prevent the validated catalog from being used, but keeps the old on-disk snapshot, publishes a memory-only snapshot, and returns the `mcp.catalog_persistence_failed` diagnostic. A network or validation failure still returns an error directly, and the previous snapshot stays as it was but is not reported as this request's success. A damaged file, an unknown schema, or a UUID or endpoint mismatch fails explicitly, and a user refresh may go straight to the network and replace it.

A snapshot has no TTL/LRU, background refresh, automatic retry, source/age DTO, or migration reader. A successful registration deletion is not affected by a failure to clean up the derived catalog; such a failure only writes a warning. The existing external-data reconciliation in Data Archive/TT-Sync empties the in-memory hot copy, so a later read observes the current data root again. Changing only the name, Active/Paused, permissions, or description overrides does not clear the catalog; a change to the endpoint, headers, or protocol version deletes the disk and memory snapshot first and then saves the new connection configuration. The Paused gate always precedes the cache lookup.

Model tool preparation is strictly cached-only: the shared resolver handles only registrations that are Active and store at least one Ask/Allow, reads the snapshot memory first and then disk, calls no gateway, and performs no cold discovery; a registration without a permission never touches the catalog. The resolver copies the raw descriptor and then applies the registration description override; an invalid property override produces a diagnostic and does not fall back to the raw descriptor. A per-registration cache miss, a read or validation failure, or a function schema whose root is not an object produces only a diagnostic, and a healthy server carries on. The Agent then narrows by the Profile's selection and applies the higher-priority Profile override; Legacy reads the entire set of permitted descriptors once per actual root generation and reuses it throughout tool recursion. After the user explicitly refreshes in the Manager or edits an override, the change shows up only on the next Agent invocation or Legacy root.

Each test call also uses a new, short-lived Peer. When the negotiation lands on `2026-07-28`, SEP-2243 requires the parameters annotated with `x-mcp-header` to be mirrored as `Mcp-Param-*` headers, and a server must reject their absence with `HeaderMismatch`; RMCP caches tool schemas only from a `tools/list` response on the same transport, silently omits those headers on a miss, and offers no API to pre-fill the cache from outside. So before a call, `tools/list` is paged on the same Peer and stops as soon as the target tool appears; only if the target never appears is the full directory walked. That step hydrates transport metadata only: it performs no arguments schema validation or coercion and persists no catalog; when the target does not appear in the list the SDK can see, NotSent is returned explicitly. The 2025 protocols skip this extra list.

## Current fixed boundaries

- The adapter sets no HTTP response body limit of its own: it uses RMCP's built-in reqwest backend directly, a single SSE event keeps RMCP's default limit, and a JSON response body is bound only by the operation timeout, like an LLM provider response. Result size is decided by the consumer: the Agent shares the long-result externalization, while Legacy follows local tools and sets no separate limit.
- Test-call arguments JSON: 256 KiB, and it must be an object.
- Agent MCP arguments are likewise at most 256 KiB and must be an object; a schema that can be advertised must state `type: "object"` at its root explicitly.
- Legacy MCP arguments are likewise at most 256 KiB and must be an object; the result is inlined into the Tool message as MCP outcome JSON and does not reuse the Agent workspace externalization.
- For how the text, images, and diagnostics of an Agent MCP result reach the model, and how a Manager test call differs from a Legacy chat, see [Agent consumption contract](../API/MCP.md#7-agent-consumption-contract).
- The transport accepts any HTTP(S) endpoint with a host, including plain public HTTP, userinfo, and a query. When the Manager activates an HTTP registration it states plainly that traffic is unencrypted.
- Custom headers have no reserved-name, count, or total-size limit; names and values are stored exactly as entered. A configuration the transport cannot accept (an illegal header, or one of RMCP's reserved `Accept`, `Mcp-Session-Id`, `Last-Event-Id`) makes the startup request fail, so NotSent is returned before any `tools/call` is sent. Endpoint credentials and authentication headers are stored in the registration in plaintext.
- A single tool's wire representation: 256 KiB; a complete catalog: 8 MiB.
- Per server: at most 32 pages and 512 tools.
- The HTTP connect timeout is 30s; lifecycle and pagination each have a 120s operation timeout, and waiting for the response to a tool call already sent is 60s. The shared client does not add a request timeout on top. A cancellation or a timeout returns to the caller at once; if a startup request (`server/discover` or `initialize`) is still pending, RMCP does not currently abort that HTTP request, and the leftover connection is closed by the server or the network.
- Redirects, SSE reconnect, reinitialization on an expired session, and application retry are all off.
- The protocol version preference decides the lifecycle and the accepted set:

  | Preference | lifecycle | Accepted negotiated versions |
  | --- | --- | --- |
  | `auto` | Starts `server/discover` with `2026-07-28`; when the server rejects it with a non-modern JSON-RPC error or a session-less 4xx (401/403 excepted), RMCP falls back to `2025-11-25` `initialize` on the same transport | `2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26` |
  | `2026-07-28` | `server/discover` only, with no legacy fallback | `2026-07-28` |
  | `2025-*` | `initialize` with the chosen version directly, without a discover probe | The chosen version |

  Once startup completes the adapter validates the negotiated version; if it is outside the accepted set, the connection is closed and reported as a startup failure.
- RMCP currently treats a JSON-RPC error in a startup-phase SSE response as a closed connection. Only when an `auto` startup fails with `ConnectionClosed` is a `2025-11-25` initialize attempted once with a new Peer inside the same lifecycle timeout, and both failure causes are kept in the error; other errors and a fixed version do not take that path.
- When the negotiation lands on `2026-07-28`, RMCP removes tools whose `x-mcp-header` annotations are invalid from the `tools/list` result; such a tool never enters the catalog and produces no diagnostic.

The candidate protocol versions are fixed in code; the other boundaries are not per-server settings. Exceeding a limit is never silently truncated: a single oversized tool produces a discovery diagnostic, and an unconfirmed complete pagination or an oversized catalog makes this server discovery fail; a test call whose metadata pagination exceeds the limit before finding its target returns NotSent, and content that cannot be displayed after the server has responded keeps KnownResponse and a diagnostic. An invalid optional output schema removes only that field and produces a diagnostic, without isolating a tool that remains callable.

## Agent call semantics

- A Profile v3 MCP identity is `mcp/<registration-uuid>:<native-name>`; builtin native names from v1/v2 are migrated once at application load to `builtin:<native-name>` and written back atomically.
- The registration description override is the default for an Agent MCP descriptor; Profile `tools.toolDescriptions` is applied last, before the invocation snapshot, and has the higher priority.
- The model alias is `mcp__<normalized server displayName>__<normalized nativeName>`, with a deterministic numeric suffix on collision; an alias is decoded only from the invocation binding, and execution uses the original native name.
- The registration is read again just before sending; missing, unreadable, Paused, Off, or a transport configuration failure before sending all return a recoverable NotSent tool error. Ask and Allow behave the same at present.
- A known `isError`, a server error, and an unsupported response become a recoverable Agent tool result; MCP produces no `AgentToolEffect`.
- `outcome_unknown` may already have executed, so it is never retried automatically and no invented result is filled in. There is no user decision UI today, so the run ends with a non-retryable error; when a chat commit already happened, the Agent's partial-success terminal state applies.

## Legacy call semantics

- MCP descriptors exist only inside the private generation context; each actual group member's model/tool recursion chain is its own root. Recursion reuses the descriptor snapshot but re-evaluates local tools each round, allocates MCP aliases from the current local view, and creates provider objects; execution resolves only the current round's map, and a historical alias is not authority for a new request.
- Each root takes descriptors with the registration description override already applied from the shared resolver; a later change in the Manager does not alter a root that is already running.
- Local aliases keep ecosystem priority; MCP uses `mcp__<server>__<tool>` with a deterministic numeric suffix. After `CHAT_COMPLETION_SETTINGS_READY` only the intersection of the initial MCP aliases and the post-hook entries with a unique name of the same value is kept; a deleted, renamed, or duplicate alias does not get a guessed ToolId.
- The finalizer describes only the frontend post-hook view. The backend then applies the user's `custom_include_body` / `custom_exclude_body` as usual; Legacy MCP neither protects nor reinjects any body field.
- When a response alias hits this round's MCP binding, Rust is called through a separate UUID `executionCallId`; the provider's `tool_call_id` is used only to associate Assistant/Tool messages. If an initial MCP alias loses its final binding, that becomes a NotSent tool error, with no fallback to the live local registry.
- A known error and the NotSent of a non-user Stop are saved as ordinary error tool results, and later calls in the same batch continue. `OutcomeUnknown` or a user Stop ends the remaining calls at once; unknown fabricates no tool result, saves no part of the current batch, is not retried automatically, and shows a persistent "may already have executed" warning.
- A complete known batch still uses the existing atomic writer: Assistant `tool_calls[]`, physical `role=tool` rows, `TOOL_CALLS_PERFORMED`, render, `TOOL_CALLS_RENDERED`, save, recursive Generate. After a Stop, a batch that has been fully confirmed may still be saved, but nothing recurses.
- MCP is never registered with the global ToolManager; local callbacks, formatters, stealth, slash commands, and extension enumeration keep their existing behavior.

## Not supported today

- Ask approval and the unified cross-tool approval interaction;
- the Legacy unknown-outcome pause/resume/retry workflow;
- OAuth/credentials, stdio, Resources/Prompts/Tasks/Apps;
- background refresh, list-changed, catalog TTL/revision history, and an MCP-specific sync dataset.

A full Data Archive backs up the registrations, the plaintext custom header values they hold, and the persistent catalog along with the data root. Whether TT-Sync includes these files is still decided by the general DatasetPolicy the user selects; MCP adds no sync protocol of its own.
