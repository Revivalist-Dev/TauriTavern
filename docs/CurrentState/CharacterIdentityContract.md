# Character identity contract (current state)

This document records the character identity contract TauriTavern has already landed, covering avatar filenames, chat directories, compatibility with legacy directories created incorrectly, lorebook binding, and the boundaries later development must not break by accident.

Audience: developers who will keep working on character import, editing, chat saving, chat export, and the Agent profile/skill import chain.

---

## 1. Scope and conclusions

The TauriTavern frontend comes from SillyTavern. Character-related interfaces must follow the upstream contract:

> The `avatar_url` returned by `/api/characters/get` and passed back by the frontend is an exact avatar filename — not a URL, not a path, and not a resource address that can be parsed.

For example:

- A valid identity value: `Alice#1.png`
- The corresponding Rust-internal character stem: `Alice#1`
- The corresponding canonical chat directory key: `Alice#1`

No character identity chain may therefore apply any of the following to `avatar_url`:

- `trim`
- `decodeURIComponent` / percent decode
- stripping `?query` or `#hash`
- taking the basename by `/` or `\`
- treating it as a resource URL such as `/thumbnail?file=...`

These transformations are allowed only inside the backend legacy resolver, where they serve to find chat directories that earlier versions created incorrectly.

---

## 2. Frontend/API boundary

Boundary rules on the JS side:

- `avatar_url` means the exact avatar filename.
- Only `.png` character card filenames are accepted for now.
- A filename must not contain path separators, query/fragment semantics, control characters, or characters the platform forbids.
- Deriving the character stem from `avatar_url` removes only the trailing `.png` extension.

Core implementation:

- `src/tauri/main/services/characters/character-identity.js`

Constraints for continued development:

- Routes, services, adapters, and the Agent import chain should all share that identity module.
- Do not write a second, "lenient parser" at a call site.
- If a caller is holding a resource URL, it should first go back to the business context that produced that URL; a URL must not be passed into the character identity module.

---

## 3. Rust internal keys

The Rust chat repository currently receives the character stem, not the avatar filename.

That is:

- JS/API boundary: `Alice#1.png`
- Rust chat repository argument: `Alice#1`
- Canonical chat directory on disk: `default-user/chats/Alice#1/`

Core implementation:

- `src-tauri/crates/tt-adapter-storage-core/src/chat_directory_identity.rs`
- `src-tauri/crates/tt-adapter-storage-core/src/repositories/file_chat_repository/chat_dir_resolver.rs`
- `src-tauri/crates/tt-adapter-storage-userdata/src/repositories/file_character_repository/helpers.rs`

Constraints for continued development:

- The Rust resolver's input is named `character_name`, but its meaning is the internal stem/key.
- The Rust resolver does not parse avatar filenames, and does not parse URLs or paths.
- Legacy candidate generation inside the Rust resolver exists only to read old, incorrect directories; it is not a new identity rule.

---

## 4. Chat directory resolution

The current resolution order for a character's chat directory is:

1. Compute the canonical key.
2. If the alias store already records a legacy directory for that key and the directory still exists, use the alias first.
3. If the canonical directory exists, use the canonical directory.
4. If the canonical directory does not exist, attempt safe legacy discovery.
5. If no legacy hit is found, return the canonical directory.

An alias taking precedence over the canonical directory is deliberate:

- Once the system has established that `Alice#1 -> Alice` is an old, incorrect directory, later reads and writes must keep landing in the same physical directory.
- That prevents the canonical directory, should it appear later, from splitting the chat history into two copies.

---

## 5. Legacy discovery

Legacy discovery exists only for historical compatibility.

It reproduces the directory names the old, incorrect normalizer could produce:

- `trim`
- stripping the content after `?` or `#`
- percent decode, then strip query/hash
- percent decode, then take the basename

Hit conditions:

- The candidate directory must exist.
- The candidate directory must contain at least one `.jsonl` chat file.
- The candidate must not equal the canonical directory.
- If `characters/<candidate>.png` exists, the directory is taken to belong to another real character and must not be claimed.
- When several legacy candidates hit at once, fail fast and return an error rather than guessing.

This rule avoids a full scan and a bulk migration at upgrade time: a small, scoped resolution happens only when the user actually touches the character in question.

---

