# Native API formats (Custom): current compatibility status

Last updated: 2026-10-16

This document describes the current implementation snapshot and the ongoing development constraints
for the native API format compatibility **already landed in TauriTavern** across three vendors: OpenAI
Responses, Claude Messages, and Gemini generateContent / Gemini Interactions.

Target boundary (rollback compatibility):

- After rolling back to SillyTavern, it is enough that ST 1.16.0 **boots and does not crash on the
  settings** (there is no attempt to make ST natively understand the new fields).

---

## 1. What this currently solves

While keeping the frontend on SillyTavern semantics as far as possible (`chat.completion` / tool loop /
event streams), the `Custom` entry point gains four native-protocol variants:

- **OpenAI Responses**: `/v1/responses` (stream + tool calling)
- **Claude Messages**: `/v1/messages` (adds the required beta header when prompt caching or fast mode
  is enabled explicitly)
- **Gemini generateContent**: `/v1beta/models/{model}:generateContent` /
  `:streamGenerateContent?alt=sse` (reuses the Google AI Studio path, with stream + tool calling +
  native parts replay)
- **Gemini Interactions**: `/v1beta/interactions` (stream + tool calling + thought signature / native
  blocks replay)

Core principles:

- **Protocol complexity is concentrated in the Rust backend translator and normalizer**; the frontend
  does only the minimum: selection and echo, plus a few parse branches.
- **Rollback-friendly configuration**: persistence still centres on `chat_completion_source=custom`,
  and the new capabilities extend it through the added field `custom_api_format`.

---

## 2. How the end-to-end path works today

### 2.1 Configuration and selection (frontend)

UI: `Chat Completion Source` in the OpenAI settings gains 4 options:

- `Custom (OpenAI Responses)`
- `Custom (Claude Messages)`
- `Custom (Gemini generateContent)`
- `Custom (Gemini Interactions)`

Persistence semantics (key contract):

- Every "Custom (*)" variant ultimately persists as:
  - `oai_settings.chat_completion_source = "custom"`
  - `oai_settings.custom_api_format ∈ {"openai_compat","openai_responses","claude_messages","gemini_interactions","gemini_generate_content"}`

This guarantees that when the settings file is copied back to ST 1.16.0:

- `chat_completion_source` is still the `custom` value ST knows.
- `custom_api_format` is ignored by ST as an unknown field (but must not crash the settings page).

Connection Profiles (the Connection Manager extension):

- The profile's `api` is recorded as `custom` for Custom across the board, so a UI variant value never
  reaches the configuration and creates rollback risk.
- The Custom variant is recorded and replayed through the separate `custom-api-format` field
  (equivalent to running `/custom-api-format <format>`).

The endpoint preview is derived from the selected protocol and the connection settings; Gemini
generateContent additionally reads the model and streaming state, and its address rules match the
backend.

### 2.2 Request construction (Rust payload builder)

The backend entry point still receives frontend data as an OpenAI-compatible generate payload, and
branches on `custom_api_format` in `payload/custom.rs`:

- `openai_compat` → the existing `/chat/completions` compatible construction, with the include/exclude
  overrides applied
- `openai_responses` → constructs `/responses`
- `claude_messages` → reuses the Claude Messages construction, with the include/exclude overrides
  applied
- `gemini_interactions` → constructs `/interactions`
- `gemini_generate_content` → reuses the MakerSuite translator and transport path; see §4.4 for the
  Custom semantics

DeepSeek's native and Custom/OpenCode-compatible requests share a backend adapter that preserves the
parameter and prompt policy of each origin; the adaptation runs after protocol construction and before
user overrides.

Built-in channel model rules serve only to construct the request and no longer re-run remote parameter
validation on the constructed Claude payload. The JSON schema for Fable 5.1, Opus 5.5, and Sonnet 5.5
uses output_config.format, coexisting with effort and ordinary tools; other Claude models keep the
schema tool. Custom keeps explicit parameters as they are, and the upstream response decides whether
they are accepted.

### 2.3 HTTP calls and stream handling (Rust repository)

The repository layer branches again on **endpoint_path** for `ChatCompletionSource::Custom`
(`http_chat_completion_repository/mod.rs`):

