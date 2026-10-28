# Scripts

This directory holds the repository's development, build, migration-export and CI helper scripts. This branch supports Windows x64 only.

## SillyTavern migration export

These two scripts interactively produce a zip that can be imported directly into the TauriTavern `data-migration` extension:

- Detect automatically whether the current directory is a SillyTavern root
- Choose whether to export `data/default-user/backups`
- Map `public/scripts/extensions/third-party` to `data/extensions/third-party` automatically
- Show clear compression progress

### One-line run

The one-line form must run in an interactive terminal, because the script reads its options from the terminal. That keeps it clear of the script input stream used by `curl | sh`.

Windows PowerShell:

```powershell
iex (iwr 'https://get.tauritavern.com/export.ps1').Content
```

### Local run

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\export-sillytavern-migration.ps1
```

## Directory guide

- `export-sillytavern-migration.ps1`
  The Windows PowerShell SillyTavern migration export script.
- `build-portable.mjs`
  Builds the Windows portable binary and copies the artifacts to the requested output directory. Backs `pnpm run tauri:build:portable`.
- `tauri-before-build.mjs`
  Generates the frontend bundle Tauri packaging needs, in one place.
- `tauri-app.mjs`
  Sets `TAURI_APP_PATH` and `TAURI_FRONTEND_PATH`, then invokes the local Tauri CLI; Windows is the only target.
- `tauri-dev-server.mjs`
  Provides `tauri dev` with a lightweight static frontend server and a page-refresh channel, and injects the [development asset bridge](../docs/CurrentState/ThirdPartyExtensions.md) bootstrap script; the port comes from `devUrl` in `tauri.conf.json`. Static files are watched through `@parcel/watcher` native events, and Rspack dependencies refresh after a successful recompile.
- `check-frontend-guardrails.mjs`
  Validates frontend host-layer file size and dependency boundaries so the Host Kernel does not keep growing. Backs `pnpm run check:frontend`.
- `ci/verify-release-version.mjs`
  Validates that the Stable Release tag matches the frontend, Cargo, Tauri and Cargo lock versions.
- `ci/collect-release-assets.mjs`
  Validates the required Windows build artifacts and collects release assets under the user-visible naming contract shared by Stable and Canary.
- `guardrails/frontend-lines-baseline.json`
  The baseline data file used by `check-frontend-guardrails.mjs`, holding the hard line-count limits.

## Maintenance conventions

- One-off scripts meant for end users should stay interactive-friendly, depend on little, and fail loudly.
- Scripts meant for the repository itself should be reached through a `pnpm` script or CI, without spreading extra entry points.
- If a change to the migration export script touches the archive layout, confirm that it still matches the `data/...` contract of the current `data-migration` importer.