## 6. Alias store

Alias file location:

- `default-user/user/cache/chat_aliases_v1.json`

The alias key is the Rust-internal character stem, not the avatar filename.

Example:

```json
{
  "version": 1,
  "aliases": {
    "Alice#1": {
      "dir": "Alice",
      "reason": "legacy-avatar-url-normalizer",
      "created_at": "2026-06-06T00:00:00Z"
    }
  }
}
```

The current production bootstrap injects the same shared alias store into both the character repository and the chat repository:

- `FileCharacterRepository::with_chat_repository(...)`
- `FileChatRepository::with_chat_aliases(...)`

The two repositories therefore no longer each hold a separate alias cache, which prevents concurrent lazy discovery from overwriting the alias file.

Production bootstrap explicitly creates the shared alias store and the shared `FileChatRepository`, then injects the latter into the character repository through `with_chat_repository(...)`. `new(...)` is only a convenience constructor for an isolated, single-repository setup; when one runtime creates both character and chat repositories, they must share the same `FileChatRepository`.

---

## 7. Current rename / delete semantics

Character rename:

- The new identity uses the new canonical key.
- If the old chat directory is found through the canonical/alias/legacy resolver and the new canonical directory does not exist, the old directory is renamed to the new canonical directory.
- If a filesystem rename fails, the error surfaces directly.

Character delete:

- Delete the character card.
- When `delete_chats=true`, resolve the physical chat directory for the current identity and delete it.
- That includes confirmed alias directories and historical, incorrect directories found by safe legacy discovery.
- The bound lorebook is handled per [§10](#10-character-lorebook).

Delete semantics therefore lean toward user intent — "delete this character and its chats" — rather than deleting only the canonical directory.

---

## 8. Behavior that is not supported

There is no full migration at startup:

- No scanning of every `characters/` and `chats/` entry.
- No bulk directory renames on upgrade.
- No automatic merging of several possibly related chat directories.
- No silently picking one directory when legacy hits are ambiguous.

If a bulk cleanup or an explicit migration is needed, it should be a separate maintenance tool that lists the conflicts for the user to confirm.

---

## 9. The contracts easiest to break by accident

Later development especially should not do any of these:

1. Parse `avatar_url` as a URL or path.
2. Write ad-hoc `trim/decode/basename` handling in a route or service.
3. Treat a legacy candidate as a new rule inside the Rust resolver.
4. Let the character repository and the chat repository each create their own alias store on the production path.
5. Recursively scan and rename large numbers of chat directories on upgrade.
6. Fall back silently to some directory when legacy hits are ambiguous.

The right direction is:

- New data strictly follows exact avatar filename -> stem -> canonical directory.
- Old, incorrect directories are supported only through the alias/lazy resolver.
- Ambiguity fails fast.

## 10. Character lorebook

A character uses the book bound in `data.extensions.world`. The `character_book` inside the card is only a copy of it, refreshed on save and export; the two disagreeing is normal and is not a conflict.

Adopting an embedded book:

- This happens only when a card arrives: import, replace, and "import the character card's lorebook". The rules live in `CharacterService::adopt_embedded_lorebook`; the frontend prompt and refresh live in `completeCharacterLorebookAdoption` in `world-info.js`.
- The binding changes only on adoption or when the user links a book manually. On replace, the original binding is written back before adoption; if there was no binding, or the old card cannot be read, an empty binding is written back.
- The new book is named after `character_book.name`, or `<character name>'s Lorebook` when it has no name. If the name is taken, `name (1)`, `name (2)`… are tried in turn, and a book whose entries are identical is reused directly.
- The character's currently active book is what gets handled. A "local version" is the book whose name is either the new book's original name or a numbered copy of it.
  - Same content and a local version: leave it alone.
  - Different content: ask once; "update current" is offered only for local versions.
  - Anything else: link the assigned book, creating one when needed.

Deleting a character:

- The backend deletes the character only, not the lorebook.
- The frontend `deleteCharacter` deletes only bound lorebooks that have no other users.
  - Users include other characters' bound and additional lorebooks, globally enabled lorebooks, and Persona lorebooks.
  - A character whose deletion failed still counts as a user. This is decided before the list is refreshed.
- Chat-level lorebooks are not checked, and neither are character cards that cannot be read.
