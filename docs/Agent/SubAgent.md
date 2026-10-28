# Multi-agent collaboration

Several agents work inside one run. One execution of an agent is an Invocation, with its own Profile, context, and tool loop; files live in the shared workspace.

Collaboration passes goals and material in a task package and returns conclusions in a result package. It works like input and output in a pipeline: the runtime joins the two ends with a task record, and file paths carry the larger material.

## Delegation and handoff

Both forms share `AgentTaskRecord` and differ in who continues after the task:

| Form | Tool | continuation | What follows |
| --- | --- | --- | --- |
| Delegation | `agent.delegate` | `return_to_parent` | The child agent returns a result and the caller continues |
| Handoff | `agent.handoff` | `transfer_control` | The current agent exits and the next agent takes over |

A task record keeps the caller, the receiver, the target Profile, the task content, and the state. The model only chooses an agent, describes the task, and references files; the runtime manages the Invocation IDs and task file paths.

## Delegating a task

The system prompt supplies the callable agents' IDs, purposes, and supported actions, filtered by this run's tool permissions and each target's eligibility. The model picks an ID from the catalog and hands over the task:

```json
{
  "agentId": "reviewer",
  "task": {
    "objective": "Check that the character motivation is consistent throughout, and write revision suggestions to summaries/review.md.",
    "draft": "output/main.md"
  }
}
```

`task.objective` is required, `title` is optional, and other fields can carry the material this work needs. Once `agent.delegate` returns a task ID, the caller can go on with other work. Call `agent.await` when it needs the result; that can wait for one completion, wait for all of them, or just read state.

The child agent ends with `task.return`:

```json
{
  "summary": "Found two problems in the motivation continuity; revision suggestions are in summaries/review.md.",
  "artifacts": [{ "path": "summaries/review.md", "kind": "markdown", "role": "review" }]
}
```

The runtime saves the structured result and writes `summaries/<workspace-key>-result.md` for other agents to read. The caller receives the summary, the file references, and the result's other fields, then decides how to use them. A completed result also enters the caller's context in later rounds.

A delegated task runs in the background and ends with `task.return`, and the foreground agent owns the chat commit. A return-mode child agent currently has no delegation or handoff tools, and therefore no callable agent catalog.

## Handing off to the next agent

Useful for handing stages such as research, drafting, and polishing to different Profiles:

```json
{
  "agentId": "editor",
  "handoff": {
    "objective": "Do the final polishing round and commit the body.",
    "contextSummary": "Fact-checking is done; keep the existing narrative perspective.",
    "workspaceRefs": ["output/main.md", "summaries/review.md"]
  }
}
```

`handoff.objective` is required, and the rest follows the task's needs. Collect the current agent's delegated tasks before handing off. On success the current Invocation is marked `transferred` and the executor starts the receiver in the same run; the receiver continues with the existing files and commit records and finishes through `workspace.commit` and `workspace.finish`.

## What the receiver sees

The runtime prepares a new prompt and tool set from the target Profile. The initial chat material comes from the input frozen when the run started, while the preset, model, and context scope come from the target Profile rather than the previous leg, see [Prompt assembly](PromptAssembly.md). The receiver builds its assembly request from its Profile and then calls the PromptManager through the host assembly bridge it shares with Sessions. The task package enters the prompt through `agentTask`. The caller should state the objective, the necessary background, and the file paths in the task.

Both sides share the working files and each gets its read and write scope from its Profile; `skills/` uses each side's effective bindings. Tasks can agree on output files for the caller to merge; see [Workspace](Workspace.md) for file and concurrency semantics.

The Profile's `delegation` configuration controls whether it can be called, whether it can delegate or hand off, which callers are allowed, and the concurrency. Return-mode child tasks run on the scheduler; when the run wraps up or is cancelled, the runtime ends the child tasks that have not finished.

The catalog stays with the prepared request, and a call still checks the target's current permission and budget. When the target choice is wrong, the tool returns the reason and the candidates currently available for that operation.

## Inspecting and changing the implementation

Timeline shows the relationships from the Invocation and Task records and each agent's process from the journal. `readTaskDetail({ runId, taskId, includeResult })` reads a task by ID, with its result on demand.

- [invocation.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/invocation.rs): creates Invocations and Tasks.
- [delegation](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/delegation): delegation, waiting, return, handoff, and the receiver's prompt.
- [scheduler.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/scheduler.rs): background child tasks and cancellation.
- [descriptors.rs](../../src-tauri/crates/tt-application/src/services/agent_tools/agent/descriptors.rs): tool arguments visible to the model.
