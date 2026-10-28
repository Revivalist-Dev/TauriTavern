# Workspace

A workspace holds the files an agent works on repeatedly. Chat working files belong to a run, Session working files are shared by every run of that conversation, and each gets its read and write scope from the Profile; `skills/` offers a read-only file view built from the current Invocation's effective skill bindings.

## Where files live

Working directories and automatically visible read-only directories in the default Profile:

| Directory | Purpose |
| --- | --- |
| `output/` | Body text or other output ready to commit, with `output/main.md` as the default body |
| `scratch/` | Drafts and temporary material |
| `plan/` | Plain plan files |
| `summaries/` | Summaries and readable versions of child agent results |
| `persist/` | The working copy of persistent content for this run |
| `tool-results/` | Tool results, readable versions of longer results, and tool result images; read-only |
| `skills/` | The current Invocation's effective skill packages, including the built-in packages a Session can use; read-only, and an empty directory when nothing is bound |

The model finds and reads material with `workspace.list_files`, `search_files`, and `read_file`, changes text with `write_file` and `apply_patch`, and processes files in bulk with `workspace.shell`. Paths are relative to the workspace, such as `output/main.md`; `/output/main.md` in the Shell points at the same file.

When a text tool replaces an existing file or applies a patch, it checks for conflicts with the read records and the content SHA. The Shell creates no such read record; after the Shell changes a file, read it again before replacing it or applying a patch.

An ordinary run file read returns the original text, and a script can expand a template with `macros.render()`; see [Skill](Skill.md) for the macro rules on skill files. The chat and World Info are read through their own tools.

## The unified file pipeline

Text tools and the Shell (including Python and JavaScript) reach the same logical view through `WorkspaceFs`. Ordinary files and runtime material live in the run's real directory, and `WorkspaceRepository` owns initialization, the manifest, and persistent version publication; `SkillRepository` reads the raw skill files, and the application layer owns bindings and macro projection.

The model side uses the current Invocation's `ScopedWorkspaceFs`; the business root itself is immutable, and `tool-results` and `skills` are read-only. User-installed and built-in skills share external mounts and are never copied into the run directory.

Run working files allow parallel reads and serialize changes per single operation; CAS runs its condition check and its write inside one lock. A multi-step operation is not a transaction, and a successful step takes effect immediately; a Shell failure or cancel does not roll back completed changes. Appends use native append, a failure can apply partially, and nothing replays automatically.

## JavaScript

`workspace.shell` runs JavaScript ESM through QuickJS, with `js` as the entry point; `node` and `deno` are command aliases for the same restricted environment and provide no Node/Deno standard library. See `js --help` for commands and API usage.

A script entry resolves against the Shell's current directory, an import against the importing module, and the `@tauritavern/runtime` file API against the workspace root. Modules load on demand, files are read and written directly, and the permission and commit rules above apply.

A module runs its top-level code, the script calls business functions explicitly, and asynchronous work uses `await`. Arguments come from `process.argv`, and a file script uses `process.argv.slice(2)` to get string arguments; the script parses options and subcommands. See `js --help` for the argument boundaries of file, stdin, and eval.

Structured results go explicitly to stdout and diagnostics to stderr; use workspace files for larger input and output. `process.exitCode` defaults to 0 and accepts an integer from `0–255`, and an invalid assignment throws. An uncaught exception or a non-zero exit code means failure, and the existing file retention and automatic commit rules apply.

`context` and `macros` use the run's frozen input, and child agents and resumed calls keep using it. A missing chat context does not affect ordinary JS and file operations; only touching an unavailable context field reports an error.

Cancelling stops further Shell dispatch and waits for the current JS and the file operations already started to settle. Settlement is bounded by the whole `workspace.shell` call returning; an inner `timeout` does not guarantee that a single command has finished.

## How runs relate to chats

On-disk data lives under `_tauritavern/agent-workspaces/` in the data directory:

```text
agent-workspaces/
  index/
    runs/<run-id>.json
  chats/<workspace-id>/
    persistent-states/<state-id>/
      manifest.json
      persist/...
    runs/<run-id>/
      run.json
      manifest.json
      events.jsonl
      input/...
      invocations/...
      tasks/...
      agent-results/...
      model-responses/...
      tool-args/...
      tool-results/...
      output/...
      scratch/...
      plan/...
      summaries/...
      persist/...
```

