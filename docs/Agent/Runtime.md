# Run loop

A run starts from a frozen input and runs the model and tool loop inside an Invocation. `target` separates Chat from Session: Chat produces files and a chat commit, and a Session keeps saving the conversation and replies directly.

## Startup

The frontend generation entry reads the current chat, the World Info activation result, macros, and connection settings to form a `FrozenRunInputSnapshot`. The PromptManager builds the initial messages from the Profile and preset, and the Host API hands the result to `AgentRuntimeService`.

The runtime creates the run, initializes the workspace, saves the input and the resolved Profile, and prepares the root Invocation. That is where the Invocation's model request, tool set, available skills, callable agent catalog, and workspace scope are decided. Changing UI settings afterwards does not rewrite an Invocation already prepared.

`startRunFromLegacyGenerate()` takes its input from the current chat; `startRunWithPromptSnapshot()` accepts input already assembled. Both enter the same Rust runtime. See [API](../API/Agent.md) for the parameters and [Prompt assembly](PromptAssembly.md) for how the prompt is produced.

`sessions.send()` creates one run each time and shares that Session's history and workspace. Rust selects the history and groups it by the tool protocol, and the PromptManager handles layout, see [Prompt assembly](PromptAssembly.md). A Session allows one active run at a time, and it refuses to start when the history changed during preparation.

## Each round

Every Invocation alternates model calls and tools, with no limit on rounds or call counts:

1. The Chat foreground consumes pending user guidance; a Session checks the context and compacts when needed; the round's model request is recorded.
2. The model is called through the Agent Model Gateway, the response is saved, and the full assistant message is added to the request history.
3. Tools run in the order returned, and confirmed results are added to the context.
4. The next model request starts only after every tool in the round has settled.

Delegation results also enter the caller's context between rounds. Problems the model can fix, such as tool arguments, come back as a tool result; model request, storage, or run state errors go to the run's wrap-up. If a Chat model prints body text directly, the runtime saves that text as a file. When Chat or a return-mode child Invocation replies with text only, the runtime reminds it at most 20 times to finish the work through tools; a 21st text-only reply ends the run with `model.tool_call_required`. The reminder count accumulates within the Invocation, a successful tool round does not reset it, and a resume starts it over.

A Session ends the round when the assistant makes no tool call, and the backend saves the messages in order. Cancelling keeps the messages already written and the working files.

