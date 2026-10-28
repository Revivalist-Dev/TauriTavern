# Agent API

`window.__TAURITAVERN__.api.agent` runs chats and sessions, reads their history and manages profiles. For the framework itself start at [Agent](../Agent/README.md); for the full TypeScript types see [src/types.d.ts](../../src/types.d.ts).

## Starting a run

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const agent = window.__TAURITAVERN__.api.agent;

const run = await agent.startRunFromLegacyGenerate({ profileId: 'default-writer' });
const unsubscribe = agent.subscribe(run.runId, event => {
  console.log(event.seq, event.type, event.payload);
}, { onError: console.error });

// Call unsubscribe() when you leave this view.
```

This entry point captures generation inputs from the current chat and is meant for the OpenAI/chat-completion path. Ordinary sends, `/trigger`, regenerate and new swipe generation all use the same run machinery while Agent Mode is on.

| Start method | Input |
| --- | --- |
| `startRunFromLegacyGenerate(input?)` | The current chat and the Legacy Generate options |
| `startRunWithPromptSnapshot(input)` | A `promptSnapshot` and `chatRef` the caller has already assembled |

The shared options are `profileId`, `generationType`, `stableChatId`, `presentation` and `options.stream`. When the stable chat ID is omitted, the Host API resolves it. When `options.stream` is omitted, each invocation uses its profile setting, and an explicit value overrides the entire run.

Both chat methods return `{ runId, status, workspaceId, stableChatId, generationType }`. A snapshot uses `{ contextPolicy, messages, generationParameters, acceptsImages? }`, with messages as `AgentModelMessage[]`; a Legacy `chatCompletionPayload` is adapted at the entry point, and chat inputs cannot inject external tool turns. For frozen inputs and assembly rules, see [Prompt assembly](../Agent/PromptAssembly.md).

The public default for `acceptsImages` is false; for how it is decided and for its invocation lifecycle, see [Prompt assembly](../Agent/PromptAssembly.md#one-assembly-one-live-exception).

In a canonical snapshot the instruction message stores its body as a Text part and carries `providerMetadata.promptComponent: "agentSystemPrompt"` so that the runtime can append the catalog. Legacy chat input still accepts a string `content` and `_tauritavern_prompt_component: "agentSystemPrompt"`. The shared PromptManager supplies the marker automatically, and the marker is never sent to the model.

A hand-built snapshot that needs delegation or handoff must carry `frozenRunInputSnapshot`, from which both the current preset and its skill scopes are taken.

## Persistent sessions

A session is independent of character chat and of the writing Agent Mode. Before using one, save the [shared configuration](../Agent/ProfilesAndPreset.md#session-configuration) with `sessions.profile.save()`; every send after that reads the latest configuration.

| Method | Returns |
| --- | --- |
| `sessions.profile.load()` | `{ profile }`; `{ profile: null }` before anything is configured |
| `sessions.profile.save(profile)` | Saves the shared `AgentProfileDefinition` |
| `sessions.create()` | `{ session }`; the metadata is `{ id, createdAt, title, lastUsedAt }` |
| `sessions.list()` | `{ sessions, activeRuns }`; the session metadata catalog and active run handles only |
| `sessions.rename({ sessionId, title })` | `{ session }`; the trimmed title must be 1-120 characters |
| `sessions.delete({ sessionId })` | Deletes the session data; an active session refuses deletion, and a target that no longer exists succeeds |
| `sessions.read({ sessionId, beforeSeq?, limit? })` | `{ session, messages, lastSeq, nextBeforeSeq, activeRun }` |
| `sessions.send({ sessionId, text, variables? })` | `{ sessionId, runId, status, createdAt }`; execution continues natively |
| `sessions.compact({ sessionId })` | As above; this run only compacts context and does not reply |

```js
// Session profile already configured; the agent is obtained as above.
const { session } = await agent.sessions.create();
const run = await agent.sessions.send({ sessionId: session.id, text: 'Look at the files in work/.' });
```

`variables.local` holds local variables for this macro evaluation and is empty when omitted; global variables are copied when `send` begins. Macro writes affect only that working copy, as described in the [macro evaluation API](Macros.md).

Keep `session.id` for later reads and sends. Execution continues after `send` returns, so observe the terminal state through `subscribe(run.runId, ...)` before sending the next message. A busy session, or inputs prepared too long ago, reject instead of retrying automatically.

`title` and `lastUsedAt` are null when unset or when older data is missing the field. `lastUsedAt` is updated when a user message is written, and an unnamed session is given a short title. The catalog is sorted by `lastUsedAt ?? createdAt` in descending order; renaming does not change the order.

History is stored by the backend; after `session_message_appended` arrives you can call `sessions.read()` to update the UI, and live progress continues through `subscribeLiveProjection()`. A history page comes back in ascending seq order, each item as `{ seq, runId, createdAt, message, origin?, compaction? }`; `nextBeforeSeq` pages backwards, and `activeRun` is an active handle or null.

`origin: { invocationId, round }` associates assistant and tool messages, and compaction records, with the round they belong to; it never enters model messages. A user's own messages have no origin, and older history may lack it too. A session seq identifies a persisted message. A compaction record has the user role, with two Text parts holding the explanation and the summary respectively, plus `compaction: { keptFromSeq: number | null, tokensBefore: number, tokensAfter: number }`; it is not a user utterance, does not update the title or `lastUsedAt`, and does not replace the model reply with the same origin. `keptFromSeq` points at the start of the retained whole group, and null means no group was retained.

A session snapshot additionally carries `contextLimits: { context, response, tokenizerModel }`, supplied by the effective model settings at assembly time. For compaction rules see [the run loop](../Agent/Runtime.md#session-context-compaction), and for states and events see [the run journal](../Agent/RunEventJournal.md#one-event). Common failure codes:

| Error code | Meaning |
| --- | --- |
| `agent.session_history_window_unsupported` | The session profile's history window is not `-1` |
| `agent.session_context_limits_missing` | The snapshot has no valid `contextLimits` |
| `agent.session_context_limits_invalid` | `contextLimits.context` is not greater than `contextLimits.response` |
| `agent.context_full` | Compaction cannot bring the context below the compaction point |
| `agent.nothing_to_compact` | On a manual compaction, the earlier part is entirely inside the kept range |
| `agent.compaction_failed` | The model did not produce a summary as required, the reply was truncated, or the input could not be reduced to a summarizable range |
| `model.context_overflow` | The provider reported an overflow; propagated when this round still fails after compaction recovery |

For where a session ends and how it is recovered, see [the run loop](../Agent/Runtime.md); for file retention rules see [Workspace](../Agent/Workspace.md#the-persistent-session-workspace).

## Control and subscription

| Method | Behavior |
| --- | --- |
| `cancel(runId)` | Requests cancellation and returns the chat handle or `{ sessionId, runId, status, createdAt }`; observe the terminal state through events |
| `readCheckpoint(runId)` | Reads the saved state and the recoverability information |
| `resume({ runId, revisionGuidance? })` | Continues the same run, or revises a completed output against new instructions; returns a run handle that carries the subscription cursor `afterSeq` |
| `submitGuidance({ runId, text, clientGuidanceId? })` | Adds instructions to an active run and returns `guidanceId` with `status: 'queued'` |
| `subscribe(runId, handler, options?)` | Subscribes to persisted events and returns an unsubscribe that may be called repeatedly |
| `subscribeLiveProjection(runId, handler, options?)` | Subscribes to the current body text, reasoning text and file tool argument previews; returns an unsubscribe |

A chat guidance message enters the context before the next foreground model request; requests already sent are left as they are. Guidance that has not been consumed survives a resume. This interface does not create chat messages.

`subscribe` takes `afterSeq`, `limit`, `intervalMs` and `onError`, and reads from the start by default. The live preview accepts only `onError`; past progress is read from persisted events. Once unsubscribed, no further callbacks are delivered, including results and errors from in-flight requests.

The live channel uses the following shared protocol, which is not written to the persistent journal:

| `update.type` | Contents |
| --- | --- |
| `snapshot` | `{ calls, responses }`, replacing the current projection |
| `responseReplace` | `{ response }`, a new model round or a retry |
| `responseAppend` | `{ invocationId, text, reasoning, toolIds }`, appending the three fields separately |
| `responseRemove` | `{ invocationId }`, removing this transient response |
| `replace` / `append` / `remove` | The existing file tool argument projections |

`response` contains `invocationId`, `invocationExitPolicy`, `round`, `attempt`, `text`, `reasoning` and `toolIds`. Body text and reasoning share the round and attempt identity, and a completed snapshot does not resend increments. The real assistant message takes over the matching attempt's preview keyed by `runId + invocationId + round`, so handle events and Channel updates that arrive in any order. Failure, cancellation and terminal states clear the preview without writing it to history. The writing Timeline consumes reasoning only, while chat body text still goes through file commits.

`resume` keeps the original inputs and confirmed results and requires that the current chat and messages still belong to the original run; an ordinary regenerate still creates a new run. Subscribe to a resumed run with the returned `afterSeq`; for recovery conditions see [the run loop](../Agent/Runtime.md#checkpoints-and-recovery).

With `revisionGuidance`, a new foreground invocation starts from the completed checkpoint and inherits the context and the original profile. The chat command `/fix <change request>` uses this entry point to revise the current swipe of the last agent reply in place, working from the saved body text.

A v1 checkpoint supports only reading state and revising a completed run; it is converted on the first revision, and the scope is set out in [the run loop](../Agent/Runtime.md#checkpoints-and-recovery).

## History and details

```js
const page = await agent.listRuns({ stableChatId, limit: 20 });
const nextPage = page.nextCursor
  ? await agent.listRuns({ stableChatId, before: page.nextCursor, limit: 20 })
  : null;

