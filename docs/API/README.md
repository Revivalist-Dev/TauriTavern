# Extension API

TauriTavern's host API lives at `window.__TAURITAVERN__.api`. Wait for the host to be ready before using it:

```js
await (window.__TAURITAVERN__?.ready ?? window.__TAURITAVERN_MAIN_READY__);
const api = window.__TAURITAVERN__.api;
```

| API | Purpose |
| --- | --- |
| [api.chat](Chat.md) | Chat reading, search, metadata and extension storage |
| [api.layout](Layout.md) | Reading and subscribing to the content viewport |
| [api.dev](Dev.md) | Frontend and backend logs and model request diagnostics |
| [api.worldInfo](WorldInfo.md) | World Info activation results and entry navigation |
| [api.extension.store](Extension.md) | Global JSON / Blob storage for extensions |
| [api.db](Database.md) | Local vector, text index, graph and TQL database |
| [api.agent](Agent.md) | Run control, history, file details and profile management |
| [api.llmConnections](LlmConnections.md) | Model connections used by agents |
| [api.skill](Skill.md) | skill import, editing, scope and export |
| [api.mcp](MCP.md) | MCP servers, tool discovery, permissions and test calls |

For the full types, see [src/types.d.ts](../../src/types.d.ts); for the stability guarantees, see the [host contract](../FrontendHostContract.md). When migrating a SillyTavern extension, the [migration guide](Migration.md) is a good starting point.

For how the framework works internally, see [Agent](../Agent/README.md). This directory concentrates on how to call the API and what it returns.
