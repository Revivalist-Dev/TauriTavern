# Skill API

`api.skill` manages local knowledge packages, including import, file editing, scope and export. For how to write a knowledge package and its scripts, see [Skill](../Agent/Skill.md).

## Entry point

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const skill = window.__TAURITAVERN__.api.skill;
const installed = await skill.list();
```

## Management and files

| Method | Behavior |
| --- | --- |
| `list({ scope? }?)` | Returns the skill list; `all` covers every user-installed skill, while built-in packages have to be filtered with `builtin` |
| `listFiles({ scope?, name })` | Lists the files in the package |
| `readFile({ scope?, name, path, startLine?, lineCount? })` | Reads a UTF-8 file, with optional 1-based line ranges |
| `writeFile({ scope?, name, path, content, expectedSha256? })` | Writes a file, optionally checking the SHA it was read at to detect a concurrent modification |
| `move({ name, fromScope, toScope, conflictStrategy? })` | Moves the package to another scope |
| `export({ scope?, name })` | Returns `{ fileName, contentBase64, sha256 }`, with the content as a ZIP |
| `delete({ scope?, name })` | Deletes the install index entry and the package directory |

The scopes are `global`, `preset`, `profile`, `character` and `builtin`; omitting the scope means global. `builtin` ships with the application and supports listing and reading only: no install, write, move, scope change, delete or export. List it separately with `list({ scope: { kind: 'builtin' } })`. For the full structure, see `TauriTavernSkillScope` in [src/types.d.ts](../../src/types.d.ts).

File paths are relative to the skill package. `readFile` returns the raw text and its original SHA and does not expand macros; omitting the range reads the whole file, and long content comes back as a line preview plus `nextStartLine`. `writeFile` returns an error when the SHA does not match.

## Choosing an import source

| Method | Returns |
| --- | --- |
| `acquireImport()` | Synchronously takes this page's import lease and returns `release(): Promise<void>`; throws `skill.import_busy` while the lease is held |
| `pickImportArchive()` | A single archive input, or `null` if cancelled |
| `pickImportArchives()` | One or more archive sources, or `null` if cancelled |
| `isDirectoryImportAvailable()` | Whether the current host can pick directory sources (currently desktop only) |
| `pickImportDirectories()` | One or more directory sources, or `null` if cancelled; throws when unavailable |
| `discoverImports({ input })` | Recursively expands the skills inside a directory or archive; any other input yields a single candidate |
| `downloadImport({ url })` | Downloads a raw `SKILL.md` over HTTPS and returns a single-file import input |
| `discardPickedImport(input?)` | Releases the temporary resources of one source, or of the whole batch when called without arguments |

An import input takes one of three forms:

```ts
type SkillImportInput =
  | { kind: 'directory'; path: string; source?: unknown }
  | { kind: 'archiveFile'; path: string; skillRoot?: string; source?: unknown }
  | {
      kind: 'inlineFiles';
      files: Array<{
        path: string;
        content: string;
        encoding?: 'utf8' | 'utf-8' | 'base64';
        mediaType?: string;
        sizeBytes?: number;
        sha256?: string;
      }>;
      source?: unknown;
    };
```

`skillRoot` is the skill's root path inside the archive; discovery stops descending once it finds a `SKILL.md`. `source` records provenance, which character cards and presets use to associate embedded skills. Both ZIP and legacy `.ttskill` archives can be imported; export always uses ZIP.

## Preview and install

After picking a source, call `discoverImports({ input })`, then call `previewImport({ input, targetScope? })` on each returned candidate to inspect its content and any name clash, and finally call `installImport({ input, targetScope?, conflictStrategy? })`.

| `conflict.kind` | Meaning | Install behavior |
| --- | --- | --- |
| `new` | No package with that name exists | Install |
| `same` | Same name and identical content | Merge the source and keep the existing content |
| `different` | Same name but different content | Specify `skip` or `replace` |

The install result's `action` is `installed`, `replaced`, `already_installed` or `skipped`. With multiple sources, preview and install run per item, and each item commits and returns its own result; completed installs are kept.

The assistant and Skill Manager take the import lease before picking or downloading a source and hold it until preview and install finish. Once the whole batch completes or is cancelled, wait for in-flight requests to end and then `await release()`; it clears the temporary sources and frees the lease, and may be called repeatedly. A single install does not release the source.

Agents use installed packages through the read-only `skills/<name>/` view and `workspace.shell`; see [Skill](../Agent/Skill.md).