- `/responses` → OpenAI Responses repository (semantic SSE → normalized chunks)
- `/interactions` → Gemini Interactions repository (semantic SSE → normalized chunks)
- `/messages` → Claude repository (keeps Claude's event-stream semantics)
- `/generateContent` / `/streamGenerateContent` → MakerSuite repository (the regular Gemini native
  API)
- anything else → Custom OpenAI-compatible (`/chat/completions`)

> Note: Claude streaming keeps the Anthropic event-stream JSON semantics; Responses and Interactions
> streaming are normalized uniformly into OpenAI `chat.completion.chunk`.

An explicit error in a JSON response (including with HTTP 200) becomes an error at the shared read
point, and Legacy and Agent take the same propagation path; the streaming frontend ignores only
non-JSON frames and does not swallow a recognized provider error.

---

## 3. Supported capabilities / explicit non-support

### 3.1 Capability matrix (current)

| Custom variant | Non-streaming | Streaming | tool calling | thought signature / native blocks | ST rollback boot |
|---|---:|---:|---:|---:|---:|
| OpenAI-compatible (`/chat/completions`) | ✅ | ✅ | ✅ (upstream ST semantics) | ✅ (`tool_calls[].extra_content` opaque round-trip) | ✅ |
| OpenAI Responses (`/responses`) | ✅ (normalize→chat.completion) | ✅ (Responses events→chat.completion.chunk) | ✅ (full transcript replay / `previous_response_id`) | ✅ (backend normalizer / the Agent gateway keeps the raw `output` and `responseId`) | ✅ |
| Claude Messages (`/messages`) | ✅ (normalize→chat.completion) | ✅ (Anthropic events) | ✅ (reuses the Claude tool loop) | ✅ (existing path) | ✅ |
| Gemini generateContent (`/models/{model}:…`) | ✅ (normalize→chat.completion, native included) | ✅ (Gemini native events, last packet carries native) | ✅ | ✅ (`message.extra.native.gemini.content` replay) | ✅ |
| Gemini Interactions (`/interactions`) | ✅ (normalize→chat.completion, native included) | ✅ (SSE→chat.completion.chunk, last packet carries native) | ✅ | ✅ (`message.extra.native` replays steps) | ✅ |

### 3.2 Explicit current limitations

- **Custom OpenAI Responses no longer maintains an in-memory call_id → response_id cache.** Ordinary
  Custom requests and Agent requests that leave the enhancement mode off (the default) rely on full
  transcript / native output replay; only after Responses WebSocket mode is enabled explicitly does
  the Agent use `previous_response_id` and incremental input through the run-scoped `provider_state`.
- **Custom's model list and status check** now follow the transport protocol selected by
  `custom_api_format`: OpenAI-compatible and Responses keep the compatible `/models`, Claude Messages
  uses Claude's `/models`, and Gemini generateContent and Interactions both use Gemini's `/models`.
  The Google model list reads every page and keeps the model metadata, and a mid-way failure returns
  no partial list; when the server hands back a page token that has already been requested (a reverse
  proxy that does not forward `pageToken`), pagination ends there, the replayed page is discarded, and
  the earlier pages are the list it could provide.
- **Claude streaming performs no chunk normalization**: the frontend parses it on the Anthropic events
  branch (which it already does, preferring reuse of the existing Claude semantics).

---

## 4. Implementation notes per vendor (the parts that matter most for ongoing work)

### 4.0 OpenAI-compatible (/chat/completions)

- The shared Chat Completions builder sets `stream_options.include_usage=true` for streaming requests;
  the existing additional body overrides can still override or delete that field. The trailing usage
  packet may carry no choices and has to be consumed until the stream ends normally.
- The Claude, Gemini, Responses, and Interactions normalizers keep the cache-read count as
  `usage.prompt_tokens_details.cached_tokens` and do not pad a missing value with zero; Claude's
  `prompt_tokens` covers cache reads, cache writes, and uncached input. The existing Responses and
  Interactions final stream packets carry the same usage.
- Cache hit rate is an optional statistic. The shared frontend parse entry point treats a missing or
  inconsistent count as unknown (`null`), shows no statistic, guesses no value, and does not interrupt
  a streaming or non-streaming reply because of it; a later valid usage updates as usual.
- `Auto` in the first-party UI's Reasoning Effort means `reasoning_effort` is not generated at all;
  every other explicit value goes out as-is in the Custom payload, without being enabled, validated,
  or downgraded by model name. When upstream rejects it, the error returns along the existing path,
  and the user can still override or delete the field through an include/exclude body override.
- An assistant tool call's `extra_content` is provider-owned opaque JSON, replaced wholesale during
  streaming by the newest non-null snapshot; Legacy and Agent save it at the original tool call
  position and replay it verbatim in later tool requests against the same API and model.
- The frontend does not parse the provider namespace or signature inside it, does not enable it by
  model name, and does not fill in a missing value.
- The Rust OpenAI-compatible payload builder keeps forwarding `messages` wholesale, adding no
  provider-specific validation; when upstream rejects the field, its error reaches the user along the
  existing path.
- Switching the provider or model in Legacy migrates only the canonical tool call semantics and does
  not carry the old provider's `extra_content`; an Agent invocation's model connection is frozen for
  the duration of the run.

### 4.1 OpenAI Responses (/responses)

Request side (payload):

- `messages[]` → `input[]` items; the `system`, `developer`, and `user` roles are preserved as they
  are
- an assistant message carrying `message.native.openai_responses.output` replays the raw Responses
  `output` items verbatim
- assistant text is encoded as Responses `message` / `output_text`
- assistant `tool_calls[]` are encoded as Responses `function_call` items; `id`, `function.name`, and
  `function.arguments` must be parseable, and a missing structure fails fast
- `tool` / `function` messages are encoded as `function_call_output` and must carry a `tool_call_id`
- `store` defaults to `false`; `include` guarantees `reasoning.encrypted_content`, which reasoning and
  native continuation need
- a preset with `enable_web_search=true` adds the `{ "type": "web_search" }` hosted tool; it coexists
  with local function tools and never enters the Agent's local tool registry
- `previous_response_id`, `max_tokens` / `max_completion_tokens`→`max_output_tokens`,
  `verbosity`→`text.verbosity`, `metadata`, and `parallel_tool_calls` map as the current payload
  builder defines
- `json_schema` → `text.format`, coexisting with `text.verbosity`; the schema field values are shared
  with Chat Completions.
- `reasoning_effort` is only a structural conversion to `reasoning.effort`; an explicit value is not
  enabled, validated, or downgraded by model name.

Transport side (repository):

- an ordinary Custom `/responses` request uses HTTP when non-streaming and SSE when streaming
- a request uses the run-scoped persistent WebSocket session only when the internal
  `_tauritavern_provider_state.transport = "responses_websocket"`; a portable Agent request that has
  only a `sessionId` still uses HTTP
- the Custom Responses connection setting leaves WebSocket mode off by default; once enabled
  explicitly, WebSocket, `previous_response_id`, and incremental input take effect atomically as one
  enhancement mode, and a failure on that path does not fall back to HTTP
- the Responses WebSocket connection starts as an HTTP Upgrade through `HttpClientPool`'s
  ChatCompletion WebSocket profile and is then handed to the WebSocket frame stream, so it inherits
  the existing proxy, TLS/client construction, and connection-timeout contract
- the persistent session's connection key includes the transport revision, so a change to the request
  proxy or client configuration rebuilds the session
- the outgoing HTTP payload strips `_tauritavern_provider_state`
- the WebSocket `response.create` payload strips `_tauritavern_provider_state`, `stream`, and
  `background`

Streaming side (repository):

- parses the semantic Responses events (such as `response.output_text.delta`,
  `response.refusal.delta`, and `response.output_item.done`)
- emits OpenAI `chat.completion.chunk`:
  - a text delta → `choices[0].delta.content`
  - a reasoning delta → `choices[0].delta.reasoning_content`
  - a completed function call item → a single `choices[0].delta.tool_calls[]` (the `id` is the
    Responses `call_id`)
- SSE must end with a Responses terminal event; a connection that closes early fails fast, unless the
  user cancelled it

Tool follow-up (key contract):

- Ordinary Custom Responses does not rely on a repository memory cache. The translation layer only
  translates tool items, and the provider decides how calls and results pair up.
- A portable Agent Responses follow-up uses full transcript / native output replay; only after
  WebSocket mode is enabled explicitly is it driven by `provider_state.previousResponseId` in
  `AgentModelGateway`. See [Agent LLM gateway](../Agent/LlmGateway.md#continuation-state).

### 4.2 Gemini Interactions (/v1beta/interactions)

URL and authentication:

- if `custom_url` does not end in `/v1` or `/v1beta`, the backend appends `.../v1beta`
- when the user supplies an explicit `Authorization` header, it takes precedence; otherwise
  `x-goog-api-key` is used
- streaming is enabled by `stream: true` in the request body, and the response is parsed as SSE

Request side:

- `system` messages are aggregated into the top-level `system_instruction`
- user, assistant, and tool history build `user_input`, `model_output` / `function_call`, and
  `function_result` steps respectively
- structured output uses
  `response_format = { "type": "text", "mime_type": "application/json", "schema": ... }`
- `reasoning_effort` is only a structural conversion to `generation_config.thinking_level`; an
  explicit value is neither parsed nor downgraded.

Signature / native blocks (key contract):

- on the streaming completion event `interaction.completed`, the backend puts the aggregated `steps[]`
  into:
  - `choices[0].delta.native = { gemini_interactions: { steps } }`
- the frontend persists that to `message.extra.native` when it saves the message
- when it later builds stateless history, it replays the steps verbatim only when the body matches the
  original response and the request target matches
- when SillyTavern splits a function-call turn with leading text into an adjacent visible message and a
  tool invocation, the payload translator deduplicates only when the native steps are exactly equal
  and replays them once

Streaming normalization:

- Interactions SSE order is `interaction.created` / status notifications, then each output passes
  through `step.start` / `step.delta` / `step.stop` in turn, and finally `interaction.completed` and
  `[DONE]`; the adapter accepts both the `interaction.status_update` seen in production and the status
  event the documentation names, but completes the response only on the terminal event
- `step.delta.type=text` → `delta.content`
- `step.delta.type=thought_summary` → `delta.reasoning_content`; the `thought_signature` is kept only
  in the native step
- the function call's id and name come from `step.start.step`; the `arguments` string of
  `step.delta.type=arguments_delta` accumulates until `step.stop` and is parsed then, and exactly one
  complete `delta.tool_calls` item is sent
- server-side tool steps such as Google Search, and text annotations, are not projected into the
  generic chat fields and are kept verbatim in the native steps after streaming assembly
- a streaming function call's terminal status can be `completed`, so `finish_reason=tool_calls` is
  decided by the assembled `function_call` step; a non-streaming function call's status can be
  `requires_action`
- an `incomplete` result with consumable text normalizes to `finish_reason=length`; no consumable
  output, or an incomplete function call, is a direct error

### 4.3 Claude Messages (/messages, Custom variant)

Reasoning effort:

- `reasoning_effort` is only a structural conversion to `output_config.effort`; an explicit value is
  not enabled, validated, or downgraded by model name
- the builder neither guesses nor generates `thinking` from the model

Hosted web search:

- a preset with `enable_web_search=true` adds
  `{ "type": "web_search_20250305", "name": "web_search" }` for direct Claude and Custom Claude
  Messages.
- `server_tool_use` / `web_search_tool_result` are provider-hosted execution, so they stay in the
  Claude native content and are not projected into Agent local function calls.
- Vertex Claude and built-in Bedrock Claude do not inherit this switch; each has its own hosted-tool
  capability boundary.

Header policy (key contract):

- Custom Claude Messages does not enable beta features automatically by default; when prompt caching
  or fast mode is enabled explicitly, the backend adds the corresponding `anthropic-beta` header.
- Prompt caching still requires both the connection opt-in and the TT cache policy, and user-defined
  headers follow the existing override rules.

Image input:

- Claude Messages reuses the shared `content_parts` parser: an `image_url` data URL becomes
  `source.type=base64`, and a remote `http(s)` URL for direct or custom Claude Messages becomes
  `source.type=url`.
- AWS Bedrock Claude reuses the Claude renderer but enforces a base64-only source policy; input it
  cannot preserve faithfully, such as remote URLs and provider file references, fails fast.
- An OpenAI-style `input_image.file_id` is not converted automatically into a Claude Files API
  reference yet; a Claude-native file source is replayed faithfully only as a native block, and the
  caller owns the beta/header/file lifecycle.

Streaming semantics:

- the backend passes Claude's SSE `data:` JSON events through (with no chunk normalization)
- the frontend parses direct Claude, Vertex Claude, built-in Bedrock Claude, and
  `custom_api_format=claude_messages` on the Claude streaming branch
- the frontend accumulates `text_delta`, `thinking_delta`, `signature_delta`, and `input_json_delta`
  by content block index; `input_json_delta` follows the delta contract and is not bound to a
  specific tool block type
- the frontend handles terminal states explicitly on the `stop_reason` of a `message_delta` or a
  non-streaming response: `refusal` keeps the provider output, shows a toast, and appends the same
  warning to the final `message.mes`; `max_tokens` / `model_context_window_exceeded` keep the partial
  text and show a truncation warning. None of these terminal states executes or replays an unfinished
  tool call.
- only an assistant turn containing a client `tool_use` saves the full `content[]` to
  `message.extra.native.claude` and replays it when the body matches the original response and the
  request target matches; an ordinary assistant turn uses SillyTavern canonical content.
- when SillyTavern splits one tool turn into an adjacent visible message and an invocation message,
  the translator collapses them into one only when the two native contents are exactly equal, and
  fails fast when they differ; editing either message invalidates both copies of the native metadata

### 4.4 Gemini generateContent (the regular native API)

- The Custom entry point reuses MakerSuite's translation and transport path, selecting the protocol
  explicitly with `custom_api_format=gemini_generate_content`.
- The base URL and the model are configured separately: an explicit `/v1` or `/v1beta` is kept,
  otherwise `/v1beta` is appended. Authentication uses the Custom API key, and Additional Parameters
  apply after translation.
- A Custom model name is handled as an alias; explicit sampling and image parameters are forwarded
  per the protocol, and prefill is not rewritten automatically. When a Gemini model ID can be
  recognized in the model name (including a `models/` or relay prefix), `reasoning_effort` maps to the
  thinking level or budget that model supports; other aliases map to `thinkingLevel` by default, and
  `auto` is not sent. Additional Parameters can override this, and upstream errors return normally.
  Multiple candidates via `n` are not implemented yet and take no part in the generation decision.
- Native parts and signatures are replayed only when the body matches the original response and the
  API, format, and model match. An old record that cannot be verified keeps its body and visible
  reasoning; a streaming request commits native history only after it ends completely.
- For ordinary messages in a request, `native.gemini.content.parts` enters `contents` as it is, with
  no signature attached; tool and function messages take the existing tool conversion path, and a
  leading `systemInstruction` still reads the body only.
- Google AI Studio, Custom, and Vertex AI share the Gemini streaming accumulation and response
  normalization. A response must contain visible text, a tool call, or inline media; when there are no
  candidates, the error reason comes from `promptFeedback.blockReason`, and a `finishReason` is not
  required separately.

Implementation entry points:
[`payload/custom.rs`](../../src-tauri/crates/tt-application/src/services/chat_completion_service/payload/custom.rs),
[`makersuite.rs`](../../src-tauri/crates/tt-adapter-provider-http/src/http_chat_completion_repository/makersuite.rs).

---

## 5. Contracts most easily broken by accident (do not break these)

1. **Rollback compatibility**: a Custom variant must persist with `chat_completion_source="custom"`;
   never write the UI selection value (such as `custom_openai_responses`) into the settings file.
2. **tool_call_id transparency**: the tool loop must not assume a tool_call_id is an OpenAI UUID; pass
   and store it as an opaque string.
3. **native metadata fidelity**: the Agent gateway keeps Claude content blocks, Gemini content parts,
   OpenAI Responses output items, and Gemini Interactions steps through the normalized
   `message.native` / canonical `Native` part. Unknown fields must not be scrubbed, or the signature
   chain and reasoning continuation break.
4. **Custom Claude does not inject anthropic-beta**: that behaviour exists for third-party
   compatibility; only explicitly opted-in prompt caching adds a caching header automatically now, and
   no other case may hard-code a fallback.
