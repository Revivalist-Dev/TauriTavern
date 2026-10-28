# Upstream sync — Windows-only scope

This fork builds **Windows 10/11 x64 desktop only**. Every upstream sync run must keep it that
way. Linux, macOS, Android, iOS, OpenHarmony, Flatpak and TestFlight are out of scope, even when
upstream ships them as ordinary commits rather than conflicts.

This page is the runbook for every sync. The gate prints the same notice on every run:

```powershell
node scripts/check-windows-only.mjs
```

`pnpm run check` runs it first, and the PR quality gate runs it before tests. A non-Windows path
that comes back through a merge fails the run.

## Per-run procedure

1. **Fetch and identify the delta.**

   ```powershell
   git fetch origin --tags --prune
   git fetch origin dev --no-tags
   git log --oneline <merged-tag>..origin/dev
   git diff --stat <merged-tag>..origin/dev
   ```

2. **Classify every commit before merging.** Keep performance, correctness, dependency and test
   work that applies to the Windows host. Reject anything whose files, symbols or tests only exist
   for another platform (iOS/UIKit, Android, Linux/GTK, macOS/AppKit, OpenHarmony, Flatpak,
   TestFlight).
3. **Merge, then delete what came back.**

   ```powershell
   git merge --no-commit --no-ff origin/dev
   node scripts/check-windows-only.mjs
   ```

   Resolve platform conflicts by keeping this fork's side:
   - deleted platform files stay deleted (`git rm`);
   - `Cargo.toml` target-dependency blocks for non-Windows targets stay removed;
   - `#[cfg(target_os = "...")]` / `#[cfg(mobile)]` branches are not reintroduced;
   - `src/index.html` keeps this fork's stylesheet links, not platform CSS;
   - README and docs keep the Windows-only wording.

4. **Remove added out-of-scope files.** A conflict-free addition is still rejected. The gate lists
   the known paths; new ones must be added to `FORBIDDEN_PATHS` in `scripts/check-windows-only.mjs`
   and to the table below.
5. **Run the gates.**

   ```powershell
   pnpm install
   cd src-tauri; cargo check --workspace --all-targets; cd ..
   pnpm run check
   pnpm run web:build
   ```

6. **Record the run.** Add a row to the run log below with the upstream range, what was kept and
   what was rejected. Update `PROVENANCE.md` if the merged base changed.

## Paths that must never come back

| Path | Platform |
| --- | --- |
| `.github/workflows/public-testflight.yml`, `nix-package-check.yml`, `fastools-build.yml`, `issue-platform-labels.yml` | CI |
| `packaging/flatpak` | Linux |
| `scripts/install-linux.sh`, `scripts/ohos`, `scripts/macos`, `scripts/ci/configure-mobile-http.sh` | Linux / OpenHarmony / macOS / mobile |
| `src-tauri/crates/tauritavern/gen/android`, `gen/apple` | Android / iOS |
| `src-tauri/crates/tauritavern/icons/AppIcon.icon`, `icons/icon.icns` | macOS |
| `src-tauri/crates/tauritavern/src/platform/ios_*` | iOS |
| `src/css/tauritavern-drawer-bar.css`, `src/scripts/drawer-bar.js` | iOS system-bar UI |
| `src/tauri/main/compat/mobile`, `compat/android-speech-synthesis.js` | mobile runtime |
| `docs/AndroidDevelopment.md`, `iOSDevelopment.md`, `OpenHarmonyDevelopment.md` | platform docs |
| `docs/CurrentState/iOSPolicy.md`, `LinuxRepository.md`, `MobileStyleAdaptation.md` | platform docs |

## Dependency policy

`src-tauri/Cargo.toml` and the crate manifests contain no `[target.'cfg(...)']` blocks for
non-Windows targets. Windows needs plain dependencies; a target block that reappears is either a
merge mistake or a platform feature and must be resolved before the run is accepted.

## Run log

| Date | Upstream range | Kept | Rejected |
| --- | --- | --- | --- |
| 2026-10-27 | `v2.4.0` (`fff9af0`) → `origin/dev` `6a6fc49a` (32 commits) | Character index (`6a6fc49a`), CSS selector work (`18638037`, `92fe9d6c`), World Info copies (`615632a0`, `2593fb7c`), generation metadata (`d0298d60`), prompt manager in-place rows and icons (`38d876ab`, `34b94b5c`), editor style work (`33634017`, `0f41456d`), style-mod patch, VertexAI token timing (`38c860b6`), preset startup (`9f39f822`), dev-log unload (`800f2994`), web-host World Info save (`85f5838d`), perf baselines (`127310fb`, `7891eda5`), `rmcp` 3.6.0 (`6c264c5d`), `mdns-sd` 0.21.6 (`c7e94cd1`), `tokio` 1.53.3 (`96b6d355`) | Flatpak sources (`4f4ea9e1`, `c564be10`), iOS CI (`44d2074f`), iOS docs (`ee7f74e9`), drawer bar (`2dc6d7bf`, `9b169c8a`, `a09d1116`, `bbbfa4a9`, `96e89a07`, `e7d81bc8`, `d1a4fb37`, `06d69b85`), HarmonyOS README badge (`56268a19`) |
