# Run event journal

`events.jsonl` is the append-only journal of one run. It records the steps that already happened, so Timeline and history queries can rebuild the run's course after the page closes.

## One event

Each line is a JSON object:

```json
{
  "seq": 1,
  "id": "evt_...",
  "runId": "run_...",
  "timestamp": "2026-09-06T12:00:00Z",
  "level": "info",
  "type": "run_created",
  "payload": {}
}
```

`seq` increases from 1 without gaps and is the cursor for paging and for following new events. Every Invocation in a run shares the sequence. The repository serializes appends, and existing events stay as they are.

Events record stage information and file references. Tool arguments, full results, and model responses are stored separately, so reading Timeline does not carry the whole context every time. The common events read as one run:

```text
run_created
  → workspace_initialized
  → model_request_created → model_completed
  → tool_call_requested → tool_call_completed / tool_call_failed
  → workspace_file_written / workspace_patch_applied
  → chat_commit_requested → chat_commit_completed
  → run_completed / run_partial_success / run_failed / run_cancelled
```

This sketch shows the main steps; a run usually has several rounds of calls, and it also records state changes, delegation, handoff, and user guidance along the way.

A Session run emits `prompt_assembly_requested` too, which the host answers with the prompt rebuild after compaction.

A Session's `model_request_created` carries `context: { tokens, point }`, the context usage and compaction point for that request, which is the count the runtime uses to decide compaction. The status is `compacting_context` while compaction runs. `context_compaction_started` carries `round`, `invocationId`, `trigger` (`point`, `overflow`, or `manual`), and the current `tokens`; on success `context_compacted` carries the same round identity, the `seq` of the compaction record, `tokensBefore`, `tokensAfter`, `keptFromSeq`, and `point`. A compaction inside the loop then returns to `calling_model`, and a manual compaction run ends right after. The compaction record itself is read through a `session_message_appended` notification, and the summary body lives in the Session history rather than being copied into the event.

## Reading and display

`api.agent.readEvents({ runId, afterSeq, limit })` reads the events after a cursor. `beforeSeq` reads the nearest page before the given sequence number, with the results still ordered by ascending sequence. `api.agent.subscribe()` follows new events on top of that.

Passing `invocationId` reads one agent's process. An event's `payload.eventScope` names the primary and the related Invocations, and the backend filters by those attributions before paging.

Timeline also needs the whole agent relationship. `includeTimelineProjection: true` attaches a relationship graph built from the Invocation and Task records, independent of the current event page. Task details come from `readTaskDetail()` and model rounds from `readModelTurn()`, so a page never touches the internal file formats.

`subscribeLiveProjection()` provides live previews of tool arguments and reasoning text. Collapsed, it renders a three-line tail preview; expanded, it shows everything received so far and grows naturally, and auto-scroll to the bottom pauses while the user reads. Historical events stay virtualized at a fixed row height, and the few live blocks use natural height on their own. This is display state in memory; the final execution results still come from the journal. Timeline omits automatic progress commits by default, and the raw journal keeps those records.

## What can be rebuilt

The journal supports reviewing model and tool steps, relating files, tallying commit results, and explaining the final state. The summary in the run list is a rebuildable cache, and a finished run can reuse it.

Complete body text depends on the referenced files. After history cleanup the core journal may remain while model responses or task results are gone. The current journal is also not used to re-execute tools, resume a suspended run, or restore file content at an arbitrary moment.

When you add an event, record it in the runtime path that owns the action and carry the run, Invocation, or Task information that locates the action. Larger content still goes into files.

## Source

- [journal.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/journal.rs): event attribution and state records.
- [run_store.rs](../../src-tauri/crates/tt-adapter-storage-userdata/src/repositories/file_agent_repository/run_store.rs), [event_journal.rs](../../src-tauri/crates/tt-adapter-storage-userdata/src/repositories/file_agent_repository/event_journal.rs): appends and paged reads.
- [agent_run_history_service.rs](../../src-tauri/crates/tt-application/src/services/agent_run_history_service.rs): history summaries and cleanup.
- [run-event-presenter.ts](../../src/scripts/extensions/agent-system/src/run-event-presenter.ts): Timeline's event display.
