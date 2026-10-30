# Customize user guide

The **Customize** panel is available from the TauriTavern settings rail and from the Copilot menu. It
is backed by the native Rust process.

## Opening Customize

- Open the settings rail and select **Customize**.
- In Copilot, open the menu and choose **Customize**. Both open the same panel.

The panel has seven tabs: Rules, Skills, Subagents, Commands, Hooks, MCP, and Plugins.

## Rules, Skills, Subagents, and Commands

Resources can be stored in native app storage or in the active vault. Vault resources live in:

```text
.cursor/rules/       Markdown or .mdc files
.cursor/skills/      one folder per skill, each with SKILL.md
.cursor/agents/      subagent definitions
.cursor/commands/    slash-command definitions
```

Use the scope and surface checkboxes to control where a resource applies: **Native agent**,
**Copilot**, **Roleplay**, or **DeepLore**. Rules and skills are opt-in for standard roleplay.

Vault resources override native resources with the same name. Plugin contributions are the lowest
precedence layer.

### Commands

Copilot recognizes `/command arguments` and expands the command body, replacing `$ARGUMENTS` with the
supplied text. Roleplay registers the same commands with SillyTavern's slash-command parser.

### Subagents

Subagent definitions are listed in the system prompt and the Customize panel. Named runtime execution
is still being completed; current delegation uses the native agent profile picker.

## Hooks

Hooks use Cursor's JSON configuration shape:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "matcher": "Shell",
        "command": "node .cursor/hooks/check.js",
        "timeoutSec": 30
      }
    ]
  }
}
```

- Vault hooks live at `.cursor/hooks.json`.
- The first save does not trust them. Open **Hooks** and press **Trust configuration**.
- Commands receive the event JSON on standard input and return JSON such as
  `{"permission":"deny","agentMessage":"Blocked by policy"}`.
- The **Run test event** button exercises the current event without executing a real tool.
- Recent hook runs appear under **Recent hook runs**.

Supported events are `sessionStart`, `sessionEnd`, `beforeSubmitPrompt`, `preToolUse`,
`postToolUse`, `postToolUseFailure`, `afterAgentResponse`, `stop`, `subagentStart`, `subagentStop`,
`beforeReadFile`, and `afterFileEdit`.

When a `stop` hook returns `followupMessage`, Copilot starts a follow-up turn, up to three follow-ups
per user request. Native and roleplay stop continuations are not yet automatic.

## MCP

The **MCP** tab lists `.cursor/mcp.json` presets and registered native MCP servers.

- **Add server** registers an HTTP MCP endpoint.
- **Discover** refreshes the server's tools and permissions.
- **Remove** unregisters the server.
- Discovered tool names are shown in the server row.

MCP execution is available to the native agent. Copilot receives the MCP server and discovered-tool
catalog in its customization context; direct Copilot-side tool dispatch is still being completed.

## Plugins

Extensions can add a `customize` block to their `manifest.json`:

```json
{
  "name": "My Plugin",
  "customize": {
    "rules": ["customize/rules"],
    "skills": ["customize/skills"],
    "agents": ["customize/agents"],
    "commands": ["customize/commands"],
    "hooks": "customize/hooks.json",
    "mcp": "customize/mcp.json"
  }
}
```

Plugin contributions are read-only and appear under **Plugins**. Use **Enable/Disable** to turn a
plugin's contributions on or off. Use **Manage extensions** to open the extension manager for
installing or removing the plugin itself.

Plugin paths are confined to the extension directory. Hooks contributed by plugins do not run until
they are trusted.

## Surface summary

| Surface | Rules | Skills | Commands | Hooks |
| :--- | :--- | :--- | :--- | :--- |
| Native agent | yes | existing skill picker | prompt metadata | all lifecycle events |
| Copilot | yes | yes | `/command` expansion | prompt, tool, response, stop |
| Standard roleplay | opt-in | opt-in | slash parser | generation events |
| DeepLore | opt-in context | opt-in | no | file-read hooks |

## Safety

- Hooks and MCP servers execute local processes or network calls. Only trust configurations and
  endpoints you have reviewed.
- Vault hook trust is tied to the configuration hash; editing `hooks.json` requires trusting it again.
- Plugin hooks remain disabled by default.
