# Agent testing

Test admission follows the [contributing guide](../../CONTRIBUTING.md#test-admission): verify observable behaviour, a non-trivial boundary, or a defect already fixed. Prefer extending an existing behaviour test so one verification covers a whole data flow.

## Where to verify

| Change | Existing entry point |
| --- | --- |
| Runs, Session continuity, catalogs, collaboration, commits | [host Agent contract tests](../../src-tauri/crates/tauritavern/src/app/contract_tests/agent_runtime) |
| Session grouping, counting, and compaction | [session_context.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/session_context.rs) and [Session contract tests](../../src-tauri/crates/tauritavern/src/app/contract_tests/agent_runtime/session.rs) |
| Session history placement and depth injection | [PromptManager browser tests](../../tests/browser/agent-session.test.mjs) |
| Macro input capture and request parameters | [SDK capture](../../tests/browser/agent-macro-capture.test.mjs), [prompt assembly](../../tests/browser/additional-parameters.test.mjs) |
| Files and persistent versions | [FileAgentRepository tests](../../src-tauri/crates/tt-adapter-storage-userdata/src/repositories/file_agent_repository/tests.rs), [file semantics loop](../../src-tauri/crates/tt-adapter-storage-userdata/src/repositories/file_agent_repository/tests/workspace_fs.rs) |
| Model protocols and continuation | [gateway tests](../../src-tauri/crates/tt-application/src/services/agent_model_gateway/tests.rs) |
| Host API | [agent-api-contract.test.mjs](../../tests/agent-api-contract.test.mjs) |
| Profile, history, and Timeline UI | [agent-system tests](../../src/scripts/extensions/agent-system/src) |
| In-app assistant history catch-up, admission boundaries, and interaction defects | [in-app-agent tests](../../src/scripts/extensions/in-app-agent/src) and [app-use tests](../../packages/app-use/src); accept theme, geometry, and plain forms in the native WebView |
| Skill files, macros, and scripts | [host execution loop](../../src-tauri/crates/tauritavern/src/app/contract_tests/agent_runtime/execution.rs), [Skill repository](../../src-tauri/crates/tt-adapter-storage-userdata/src/repositories/file_skill_repository/tests.rs) |
| Old data migration | [Profile import](../../src-tauri/crates/tauritavern/src/app/contract_tests/profile_migration.rs), [run revision](../../src-tauri/crates/tauritavern/src/app/contract_tests/agent_runtime/legacy_revision.rs) |
| Shell and JS files and commits | [host integration](../../src-tauri/crates/tauritavern/src/app/contract_tests/agent_runtime/shell.rs) |
| Execution and cancellation boundaries | [JS tests](../../src-tauri/crates/tt-adapter-workspace-shell/src/javascript/tests.rs), [wrap-up tests](../../src-tauri/crates/tt-adapter-workspace-shell/src/tests.rs) |

Use temporary directories and the real repository when files are involved; coordinate concurrency with a channel, a barrier, or a controlled future, and assert the outcome and the final content of the racing operations. Never prove concurrency correctness by acquiring a private lock or by a single poll returning Pending.

## Running the checks

Run the affected part first, for example:

```sh
cargo test --manifest-path src-tauri/Cargo.toml -p tauritavern contract_tests::agent_runtime
cargo test --manifest-path src-tauri/Cargo.toml -p tt-adapter-workspace-shell
node --test tests/agent-api-contract.test.mjs
pnpm run test:browser
```

After the change, run the repository checks:

```sh
node scripts/check-rust-crate-boundaries.mjs
pnpm run check
```

Manual verification can start from the default Profile: run one writing task, inspect the files and the commit, then pick the delegation, handoff, cancellation, or history scenario this change touches. The test scope follows the behaviour that actually changed.
