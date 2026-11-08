# Module documentation

This section records how each module works and where its source entry point lives. The overall picture of the agent is in [Agent](../Agent/README.md), and the backend layering is in
[Backend structure](../BackendStructure.md).

## Removed from this fork

- **Text-to-speech.** The `tts` frontend extension, its settings section, the `/tts` provider routes,
  the `tts_handle` command, the `TtsService` application service, the `TtsRepository` port and the
  HTTP TTS adapter are removed. There is no replacement and no supported TTS path in this fork.

| Module | What the document covers |
| --- | --- |
| [Third-party extensions](ThirdPartyExtensions.md) | Loading, discovery, and resource access |
| [Embedded runtime in messages](EmbeddedRuntime.md) | iframe lifecycle and rendering |
| [Startup flow](StartupOptimization.md) | The Shell, Core, and Full phases |
| [Bootstrap](BootstrapOptimization.md) | Startup inputs and memory cost |
| [Chat storage](ChatPayload.md) | Full history, paged reads, and saving |
| [Memory extension](MemoryExtensionApi.md) | Chat queries and extension storage |
| [Media assets](MediaAssetContract.md) | Browser resources and Range requests |
| [Sync](Sync.md) | LAN Sync and TT-Sync |
| [File transfer](FileTransfer.md) | Native picking, delivery, and staging |
| [Data directory](DataDirectorySelection.md) | Desktop directory selection and migration |
| [Native model APIs](NativeApiFormats.md) | Responses, Claude, Gemini, and other formats |
| [Character identity](CharacterIdentityContract.md) | Characters, chat directories, renaming, and lorebook binding |
| [Logging](LoggingObservability.md) | tracing, the Dev API, and LLM request logs |
| [Resource caching](HostResourceCaching.md) | Resource versions and conditional requests |
| [Update channels](UpdateChannels.md) | Stable, Canary, and update detection |
| [Tauri host layer](TauriShell.md) | Desktop icon rail and side panels |
| [Upstream PR assessment](UpstreamPullRequests.md) | Merge, defer, and reject verdicts for the Windows-only baseline |
| [Windows distribution](WindowsDistribution.md) | WinGet and the installer |
| [MCP](MCP.md) | Servers, tool catalogue, and model invocation |
| [Vector API](VectorApi.md) | Indexing, embeddings, and queries |
| [First-party UI](FirstPartyUI.md) | React, TypeScript, and the build pipeline |
| [Web Host](WebHost.md) | The host implementation used by the browser embedder (Tavern Studio) |

