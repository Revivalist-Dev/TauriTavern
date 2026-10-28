# TauriTavern Workspace Guidelines for AI Agents and Chats

## Read this first: English-only, Windows-only

- Every file in this repository is English: UI copy, documentation, comments, commit messages, test names, CLI output and error messages. Do not add Chinese or any other non-English prose. The non-English locale files have been removed and the application always runs in English. Non-English characters are permitted only in provider API values and Unicode fixtures listed under "Exemptions" in `docs/TranslationGlossary.md`.
- This fork targets Windows 10/11 x64 desktop only. Never pull, merge or cherry-pick upstream content that exists only for macOS, Linux, Android, iOS, OpenHarmony, Flatpak or TestFlight. If an upstream merge reintroduces a non-Windows path, remove it in the same change. The gate is `pnpm run check:windows-only`; the runbook is `docs/UpstreamSync.md`.
- Read this section before touching anything under `tauri-tavern/`.

## The Way: project philosophy

The full statement lives in the "Project philosophy" section of `CONTRIBUTING.md`. The seven principles below guide requirement analysis, design, implementation and review. When principles conflict, weigh the user's request, the SillyTavern ecosystem, the platform constraints and the facts that can actually be verified.

1. **General beats special-casing.** First decide whether several requirements share one meaning and extend a single common mechanism. Keep genuine differences visible; do not build a universal abstraction before a shared requirement exists.
2. **Start from first principles.** Confirm what the user wants, which behaviours are already external contracts, how much evidence supports the current judgement, and which conditions must remain true long term. Only then choose the technology and the place to change.
3. **Fail fast; never degrade silently.** When a constraint stops holding or a result cannot be confirmed, stop the operation and propagate a contextual error. A recovery path is acceptable only when it is explicit and visible to the caller; never guess a default for an unknown state.
4. **Maintainability first.** Software engineering has no magic. Code and documentation must let a later maintainer understand, verify and change the system without relying on unwritten history. Extra complexity needs a real problem and measurements behind it.
5. **KISS and the 60/95 rule.** Choose the simplest approach that fully solves the current problem. 60/95 means roughly 60% of the complexity should cover roughly 95% of real-world cases; rare cases without evidence can wait until they actually appear.
6. **Clarity and elegance.** Concepts should be clear, responsibility should sit where the relevant facts live, and data flow and error paths should be easy to trace. The implementation should respect user choice and the existing ecosystem, and let Rust, Tauri and modern engineering practice serve the problem itself.
7. **Follow, but do not worship.** Principles can conflict. When they do, return to the original goal and the available evidence, explain the trade-off, and use first principles and practical judgement to choose. When new facts overturn an old judgement, change the design.

## The Craft: engineering practice

- **Core architecture:** follow the workspace crate boundaries in `docs/BackendStructure.md`. The `tauritavern` host carries only the Tauri shell, composition, commands and AppHandle/WebView/resource/platform glue; Tauri-free concrete IO belongs in the matching `tt-adapter-*` crate.
- **Rust philosophy:** write idiomatic Rust. Prefer `Result` with `thiserror`/`anyhow` for error handling, and respect ownership and borrowing.
- **Modularity and abstraction:** repository traits and outbound ports live in `tt-ports`; concrete implementations live in adapter crates. Do not add a meaningless trait, factory or facade for a single implementation.
- **Code reuse (DRY):** reuse existing project helpers first. Do not extract a cross-bounded-context sanitizer, formatting library or abstraction layer just to look generic.
- **Documentation first:** before writing code, read the relevant pages under `docs/` (especially `BackendStructure.md`, `FrontendGuide.md` and `FrontendHostContract.md`) and understand the requirement, architecture and plan.
- **Code consistency:** before adding a feature, check whether similar code or definitions already exist; reuse them or stay consistent with them.
- **Definition of done:** self-review every path for concept, responsibility, state ownership and data flow. Passing tests only confirms behaviour and is not a finishing gate. Readability, maintainability and conceptual consistency are hard gates. The maintainer reviews from first principles; only that review closes the work.
- **Error handling:** propagate errors clearly. Follow fail-fast and never degrade silently. Use `CommandError` at Tauri command boundaries and `DomainError` in the domain/repository layer.
- **Async:** use `async`/`await` and the `tokio` runtime for I/O-bound or concurrent work such as file and network access.
- **Data transfer objects (DTOs):** pass DTOs between the application and presentation layers (Tauri commands). Keep DTO definitions aligned with the documentation and consistent across the frontend and backend.
- **Tauri commands:** `#[tauri::command]` belongs only in the `presentation` layer and should call `application` services. Do not put complex logic or infrastructure access in the command itself.
- **Comments:** add clear, concise comments for complex or non-obvious logic.
- **Test admission:** add tests only for observable stable behaviour, non-trivial invariants or boundaries, or a concrete defect that has occurred and been fixed. Code changes and coverage are not reasons by themselves. Never assert on source text with regex or string matching; do not test literals, obvious control flow, direct delegation, implementation details or removed features. Do not add regression tests in advance.
- **Test practice:** reuse the highest existing behavioural coverage first and avoid repeating the same assertion at several layers. Use deterministic coordination for concurrency tests; never rely on `sleep`. When removing a feature or test, remove its fixtures, fakes, hooks and dependencies in the same change. Keep a minimal runnable test when migrating a core repository or changing format semantics. Run the focused tests for the affected crates and `scripts/check-rust-crate-boundaries.mjs` first, then the full harness `pnpm run check` after each implementation.
- **Frontend interaction:** follow `FrontendGuide.md` for frontend interaction, especially the DTO and event contracts.
- **Repository skills:** `.agents/skills/` is the only source for day-to-day development skills; `.claude/skills` is a symlink to it, and `.github/codex/skills/` is for controlled CI use only. Use `maintain-conceptual-integrity` for architecture planning, shared mechanisms, upstream sync or review.
