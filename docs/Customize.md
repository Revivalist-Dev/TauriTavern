# Customize user guide

The **Customize** panel is available from the TauriTavern settings rail and from the Copilot menu. It
is backed by the native Rust process.

## Creative Writing framing

TauriTavern is a creative-writing client for character dialogue, interactive fiction, and text
scenes. Agents, prompts, and documentation use **Creative Writing** as the domain name and
**Character Chat** as the normal conversation surface.

## Terminology update

The surface selector now uses **Character Chat**. Customizations saved against the previous surface
name must be opened and saved again; the old value is intentionally not accepted. Bundled third-party
presets keep their original labels.

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
**Copilot**, **Character Chat**, or **DeepLore**. Rules and skills are opt-in for Character Chat.

Vault resources override native resources with the same name. Plugin contributions are the lowest
precedence layer.

### Commands

Copilot recognizes `/command arguments` and expands the command body, replacing `$ARGUMENTS` with the
supplied text. Character Chat registers the same commands with SillyTavern's slash-command parser.

### Subagents

Subagent definitions are listed in the system prompt as `name (agentId: custom-...)`.

The native agent can delegate to a custom definition by passing that ID to its delegation tool. The
child run inherits the caller's model and tool policy, and the definition's prompt is prepended to the
task. Copilot can run one with the `run_custom_agent` tool, which accepts `agentId` and `task`, caps
the task at 8,000 characters, returns at most 12,000 characters, and times out after 60 seconds. The
child is a single text turn with tools and further subagent delegation disabled.

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

When a `stop` hook returns `followupMessage`, the native agent and Copilot start a follow-up turn,
up to three follow-ups per user request. Character Chat stop continuations are not yet automatic.

## MCP

The **MCP** tab lists `.cursor/mcp.json` presets and registered native MCP servers.

- **Add server** registers an HTTP MCP endpoint.
- **Discover** refreshes the server's tools and permissions.
- **Remove** unregisters the server.
- Discovered tool names are shown in the server row.

Each server row has a **Test call** control. Pick one of its discovered tools, enter JSON arguments,
and run it; the normalized native result appears below the form. Test calls use the same permission
path as normal MCP execution, so denied tools are refused there too.

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
| Native agent | yes | existing skill picker | `/command` expansion | all lifecycle events |
| Copilot | yes | yes | `/command` expansion | prompt, tool, response, stop |
| Character Chat | opt-in | opt-in | slash parser | generation events |
| DeepLore | opt-in context | opt-in | no | file-read hooks |

## Safety

- Hooks and MCP servers execute local processes or network calls. Only trust configurations and
  endpoints you have reviewed.
- Vault hook trust is tied to the configuration hash; editing `hooks.json` requires trusting it again.
- Plugin hooks remain disabled by default.
