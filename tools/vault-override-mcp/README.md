# Vault Override MCP

Local MCP server for authoring TauriTavern narrative-experiment overrides. It gives DeepLore
Copilot one read-first guide and a validated write tool, without exposing the base vault files.

## Start

From `tauri-tavern/`:

```powershell
pnpm run mcp:overrides
```

Equivalent explicit command:

```powershell
node tools/vault-override-mcp/server.mjs `
  --root C:\DeveloperData\project-zedon\project-roleplay `
  --port 7808
```

`--root` may be repeated. It must point at a directory containing `lorebook-*` vaults. The server
binds to `127.0.0.1` by default and exposes `POST /mcp` plus `GET /health`.

The process must stay running while Copilot uses the tools.

## Register in TauriTavern

1. Open **Agent Workspace -> MCP**.
2. Add a custom server:
   - Name: `Vault Overrides`
   - Endpoint: `http://127.0.0.1:7808/mcp`
   - Protocol: automatic, or `2025-06-18`
3. Mark it active and run discovery.
4. Set permissions:
   - `vault_overrides_guide`: allow
   - `list_vaults`: allow
   - `list_overrides`: allow
   - `create_override`: ask (recommended) or allow

The same registration can be created through the bridge API:

```js
const api = window.__TAURITAVERN__.api.mcp;
const server = await api.servers.create({
  displayName: 'Vault Overrides',
  endpoint: 'http://127.0.0.1:7808/mcp',
  protocolVersion: '2025-06-18',
});
await api.servers.setState({ registrationId: server.id, state: 'active' });
await api.servers.discover(server.id);
await api.tools.setPermission({
  registrationId: server.id,
  nativeName: 'create_override',
  permission: 'ask',
});
```

## Tools

### `vault_overrides_guide`

Read-only. Returns the full authoring contract: exact-path matching, manifest layout, examples, and
the safe workflow. Copilot should call this before any write. The server's MCP `initialize`
instructions also point at it.

### `list_vaults`

Read-only. Lists the `lorebook-*` vaults under the configured roots, their experiment directories, and
experiment counts.

### `list_overrides`

Read-only. Takes `vault` and an optional `experiment`. Returns each experiment's `overrides` and
`removals` entries.

### `create_override`

Write tool. Takes:

| Field | Required | Meaning |
|---|---|---|
| `vault` | yes | Vault directory name, e.g. `lorebook-naruto` |
| `experiment` | yes | Experiment folder name; letters, digits, `.`, `_`, `-` |
| `target` | yes | Existing base note path with its exact filename |
| `content` | no | Full Markdown; omitted means copy the base note |
| `title` | no | Experiment title |
| `summary` | no | Experiment summary |
| `overwrite` | no | Replace an existing override file; defaults to `false` |

It writes `Narrative-Experiments/<experiment>/overrides/<target>` (or the `lore/` variant), updates
`experiment.json` atomically, removes a conflicting removal entry, and never edits the base note.

The tool refuses:

- vault names that are not `lorebook-*`;
- paths outside a configured root;
- absolute paths, `..` traversal, and non-Markdown targets;
- targets that do not already exist;
- overwriting an existing override unless `overwrite: true` is passed.

## Exact-path rule

The target must match the base note's exact path, relative to the content root. If
`World/Clans/Aburame Clan (Konohagakure).md` exists, the manifest entry is:

```json
"overrides": [
  "overrides/World/Clans/Aburame Clan (Konohagakure).md"
]
```

A path that does not match a base note becomes a **new virtual note**, not a replacement. This is how
consolidated experiments such as Naruto's `arranged-dowry` work: they add a new consolidated note and
list the old files under `removals`.

## Verify

1. Start the server and confirm `http://127.0.0.1:7808/health`.
2. Run `list_vaults`, then `vault_overrides_guide`.
3. Create an override with `create_override`.
4. In **Vault explorer -> Narrative experiments**, select the experiment and confirm the note is red
   with `Overridden`.
5. Switch back to **Base vault** and confirm the original returns.
6. With the experiment active, verify DeepLore Copilot retrieval returns the override text.

The server contract has an offline test:

```powershell
pnpm test:mcp
```

## Stop

Find the listener on port 7808 and stop only that process:

```powershell
$connection = Get-NetTCPConnection -LocalPort 7808 -State Listen
Stop-Process -Id $connection.OwningProcess
```

## Security notes

- The server is a local filesystem writer. Keep it bound to `127.0.0.1`.
- Use `--token <value>` to require `Authorization: Bearer <value>`; add the same header in the MCP
  registration.
- The write tools are limited to `<root>/lorebook-*/Narrative-Experiments/.../overrides`, but any local
  process with access to the endpoint can author overrides while it is running.
- The server does not delete experiments or base notes.
