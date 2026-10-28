<div align="center">

<img src="docs/images/tauritavern-readme-hero.webp" alt="TauriTavern" width="720">

# TauriTavern

**SillyTavern, as a native Windows app — ready out of the box**

> **Fork note:** this branch builds Windows 10/11 x64 only. macOS, Linux, Android, iOS, HarmonyOS, Flatpak and TestFlight instructions from upstream do not apply and are not part of this repository. Text-to-speech is removed from this fork and is not a supported feature.

[Downloads](https://tauritavern.github.io/en/downloads/) · [Docs](https://tauritavern.github.io/en/) · [Releases](https://github.com/Darkatse/TauriTavern/releases) · [Issues](https://github.com/Darkatse/TauriTavern/issues)

[![Release](https://img.shields.io/github/v/release/Darkatse/TauriTavern?style=flat-square&color=1f9d96)](https://github.com/Darkatse/TauriTavern/releases/latest)
[![License](https://img.shields.io/github/license/Darkatse/TauriTavern?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Darkatse/TauriTavern?style=flat-square&labelColor=black&color=ffcb47)](https://github.com/Darkatse/TauriTavern/stargazers)
[![Platforms](https://img.shields.io/badge/platforms-Windows%2010%2F11%20x64-1f9d96?style=flat-square)](https://github.com/Darkatse/TauriTavern/releases/latest)
<br/>
[![Telegram](https://img.shields.io/badge/Telegram-Group-26A5E4?style=flat-square&logo=telegram&logoColor=white)](https://t.me/TauriTavern)
[![Discord](https://img.shields.io/badge/Discord-Community-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/hn57aFGe8h)
[![Issues](https://img.shields.io/github/issues/Darkatse/TauriTavern?style=flat-square&logo=github)](https://github.com/Darkatse/TauriTavern/issues)
[![Canary](https://img.shields.io/github/actions/workflow/status/Darkatse/TauriTavern/canary-release.yml?style=flat-square&logo=githubactions&label=canary)](https://github.com/Darkatse/TauriTavern/actions/workflows/canary-release.yml)

</div>

<p align="center"><sub>Thanks to <a href="https://github.com/shiyue137">@shiyue137</a> for designing the TauriTavern logo 💛</sub></p>

## Download

<div align="center">

[![⬇ Download TauriTavern](https://img.shields.io/badge/%E2%AC%87_Download-TauriTavern-1f9d96?style=for-the-badge)](https://tauritavern.github.io/en/downloads/)

**Windows 10/11 x64 · one click to the latest stable build**

[![Windows](https://custom-icon-badges.demolab.com/badge/Windows-0078D6?logo=windows11&logoColor=white&style=flat-square)](https://tauritavern.github.io/en/downloads/platforms/)

[GitHub Releases](https://github.com/Darkatse/TauriTavern/releases)

</div>

<details>
<summary><b>📦 Install with a package manager</b> (Windows)</summary>

### Windows · WinGet

Run in PowerShell:

```powershell
winget install --id TauriTavern.TauriTavern
```

### Windows · Scoop

Run in PowerShell:

```powershell
scoop bucket add Darkatse https://github.com/Darkatse/Scoop-Darkatse.git
scoop install Darkatse/TauriTavern
```

</details>

### Canary

Canary receives daily updates with new features and fixes, but may be less reliable than Stable. If you want to try the latest build or are having an issue with Stable, check whether Canary already includes a fix.

Windows builds are available from the [Canary Release](https://github.com/Darkatse/TauriTavern/releases/tag/Canary).

> [!TIP]
> **Windows portable**: requires the WebView2 runtime on the system.

## What is TauriTavern

TauriTavern ports [SillyTavern](https://github.com/SillyTavern/SillyTavern) into a true native Windows app: the frontend keeps the full upstream experience (synced to 1.19.0), while the backend is rebuilt from Node.js into Rust (Tauri v2).

No Node.js to install, no command line — just download and run. Your character cards, chats, presets, world info, and frontend extensions all stay compatible with SillyTavern.

> Note: TauriTavern is an independently maintained open-source project, not an official SillyTavern client. TauriTavern is free and open source under the AGPL-3.0 license. Please review the license terms before use.

## Highlights

- 🖥️ **Native Windows desktop app**: Windows 10/11 x64, packaged as a Tauri v2 application
- 🎭 **Full SillyTavern experience**: frontend synced to upstream 1.19.0, with fully compatible data formats and directory layout
- 🧩 **Frontend extension ecosystem**: built-in native Git — install, update, and switch branches right in the UI (Node-only backend plugins are not supported)
- 🔄 **Built-in multi-device sync**: encrypted LAN pairing, or automatic upload via the remote TT-Sync v2
- 🤖 **Agent framework**: tool calling, Skills, sub-agents, and a run timeline; development is ongoing
- 📦 **One-click migration**: SillyTavern export scripts + in-app import for a smooth move
- ⚡ **Performance engineering**: phased startup and chat DOM virtualization keep even very long chats smooth
- 🔒 **Your data, yours**: everything stays on your device, with an optional portable mode

## Screenshots

<div align="center">
<img src="docs/images/tauritavern-multidevice-cutout.webp" alt="TauriTavern on Windows" width="760">
</div>

## Architecture at a Glance

The Rust backend is a Clean Architecture Cargo workspace (`src-tauri/crates/`):

- `tauritavern`: Tauri host, command layer, and composition root
- `tt-application` · `tt-ports` · `tt-domain` · `tt-contracts`: use cases, ports, domain models, and cross-crate contracts
- `tt-adapter-*`: concrete storage, HTTP, media, sync, extension, and tokenization implementations

The frontend is upstream SillyTavern plus a modular Tauri injection layer (`src/tauri/main/`), talking to the Rust backend through the `window.__TAURITAVERN__` platform ABI. See [docs/BackendStructure.md](docs/BackendStructure.md) and [docs/FrontendGuide.md](docs/FrontendGuide.md) for details.

<details>
<summary><b>🛠 Development</b> (prerequisites · common commands · Tauri Pilot · portable builds · FasTools)</summary>

**Prerequisites**: Rust stable (edition 2024) · Node.js 22.13+ · pnpm 11 · Tauri CLI

```bash
git clone https://github.com/Darkatse/TauriTavern.git
cd TauriTavern
pnpm install
```

**Common commands**:

```bash
pnpm run check         # frontend guardrails/types/contracts + Rust dev check
pnpm run web:build     # build frontend bundles (Rspack)
pnpm run tauri:dev     # desktop dev mode
pnpm run tauri:build   # build desktop installers
```

**Tauri Pilot (UI development with AI agents)**

The project already includes the development-only [Tauri Pilot](https://github.com/mpiton/tauri-pilot) plugin and capability. It lets an AI agent inspect and operate the WebView on desktop through accessibility snapshots. The standard development and release commands do not enable it.

```bash
cargo install tauri-pilot-cli  # only needed once
pnpm run tauri:dev:pilot       # desktop
```

After the app starts, use another terminal for the basic workflow:

```bash
tauri-pilot ping
tauri-pilot snapshot -i
tauri-pilot click @e3          # use a ref from the current snapshot
tauri-pilot diff -i
tauri-pilot logs --level error
```

Take a snapshot before interacting and perform one action at a time. Use `wait` after asynchronous updates and prefer `assert` for verification. An MCP-capable agent can register `tauri-pilot mcp` as a stdio server.

**Portable builds**: `pnpm run tauri:build:portable` (outputs to `release/`); force portable runtime with `TAURITAVERN_RUNTIME_MODE=portable` or a `portable.flag` file.

**FasTools**: the recommended toolkit for development and deployment debugging. Build with `pnpm run fastools:build`, run with `pnpm run fastools:run`.

</details>

## Documentation

- 📖 [Online docs](https://tauritavern.github.io/en/): guides covering usage, Agent, architecture, API, and downloads
- [docs/FrontendGuide.md](docs/FrontendGuide.md): frontend architecture and extension guide
- [docs/FrontendHostContract.md](docs/FrontendHostContract.md): public host-layer contract
- [docs/BackendStructure.md](docs/BackendStructure.md): backend Clean Architecture and crate boundaries
- [docs/CurrentState/](docs/CurrentState/README.md): implementation status of shipped modules

## Contributing

Issues and PRs are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first, target the `dev` branch unless it is an urgent fix.

## Acknowledgements & License

Built on [SillyTavern](https://github.com/SillyTavern/SillyTavern) and [Tauri](https://tauri.app/), with thanks to [Cocktail](https://github.com/Lianues/cocktail), [Tavern-Helper](https://github.com/N0VI028/JS-Slash-Runner), [LittleWhiteBox](https://github.com/RT15548/LittleWhiteBox), [MikTik](https://github.com/Darkatse/MikTik), [@LX2000WASD](https://github.com/LX2000WASD) for maintaining the [TauriTavern AUR package](https://github.com/LX2000WASD/TauriTavern-aur), and [@LeenHawk](https://github.com/LeenHawk) for the HarmonyOS port.

Released under [AGPL-3.0](LICENSE) (same license family as SillyTavern).

[![Contributors](https://contrib.rocks/image?repo=Darkatse/TauriTavern)](https://github.com/Darkatse/TauriTavern/graphs/contributors)

<p align="center"><sub><em>Made with love and care ❤️ — The TauriTavern Team</em></sub></p>
