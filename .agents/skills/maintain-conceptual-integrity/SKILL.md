---
name: maintain-conceptual-integrity
description: "Keep conceptual integrity across architecture planning, implementation and review in TauriTavern: one kind of thing takes one path. Trace data and behavior paths from shared meaning, unify scattered implementations at the source, finish the migration and delete the old path, and choose decisively instead of routing around structure with compensation layers, fallbacks, wrappers, switches and parallel implementations, or writing tests that guard nothing. Use when planning or designing a feature, refactor, new entry point, integration, provider or capability; when reviewing a plan, design document or diff; when deciding which tests to add or remove; when syncing upstream SillyTavern; or when the user stresses conceptual integrity, a unified architecture, refusing to pile up patches, or lowering the maintainer's cognitive load. Not for one-line fixes or non-coding requests."
---

# Conceptual integrity and maintenance cost

The primary goal is long-term maintainability: a maintainer understands the system through a small set of coherent concepts, naturally knows where to change something when a rule changes, and can grow new features along structures that already exist.

The method is **one kind of thing takes one path**. Complexity goes into merging paths at the source, not into routing around existing structure as compensation.

Agents drift the other way: each step optimizes only the diff in front of it, adds a branch for a new caller, wraps an unexplainable state in a fallback, wraps code it dares not touch in a layer, and keeps an old path for compatibility. Each step makes sense alone; together they produce code nobody dares to change.

## Start from the facts

Before planning, read this repository's rules: `AGENTS.md`, the project philosophy and test admission in `CONTRIBUTING.md`, and, as the task requires, `docs/BackendStructure.md`, `docs/FrontendGuide.md`, `docs/FrontendHostContract.md`, `docs/CurrentState/` and `docs/API/`. They record this project's boundaries, contracts and past tradeoffs; where they are specific, they take precedence.

Then trace data, state and behavior end to end along the real flows, and identify what several entry points actually share and where the current complexity comes from. Source code, real usage and reproducible behavior are the evidence.

## Contracts are hard boundaries; implementations are not

Hard boundaries are contracts that someone actually depends on. In TauriTavern there are two main kinds:

- **Upstream compatibility contracts** (BackendStructure §5): the URLs, response shapes, asset paths, file layout and `eventSource` event semantics that the upstream frontend, extensions, scripts and character cards can observe.
- **Host contracts** (FrontendHostContract §1): the Public Contract is an external promise; the Project Contract may evolve, but the related modules and documentation must move with it; Internal code may be refactored freely.

Identify the concrete consumers, and keep each contract entry point as a thin entry into the shared mechanism. New TauriTavern capabilities are exposed through `window.__TAURITAVERN__.api.*`; the `/api/*` compatibility layer is entered only when behavior really matches an upstream route.

Everything outside the contracts is implementation. Existing code, code inherited from upstream, and the documents describing it may all be redesigned. Upstream's inconsistent patterns and old defects are not contracts and should be corrected at the source. Treating every existing line as untouchable is exactly where wrappers and parallel paths come from.

## Converge at the source

- Implement shared semantics in one place. Each entry point supplies its own data and context, and the shared mechanism carries the shared behavior. For example, the shell and the text tools both operate on the workspace, so whether a file is committed automatically is decided by one shared commit rule (`docs/Agent/Workspace.md`); in import and export, the feature supplies only the file type, content and suggested name, while selection and delivery belong to the host (`docs/CurrentState/FileTransfer.md`).
- State has one source of truth; everything else derives from it or passes through it.
- When entry points or writers disagree, change them so they follow one protocol; do not reconcile them downstream with observation, synchronization or compensation. For example, after the API changes a numeric constraint, it sends the same `input` a user action would send, and the shared implementation updates the number box along with it, rather than attaching a separate observer.
- Fix a bug where all callers pass through, not only at the entry point the ticket names.
- Boundaries are decided by semantics. Rules that mean the same thing converge; real differences are stated clearly. Platform differences are real, but they belong only in the host module that owns the fact, and platform checks follow FrontendGuide §2.1 and BackendStructure §6.4. A separate branch for one extension, provider or entry point is usually not a real difference. With no shared need, there is no shared abstraction.
- One concept gets one name throughout code, parameters, errors and documentation, and follows conventions users already know.

## Choose decisively

Hedging is how complexity enters without anyone deciding it should.

- Recommend one option, state the tradeoff in one sentence, and do not hand back a list of alternatives.
- Do not use a switch, option or configuration value to avoid a decision.
- If you cannot name a concrete consumer, do not keep the old path "for compatibility".
- Do not add a fallback for a state you cannot explain; report an error with context when a constraint fails. A recovery path within expectations must be semantically explicit, and the caller must be told. A small problem the user can recover from does not block the main flow.
- Align with maintainers only on decisions that change behavior, contracts or ownership; once aligned, do it completely. Review works the same way: raise the points that would change those, and do not chase rare edges.