`workspaceId` derives from the chat kind and the `stableChatId`. The chat file name locates the current chat, and the stable identity ties its runs together. Every generation creates a new `runId`.

`manifest.json` describes the workspace directories and the output; `input/` keeps the starting point for prompts, the Profile, and persistent content. Directories such as invocations, tasks, and model responses serve the runtime and the detail APIs.

## Committing to the chat

The commit and persist publication rules below apply to the Chat target only.

When the model calls `workspace.commit`, the runtime reads the named accessible run working file and asks the frontend host to save it. The default replaces the body of this output message; `append` adds the file content to this output. The host bridge follows SillyTavern's output handling and save flow and hands the result back to the runtime on success.

Before the first explicit commit, a foreground run also shows writing progress: streamed text forms a live body, and qualifying text changes commit automatically as progress records. After the first explicit commit succeeds, later chat publication is controlled by explicit `workspace.commit` calls. `workspace.finish` still requires at least one explicit commit from the foreground.

The Shell and text tools share the automatic commit rule: each round publishes at most the last qualifying text file that changed, reading its current content at commit time. A non-zero Shell exit, a cancel, or a timeout clears the round's pending candidate.

A confirmed commit stays even if a later run fails. The detailed model, tool, and file processing goes to Timeline; the chat message keeps the body, the visible reasoning, and the metadata of the related run.

## Carrying content into the next run

`persistBaseStateId` names the starting point for `persist/`. At initialization the repository copies the matching persistent version into this run, and the model then changes it like an ordinary file.

`workspace.finish` publishes the files and directories of `persist/` as an immutable version and writes its ID into the agent metadata of the committed message. The version reflects deletions, moves, and empty directories; a revision that leaves the complete state unchanged reuses the previous version. Later generations pick their starting point from the current message or swipe, so different candidates can keep their own persistent content.

Branching a chat copies the persistent version and uses a new chat identity. Run history cleanup and persistent version cleanup are separate: trimming an old run's material never deletes persistent content a chat still uses.

## Retention and cleanup

Run history splits into core records and full material. A recent run keeps every file, an older run can keep only `run.json`, the journal, and the summary, and a run beyond the history window is deleted whole. After material cleanup, Timeline still shows the retained events, and the matching file details may no longer be readable.

`api.agent.retention` provides the settings, preview, and execution entry points; automatic cleanup is off by default. See [Agent API](../API/Agent.md) for the operation parameters.

## The persistent session workspace

```text
agent-workspaces/sessions/
  profile.json                      shared configuration
  <session-id>/
    session.json                    session metadata
    history.jsonl                   continuous messages
    workspace/{work,tmp,tool-results}/
    runs/<run-id>/                  records of each execution
```

`work/`, `tmp/`, and the read-only `tool-results/` survive across runs and restarts, and the agent clears its own temporary material. The Shell's `/tmp` points at the workspace directory, not the host temp directory. History and files are isolated per Session, and only the Profile is shared.

Session files change directly and never publish Chat persist versions. The data stays on this machine and takes part in neither existing sync nor Chat retention; a full data archive still includes it.

Deleting a Session cleans its directory and run index, keeps the shared Profile and the skills, and does not roll back changes tools made to other application data. See [Session API](../API/Agent.md#persistent-sessions) for call constraints.

## Source

- [workspace_policy.rs](../../src-tauri/crates/tt-application/src/services/agent_profile_service/workspace_policy.rs): the directory-to-Profile mapping.
- [workspace tools](../../src-tauri/crates/tt-application/src/services/agent_tools/workspace): file reads, changes, and commit requests.
- [WorkspaceFs](../../src-tauri/crates/tt-ports/src/workspace_fs.rs): the shared file contract and text convenience methods.
- [ScopedWorkspaceFs](../../src-tauri/crates/tt-application/src/services/agent_workspace_scope.rs): the Invocation-scoped view.
- [WorkspaceShell adapter](../../src-tauri/crates/tt-adapter-workspace-shell/src): Shell, JavaScript, the execution-time file bridge, and wrap-up.
- [FileAgentRepository](../../src-tauri/crates/tt-adapter-storage-userdata/src/repositories/file_agent_repository): paths, files, persistent versions, and cleanup.
- [Chat commit bridge](../../src/tauri/main/api/agent-chat-commit-bridge.js): integration with frontend chat saving.
