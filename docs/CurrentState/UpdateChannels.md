# Current contract of the update channels

TauriTavern maintains exactly two update channels, `stable` and `canary`. The update feature only
detects an update and guides the download; it does not install updates inside the app.

The Linux system package repository defaults to `stable` and also provides a separate `canary` suite.
APT/DNF/Zypper install updates from the system package database, independently of the in-app
Stable/Canary preference; repository addresses, signing identities, and installation methods are in
`docs/CurrentState/LinuxRepository.md`.

## Identity and default channel

- User-facing: Stable shows the version number; Canary shows a China Standard Time date, for example
  `Canary Release 2026.06.14`.
- Program-facing: Stable compares by SemVer; Canary normalizes both the current build and the remote
  Git commit to a 12-character short hash and compares them exactly.
- A build branch of exactly `main` defaults to `stable`, any other known branch defaults to `canary`,
  and missing branch information conservatively defaults to `stable`.
- The user can override the default channel in the version extension settings. That choice goes
  through the existing settings persistence path.

Build identity is injected through `TAURITAVERN_BUILD_BRANCH` and `TAURITAVERN_BUILD_REVISION`; when
they are not supplied explicitly, the build script reads the GitHub Actions environment and then local
Git. A Canary build with a missing or invalid revision must fail explicitly rather than fall back to
version comparison.

## Detection path

The frontend passes the effective channel to the `check_for_update` command, the application service
decides the comparison semantics, and the GitHub adapter only reads the data for that channel:

- Stable: `GET /repos/Darkatse/TauriTavern/releases/latest`
- Canary: `GET /repos/Darkatse/TauriTavern/releases/tags/Canary` and
  `GET /repos/Darkatse/TauriTavern/commits/Canary`

A Canary Release must be a prerelease, and the Stable latest must not be one. The `release_token`
returned to the frontend is the machine deduplication key: the tag for Stable, `sha12` for Canary. The
popup mainly shows the Release name, so the release pipeline generates Canary's date format
consistently.

## Canary release pipeline

The Stable and Canary debug builds on Windows and macOS both enable Tauri Pilot; regular release builds
leave it off by default.

`.github/workflows/canary-release.yml` builds the desktop and mobile targets from the same commit on
`dev`, and updates the fixed `Canary` Release and tag only after the required artifacts have validated.
The experimental HarmonyOS HAP is an optional artifact in both Stable and Canary: when the HarmonyOS
build fails, the other platforms publish as usual and only that HAP is missing, with the failure shown
on the HarmonyOS job of that run. Stable and Canary share one user-facing artifact naming contract:

```text
TauriTavern-<release-id>-<platform>-<arch>[-<variant>][.<ext>]
```

Stable's `release-id` is the version number; Canary uses `<YYYYMMDD>-canary`, with the date computed in
`Asia/Shanghai`. Platforms are always `windows`, `macos`, `linux`, `android`, `ios`, or `ohos`; desktop
architectures are always `x64` / `arm64`; Android and HarmonyOS use the standard ABI names. The kind is
not repeated when the extension already distinguishes the package format, so only necessary variants
such as `setup`, `portable`, and `TestFlight` keep a suffix; a Linux portable build is a native
executable with no extension. The Release title is `Canary Release <YYYY.MM.DD>`. The tag moves to the
published commit last, so clients never see an unfinished build first.

Release notes begin with a deterministic context and fallback body generated from Git history. A
separate read-only Codex job inspects the actual diff using the `CANARY_CODEX_API_KEY`,
`CANARY_CODEX_RESPONSES_ENDPOINT`, `CANARY_CODEX_MODEL`, and `CANARY_CODEX_EFFORT` secrets, then writes
a bilingual Chinese/English body through a project-specific skill. The skill source files live in
`.github/codex/skills/`, which local Codex does not discover automatically, and CI only copies them
into the runner's temporary `CODEX_HOME`. When the Codex call fails or its output does not match the
expected structure, the deterministic body is used directly, without affecting the build or the
release.

## Public TestFlight

The existing self-signed iOS IPA for Stable and Canary keeps its original build parameters and Release
file name. After the ordinary IPA completes, the iOS job reuses the frontend assets it already produced
to build an additional `ios_external_beta` + App Store Connect copy, published as a separate artifact
with the `-TestFlight.ipa` suffix. Only once the full GitHub Release assets publish successfully does
the shared `.github/workflows/public-testflight.yml` upload and distribute that dedicated IPA; after it
has entered the TestFlight flow successfully, the temporary `-TestFlight.ipa` is deleted from the
GitHub Release, while the ordinary self-signed IPA is always kept.

The Stable dedicated IPA goes only to `TauriTavern Beta Test`, and the Canary one only to
`TauriTavern Canary Test`; the pipeline verifies that the target really is a public external-testing
group of the current app. Every TestFlight build uses a monotonically increasing `CFBundleVersion`, so
the two channels can share a marketing version without a build-number collision.

Before upload, an isolated read-only Codex job checks the actual commit range and the
`ios_external_beta` capability boundary, and produces only English `What to Test` copy that is visible
in the public build and worth testing. AI takes no part in build, version, group, or review decisions;
when the call fails or the copy is invalid, a deterministic generic testing hint is used, so AI never
blocks the upload. Before the IPA uploads, App Store Connect is checked by app, marketing version, and
build number; a rerun that encounters the same build already uploaded skips the duplicate. A
deterministic script then waits for Apple to finish processing, writes the `en-US` build localization,
enables automatic notifications, associates the single target group, and submits for Beta App Review
when needed. Apple's review is asynchronous external state: the run ends as soon as the submission is
accepted, without waiting for approval.

## Maintenance constraints

1. Never judge an update by the displayed date; the date serves user recognition only, and the commit
   SHA is the Canary identity.
2. Never let desktop and mobile advance the Canary tag separately; one Release must correspond to one
   source commit.
3. Never let AI decide the version, the artifacts, the release conditions, or the tag; AI may only
   rewrite facts that have already been produced.
4. When changing the channel DTO, settings, or command, keep the Rust serde names matching the
   frontend strings `stable` / `canary`.
5. Public TestFlight always uses `ios_external_beta`; never copy the full GitHub Release changelog
   straight into `What to Test`.