## Finish the migration

A refactor that leaves two structures alive makes things worse.

- Complete the shared mechanism first, then connect features to it.
- Migrate every real caller. In the same change, delete the replaced code, branches and bypasses, along with their tests, fixtures and fakes, and update the documentation that describes them. Adding one more layer around the old structure is not finished work.
- When the work must be split, every piece advances the same architecture.
- A larger change is acceptable when the refactor removes duplicated paths, implicit knowledge and repeated compensation. Judge the comprehension and change cost of the whole system, not the size of this diff.
- Build and experiments use the entry points the repository and CI already have; do not create copies or parallel environments.

## A test must prove its value

An agent writes tests reflexively: one per change, one per layer, one per new branch. Many of them pin the implementation, and a test that pins the implementation turns the implementation into a contract, so the next refactor has to fight it first. Every test is code someone has to maintain.

- By default, write no test. Write one only for stable observable behavior, a non-trivial invariant or boundary, or a concrete defect that occurred and was fixed. Keep the minimum runnable test for a core repository migration or a change in format semantics. "I changed code", coverage, and "just in case" are not reasons.
- Never assert on source text with a regular expression or text match, and do not test literals, obvious control flow, direct delegation, implementation details or removed functionality. Do not add a regression test in advance for a defect that has not happened.
- Guard one behavior once, at the highest layer where the whole flow is already observable. Extend the existing behavior test first; do not repeat the same assertion at every layer. For where verification belongs, see `docs/Agent/TestingStrategy.md`.
- Deleting a test that guards nothing is progress, not a loss of coverage.

## Match complexity to the problem

- Judge simplicity by concepts, dependencies and implicit knowledge, not by line count. Choose the simplest option that fully solves the real problem.
- 60/95: cover about 95% of real scenarios with about 60% of the complexity. A rare scenario without real evidence can wait until it actually appears.
- Do not build mechanisms in advance for problems that have not appeared, and do not defend at every layer; guard once at the boundary responsible for it.
- Mechanisms the real problem needs still stay. Two mechanisms guarding different invariants are not duplication; workspace editing, for example, needs both CAS and a lock.
- When you find a problem, or a review points out a hole, first check whether an existing rule can be generalized, or whether the condition causing the split can be deleted. Special cases appended one at a time accumulate complexity; one generalized rule often resolves several problems at once.

## Signs of accumulation

Check your plan against these before implementing. In review, report one line per finding: `file:line: <tag> what split. → where it should converge.`

| Tag | Sign |
|---|---|
| `split-path` | One thing has two paths, or a branch per caller is written for something every caller needs. |
| `second-truth` | A cache, mirror or flag duplicates state that something else owns. |
| `compensation` | A downstream observer, synchronization, retry or patch reconciles an upstream disagreement. |
| `half-move` | Old and new structures are both alive; callers or documentation were not migrated. |
| `special-case` | A one-off condition handles something one generalized rule could resolve. |
| `extra-layer` | A wrapper, adapter, interface or factory with no shared need, usually around code that could have been changed directly. |
| `defensive-layer` | A fallback that guesses the result for an unknown state, a wildcard branch that swallows a new platform or variant, or the same guard repeated at every layer. |
| `hedge` | A switch, option or retained old path that exists to postpone a decision. |
| `test-pile` | A test that pins the implementation, repeats an assertion another layer already has, guards a defect that never happened, or exists only because code changed. |

End with `net: -<N> paths`, counting the paths, sources of truth and special cases a maintainer no longer has to understand. When you find no split, write `Coherent. Ship.`

## Closing

Check each entry point the change touches: has it entered the shared mechanism? Is there one fewer path a maintainer has to understand? Then test this design with the next piece of development: can a maintainer find the rule and the place to change faster, and extend the feature along one clear path?

A passing test suite and `pnpm run check` only confirm behavior; they do not mean the design is finished.

## Boundaries

- Not for typos, one-line fixes, or tasks with no structural decision.
- Not a licence to rewrite. Converge within the semantics of the problem; when converging would go beyond this task, raise it in one sentence and ask, neither quietly widening the change nor quietly skipping it.
- Principles serve judgment. Change the design when new facts overturn an old judgment.

Basis: the project philosophy in `CONTRIBUTING.md`, and the tradeoffs already made in the documents listed above. A general English edition is available at [Darkatse/conceptual-integrity](https://github.com/Darkatse/conceptual-integrity).
