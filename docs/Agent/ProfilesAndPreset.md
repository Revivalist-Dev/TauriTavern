# Profiles and presets

A Profile describes how an agent works: which prompt and model it uses, which tools it can call, which files it can read and write, and how it delivers results. The preset owns prompt organization, and the LLM Connection owns connection details.

## Starting from the default profile

The Profile panel in Agent System can copy and edit configurations. `Default Writer` uses the current chat's preset and model, treats `output/main.md` as the body, and supports workspace tools, skills, and delegation. The built-in default configuration and new Profiles enable streaming by default; saved configurations keep their existing settings. Complete one run with it first, then adjust the configuration for the task.

An extension can also read the default configuration and save a copy of it:

```js
const agent = window.__TAURITAVERN__.api.agent;
const { profile } = await agent.profiles.load('default-writer');
const reviewer = structuredClone(profile);
reviewer.id = 'reviewer';
reviewer.displayName = 'Reviewer';
reviewer.instructions.agentSystemPrompt = 'Check the character motivation in the draft, give concrete revision suggestions, and return the result as the task requires.';
reviewer.delegation.callable = true;
reviewer.delegation.allowAsSubagent = true;
await agent.profiles.save(reviewer);
```

After saving, `profiles.diagnose('reviewer')` reports problems with model, preset, or tool references.

## Choosing the prompt and model

The two bindings are independent:

| Setting | Option | Meaning |
| --- | --- | --- |
| `preset.mode` | `currentPromptSnapshot` | Uses the current chat preset captured by the run (including unsaved changes); the chat root agent reuses the live generation |
| | `ref` | Assembles again with the preset named by `preset.ref` |
| `model.mode` | `currentPromptSnapshot` | Uses the model connection frozen with this input |
| | `connectionRef` | Uses the named LLM Connection and `modelId` |
| | `requiresConfiguration` | Waits for the user to choose a model on this machine |

Child agents and handoff targets assemble by their own bindings too, and see [Prompt assembly](PromptAssembly.md) for what "current" means. To get a leaner child agent, shrink the history window or bind a lean preset.

For example, a dedicated writing preset and a local connection:

```json
{
  "preset": {
    "mode": "ref",
    "ref": { "apiId": "openai", "name": "Writer Preset" }
  },
  "model": {
    "mode": "connectionRef",
    "connectionRef": "writer-model",
    "modelId": "model-name"
  }
}
```

This is a binding fragment inside a Profile. `writer-model` must be a connection already saved on this machine. A standalone preset uses an OpenAI/chat-completion Preset; see [Prompt assembly](PromptAssembly.md) for how it is assembled.

`preset.reasoningEffort` is allowed only with `mode = ref`: when omitted it follows the preset, `auto` sends no effort, and any other level overrides the preset. This field does not turn on a model's thinking mode.

A Model Target in the Profile panel materializes as an LLM Connection. Updates to the connection's endpoint and credentials feed later resolution, while the Profile's `modelId` keeps the value the user selected. On export, or when embedded in a character card or preset, a local standalone model binding becomes `requiresConfiguration`; choose it again after import.

## Adjusting how the agent works

| Field | Purpose |
| --- | --- |
| `instructions.agentSystemPrompt` | The agent's working instructions; the default instructions apply when omitted |
| `context.initialChatHistoryMessages` | Number of initial chat history messages in Chat: `-1` does not trim, `0` injects none, and a positive number takes the most recent N; the model context budget still applies |
| `context.includeActivatedWorldInfo` | Whether the initial prompt includes activated World Info |
| `tools.allow` / `deny` | Available tools; `deny` wins |
| `tools.externalResultInlineCharLimit` | Character threshold for inlining MCP and extension results to the model, 50,000 by default; longer results keep a complete readable file |
| `tools.toolDescriptions` | Replaces the tool or parameter descriptions the model sees |
| `skills.visible` / `deny` | Selects available skills by name |
| `workspace.visibleRoots` / `writableRoots` | File read and write scope |
| `run.presentation` | Foreground chat output or background file processing |
| `run.stream` / `modelRetry` | Streaming preview and model request retries |
| `run.directRunnable` | Whether it appears in the list of agents that can be run directly |
| `output.artifacts` | Output files; the current body target is `messageBody` |

