# Translation Glossary

Terms used when translating TauriTavern documentation and UI strings. Keep the English term on the left everywhere; do not introduce synonyms.

| Term | Use | Notes |
|---|---|---|
| agent | agent | An AI agent, never "assistant" for the framework concept. |
| run | run | One agent execution. |
| tool call | tool call | Not "function call" in user-facing docs. |
| skill | skill | Lowercase unless it is a proper name. |
| workspace | workspace | The repository/workspace, not "work area". |
| World Info | World Info | Capitalized, the SillyTavern feature. |
| lorebook | lorebook | Lowercase. |
| character card | character card | Lowercase. |
| prompt | prompt | The text, not "cue". |
| preset | preset | Lowercase. |
| extension | extension | Frontend extension; "plugin" only for backend plugins. |
| drawer | drawer | The left sidebar drawer in the UI. |
| sidebar | sidebar | The navigation rail, distinct from the drawer. |
| provider | provider | An AI/API provider. |
| connection | connection | A configured provider endpoint. |
| handoff | handoff | One word. |
| chat | chat | A conversation. |
| message | message | A single chat message. |
| turn | turn | One user/assistant exchange. |
| branch | branch | A chat branch. |
| checkpoint | checkpoint | A saved chat state. |
| variable | variable | A chat variable. |
| macro | macro | A SillyTavern macro. |
| regex | regex | A regular expression rule. |
| trigger | trigger | A World Info trigger. |
| lore entry | lore entry | One World Info entry. |
| token | token | A model token. |
| context | context | The prompt context window. |
| system prompt | system prompt | Lowercase. |
| persona | persona | The user persona. |
| group chat | group chat | Lowercase. |
| swipe | swipe | A message swipe/regeneration. |
| host contract | host contract | The frontend/backend ABI. |
| runtime adapter | runtime adapter | The embedded backend adapter. |
| Tauri Pilot | Tauri Pilot | Product name, keep. |
| FasTools | FasTools | Product name, keep. |

## Exemptions

The following non-English characters are data, not prose, and must not be translated:

- Unicode and encoding fixtures: `tt-adapter-tokenization` tokenizer golden fixtures. The CJK tokenizer vector is retained because it validates model token IDs; CJK text-metric and GB18030 archive fixtures are retired with the lorebook migration.
- Tokenizer vocabularies under `src-tauri/resources/tokenizers/` and vendored `lib/` bundles.

## Style rules

- Use sentence case for headings.
- Use the Oxford comma.
- Prefer active voice and present tense.
- Keep code identifiers, commands, file paths, API names, JSON keys and UI labels in backticks unchanged.
- Preserve every fenced code block verbatim except for comments that are Chinese; translate those comments in place.
- Preserve frontmatter keys, table structure, image paths and link targets.
- Do not translate provider voice IDs, model IDs, package names or command flags.
