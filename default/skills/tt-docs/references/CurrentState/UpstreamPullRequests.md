# Upstream PR assessment (Windows-only baseline)

This document records the per-PR assessment of open upstream PRs against the **2.4.0 Windows-only**
baseline. The assessment decides only whether a PR is worth merging; it is not a merge action.
Verdicts are:

- **Apply**: consistent with the Windows target and low-risk; merge once confirmed.
- **Defer**: the direction has value, but it depends on work that has not landed (UI re-layout,
  capability review); reassess once the prerequisite is met.
- **Reject**: non-Windows platform work, or in conflict with this branch's Windows-only rules.

Baseline: `v2.4.0` (`fff9af0`); the local branch carries only the Windows-only trimming and the
SillyBunny host layer.

## UI / panel PRs already merged into 2.4.0 (not processed again)

| PR | Title | 2.4.0 ancestor |
| --- | --- | --- |
| #240 | Panel Runtime / Layout API | Yes (`024d36f`) |
| #301 | Panel layout and sidebar | Yes (`427ed6e`) |
| #353 | Panel UI fixes | Yes (`0a84236`) |

Verdict: all three are already in the baseline; **do not cherry-pick them again**.

## Open PR decision table

| PR | Title | Status | Decision | Windows-only rationale |
| --- | --- | --- | --- | --- |
| #306 | fix(characters): accept preserved import names without png suffix | CONFLICTING | **Apply (rebase first)** | A Windows regression fix for the character import path, with changes concentrated in `character-identity.js` and the import routes. The conflicts come from routes and tests this branch has already modified, and the semantics can be kept. |
| #336 | fix(downloads): save host-served resources through the native save flow | MERGEABLE | **Apply** | WebView2 downloads have to go through the host's native save flow, and the current code still uses page downloads; the new `download_dispatch.rs` is a capability Windows benefits from directly. |
| #339 | feat(quick-js): let JS scripts run workspace commands (shell.exec) | MERGEABLE | **Defer** | Platform-independent, but exposing `shell.exec` to scripts is a capability expansion that needs its own security review (command allowlist, workspace boundary, subagent inheritance). |
| #340 | feat(bashkit): register builtin tools and MCP as shell commands | CONFLICTING | **Defer** | Depends on the shell extension in #339, and it touches the agent runtime, MCP, and prompt snapshots at the same time. The conflict surface is large, so assess it as a whole once #339 is settled. |
| #356 | feat(android): background keep-alive service and wakelock | MERGEABLE | **Reject** | Pure Android platform work (`gen/android`, foreground service, wakelock), in direct conflict with this branch's Windows-only rules. |
| #359 | fix(webview): send no Referrer for app host origins | MERGEABLE | **Apply** | In-app resource requests from WebView2 should not carry a Referer; the change stays inside `tauri_resource_adapter.rs` and is compatible with the trimmed resource delivery path. |
| #373 | fix(chat): refuse writes without an editor; check before re-render | MERGEABLE | **Apply** | A Windows WebView2 regression fix for the chat editor; the change is small and has no coupling to the UI layer. |
| #377 | Feat/chat save progress | CONFLICTING | **Defer** | The save-progress indicator goes into the settings panel and the status capsule, so it has to build on the new host UI layer. The conflict surface is large right now, so redo it once the UI layer is stable. |
| #378 | perf(save): coalesce or take over duplicate writes | MERGEABLE | **Defer** | Save coalescing rewrites the write timing in `src/script.js`, and it overlaps the chat rendering changes in the SillyBunny host layer. Merge and re-test after the UI layer lands. |

## Suggested merge order

1. #359 (the smallest, a pure WebView2 behaviour fix).
2. #336 (the download path; verify the native save dialog by hand on Windows once).
3. #373 (the editor guard; run the chat editing contract tests).
4. #306 (after rebasing, keep the new identity-resolution branch and re-check the import contract
   tests).
5. Assess #377 and #378 once the UI layer is stable; #339 and #340 go through a separate security
   review; #356 is excluded permanently.

## Review checklist

- [ ] Verify every Apply PR by hand in a Windows debug build.
- [ ] After merging, rerun `cargo test -p tauritavern --lib`, `pnpm run check:frontend`, and the
      relevant contract tests.
- [ ] If a later upstream release contains these PRs, take them through the version upgrade instead of
      cherry-picking them again.