const { events, timelineProjection } = await agent.readEvents({
  runId,
  afterSeq: 0,
  limit: 100,
  includeTimelineProjection: true,
});
```

| Method | Returns |
| --- | --- |
| `listRuns({ chatRef?, stableChatId?, statuses?, before?, limit? })` | `{ runs, nextCursor? }` in reverse creation order; `before` is `{ createdAt, runId }`, at most 200 items |
| `readEvents({ runId, afterSeq?, beforeSeq?, limit?, invocationId?, includeTimelineProjection? })` | `{ events, timelineProjection? }`, events in ascending sequence order, at most 500 per page |
| `readWorkspaceFile({ runId, path })` | `{ path, text, chars, words, sha256 }` |
| `readWorkspaceBytes({ runId, path })` | `Uint8Array`; capped at 1,000,000 bytes, for reading tool result images |
| `readModelTurn({ runId, invocationId?, round, maxChars? })` | Assistant text, visible reasoning, tool calls and the provider summary |
| `readTaskDetail({ runId, taskId, includeResult? })` | The task description, its current state and, on request, the result |

`listRuns` stays within chat history scope; session conversations use `sessions.read`, while events, model turns and workspace details read by runId work for both kinds of run. `beforeSeq` reads the most recent page before that sequence number, and `afterSeq` is for catching up forwards. `invocationId` filters by ownership before paging, which suits a sub-agent's local Timeline. `timelineProjection` covers the invocations and delegation relations of the whole run and is independent of the current event page.

`readModelTurn`'s `round` starts at 1, and omitting `invocationId` reads the root agent. `maxChars` limits the displayed text, while the character and word totals still describe the full content.

`readTaskDetail` puts both a delegated `task` and a handoff under the return value's `task` field and preserves custom fields. The state is the state at read time. `includeResult` defaults to `false`; when it is `true`, the result is `{ summary, summaryRef, output }` if one exists, and `result` is `null` otherwise.

Model turns, task details, the tool catalog and Timeline relations are UI projections that evolve with the project (a Project Contract). The UI reads its content through these APIs, and the concrete types live in `src/types.d.ts`. For log semantics see [the run journal](../Agent/RunEventJournal.md).

## Profiles, prompts and the tool catalog

| Method | Purpose |
| --- | --- |
| `profiles.list()` | Returns the profile list and file diagnostics |
| `profiles.load(profileId)` | Returns `{ profile }` |
| `profiles.save(profile)` / `delete(profileId)` | Saves or deletes a configuration |
| `profiles.diagnose(profileId)` | Checks references to presets, models, tools and so on |
| `profiles.resolveSystemPrompt({ profileId? })` | Returns `{ agentSystemPrompt }` |
| `profiles.repairFile({ profileId, action })` | Deletes a broken configuration or normalizes its identity; action is `delete` or `normalizeIdentity` |
| `profiles.retargetPresetRefs({ from, to })` | After a preset is renamed, updates matching references in ordinary profiles and in the shared session profile; both ends are `{ apiId, name }` |
| `promptAssembly.prepare(input)` | Resolves the profile and the frozen inputs, and returns the assembly mode and the requests |
| `promptAssembly.buildSnapshot(request)` | Runs PromptManager in the frontend and produces the snapshot |
| `promptAssembly.buildCurrentModelConnectionSnapshot(input)` | Produces a connection snapshot from the current settings |
| `promptAssembly.applyCurrentModelConnectionSnapshot(input)` | Applies a connection snapshot to the assembly settings |
| `tools.list({ context? }?)` | Returns `{ tools, diagnostics }` covering built-in tools, available MCP tools and registered extension tools; context is `chat` or `session` |
| `tools.register(definition, execute)` | Registers a plain JS tool function and returns `Promise<void>` |
| `tools.setEnabled(toolId, enabled)` | Enables or disables a registered extension tool without deleting the function or rewriting the profile |

For how to use profiles, see the [configuration guide](../Agent/ProfilesAndPreset.md). `tools.list()` returns stable tool IDs, descriptions and argument schemas; the names the model calls belong to the invocation snapshot.

`profiles.retargetPresetRefs` returns `{ updated, profileIds, sessionProfileUpdated }`; the total `updated` includes the shared configuration, while `profileIds` lists ordinary profiles only.

`profiles.resolveSystemPrompt` returns the profile's instruction body; for how the runtime appends its catalog see [Prompt assembly](../Agent/PromptAssembly.md#skill-and-agent-catalogs).

## Registering extension tools

Register a plain JS function in the extension's startup entry point; module references and closures are available directly. The stable ID is `extension/<extensionId>:<name>`, and a duplicate registration reports an error. Registration persists until the main page reloads and is independent of the panel switch.

```js
await agent.tools.register({
    extensionId: 'my-extension',
    name: 'read_auto_reply_settings',
    description: 'Reads whether automatic replies are enabled.',
    inputSchema: { type: 'object', properties: {} },
    contexts: ['chat', 'session'],
    enabled: true,
}, async () => {
    return { enabled: true };
});

