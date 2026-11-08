#!/usr/bin/env node
/**
 * Local MCP server for authoring TauriTavern vault overrides.
 *
 * Transport: Streamable HTTP, JSON responses, endpoint `/mcp`.
 * No third-party dependencies.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SERVER_NAME = 'tauri-vault-overrides';
const SERVER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '2025-06-18';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const EXPERIMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const VAULT_NAME = /^lorebook-[A-Za-z0-9._-]+$/;

function usage(exitCode = 0) {
    console.log(`Usage: node tools/vault-override-mcp/server.mjs --root <lorebook-parent> [options]

Options:
  --root <path>    Directory containing lorebook-* vaults. Repeatable.
  --port <number>  Port to listen on. Default: 7808.
  --host <host>    Bind address. Default: 127.0.0.1.
  --token <token>  Require Authorization: Bearer <token>.
  --help           Show this help.
`);
    process.exit(exitCode);
}

function parseArgs(argv) {
    const options = { roots: [], port: 7808, host: '127.0.0.1', token: '' };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = () => {
            index += 1;
            if (index >= argv.length) usage(2);
            return argv[index];
        };
        if (arg === '--root') options.roots.push(path.resolve(next()));
        else if (arg === '--port') options.port = Number(next());
        else if (arg === '--host') options.host = next();
        else if (arg === '--token') options.token = next();
        else if (arg === '--help' || arg === '-h') usage(0);
        else {
            console.error(`Unknown argument: ${arg}`);
            usage(2);
        }
    }
    if (options.roots.length === 0) {
        const fallback = process.env.TAURITAVERN_LOREBOOK_ROOT;
        if (fallback) options.roots.push(path.resolve(fallback));
    }
    if (options.roots.length === 0) {
        console.error('At least one --root is required.');
        usage(2);
    }
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        console.error('--port must be an integer between 0 and 65535.');
        process.exit(2);
    }
    return options;
}

const options = parseArgs(process.argv.slice(2));
const roots = options.roots.map((root) => fs.realpathSync(root));
const sessions = new Set();

function isInside(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeTarget(value) {
    const raw = String(value ?? '').trim().replaceAll('\\', '/');
    if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
        throw new Error('target must be a vault-relative path');
    }
    const normalized = path.posix.normalize(raw);
    if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
        throw new Error('target escapes the vault');
    }
    if (!normalized.toLowerCase().endsWith('.md')) {
        throw new Error('target must be a Markdown file (.md)');
    }
    return normalized;
}

function findVault(input) {
    const value = String(input ?? '').trim();
    if (!value) throw new Error('vault is required');
    const candidates = [];
    if (path.isAbsolute(value)) {
        candidates.push(path.resolve(value));
    } else if (!value.includes('/') && !value.includes('\\')) {
        for (const root of roots) candidates.push(path.join(root, value));
    } else {
        throw new Error('vault must be a lorebook-* directory name, not a path');
    }
    for (const candidate of candidates) {
        let real;
        try {
            real = fs.realpathSync(candidate);
        } catch {
            continue;
        }
        if (!fs.statSync(real).isDirectory()) continue;
        if (!VAULT_NAME.test(path.basename(real))) throw new Error('vault must be named lorebook-*');
        if (!roots.some((root) => real === root || isInside(root, real))) {
            throw new Error('vault is outside the configured roots');
        }
        return { name: path.basename(real), path: real };
    }
    throw new Error(`vault not found: ${value}`);
}

function describeVault(vault) {
    const rootsInfo = [];
    for (const [label, directory] of [
        ['root', path.join(vault.path, 'Narrative-Experiments')],
        ['lore', path.join(vault.path, 'lore', 'Narrative-Experiments')],
    ]) {
        if (!fs.existsSync(directory)) continue;
        const experiments = [];
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const manifestPath = path.join(directory, entry.name, 'experiment.json');
            if (!fs.existsSync(manifestPath)) continue;
            experiments.push(entry.name);
        }
        rootsInfo.push({ label, path: directory, experiments: experiments.sort() });
    }
    return { name: vault.name, path: vault.path, experimentRoots: rootsInfo };
}

function listVaults() {
    const found = new Map();
    for (const root of roots) {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory() || !VAULT_NAME.test(entry.name)) continue;
            const vaultPath = fs.realpathSync(path.join(root, entry.name));
            found.set(entry.name, describeVault({ name: entry.name, path: vaultPath }));
        }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function resolveTarget(vault, targetInput) {
    const target = normalizeTarget(targetInput);
    const contentRoot = path.join(vault.path);
    const loreRoot = path.join(vault.path, 'lore');
    const candidates = [
        {
            label: 'root',
            contentRoot,
            absolute: path.resolve(contentRoot, target),
            experimentRoot: path.join(vault.path, 'Narrative-Experiments'),
        },
    ];
    if (fs.existsSync(loreRoot)) {
        candidates.push({
            label: 'lore',
            contentRoot: loreRoot,
            absolute: path.resolve(loreRoot, target),
            experimentRoot: path.join(loreRoot, 'Narrative-Experiments'),
        });
    }

    for (const candidate of candidates) {
        if (!isInside(candidate.contentRoot, candidate.absolute)) continue;
        if (!fs.existsSync(candidate.absolute)) continue;
        if (!fs.statSync(candidate.absolute).isFile()) continue;
        return { ...candidate, target, realTarget: fs.realpathSync(candidate.absolute) };
    }
    throw new Error(`base note not found for target: ${target}`);
}

function readManifest(manifestPath, experiment) {
    if (!fs.existsSync(manifestPath)) {
        return {
            title: experiment.replaceAll(/[-_]+/g, ' ').replaceAll(/\b\w/g, (letter) => letter.toUpperCase()),
            summary: '',
            overrides: [],
            removals: [],
        };
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        throw new Error(`invalid experiment.json: ${error.message}`);
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('invalid experiment.json: expected a JSON object');
    }
    if (!Array.isArray(manifest.overrides)) manifest.overrides = [];
    if (!Array.isArray(manifest.removals)) manifest.removals = [];
    return manifest;
}

function writeFileAtomic(filePath, contents) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, contents, 'utf8');
    fs.renameSync(temporary, filePath);
}

function createOverride(args) {
    const vault = findVault(args.vault);
    const experiment = String(args.experiment ?? '').trim();
    if (!EXPERIMENT_NAME.test(experiment)) {
        throw new Error('experiment must start with a letter or digit and contain only letters, digits, dot, underscore, or dash');
    }
    const target = resolveTarget(vault, args.target);
    const content = args.content === undefined || args.content === null
        ? fs.readFileSync(target.realTarget, 'utf8')
        : String(args.content);
    if (content.length > MAX_BODY_BYTES) throw new Error('content is too large');
    if (!content.trim()) throw new Error('content must not be empty');

    const relativeOverride = `overrides/${target.target}`;
    const overridePath = path.resolve(target.experimentRoot, experiment, relativeOverride);
    if (!isInside(target.experimentRoot, overridePath)) throw new Error('override path escapes the experiment root');
    const exists = fs.existsSync(overridePath);
    if (exists && args.overwrite !== true) {
        throw new Error('override already exists; pass overwrite: true to replace it');
    }

    const manifestPath = path.join(target.experimentRoot, experiment, 'experiment.json');
    const manifest = readManifest(manifestPath, experiment);
    manifest.overrides = manifest.overrides.filter((entry) => entry !== relativeOverride);
    manifest.overrides.push(relativeOverride);
    manifest.removals = manifest.removals.filter((entry) => entry !== target.target);
    manifest.overrides.sort();

    if (typeof args.title === 'string' && args.title.trim()) manifest.title = args.title.trim();
    if (typeof args.summary === 'string' && args.summary.trim()) manifest.summary = args.summary.trim();

    writeFileAtomic(overridePath, content.endsWith('\n') ? content : `${content}\n`);
    writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    return {
        ok: true,
        vault: vault.name,
        experiment,
        contentRoot: path.relative(vault.path, target.contentRoot) || '.',
        target: target.target,
        override: path.relative(vault.path, overridePath).replaceAll('\\', '/'),
        manifest: path.relative(vault.path, manifestPath).replaceAll('\\', '/'),
        replacedExisting: exists,
        overrides: manifest.overrides.length,
        removals: manifest.removals.length,
        next: 'Open Vault explorer -> Narrative experiments -> select this experiment. The note should be red/Overridden.',
    };
}

function listOverrides(args) {
    const vault = findVault(args.vault);
    const result = [];
    for (const [label, directory] of [
        ['root', path.join(vault.path, 'Narrative-Experiments')],
        ['lore', path.join(vault.path, 'lore', 'Narrative-Experiments')],
    ]) {
        if (!fs.existsSync(directory)) continue;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const manifestPath = path.join(directory, entry.name, 'experiment.json');
            if (!fs.existsSync(manifestPath)) continue;
            if (args.experiment && entry.name !== args.experiment) continue;
            try {
                const manifest = readManifest(manifestPath, entry.name);
                result.push({
                    scope: label,
                    experiment: entry.name,
                    title: manifest.title ?? entry.name,
                    summary: manifest.summary ?? '',
                    overrides: manifest.overrides,
                    removals: manifest.removals,
                });
            } catch (error) {
                result.push({ scope: label, experiment: entry.name, error: error.message });
            }
        }
    }
    return { ok: true, vault: vault.name, experiments: result };
}

function guideText(vaults) {
    const vaultLines = vaults.length === 0
        ? 'No lorebook-* vaults are visible under the configured roots.'
        : vaults.map((vault) => {
            const rootsText = vault.experimentRoots.length === 0
                ? 'no experiment directory yet'
                : vault.experimentRoots.map((root) => `${root.label} (${root.experiments.length} experiments)`).join(', ');
            return `- \`${vault.name}\` - ${rootsText}`;
        }).join('\n');

    return `# Vault override authoring guide

Call this tool before creating an override. It is the authoritative contract for the DeepLore Copilot and any other MCP client.

## What an override is

An override is a Markdown file inside an experiment's \`overrides/\` tree. It is applied by TauriTavern's vault explorer and by DeepLore's native vault transport. The base note is never edited.

Experiment layout:

\`\`\`text
<vault>/Narrative-Experiments/<experiment>/experiment.json
<vault>/Narrative-Experiments/<experiment>/overrides/<target path>
\`\`\`

A vault whose notes live under \`lore/\` uses \`<vault>/lore/Narrative-Experiments/\` instead.

## The exact-path rule

The override path must mirror the **existing base note path** exactly, relative to the content root. If \`World/Clans/Aburame Clan (Konohagakure).md\` exists, the manifest entry is:

\`\`\`json
"overrides": ["overrides/World/Clans/Aburame Clan (Konohagakure).md"]
\`\`\`

If the path does not match a base note, the override becomes a **new virtual note**, not a replacement. To replace a note, use its exact filename.

## Use the tool, not the filesystem

Use \`create_override\` with:

- \`vault\`: a directory name from \`list_vaults\` (for example \`lorebook-naruto\`)
- \`experiment\`: a short folder name (for example \`my-fix\`)
- \`target\`: the existing note path relative to the content root
- \`content\`: optional full Markdown. Omit it to copy the base note.
- \`title\`, \`summary\`: optional experiment metadata
- \`overwrite\`: optional, only when replacing an existing override file

The tool creates the experiment if needed, writes the override, and updates \`experiment.json\` atomically. It removes a matching removal entry so the override wins.

Example call:

\`\`\`json
{
  "vault": "lorebook-naruto",
  "experiment": "sakura-rewrite",
  "target": "Character/Sakura Haruno/Sakura Haruno (Naruto).md",
  "title": "Sakura rewrite",
  "summary": "Alternate Sakura characterization.",
  "content": "---\\ntags:\\n  - character\\n---\\n\\n# Sakura Haruno\\n\\nNew text..."
}
\`\`\`

## After writing

Open **Vault explorer -> Narrative experiments**, select the experiment, and confirm the note is red with \`Overridden\`. Switch back to **Base vault** to deactivate. The changed note must still be verified in the DeepLore Copilot retrieval.

Visible vaults:
${vaultLines}
`;
}

function toolResult(text, isError = false) {
    return {
        content: [{ type: 'text', text }],
        ...(isError ? { isError: true } : {}),
    };
}

function callTool(name, args) {
    try {
        if (name === 'vault_overrides_guide') {
            return toolResult(guideText(listVaults()));
        }
        if (name === 'list_vaults') {
            return toolResult(JSON.stringify({ ok: true, vaults: listVaults() }, null, 2));
        }
        if (name === 'list_overrides') {
            return toolResult(JSON.stringify(listOverrides(args), null, 2));
        }
        if (name === 'create_override') {
            return toolResult(JSON.stringify(createOverride(args), null, 2));
        }
        return toolResult(`Unknown tool: ${name}`, true);
    } catch (error) {
        return toolResult(`Error: ${error.message}`, true);
    }
}

const tools = [
    {
        name: 'vault_overrides_guide',
        title: 'Read the vault override authoring guide',
        description: 'READ THIS FIRST. Returns the complete instructions for creating TauriTavern narrative-experiment overrides: exact-path matching, experiment.json fields, validation rules, and the safe create_override workflow. No filesystem changes.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
        name: 'list_vaults',
        title: 'List writable lorebook vaults',
        description: 'Lists the lorebook-* vaults visible under the configured roots and the experiment directories they expose. Call before create_override when the vault name is unknown.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
        name: 'list_overrides',
        title: 'List experiment overrides',
        description: 'Lists experiments and their override/removal paths for one vault. Use it to check what already exists before writing.',
        inputSchema: {
            type: 'object',
            properties: {
                vault: { type: 'string', description: 'Vault directory name, for example lorebook-naruto.' },
                experiment: { type: 'string', description: 'Optional experiment folder name to narrow the result.' },
            },
            required: ['vault'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
        name: 'create_override',
        title: 'Create or replace a vault note override',
        description: 'Creates an exact-path override in Narrative-Experiments/<experiment>/overrides and updates experiment.json. The target must be an existing Markdown note. Writes only inside the selected experiment; never edits the base note. Read vault_overrides_guide first.',
        inputSchema: {
            type: 'object',
            properties: {
                vault: { type: 'string', description: 'Vault directory name, for example lorebook-naruto.' },
                experiment: { type: 'string', description: 'Experiment folder name, letters/digits/dot/underscore/dash only.' },
                target: { type: 'string', description: 'Existing base note path relative to the content root, with exact filename.' },
                content: { type: 'string', description: 'Full Markdown for the override. Omit to copy the base note.' },
                title: { type: 'string', description: 'Optional experiment title.' },
                summary: { type: 'string', description: 'Optional experiment summary.' },
                overwrite: { type: 'boolean', description: 'Replace an existing override file. Defaults to false.' },
            },
            required: ['vault', 'experiment', 'target'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
];

function rpcError(id, code, message) {
    return { jsonrpc: '2.0', id, error: { code, message } };
}

function rpcResult(id, result) {
    return { jsonrpc: '2.0', id, result };
}

function handleRpc(message, sessionId) {
    const { id, method, params } = message;
    if (method === 'initialize') {
        return rpcResult(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            instructions: 'Read vault_overrides_guide before writing. Use create_override to author exact-path narrative experiment overrides. The server writes only inside Narrative-Experiments/<experiment>/overrides. Never edit base notes directly.',
        });
    }
    if (method === 'ping') return rpcResult(id, {});
    if (method === 'tools/list') return rpcResult(id, { tools });
    if (method === 'tools/call') {
        const name = params?.name;
        const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        return rpcResult(id, callTool(String(name ?? ''), args));
    }
    if (method === 'resources/list') return rpcResult(id, { resources: [] });
    if (method === 'prompts/list') return rpcResult(id, { prompts: [] });
    if (method === 'logging/setLevel') return rpcResult(id, {});
    if (method === 'notifications/initialized' || method?.startsWith?.('notifications/')) return null;
    return rpcError(id, -32601, `Method not found: ${String(method)}`);
}

function authorized(request) {
    if (!options.token) return true;
    return request.headers.authorization === `Bearer ${options.token}`;
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('request body too large'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
    });
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (url.pathname === '/health' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, server: SERVER_NAME, version: SERVER_VERSION }));
        return;
    }
    if (url.pathname !== '/mcp') {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Not found');
        return;
    }
    if (request.method === 'GET') {
        response.writeHead(405, { Allow: 'POST, DELETE' });
        response.end();
        return;
    }
    if (request.method === 'DELETE') {
        response.writeHead(204);
        response.end();
        return;
    }
    if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'GET, POST, DELETE' });
        response.end();
        return;
    }
    if (!authorized(request)) {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(rpcError(null, -32001, 'Unauthorized')));
        return;
    }

    let body;
    try {
        body = await readBody(request);
    } catch (error) {
        response.writeHead(413, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(rpcError(null, -32600, error.message)));
        return;
    }

    let message;
    try {
        message = JSON.parse(body.replace(/^\uFEFF/, ''));
    } catch {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(rpcError(null, -32700, 'Parse error')));
        return;
    }

    const messages = Array.isArray(message) ? message : [message];
    const sessionId = request.headers['mcp-session-id'];
    const replies = [];
    for (const item of messages) {
        if (!item || typeof item !== 'object' || item.jsonrpc !== '2.0') {
            replies.push(rpcError(item?.id ?? null, -32600, 'Invalid Request'));
            continue;
        }
        if (item.method === 'initialize') {
            const newSession = typeof sessionId === 'string' && sessionId ? sessionId : randomUUID();
            sessions.add(newSession);
            const reply = handleRpc(item, newSession);
            reply && replies.push(reply);
            response.setHeader('Mcp-Session-Id', newSession);
            continue;
        }
        const reply = handleRpc(item, typeof sessionId === 'string' ? sessionId : '');
        if (reply) replies.push(reply);
    }

    if (replies.length === 0) {
        response.writeHead(202);
        response.end();
        return;
    }
    const payload = Array.isArray(message) ? replies : replies[0];
    response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(payload));
});

server.on('clientError', (error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(options.port, options.host, () => {
    const address = server.address();
    console.log(`[${SERVER_NAME}] listening on http://${options.host}:${address.port}/mcp`);
    for (const root of roots) console.log(`[${SERVER_NAME}] root: ${root}`);
    console.log(`[${SERVER_NAME}] tools: ${tools.map((tool) => tool.name).join(', ')}`);
});
