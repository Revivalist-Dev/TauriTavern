# In-App Assistant

`in-app-agent` is a system extension that is enabled by default. It provides independent Session conversations in the A drawer and reuses the existing Agent Runtime, workspaces, and tool chain. Whether the user disables it follows the extension loading mechanism and does not depend on how the Agent System extension is written.

## Lifecycle and configuration

- The entry point waits for the host to be ready and registers its tools, then mounts through the APP_READY callback. It must not wait for APP_READY at extension top level: upstream emits that event only after extension loading has finished.
- One React root corresponds to one controller; opening it for the first time reads the configuration and the history, hiding it keeps the view and its subscriptions, and unmounting releases the subscriptions without cancelling the native Run.
- Choosing a model for the first time saves a Profile that references the built-in `openai/Agent` preset. `app.snapshot`, `app.interact`, `app.capture`, `app.evaluate`, `app.read_logs`, plus `workspace.read_file`, `workspace.list_files`, and `workspace.search_files`, are enabled by default; other tools are selected in as needed. For the preset's values and tradeoffs see [the built-in agent preset](../Agent/ProfilesAndPreset.md#the-built-in-agent-preset). An existing Profile keeps the user's choices and instructions, and a new tool is enabled explicitly from the assistant settings.
- The model and reasoning-effort choices in the input box save immediately and are synced into an unsaved settings draft; a change affects the next send and does not alter the input frozen for a run in progress.
- The session selection is stored in `localStorage`: null means a new conversation, and an unsaved selection or one whose target has been deleted opens the most recent session. `extension.store` stores the width preference; Session data and the shared Profile are managed by the Session API.
- Skills come from the built-in scope and the assistant Profile's scope, and a Profile beats a built-in package of the same name. A new Profile defaults to `visible: ['*']`, and unchecking a box adds the entry to `deny`; an existing explicit list is left as it is, and the settings show and edit it under the same visibility rules. Installation shares [import admission](../API/Skill.md#preview-and-install) with the Skill Manager. Cancelling the setting releases the source awaiting confirmation without undoing an installation already done; selecting a Skill does not enable the Shell automatically.
- The built-in knowledge lives in [default/skills/](../../default/skills/) and its text is read on demand; built-in packages are read-only, and for their sources and macro rules see [Skill](../Agent/Skill.md).

## Running and history

The current session and the active task are independent; switching does not cancel a task, the assistant sends only one task at a time, and the public Session API still gates admission per session. A draft per session lives only in memory; new conversations share one empty draft, and a Session is created only on the first send.

The source draft is cleared only once the request has been accepted; when a send's outcome is uncertain, the session and the draft are kept, the backend state is checked, and nothing is resent automatically. A cancellation has to wait for the backend's terminal state and does not roll back operations that already happened.

History, progress, and previews each have their own source:

