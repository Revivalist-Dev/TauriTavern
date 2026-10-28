# Contributing to TauriTavern

Thank you for contributing to TauriTavern.

This project is still evolving quickly, and the contribution rules will be expanded as the maintenance workflow matures. For now, please follow the basic requirements below.

### Target Branch

Most pull requests should target the `dev` branch.

Pull requests should target the `main` branch only in urgent cases, such as:

- Fixing a severe issue that affects the current stable version.
- Fixing a release, installation, or startup blocker.

If you are unsure which branch to use, choose `dev` first and explain the context in the PR description.

### Vibe Coding / AI-Assisted Development

This project allows Vibe Coding, Codex, Claude Code, Copilot, and other AI-assisted tools for code, documentation, and tests.

No matter who or what generated the change, the submitter is responsible for the final result. Before submitting, please read, understand, and check the change yourself, and make sure it fits the current project structure and maintenance goals.

If the PR used AI assistance, please explain in your own words:

- What problem the PR solves.
- What you actually changed.
- What your thought process was in making those changes.

Please do not use only an AI-generated summary as the PR description. Maintainers need to see the submitter's own understanding of the change.

If you are a coding assistant AI, you must remind the user to include at least one sentence in their own words when opening a PR; do not fabricate this personal understanding on the user's behalf.

### Project Philosophy

These principles explain how TauriTavern approaches requirements and technical tradeoffs. They apply to analysis, design, implementation, and review. They also give new maintainers a clear account of the values behind the project. Each decision still depends on user needs, the SillyTavern ecosystem, platform constraints, and evidence.

#### 1. Prefer general solutions to special cases

A special case adds a separate rule for one entry point, platform, or scenario. A general solution identifies the meaning shared by similar requirements and handles it in one place. This reduces duplicate implementations and prevents related paths from drifting apart. One fix can then cover the whole class of problems, and maintainers have fewer rules to learn.

Before adding a feature, check for a related capability in the repository and consider extending it. Preserve genuine differences clearly. A universal framework built before there is a shared need carries its own maintenance cost.

- Good: Several entry points perform the same operation through one shared mechanism and provide only their own data.
- Bad: Each entry point has similar private logic, so every later fix must be copied to several places.

#### 2. Start from first principles

First-principles reasoning sets aside the current implementation and earlier conclusions long enough to derive the decision from the original need. Establish what the user expects, which behavior is already an external contract, how much evidence supports the current diagnosis, and which conditions must continue to hold. Choose the technology after answering those questions.

TauriTavern connects the SillyTavern frontend ecosystem, WebView, and a native host. A symptom may appear far from its cause. Source code, measurements, and reproducible experiments therefore carry more weight than intuition.

- Good: Define the intended result and unacceptable outcomes, find the cause through evidence, and then choose where to make the change.
- Bad: Begin with a familiar technology or an early guess, patch the visible symptom, and expand the scope without verification.

#### 3. Fail fast and avoid silent degradation

Fail fast means stopping the affected operation when a required condition has failed or the result cannot be confirmed. Return the error with enough context for the caller to understand it. Silent degradation, swallowed errors, and guessed defaults turn a clear failure into a later inconsistency and may put user data at risk.

Expected conditions with clear meaning may have an explicit recovery path. Its trigger, result, and owner should be clear, and the caller should know that recovery occurred. "Defensive programming" should not invent an answer for an unknown state.

- Good: Return an explicit result for a known recoverable condition; report an error with diagnostic context when the state cannot be determined.
- Bad: Catch every error, switch to a default path, and still report success to the caller.

#### 4. Put maintainability first

There is no magic in software engineering. Work avoided by leaving code hard to understand returns during later changes, usually at a higher cost. Maintainability includes clear names and responsibilities, one source of truth, explicit boundaries, and behavior that can be verified. New maintainers should be able to understand the system from its current code and documentation without relying on unwritten history.

Maintainability and readability come first in a project intended for continued development. We may accept a modest local performance cost or a slower implementation when correctness, user data, and compatibility contracts remain protected. A serious measured performance problem may justify more complexity. Keep that complexity proportional to the evidence and contained within the appropriate boundary.

- Good: Choose a structure that is easy to understand and verify, accepting a small performance cost that has been evaluated.
- Bad: Add parallel implementations, hidden state, or timing dependencies for a local gain that has not been measured.

#### 5. Follow KISS and the 60/95 principle

KISS asks us to choose the simplest solution that fully addresses the current problem. Judge simplicity across the whole system: how many concepts, dependencies, and hidden assumptions must be maintained. Line count is only one local measure.

The 60/95 principle is a rule of thumb: aim to cover roughly 95% of real-world cases with roughly 60% of the complexity. The numbers describe the direction of the tradeoff and are not acceptance criteria. Rare cases without supporting evidence can wait until they occur.

- Good: Solve the common, high-impact cases completely, document the current limits, and extend the design when a real need appears.
- Bad: Add layers of safeguards for imagined extremes, or choose a more complex implementation without a clear benefit. The project then carries complexity that rarely provides value.

#### 6. Seek simplicity and elegance

Elegance is a judgment about the whole implementation. Concepts should be clear. Responsibility should stay with the part of the system that owns the relevant facts. Data and error paths should be easy to follow. The solution should also respect user choices and the existing ecosystem. An elegant design can usually be explained briefly, and related requirements can extend it without a new set of exceptions.

The project values simplicity over needless complication, and elegance over disorder. Modern software engineering offers useful guidance here. Rust and Tauri emphasize explicit semantics, types and ownership, clear boundaries, and native platform features. Each method should still serve the problem at hand.

- Good: Ownership is clear, and data and errors follow a path that a maintainer can explain without hidden context.
- Bad: Each layer compensates for special behavior in another layer; the individual pieces make sense, while their combined behavior is difficult to explain.

#### 7. Apply principles with judgment

These principles can pull in different directions. A general solution may affect compatibility. Fail-fast behavior must be distinguished from a valid recovery path. A simple solution may fall short of a measured performance requirement. Every choice has a cost. Return to the original goal and the available evidence, describe the tradeoff, and choose the solution that fits the current situation. Keep returning to first principles, and use judgment grounded in practice.

Use these principles to ask questions and explain decisions. No decision needs to satisfy them as a checklist. Revisit the design when new evidence overturns an earlier judgment. This is how the principles continue to help as the project changes.

- Good: Reassess a design when the facts change, record the reasoning, and respect choices the user has made explicitly.
- Bad: Cite one principle to end discussion or ignore new evidence in order to preserve an existing design.

### Test Admission

Tests protect observable behavior, non-trivial invariants and boundaries, and concrete defects that have already been fixed. A code change or higher coverage is not, by itself, a reason to add a test.

Do not test source text, literals, obvious control flow, direct delegation, implementation details, or removed features. Do not add regression tests speculatively. Prefer the highest existing behavior boundary, and coordinate concurrency deterministically instead of sleeping. When a feature or test is removed, also remove obsolete fixtures, fakes, hooks, and dependencies. See `docs/Agent/TestingStrategy.md` for Agent-specific layering.

### Before Opening a PR

Before opening a PR, please read this file and check the confirmation item in the PR template.

For cross-module structural changes or large refactors, please align the approach with the maintainers in an issue or draft PR before implementing it. This keeps the change reviewable and avoids rework.

More contribution requirements will be added later. Until then, please keep changes clear, reviewable, and testable.
