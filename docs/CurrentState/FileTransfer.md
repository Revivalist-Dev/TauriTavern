# File import and export

The host offers two capabilities: **picking** a user's files, and **delivering** a file that has already been produced. Feature code supplies the purpose, the content, and a suggested filename; the system panel, URI grants, and file copying are centralized in the host's `platform/file_transfer`.

## 1. Rules

- **Whoever produces a file starts the delivery.** A file produced by Rust is delivered by the command that produced it; a delivery started by the frontend stages the content first (WebView bytes, or a remote resource the host downloads) and then calls `deliver_staged_file`.
- **A delivery consumes the source file.** Saving, cancelling, and failing all end this artifact.
- **The delivery result is `{ delivered }`.** It is `true` once the target write or the system hand-off is complete, `false` on cancellation, and throws on failure. When the target is an ordinary file, the write must have landed on disk before delivery counts as complete.
- **Picking filters by purpose.** Character cards, Skill archives, and data archives map to each platform's filter conditions respectively, and the file's content is validated by the importer.

## 2. Platform implementations

| Platform | Picking | Delivery |
| --- | --- | --- |
| Windows / macOS / Linux | The dialog plugin returns a path, which is copied into staging; a data archive is used in place | Save panel; move on the same volume, copy across volumes |
| Android / OpenHarmony | The dialog plugin returns a URI with a grant, which is opened through the fs plugin as an fd and copied into staging | The save panel grants a target URI, and the bytes are written through the fd |
| iOS | Document Picker produces a copy, which is moved into staging | Share Sheet |

An Android content URI carries no filename; `ContentUriPlugin` gets it by querying `DISPLAY_NAME`.

The save panel on Android and OpenHarmony accepts only a file extension, and the system converts it to a type with its own table; an extension the system does not recognize declares no specific type. The save panel derives the suffix from the type, so a type chosen by hand can disagree with the system's table: ColorOS, for instance, saves a `.jsonl` carrying `application/octet-stream` as `.bin`.

## 3. Staging

| Staging | Location | Content |
| --- | --- | --- |
| General | `app_cache/tauritavern-staging/<kind>/` | WebView bytes (uploads and Blob exports), remote resources downloaded by the host, picked character cards and Skill archives, debug bundles |
| Archive | `archive_imports_root/incoming`, `archive_exports_root` | Data archives, user backups |

- WebView bytes enter the host through `stage_file_*`: base64 frames on Android, raw bytes on the other platforms.
- The frontend calls the staging and delivery commands through the host's `safeInvoke` and gets a readable error message on failure; only binary chunks go through raw invoke.
- Remote resources enter the host through `stage_file_from_url`: they are downloaded by `ContentService::download_external_file`, sharing the URL rules and `Download` configuration (including the user's request proxy) used by external content import, without the page's cookies or Referer.
- A staged file whose write failed is deleted by the writer. General staging is emptied when the host starts, which reclaims files that were staged but never delivered; archive staging relies on the existing expiry sweep.
- Archives are staged separately: on Android the data root and the cache do not sit on the same volume, and a large archive has to be placed on the data volume for it to be moved straight into the task workspace.

## 4. Entry points

| Artifact or source | Entry point |
| --- | --- |
| `download()`, a same-origin `a[download]`, an Android image long-press (source readable by the page), Skill and Agent exports | `deliverBlob()` |
| An Android image long-press (remote image) | `deliverRemoteFile()`: `stage_file_from_url`, then `deliver_staged_file` |
| Data archive export | After the task completes, call `save_export_data_archive`: claim the artifact, deliver it, then mark it as handled |
| Data archive import | `import_data_archive_from_picker` |
| User backup | `export_user_backup_archive` |
| Debug bundle | `devlog_export_bundle` |
| Picking character cards and Skill archives | `pick_import_files` |

`<input type="file">`, drag and drop, and desktop directory selection keep their existing entry points. New import and export features wire into the entry points above.

## 5. Known limitations

- The mobile dialog plugin reports a panel failure as a cancellation as well.
- If a write fails partway, the target file may be incomplete; the Android and OpenHarmony fs plugin cannot delete a URI target.
- Content has to be staged before the save panel appears, with no progress shown meanwhile; a remote download has no overall timeout and cannot be cancelled.
