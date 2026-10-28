# LLM gateway

The agent loop uses one representation for model messages, tool calls, and tool results. The gateway translates between that representation and each provider's protocol, and reuses the project's existing ChatCompletionService.

```text
AgentModelRequest
  → AgentModelGateway
  → ChatCompletionService
  → provider repository
  → AgentModelResponse + provider_state
```

Connection settings, credentials, request logs, and platform policy stay with the existing services. Provider format details stay in the gateway and the matching adapter, and the loop only handles model rounds and tool operations.

## Common content and native content

`AgentModelRequest` carries messages, tools, and continuation state; `AgentModelResponse` carries the assistant message, text, tool calls, usage, and the like. Using the current tool snapshot, the gateway maps the call names the model returns back to stable tool IDs.

Protocols such as Claude, Gemini, and OpenAI Responses also need native content passed back, such as a reasoning signature, a thought signature, or native output blocks. That content stays with the message and the matching provider adapter continues it verbatim. Timeline uses the visible text and reasoning projection that `readModelTurn()` provides.

## Tool result images

Before sending, the runtime reads images through the workspace references in tool results and injects them into the `Media` parts of a request copy. Image capability comes from the [assembly snapshot](PromptAssembly.md#one-assembly-one-live-exception); see [Tool results](ToolSystem.md#how-results-enter-the-next-round) for storage, retention, and what happens when images are not accepted.

The gateway and the payload builders do the protocol conversion together:

| Protocol | Tool result images |
| --- | --- |
| OpenAI-compatible Chat Completions | Tool messages keep their text; an image-only result uses `(see attached image)`. After a run of adjacent tool messages ends, a user message is appended with the text `Attached image(s) from tool result:`, followed by that group's images. |
| Claude Messages (including Bedrock, Vertex, Custom, and OpenCode) | `tool_result.content` uses an array of text and base64 image blocks, and the text carries no tool name prefix. When the current request defines no tools, historical tool results become user content blocks that keep their images. |
| OpenAI Responses | `function_call_output.output` uses an array of `input_text` and `input_image`. |
| Gemini 3 and later | Images go in the `inlineData` of `functionResponse.parts`. |
| Gemini 2.5 and other early models | The function result is unchanged; after the result group ends, user content is appended with the text `Tool result image:`, followed by `inlineData` images. |
| Gemini Interactions | `function_result.result` uses text and image blocks. |

Tool results without images use the text shape, and tool results and user messages share the same image encoding. Formats that support no media, such as non-Claude Bedrock, reject the input explicitly.

Known limitations:

- Each request re-uploads every image in the context, and the temporary memory is roughly 3–4 times the image bytes.
- Anthropic's per-request image limit (100 for 200k-window models) can be reached before the compaction point; the matching error text is not yet confirmed, so no classification is assumed.

## Continuation state

`provider_state` belongs to the model session of one Invocation. After each successful call, the gateway updates the session ID, the message cursor, and the response information the provider needs, and the next round continues from it. Different Invocations each hold their own state.

OpenAI Responses has two continuation modes:

- By default it replays the full messages and native output over HTTP.
- With the Responses WebSocket enabled explicitly, it reuses the session and sends only the new input with `previous_response_id`.

The internal field `_tauritavern_provider_state` exists only for passing between services and is removed before request logging and upstream payload output. Profiles and prompts never manage it. See [Native API formats](../CurrentState/NativeApiFormats.md) for transport details.

## Streaming calls

The Profile's `run.stream` controls the default for the current Invocation, and the launch argument `options.stream` overrides it for the whole run. A supported provider streaming route hands the assistant body text, the visible reasoning text, and tool arguments to the runtime over one delta channel.

Signatures and encrypted content never enter the preview; tools keep the full `ToolId`, including the MCP identity needed to tell same-named tools apart. Previews are isolated per Invocation and model attempt; see [Agent API](../API/Agent.md#control-and-subscription) for the protocol and cleanup rules. In OpenAI-compatible formats, streaming and full responses share the reasoning field normalization; the final full response still goes through the common storage and tool execution path. An unsupported streaming route reports an error.

## Error classification

`model.context_overflow` means the model context window is too small or the request body is too large. Every HTTP 413 falls into this class, including an HTML body returned by a reverse proxy; Gemini's HTTP 400 `Request payload size exceeds the limit` falls into it as well, and the Session compaction flow recovers from it.

HTTP 400 errors, error objects inside a successful HTTP response, error events in an OpenAI-compatible stream, and failure events in Responses all use the same text classification, and the classification reads only the provider's error value: the JSON `error` or `detail.error`, the `error` object in a Responses `error` event (for a flat SSE event, the event itself), and the `error` of a failed Response. Echoed tool descriptions and partial output take no part. When an HTTP 400 body carries no such error value (it is not JSON, or the JSON has neither field), the whole body is classified. Overflow errors come from one constructor that returns `InvalidData` carrying the original error message. The matching rules are adapted from pi-ai 1.3.0 `utils/overflow.js` (MIT) and exclude rate-limit wording; HTTP 429 and 5xx map to retryable errors.

Claude's `model_context_window_exceeded` stop reason maps to `model.context_overflow` in both the Rust gateway and the native JS chat streaming path. Output limits unify as `model.output_truncated`, covering `max_tokens`, `length`, and Responses' `incomplete_details.reason=max_output_tokens`. These errors do not automatically retry the same request; the runtime owns Session compaction recovery, see [Runtime](Runtime.md).

## Where to make changes

- [agent_model_gateway](../../src-tauri/crates/tt-application/src/services/agent_model_gateway): `encode`, `decode`, tool schemas, and provider adapters.
- [provider_state.rs](../../src-tauri/crates/tt-application/src/services/agent_model_gateway/provider_state.rs): continuation state.
- [ChatCompletionService](../../src-tauri/crates/tt-application/src/services/chat_completion_service/mod.rs): the shared model call.
- [tt-adapter-provider-http](../../src-tauri/crates/tt-adapter-provider-http/src): the actual network requests and provider protocols.

When you change a provider, verify the messages and native continuation content in multi-round tool calling first. Representative coverage lives in the gateway tests and the host's chat-completion contract tests.
