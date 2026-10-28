# TauriTavern project documentation

TauriTavern keeps SillyTavern's frontend experience and extension ecosystem, with a Tauri and Rust backend supplying local storage, model calls, and platform capabilities. This branch builds the Windows 10/11 x64 desktop app only; Linux, macOS, Android, iOS, OpenHarmony, Flatpak, and TestFlight are all out of scope.

## Start reading

Begin with [Project philosophy](../CONTRIBUTING.md#project-philosophy) to see how the project handles compatibility, complexity, and maintenance cost. Then pick an entry point by the work you are doing:

| Area | Document |
| --- | --- |
| Repository tech stack and development checks | [Tech stack](TechStack.md) |
| Rust services and crate boundaries | [Backend structure](BackendStructure.md) |
| Frontend startup, routing, and integration | [Frontend guide](FrontendGuide.md) |
| Host behavior visible to the frontend and extensions | [Host contract](FrontendHostContract.md) |
| Writing an extension | [Extension API](API/README.md) |
| Understanding or modifying the agent | [Agent](Agent/README.md) |
| File import, export, and staging | [File transfer](CurrentState/FileTransfer.md) |
| Finding the implementation of a module | [Module docs](CurrentState/README.md) |
| Building a Windows release | [README](../README.md) · [Tech stack](TechStack.md) |
| Merging upstream updates (Windows-only rules) | [Upstream sync](UpstreamSync.md) |

The agent documentation starts with files, the workspace, the loop, and logs, then explains how multiple agents collaborate through tasks and results. Configuration, tools, scripts, and the API are there when you need them.

## Maintaining the docs

Keep one primary entry per topic, and have the body explain the purpose, how it works, and where the source lives. Interface usage belongs in the API docs, and field and default values cite the source. When behavior changes, update the topic that owns it and delete descriptions that are out of date.
