# Skill

A skill is a local knowledge package read on demand. `SKILL.md` says what tasks it suits and how to use it, and the other files hold reference material, examples, and scripts.

## Creating a skill

```text
scene-review/
  SKILL.md
  references/checklist.md
  scripts/list-scenes.js
```

A minimal `SKILL.md`:

```markdown
---
name: scene-review
description: Check character motivation and narrative continuity in a scene.
---

Read references/checklist.md and check the draft against the questions it lists.
Write concrete revision suggestions to summaries/review.md, citing the matching passages.
```

The package name uses lowercase letters, digits, `-`, or `_`. Add other directories as the content needs them; with scripts, describe the invocation command, arguments, output, and failure conditions in `SKILL.md`.

## Installation and scope

Skill Manager discovers skills recursively from a directory or a ZIP, previews and installs them one by one, and accepts several sources at once. Character cards and presets can carry skills too. Export produces a ZIP with the original files.

A user-installed skill can belong to the global scope, a preset, a Profile, or a character. Chat resolves in the order `global → preset → profile → character`; a Session resolves `builtin → profile`. `builtin` is the read-only knowledge packages shipped with the app, and they appear in neither Skill Manager nor the embeddable resource list. A later scope overrides a skill of the same name, and the Profile's `skills.visible` and `deny` then filter the result.

A child agent uses the target Profile's skill configuration, and its environment comes from the run's frozen input. A skill of the same name can bind to different scopes in different Invocations. Bindings are settled at preparation and reused by later rounds and recovery; reads use the installed package's current content, and a missing package fails rather than switching to another of the same name.

The preset scope follows the Invocation's preset binding: a named preset uses `preset.ref`, the current preset uses the chat preset the run captured, and a run without frozen input has no current preset scope.

## Using a skill during a run

The names, descriptions, and `SKILL.md` paths of the effective skills come with the system prompt, see [Prompt assembly](PromptAssembly.md). The model reads `skills/<name>/SKILL.md` and the supporting material through the workspace file tools; relative references start from the skill directory, and `/skills/<name>/` in the Shell points at the same view.

`skills/` is read-only. Every file of a built-in skill stays as it is. Ordinary UTF-8 text in a user skill expands the run's frozen macros, while source code under `scripts/` and non-UTF-8 files stay as they are; reads, file sizes, and copies use the same content view, and text search reports how many it skipped. Copy material you need to edit or publish into an ordinary working directory first, see [Workspace](Workspace.md).

`api.skill` manages the installed packages, and management reads and edits use the raw content, see [Skill API](../API/Skill.md).

## Running scripts

Run a package's scripts through `workspace.shell`. For example `scripts/list-scenes.js`:

```js
import { workspace } from '@tauritavern/runtime';

const args = process.argv.slice(2);
if (args.length !== 1) {
  throw new Error('Usage: js list-scenes.js WORKSPACE_PATH');
}
const text = workspace.readText(args[0]);
const scenes = text.split('\n').filter(line => line.startsWith('## '));
workspace.writeText('summaries/scenes.md', scenes.join('\n'));
console.log(JSON.stringify({ count: scenes.length, path: 'summaries/scenes.md' }));
```

The Shell command:

```sh
js /skills/scene-review/scripts/list-scenes.js output/main.md
```

