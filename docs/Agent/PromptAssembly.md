# Prompt assembly

Agents keep using SillyTavern's PromptManager to assemble prompts. Rust resolves the Profile, the preset, and the model connection, the frontend builds messages from those settings, and Rust then runs the model and tool loop.

## Freezing one input

Chat's `Generate()` collects material before assembly and seals a `FrozenRunInputSnapshot` after the asynchronous `GENERATE_AFTER_DATA` work completes and before the dry-run returns, for both Chat and the SDK. It records the chat facts at the moment of generation without trimming for any Profile:

| Content | Source and purpose |
| --- | --- |
| `promptInputs` | PromptManager inputs such as chat, character, example, and extension prompts; World Info is kept per source |
| `worldInfoActivation` | The World Info activated for this generation |
| `macroContext` | Names, character templates, chat facts, settings, and module data, plus read-only text for the native side |
| `variables` | Raw local and global variable values |
| `currentPreset` | Name and content of the current chat preset (preset file format, including unsaved changes); the name is null when no preset is selected |
| `currentModelConnection` | The model connection this generation uses |

The root agent, child agents, and the agent that takes over share this input, and each decides its preset, model, and context scope from its own Profile. Each assembly works on a copy, prompts and request parameters share this run's variables through one [macro evaluation entry](../API/Macros.md), and the saved input stays unchanged.