Tool fields use [stable IDs](ToolSystem.md#identity-and-call-names). Enabling an extension tool that is not loaded rejects the change; when an existing selection is temporarily absent, the configuration keeps it, the runtime excludes it and records a diagnostic, and other edits and runs are not blocked. Chat and the shared Session Profile follow the same rule.

`plan/` can hold plain plan files. The Profile plan configuration the current runner supports is `mode: "none"` with an empty `nodes`, and there is no node-based workflow executor yet.

## Configuring collaboration

The caller turns on `delegation.canDelegate` or `canHandoff` and allows the matching tools. The receiver turns on `callable`, then picks `allowAsSubagent` or `allowAsHandoffTarget` for its purpose; `allowedCallers` names the Profiles that may call it, and `["*"]` means every caller.

`descriptionForAgents` describes the work it suits, and `description` applies when that is empty. Concurrency, task counts, and handoff depth are set in `delegation` as well. See [Multi-agent collaboration](SubAgent.md) for the full flow.

## The built-in agent preset

The built-in `openai/Agent` preset serves agents that talk to the user directly: the Main Prompt explains how this kind of agent works, and the specific duties live in the Profile instructions. The in-app assistant binds it by default on first configuration; saved Session Profiles keep their existing preset and instructions. The preset names no model, source, or endpoint, and the Profile still decides the connection.

| Value | Rationale and room to adjust |
| --- | --- |
| Context `128000` | Leaves room for multi-round conversation and tool results, following SillyTavern's 128k value. Users should raise or lower it to the chosen model's actual window. |
| Max response `32768` | Reserves output budget for thinking, long answers, and tool call code; that part is set aside from the context budget. If a model rejects the limit, the user can lower it, and raise it within the model's limit for longer output. |
| Omits `temperature`, `frequency_penalty`, `presence_penalty`, `top_p`, `top_k`, `top_a`, `min_p`, and `repetition_penalty` | Uses the sampling defaults the provider offers for the model. |
| `use_sysprompt: true` | Lets sources such as Claude, Gemini, and Bedrock send the system prompt by their own protocol. |
| `media_inlining: true` | Lets the existing media inlining flow add media to requests according to model capability. |
| Empty roleplay wrappers | An agent facing the user directly needs no chat, group chat, example, continuation, or impersonation wrapper. |
| Character and World Info markers kept | Follows SillyTavern's standard preset structure; with no matching material in a Session they stay empty and produce no message. |
| `agentSystemPrompt` before the Main Prompt, `agentTask` before the history, `agentResults` at the end | Follows PromptManager's default insertion points, so no order needs rewriting after loading. |

The preset is user-editable content. Seeding the built-in file does not overwrite an existing file of the same name, and does not migrate the choices saved in a Profile.

## Session configuration

Sessions use the same `AgentProfileDefinition`, saved separately to `_tauritavern/agent-workspaces/sessions/profile.json`, shared by all Sessions, and not part of the ordinary Profile list. Changes take effect the next time a send is prepared; renaming a preset updates its references at the same time.

A Session must set `preset.mode = ref`, `model.mode = connectionRef`, and `context.initialChatHistoryMessages = -1`, and it accepts no history window; skills come from the built-in scope and the Profile's own scope, and the Profile overrides a built-in package of the same name. Body artifacts and the commit/finish requirement belong to Chat execution admission, so a Session can use an empty artifact configuration. See [Workspace](Workspace.md#the-persistent-session-workspace) for directories and lifecycle.

## Source

Ordinary Profiles are saved as JSON in `_tauritavern/agent-profiles/profiles/`, and the current schema version is 5.

Schemas 1–4 migrate automatically on load or import and drop the round and call-count limits; versions 1–3 also remove the old `skill.*` and `agent.list` tool configuration and the skill read budget. Everything else is kept, and no new permission is granted and no instruction is rewritten automatically. Ordinary Profiles and the shared Session Profile are written back at the current version after a read migration or a save.

The value of the old `tools.mcpResultInlineCharLimit` is kept on read, and the next save uses `tools.externalResultInlineCharLimit`.

- [profile.rs](../../src-tauri/crates/tt-domain/src/models/agent/profile.rs): fields and defaults.
- [agent_profile_service](../../src-tauri/crates/tt-application/src/services/agent_profile_service): default configuration, resolution, and validation.
- [profile-model.ts](../../src/scripts/extensions/agent-system/src/profile-model.ts): Profile editing and portable configuration.
- [LLM Connection API](../API/LlmConnections.md): creating and managing connections.