Skill scripts follow the shared [JavaScript workspace contract](Workspace.md#javascript). Save complex input as a JSON file and pass its path; see `js --help` for commands and API details.

### Available capabilities

Scripts run in QuickJS with ES modules and `async` / `await`, and they get no Node/Deno standard library, DOM, network, subprocess, or timers. Host capabilities come from one module:

```js
import { workspace, context, macros, log } from '@tauritavern/runtime';
```

| Interface | Purpose |
| --- | --- |
| `workspace.readText(path)` | Reads UTF-8 text |
| `workspace.writeText(path, text)` | Creates or replaces a file, creating parent directories |
| `workspace.listFiles(path?)` | With no argument, lists the workspace root; with a directory, lists files recursively and returns paths relative to that directory |
| `workspace.exists(path)` | Checks whether an accessible path exists |
| `context.worldInfo.entries` | The World Info activated when the run started |
| `context.variables.local` / `global` | SillyTavern variables, keeping their original JSON types |
| `context.macro` | Frozen macro data such as names, characters, and chat position |
| `macros.render(text)` | Expands macros with the run's frozen values |
| `log.info(text)` / `warn` / `error` / `debug` | Writes log lines to stderr |

File API paths are relative to the workspace root. `context` is a copy of the frozen input, and changing it never writes back to the host; when the needed context is missing, touching the corresponding field reports an error.

### Modules and toolkits

A relative import resolves from the importing module's directory, and the path must carry a `.js` or `.mjs` extension. These libraries ship with the app and import by full module name:

| Module | Purpose |
| --- | --- |
| `@tauritavern/kit/dayjs` | Date handling |
| `@tauritavern/kit/es-toolkit` | Array, object, and string handling |
| `@tauritavern/kit/fast-xml-parser` | XML parsing, validation, and building |
| `@tauritavern/kit/marked` | Markdown to HTML |
| `@tauritavern/kit/papaparse` | CSV parsing and generation |
| `@tauritavern/kit/slugify` | Produces text suitable for paths or identifiers |

These libraries keep their own APIs and remain subject to the runtime limits above. Bundle other dependencies in advance as compatible ESM into `scripts/vendor/` and import them by relative path; the runtime installs no npm packages. See [kit.rs](../../src-tauri/crates/tt-adapter-workspace-shell/src/kit.rs) for the built-in module list.

## Migrating old scripts

The old `skill.run_script` used exported `default(args)` / `main(args)` functions. Module execution and command-line arguments are now the only path.

Update the script and the command in `SKILL.md` together:

1. Route input from function parameters into `process.argv.slice(2)`; complex objects can move to a JSON file, and keep the existing business validation.
2. Call the business function explicitly. You may keep the original function as a named or exported function, but the interpreter never calls `default` or `main` on its own.
3. Print the return value the caller needs explicitly; send logs through `console.error()` or the runtime `log` so they never mix into JSON stdout.
4. Report failure with an exception or a non-zero `process.exitCode`, and update the help text and the usage examples.

For example, keep the original business function named `main` and add an entry point at the end of the module:

```js
const args = process.argv.slice(2);
if (args.length !== 1) {
  throw new Error('Usage: js task.js WORKSPACE_PATH');
}
console.log(JSON.stringify(await main({ path: args[0] })));
```

The invocation becomes `js /skills/<name>/scripts/task.js output/main.md`. If the original function only changes files and returns nothing, just `await main(...)` and print no `undefined`.

Removing the old command option alone does not finish the migration: a module that only exports functions can exit 0 with its business function never run. Verify stdout, stderr, the exit code, and the final file results with representative input; ported file operations still follow the workspace rule that changes take effect immediately and failures do not roll back. `skills/` inside an agent run is a read-only view, so update package source and documentation in the original package or in Skill Manager.

## Source

User-installed skills live in `_tauritavern/skills/`, organized into install directories per scope, with the index at `index/skills.json`. Built-in skills come from the shipped `default/skills/` and are materialized at startup into `_cache/builtin-skills/<digest>/`, tied to the app version, and they enter neither the install index nor sync; an update replaces the cached version. Both share `SkillRepository` and the workspace file view.

- [SkillService](../../src-tauri/crates/tt-application/src/services/skill_service.rs): management and effective skill resolution.
- [file_skill_repository](../../src-tauri/crates/tt-adapter-storage-userdata/src/repositories/file_skill_repository): package format, installation, the index, and raw file reads and writes.
- [skill_scope.rs](../../src-tauri/crates/tt-application/src/services/agent_runtime_service/skill_scope.rs): Invocation scope.
- [Skill file view](../../src-tauri/crates/tt-application/src/services/agent_workspace_scope/skills.rs): bound paths, macro projection, and catalog queries.
- [Workspace tools](../../src-tauri/crates/tt-application/src/services/agent_tools/workspace): model file operations and Shell calls.
- [WorkspaceShell adapter](../../src-tauri/crates/tt-adapter-workspace-shell/src): shared script execution and the file bridge.