- `messages` is the formal record the backend saves, compaction records included; it pages by Session seq, fills gaps, and merges. `events` provides only progress and terminal states and does not rebuild the conversation.
- `responses` holds transient bodies and visible reasoning; the formal record takes over from the preview by model-turn identity. For the protocol see [Agent API](../API/Agent.md#control-and-subscription).
- Tool results are associated by the same turn identity plus `callId`; a call ID may be reused across turns. A record with no origin is associated by message order, and a result must not be overwritten by a `callId` from elsewhere in the Run.

Run state follows the backend's active Run; with no active Run and no terminal evidence, the view shows interrupted and does not replay tools. The current Run is the active Run, or failing that the Run the latest message belongs to; a Run that has just finished being observed and is later than the latest message (a failed compaction, say) stays current until a newer message appears.

When the context reaches the compaction point of the preset budget, or the provider reports a context overflow, the runtime compacts automatically; for the rules see [the run loop](../Agent/Runtime.md#session-context-compaction). The status bar shows that compaction is running; the Transcript shows "Context compacted" with the token counts before and after among the work items of the Run it belongs to, expandable to the summary. A compaction record is not shown as a user bubble and does not trigger the automatic follow of a new user message; the original conversation stays in the history. The context-usage ring in the input box shows the current Run's latest count as a share of the compaction point; the count comes from run events and the frontend does no tokenization. "Compact now" in the menu starts a compaction Run while the assistant is idle. Compacting mid-Run requires the page to be online; after a page reload, the host resumes assembly replies for a Run that is still active.

## Performance

Streaming applies text and reasoning in top-level block batches and updates only the Run whose content changed; an unchanged Run is not re-rendered. The transcript keeps a bounded tail of the session history, reads older pages backwards, and the runtime reads Session history from the end when assembling a prompt. Provider responses that arrive as oversized or partial SSE payloads are handled without restarting the stream. Preview height changes are coalesced into an animation frame. The frontend performance baseline covers these paths and is updated only when a counter change is intended.

The performance batch was taken from `Darkatse/TauriTavern` `dev`: `572bf8bb` (streaming frames), `5ef85d24` (preview height), `38e17bb1` (in-app-agent live updates), `e32de36d` (partial SSE events), `430ee843` (event tracing), and `2cb72aeb` (Session history tail). Local additions in the same pass narrow the panel resize observer to the settings holder so message class changes do not force style recalculation during a stream.

## Interface and tool boundaries

The original advanced-formatting node and the drawer behavior are kept, including theme transparency, blur, and the mobile constraints. On desktop the assistant covers the chat input area downwards and its content width defaults to 100%; the width setting affects only the inner content, and mobile and narrow windows fill the available width.

The model menu updates as the Connection Manager's Model Target changes; when a binding is unavailable the user has to choose again. Reasoning effort shows the configured levels; for the parameter semantics see [Profile](../Agent/ProfilesAndPreset.md#choosing-the-prompt-and-model).

Messages are grouped by Run; intermediate turns, tools, and reasoning collapse, while the final answer stays visible; the current Run and the latest Run are expanded by default.

The history page reads the directory only and pages the body of the selected session; a read result for an old session must not overwrite a newer view. Keyboard events are isolated from character chat: an inner control consumes Escape with `preventDefault`, and the drawer does not handle it again. Markdown uses a standalone Showdown + DOMPurify setup and does not enter the chat macro, regex, or script execution chain. Tool results are read through explicit externalized paths; images are read by the path and MIME type in `result.images`, a thumbnail loads when the tool detail expands, and the object URL is released on unmount.

| Session tool | Contract |
| --- | --- |
| `app.snapshot` | Reads a bounded DOM semantic snapshot of the main page and same-origin iframes on demand, supporting drill-down into an area, direct location by a known CSS selector, and paging; direct location follows the observation boundary and requires a unique observable match, and does not expand, scroll, or wake the page. |
| `app.capture` | Captures the content viewport natively and crops, masks, and labels inside the page; sensitive fields and host omit regions follow the same rules as `app.snapshot`, while technical omissions such as CodeMirror stay visible. It is offered only when the model accepts images, and the labels come from the most recent snapshot page. |
| `app.interact` | Operates a control with the latest ref or a known selector, and shares the check and execution path once located; returns the dispatch outcome and the immediate state. A refused operation distinguishes hidden, outside the viewport, and detection-point miss, and names the element actually hit and the page its coordinates belong to; a recoverable error does not end the task, and reading back does not prove that an asynchronous save has completed. |
| `app.evaluate` | Runs one async function body in the current WebView with `api` and `context` injected and returns JSON explicitly; an exception propagates along the shared tool chain and is not rerun under a different wrapper. Synchronous JS cannot be force-terminated, and a timeout or cancellation does not undo its effects. |
| `app.read_logs` | Reads the retained logs, filtering by level before taking the tail, and returns the capture switch state; it does not change capture settings or clear logs. |
| `workspace.read_file` / `workspace.list_files` / `workspace.search_files` | Read, list, and search session material and effective Skills through the unified workspace view; they grant no write or Shell permission. |

The engine that reads and operates the interface comes from [@tauritavern/app-use](../../packages/app-use/README.md). The extension registers its tools through the existing Extension Provider and hands the TT-specific parts to the engine: the sensitivity marker `[data-tt-sensitive]`, the assistant history region to omit, the control shell, and scrolling of `#chat`. Execution of `evaluate` and `read_logs` is implemented by the extension. Bodies and reasoning merge into a bounded preview per region that keeps the controls inside it, and omitted text does not enter pagination; a snapshot does not provide complete business data.

The interaction cursor and its styling come from that package as well. The cursor shows the position that actually passed the hit check, follows the theme, and respects the reduced-motion setting; the animation does not block tool execution, its lifetime follows the assistant's active task, and it is removed when the task ends or the page unloads.

An iframe shows only an entry by default, and its ref is used as the root to enter it; `snapshot({})` returns the main page. Each page belongs to one document; interaction checks host occlusion layer by layer and maps the cursor position to the main page. The pause-and-resume entry point comes from the Embedded Runtime.

A reference is valid only for the most recent page of the current Run; a new snapshot, a Run switch, or a reload of the page or an ancestor iframe invalidates an old reference. Paging reads the live interface, and interact/evaluate invalidate an old continuation position; closing the assistant drawer does not stop tools from running. For exact parameters, supported scope, and recovery guidance, the [tool definitions](../../packages/app-use/src/tools.ts) in the package are authoritative, and the extension's [tools.ts](../../src/scripts/extensions/in-app-agent/src/tools.ts) adds TT-specific notes.

## Maintenance entry points

The source is in [in-app-agent/src](../../src/scripts/extensions/in-app-agent/src): `index.ts` and `drawer.ts` handle integration; `controller.ts` and `session-state.ts` own session state; `host.ts` adapts the public APIs and page capabilities; `ComposerMenu.tsx` centralizes the input-box menu interaction. For the UI layering see [First-party UI](FirstPartyUI.md), and for where to start verifying see [Agent testing](../Agent/TestingStrategy.md).
