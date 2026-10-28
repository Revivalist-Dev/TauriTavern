# SillyBunny desktop host layer (Windows)

SillyBunny's desktop UI plugs into TauriTavern as a first-party host layer rather than being injected
as a third-party extension. It contains only the Windows desktop layout: no mobile shell, no phone
breakpoints, and no Android/iOS branches.

## Composition

| Location | Responsibility |
| --- | --- |
| `src/css/tauritavern-sillybunny-shell.css` | Layout and theme variables for the left icon rail, the side panels, and the conversation panel |
| `src/tauri/main/ui/sillybunny-shell/index.js` | Install entry point: adds `sb-shell` to `body` and injects the Conversation drawer |
| `src/tauri/main/ui/sillybunny-shell/panels.js` | Extension panel host: `__TAURITAVERN_SB_SHELL__` registration, queued panels, and icon-rail buttons |
| `src/tauri/main/ui/sillybunny-shell/conversation.js` | Conversation timeline and send box |
| `src/tauri/main/bootstrap.js` | Loads the install entry point dynamically after `APP_READY` |

## Structure

- **Icon rail**: reuses SillyTavern's `#top-settings-holder` drawer directly. The host layer does not
  remount the application skeleton, so the upstream drawer's click, close, and keyboard behaviour
  stays intact.
- **Side panels**: at desktop widths the regular drawer's `.drawer-content` is pinned to the right of
  the icon rail, one at a time. Wide editors such as World Info and Prompt Manager keep their own
  geometry so a narrow panel does not squeeze them.
- **Conversation mode**: `#sb_conversation` is an ordinary drawer whose timeline mirrors the most
  recent 80 messages from `#chat > .mes`. The mirror strips `id`, `script`, and `iframe` so it neither
  duplicates IDs with the real chat nor starts a second runtime.
- **Sending**: writes to `#send_textarea`, dispatches an `input` event, then clicks `#send_but`.
  Generation, streaming, swipes, and extensions still take SillyTavern's original path; there is no
  second generation pipeline.

## Extension panels

The first-party host layer exposes `globalThis.__TAURITAVERN_SB_SHELL__`:

| Member | Behaviour |
| --- | --- |
| `register(panel)` | Adds a drawer to the icon rail; `panel = { id, label, icon?, render(container, api) }` |
| `unregister(id)` | Removes the panel and its drawer |
| `open(id)` | Opens the panel and re-renders it |
| `close(id)` | Closes the panel |
| `list()` | Returns the registered panel ids |

`registerPanel()` in `shared/sb-core` prefers this host; while the host is not ready it parks panels
in `__SB_PENDING_PANELS__` and drains them at install time. It falls back to `sb-tabs` only when no
host exists.

Injected drawers arrive after `script.js` has made its one-time `.drawer-toggle` binding, so the host
calls `doNavbarIconClick` for each injected drawer and closes it with `setTopLevelDrawerOpen`;
otherwise clicking an icon opens nothing.

Extensions already wired to a panel: `sb-prompt`, `sb-chat`, `sb-groups`, `sb-image-gen`,
`sb-chat-archive`, `sb-card-scripts`, `sb-trackers`; `sillybunny-debugger` keeps its own
extension-menu entry. The Cards and Lorebooks panels have been removed.

### Agent setup UIs

The rail has no dedicated Agent panel. Two agent setup surfaces live one level down, in the
Extensions drawer:

- **Agent System** (`#agent_system_container`, right settings column): the TauriTavern-native
  profiles, delegation, prompt, tools, skills and run UI.
- **In-Chat Agents** (`#in_chat_agents_container`, left settings column): the SillyBunny `sb-agents`
  port, with its settings, agent editor and pathfinder UI. It mounts its `settings.html` into this
  host container; without the container the extension's append is a silent no-op.

Both open from the Extensions drawer in the icon rail, not from a separate rail icon.

## Layout constraints

- The icon rail and side panels are enabled only at `min-width: 1000px`; narrower windows keep the
  upstream layout.
- In host mode `#sheld` fills the width available to the right of the icon rail instead of using the
  50% chat width.
- The icon rail scrolls and shows a thin scrollbar; a divider separates the core drawers from the
  extension panels.
- No platform API is read and no mobile host is detected; colours come from the `--SmartTheme*`
  variables and follow the user's theme.
- No phone breakpoints and no touch-only interactions are introduced.

## Differences from upstream

- The original SillyBunny implementation remounts the top-level DOM and maintains its own tab state
  machine; this implementation is primarily CSS layout with minimal DOM changes, to reduce conflicts
  with the 2.4.0 panel runtime.
- The third-party `sb-tabs` injection layer no longer participates in the host UI; feature panels
  should register with the 2.4 Panel Runtime.