A Session prepares its input from its own history and this user message, uses the designated preset, and takes nothing from the current character chat. See [Session API](../API/Agent.md#persistent-sessions) for variable sources. The full history lives in JSONL; the macro environment is evaluated from the whole conversation and frozen at send time, and the run keeps the final messages and the assembly request.

Capture stores the raw character template without evaluating its macros; the native read-only text reuses the first generation's result. Older runs can be viewed and resume/fix attempted; when reassembly is needed, schemaVersion 1 input returns `agent.frozen_run_input_outdated`, and missing macro rebuild material returns `agent.macro_context_rebuild_unavailable`.

## Context policy

The Profile's `includeActivatedWorldInfo` and the Chat history window apply only in the projection in [agent-context-policy.js](../../src/scripts/tauritavern/agent/agent-context-policy.js): it builds the working input for each assembly from the frozen input. World Info activates once, and the before-context and after-context, examples, depth injections, outlet, and Author's Note additions are kept per source for the projection to choose from. `includeActivatedWorldInfo` constrains the initial prompt only; tools read the full activation result.

A live root generation is projected first as well. A live `{{outlet}}` reads the global extension prompts, so World Info injections after projection are written back globally.

## One assembly, one live exception

Each Invocation picks its preset and connection from its own Profile: `currentPromptSnapshot` takes the frozen `currentPreset` and `currentModelConnection`, while `ref` and `connectionRef` resolve named resources. "Current" is the chat at the moment the run captured it, and it does not follow the root agent's binding or a UI switch during the run.

When the chat root Invocation binds the current preset, it reuses the live generation from `Generate()` directly and keeps the message and parameter changes extension hooks made. Every other case assembles independently. With the root bound to a named preset:

```text
Frozen chat input
  → promptAssembly.prepare: Rust resolves the Profile, reads the preset, applies the connection
  → promptAssembly.buildSnapshot: the frontend PromptManager builds messages
  → startRunWithPromptSnapshot: Rust creates the run and starts the loop
```

Assembly during a run makes one round trip through the host: the runtime writes a `prompt_assembly_requested` event, the host bridge reads the assembly input for that request ID, calls the same frontend assembler, and hands the result back to the waiting Invocation. Delegation and handoff build the request from the receiver's Profile first; a Session reuses the assembly request from send time. After `APP_READY` the host attaches the bridge to every active run and listens from the events that follow each run's current start or resume. A missing current preset returns `prompt_assembly.current_preset_unavailable`, and needing preset identity while the current preset is unnamed returns `agent.current_preset_unnamed`.

`agentSystemPrompt` is where Profile instructions sit in the PromptManager, and `agentTask` is where a delegation or handoff task sits. The preset controls component positions and roles, and the runtime consumes the final assembled messages.

`createAgentPromptSnapshot` in `openai.js` turns the payload into `messages: AgentModelMessage[]` plus a separate `generationParameters`, records `acceptsImages: isImageInliningSupported(settings) === true`, and supplies `contextLimits: { context, response, tokenizerModel }` from the effective settings. `acceptsImages` is false when omitted, a non-boolean value reports an error at the entry point, and the value is fixed for this Invocation: counting, image injection, and Session compaction rebuilds all share it. The capability check depends on the global `main_api` UI setting, and some sources depend on the current source's `model_list` as well. The Session runtime counts on that basis and decides the compaction point; Legacy Chat payloads are adapted at the entry point. The live current preset and the SDK snapshot share the payload preparation entry and each keep their own event and call-source semantics.

Ordinary Chat converts the final request after `CHAT_COMPLETION_SETTINGS_READY` completes; live variable changes there are not written back to the frozen input. Independent SDK assembly does not fire that event.

Rust selects and validates Session history and forms complete tool call and result groups, then hands them to the PromptManager as `promptInputs.sessionHistory`. The PromptManager owns layout, history position, depth injections, and additional prompts, keeps the original content and metadata, and does not re-expand historical macros. Session assembly does not tokenize and does not supply `assembly.tokenCounts`; see the [run loop](Runtime.md#session-context-compaction) for counting. Rust turns an unclosed tool group into an interruption note, the original history is not rewritten, and tools are not replayed.

An ordinary Session round reuses the assembled request and appends messages; only compaction replaces the assembly input with a summary and the retained groups, reusing this run's assembly request and macro environment. Depth injections and additional prompts keep acting on the context the model currently sees; a positive index for an additional prompt counts from the start of that context, and the summary may become the first user message. See the [run loop](Runtime.md#session-context-compaction) for the compaction rules.

## Skill and agent catalogs

When the runtime prepares an Invocation, it appends the skill catalog and the callable agent catalog to the end of the `agentSystemPrompt` body. The skill usage notes come with the available skill catalog. Default and custom instructions use the same flow and keep the preset's position and role; later rounds and recovery reuse the prepared request.

The skill catalog and the file view use the same effective bindings; the agent catalog follows the actual tools and the call eligibility of each target. See [Skill](Skill.md) and [Multi-agent collaboration](SubAgent.md) for the rules, and the [API](../API/Agent.md) for the component markers of a manual snapshot.

## What the preset and the connection each own

The preset supplies prompt layout and generation settings. The Profile's model binding supplies the final source, model, endpoint, secret, and routing; those connection fields override older values in the preset. Preset fields convert to settings through the same mapping used when a preset is loaded live, and fields outside the mapping pass through unchanged.

Additional Parameters expand when the frontend prepares the request, and later rounds reuse the result; see [macros and request templates](../API/Macros.md#agents-and-request-templates) for the scope.

An explicit `preset.reasoningEffort` wins over the preset's omission of the parameter; the PromptManager normalizes the actual value by source and model, and the provider adapter maps it to the protocol. Assembly never modifies the saved preset.

`currentPromptSnapshot` uses the connection frozen in the input. `connectionRef` resolves through an LLM Connection: it applies once at assembly so the PromptManager uses the right model settings, then applies to the final request before the Invocation enters the loop. See [LLM Connection API](../API/LlmConnections.md) for Model Targets and reverse-proxy presets.

Independent assembly uses a headless PromptManager and does not switch the UI's preset or model. Dynamic extension prompts are collected before live assembly; an extension that rewrites prompts through the ordinary `CHAT_COMPLETION_PROMPT_READY` event does not take part in this independent assembly path.

## Source

| Location | Responsibility |
| --- | --- |
| [frozen-run-input-snapshot.js](../../src/scripts/tauritavern/agent/frozen-run-input-snapshot.js) | Frontend frozen input |
| [agent-context-policy.js](../../src/scripts/tauritavern/agent/agent-context-policy.js) | Context policy projection |
| [prompt_assembly_service.rs](../../src-tauri/crates/tt-application/src/services/prompt_assembly_service.rs) | Resolves the preset, the model, and the assembly request |
| [agent-prompt-assembly-run.js](../../src/tauri/main/api/agent-prompt-assembly-run.js) | Prepare/build orchestration for the root run |
| [agent-prompt-assembly.js](../../src/tauri/main/api/agent-prompt-assembly.js) | The frontend assembler |
| [openai.js](../../src/scripts/openai.js) | PromptManager and generation parameters |
| [agent-prompt-assembly-bridge.js](../../src/tauri/main/api/agent-prompt-assembly-bridge.js) | Assembly bridging for Invocations during a run |
| [agent_runtime_service/prompt_assembly.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/prompt_assembly.rs) | Waits for assembly results and saves snapshots |
| [agent_runtime_service/session_context.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/session_context.rs) | Session history selection, grouping, counting, and compaction rebuilds |