await agent.tools.setEnabled('extension/my-extension:read_auto_reply_settings', false);
```

The model uses `name` as the basis for its call name, and naming and result expression follow the [tool contract](../Agent/ToolSystem.md). `description` states the purpose and any necessary limits, while return values and errors state the actual outcome or the specific problem.

`contexts` is required and must be non-empty, and `enabled` defaults to true; after registering, the tool still has to be selected in a [profile](../Agent/ProfilesAndPreset.md#adjusting-how-the-agent-works). A disabled tool accepts no new calls, calls already under way continue, and `list()` still includes the disabled entry. Persisting the switch is the extension's own responsibility, through its settings or `api.extension.store`, and it re-registers according to the saved value after a page reload.

The callback receives JSON object arguments and an execution context in which `target` points at the chat or session the run belongs to, independent of the current UI, and `signal: AbortSignal` offers cooperative cancellation that does not roll back operations already performed. For the full fields see the [type definitions](../../src/types.d.ts).

Attach images with `context.attachImage(blob)`, and describe the result in the function's JSON return value. For normalization, storage and context retention see [tool results](../Agent/ToolSystem.md#how-results-enter-the-next-round).

`returnsImages` defaults to false; for the declaration and binding rules see [extension tools](../Agent/ToolSystem.md#extension-tools).

A function may return a JSON value asynchronously, and a top-level `undefined` comes back as `null`; a thrown error, or a value that cannot cross the JSON IPC boundary, reports a tool error. If there is no acknowledgement for 60 seconds, the call is asked to cancel and "execution result unknown" is handed to the model as a tool error so that it can continue, with no automatic resend; the script may still be running, so later operations should check the state first. A user-initiated cancellation still ends the run.

## Retention policy

```js
const settings = await agent.retention.readSettings();
const plan = await agent.retention.planPrune({ detailLimit: 20 });
```

| Method | Behavior |
| --- | --- |
| `retention.readSettings()` | Returns the auto-prune switch and the two retention counts |
| `retention.updateSettings(patch)` | Saves a partial update |
| `retention.planPrune({ retention?, detailLimit? })` | Previews the prune range and the statistics |
| `retention.applyPrune({ retention?, detailLimit? })` | Recomputes and performs the cleanup, returning the result and `afterPlan` |

Pruning covers chat runs and never sessions. The settings are `autoPruneEnabled`, `keepRecentTerminalRuns` and `keepFullRecentRuns`. The full-retention count must not exceed the core history count, and auto-prune is off by default. A one-off `retention` argument overrides the retention counts for that operation only.

A preview distinguishes reducing material from deleting a whole run, and returns the runs that cannot be pruned. `failedRuns` in the result holds the items that did not finish. `detailLimit` only controls how many details come back; it changes neither the scope nor the totals.

## Host lifecycle

Committing a chat is a joint effort between the runtime and the host; the model requests a commit with `workspace.commit`. The host calls `settleChatPresentation({ runId })` and waits for the message to be presented and the checkpoint saved; a failure can be retried, and message writes that already completed are not repeated.

When a chat is forked, `copyChatPersistentStates({ sourceChatRef, sourceStableChatId, targetChatRef, targetStableChatId })` copies the persistent versions. After messages or swipes are deleted, `pruneChatPersistentStates({ chatRef?, stableChatId?, candidateStateIds })` clears the explicitly listed versions that the current chat no longer references; this pruning entry point currently supports character chats only.

`approveToolCall()` is a reserved entry point that is not implemented and throws when called. There is no general rollback API today.

## Errors and implementation

Asynchronous methods reject on failure; subscription errors travel through `onError`. The reason a run failed is kept in the log, and when the failure comes after a confirmed commit the run keeps its output and ends as `partial_success`.

- [types.d.ts](../../src/types.d.ts): interface parameters and return types.
- [agent.js](../../src/tauri/main/api/agent.js): API installation, startup and host bridging.
- [agent-run-runtime.js](../../src/tauri/main/api/agent-run-runtime.js): control, subscription and reads.
- [agent-sessions.js](../../src/tauri/main/api/agent-sessions.js): the session SDK and the shared profile.
- [agent_commands.rs](../../src-tauri/crates/tauritavern/src/presentation/commands/agent_commands.rs): the Rust command boundary.
