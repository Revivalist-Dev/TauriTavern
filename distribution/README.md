# Distribution

This directory holds the publishing tools that move finished builds into public package feeds. The build recipes live in `packaging/`, GitHub Actions orchestration stays in `.github/workflows/`, and generated artifacts do not enter this directory.

This fork ships Windows 10/11 x64 only. The Linux feed scripts below are retained for reference from upstream and are not part of the Windows release path.

- `apt-rpm/publish.sh`: imports DEB/RPM packages, generates and signs Stable or Canary repository metadata, then publishes to R2 in a safe order.
- `apt-rpm/rewrite-deb-version.sh`: writes a Debian-sortable version for Canary DEBs.
- `flatpak/publish.sh`: exports, signs, and publishes the Stable Flatpak onto the existing OSTree repository in a safe order.
- `nix-cache/publish.sh`: validates the Nix cache key, signs the store closure, and publishes the cache objects.

The WinGet canonical manifest lives in the external `microsoft/winget-pkgs` repository, so this directory does not keep a copy. Stable releases generate and submit the version update through `.github/workflows/winget-release.yml`. The detailed contract is in `docs/CurrentState/WindowsDistribution.md`.

CI calls these tools and validates the required environment variables and external commands before running them. The user-facing Windows installers are produced by the Tauri release workflow.