Streaming calls provide previews of the body text, thinking, and tool arguments; see [Agent API](../API/Agent.md#control-and-subscription) for how they relate to the final message. Tool execution always uses the full response; retry policy covers model requests only, and the round's call records manage tool execution.

## Session context compaction

A Session's budget comes from the preset's context length and max response length, and the compaction point is `⌊0.9 × (context − response)⌋`. The runtime prefers the input and output usage of the latest response and then estimates the messages appended since; with no usage it has `TokenizationService` estimate the whole request. When the model accepts images, each tool image in the context counts a fixed 1,400 tokens, and group selection for the retained window uses the same count. Context usage is computed once before each round and published with the request event (see the [run event journal](RunEventJournal.md#one-event)), and it compacts automatically at the compaction point; when the provider returns `model.context_overflow`, it compacts once before resending if the round has not compacted yet. If it is still over the window after compaction, the run ends and recovery is not attempted again.

The summary request extends the current request with a summary instruction. The summary is not published as an ordinary model reply; if a tool call appears, the request is retried once with tools disabled, and the call never executes. When the summary request is over the window, the earliest tool exchange groups are removed one at a time and retried, keeping user messages and any existing summary; when no complete summary can be produced, it returns `agent.compaction_failed`.

The new model context is the summary plus the most recent complete message groups, handed to the PromptManager for rebuilding through the assembly request kept at send time and the frozen macro environment. Ordinary rounds keep appending messages to the end of the request; only compaction assembles again. Rebuilding reuses the connection and generation parameters the Invocation already resolved and does not read configuration changed during the run. When the summary plus the retained content still reaches the compaction point, or automatic compaction has no history it can shrink, it returns `agent.context_full`.

On success, compaction appends a record tagged `compaction` to `history.jsonl` and keeps the original history; the next send continues from the latest summary and the retained records. The summary states that it is a model note and that state must be observed again; the workspace file read records are cleared after compaction, so files must be read again before changes. A cancel or a failed compaction appends no compaction record.

`sessions.compact()` creates one Session run without a user message: it prepares and assembles the context the way a send does, triggers the same compaction flow with `manual`, then ends without requesting a reply. When the earlier part is entirely inside the retained range, it returns `agent.nothing_to_compact`.

## Finishing and handoff

The foreground agent hands files to the host for saving with `workspace.commit` and ends with `workspace.finish`. `finish` requires the foreground to have completed an explicit commit; a background run may write no chat. See [Workspace](Workspace.md) for file publication and persistent versions.

A return-mode child agent ends with `task.return` and hands the result to the caller. `agent.handoff` moves the current Invocation to `transferred`, and the executor prepares the next Invocation, which continues with this run's commit records. See [Multi-agent collaboration](SubAgent.md) for the task mechanism.

A run enters `completed` after finishing normally. A cancel enters `cancelled`; an error after a confirmed chat commit enters `partial_success`, and an earlier one enters `failed`. The workspace and the journal are kept so you can see the results produced and where it failed.

Cancelling a Shell call waits for the file changes already started to settle before recording the result and entering the cancelled state.

## Checkpoints and recovery

Chat saves a checkpoint each time an execution ends, made of the runtime's execution state together with the host's message presentation. Resuming after an interruption keeps the original run, the frozen input, and the workspace, and preserves confirmed results.

A Session starts a new run from its saved history after a restart; it currently supports no resume, revision, guidance during a run, delegation, or handoff.

The current checkpoint schema is 2, and reading discards removed budget fields. A v1 checkpoint can be viewed read-only, and only a completed run converts on its first `/fix`; an unfinished v1 run must start over. Conversion keeps the original permissions, skill bindings, and execution results, turns rounds containing retired tool calls into history text, and adds the new usage and catalogs through a revision note. The original records are not rewritten and old calls are not replayed.

`/fix` with a modification request revises the current swipe of the last completed agent reply. The current body is saved to `output/previous_output.md` as the revision base, hand edits included. The new foreground Invocation inherits the previous foreground's context, and the original commit records and working material stay.

Recovery validates only the locally saved material of the selected run, on demand, and depends on neither sync state nor other runs. It refuses when that run is still active in this process, the material is missing or does not match, or external side effects cannot be confirmed; a recoverable save error may be retried. Recovery and cleanup are mutually exclusive, and confirmed tool and commit effects must not be replayed.

This capability resumes an execution that already ended; it does not restore an arbitrary point after a process crash. Checkpoints travel and get cleaned with the run material. See [Agent API](../API/Agent.md) for how to call it and [Sync](../CurrentState/Sync.md) for the scope of cross-device recovery.

## Where to start changing the code

These paths are relative to `src-tauri/crates/tt-application/src/services/`:

| Location | Responsibility |
| --- | --- |
| [agent_runtime_service/lifecycle.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/lifecycle.rs) | Input validation, creating and cancelling runs |
| [agent_runtime_service/session.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/session.rs) | Session configuration, history reads, send admission, and message records |
| [agent_runtime_service/session_context.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/session_context.rs) | Session context selection, grouping, counting, and compaction |
| [agent_runtime_service/executor.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/executor.rs) | Preparing the root Invocation, advancing the handoff chain, handling final states |
| [agent_runtime_service/checkpoint.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/checkpoint.rs) | Checkpoint saving, reading, and recovery admission |
| [agent_runtime_service/revision.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/revision.rs) | Follow-up revision of completed output |
| [agent_runtime_service/loop_runner.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/loop_runner.rs) | The model and tool loop |
| [agent_runtime_service/tool_execution.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/tool_execution.rs) | Tool calls, results, and side-effect records |
| [agent_runtime_service/commit.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/commit.rs) | Chat commits and run wrap-up |
| [agent_runtime_service/guidance.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/guidance.rs) | User guidance during a run |

Frontend startup and the host bridge live in [src/tauri/main/api/agent.js](../../src/tauri/main/api/agent.js), and the UI lives in [agent-system](../../src/scripts/extensions/agent-system/src).
