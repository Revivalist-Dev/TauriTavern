# Windows distribution status

TauriTavern's Windows Stable Release uses GitHub Releases as the only source of installers. WinGet
publishes only metadata that points at that Release; it neither rebuilds nor hosts a second copy of
the installer.

## WinGet contract

- Package ID: `TauriTavern.TauriTavern`
- Installer: `TauriTavern-<version>-windows-x64-setup.exe`
- Type: NSIS (`nullsoft` in the WinGet manifest)
- Architecture and scope: `x64`, `user`
- Silent switch: `/S`; unattended with progress: `/P`
- Upgrade behaviour: `install`
- Publishes Stable only; Canary, MSI, and the portable zip never enter this Package ID

A per-user directory install matches the current NSIS default behaviour. The portable build relies on
Scoop's `persist` semantics, so it cannot be mapped onto a WinGet portable package as an equivalent.

## Release pipeline

`.github/workflows/stable-release.yml` calls `.github/workflows/winget-release.yml` once every Release
asset has uploaded successfully. The latter:

1. verifies that the tag, the repository version, and the published non-prerelease Release all agree;
2. selects exactly one x64 NSIS setup asset;
3. succeeds idempotently when the target version is already merged or already has an open PR;
4. downloads a pinned WingetCreate version and verifies its SHA256;
5. generates an update from the previous version's manifest in the official repository and uploads it
   as an Actions artifact;
6. fast-forwards `master` on the `winget-pkgs` fork owned by the commit token's account to upstream,
   then opens the PR.

The sync never force-overwrites; if the fork has diverged or the token lacks permission, the release
stops and reports an error.

The workflow can be run manually with `release_tag`, so a WinGet failure only needs the manifest
publication retried, without rebuilding the Stable Release. Stable asset uploads keep `--clobber`; the
release contract is that each Stable tag is built and uploaded exactly once, and WinGet always reads
the final assets after the upload completes.

## One-time enablement

Automatic updates depend on the Package ID already existing in the official `microsoft/winget-pkgs`
repository. Enabling it the first time requires:

1. submitting and merging the `TauriTavern.TauriTavern` multi-file seed manifest under an
   already-published Stable version;
2. confirming that the seed manifest satisfies the installer contract above, and verifying install,
   silent install, upgrade, and uninstall in a real Windows user environment;
3. creating a classic PAT from a dedicated GitHub account that has completed the Microsoft CLA,
   granting it only `public_repo`, and storing it as the repository secret
   `WINGET_CREATE_GITHUB_TOKEN`;
4. running `WinGet Release` manually to verify the update PR, then letting subsequent Stable releases
   call it automatically.

Once the seed manifest is merged and synced into the WinGet source, the install command is:

```powershell
winget install --id TauriTavern.TauriTavern --exact
```

Do not add that command to the user-facing README before it resolves in the official source.
