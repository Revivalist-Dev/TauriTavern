import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const serverPath = path.resolve('tools/vault-override-mcp/server.mjs');
let root;
let vault;
let child;
let endpoint;
let sessionId;

async function rpc(method, params = {}, id = 1) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text), session: response.headers.get('mcp-session-id') };
}

async function call(name, args = {}) {
    const response = await rpc('tools/call', { name, arguments: args }, 10);
    assert.equal(response.status, 200);
    return response.body.result;
}

before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-override-mcp-test-'));
    vault = path.join(root, 'lorebook-test');
    fs.mkdirSync(path.join(vault, 'World'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'World', 'Example.md'), '# Base\n\noriginal\n');

    child = spawn(process.execPath, [serverPath, '--root', root, '--port', '0'], {
        cwd: path.resolve('.'),
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    endpoint = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('MCP server did not start')), 10_000);
        let output = '';
        child.stdout.on('data', (chunk) => {
            output += chunk.toString();
            const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+\/mcp)/);
            if (match) {
                clearTimeout(timer);
                resolve(match[1]);
            }
        });
        child.stderr.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.on('exit', (code) => reject(new Error(`MCP server exited ${code}: ${output}`)));
    });

    const initialized = await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
    });
    assert.equal(initialized.status, 200);
    sessionId = initialized.session;
    assert.match(initialized.body.result.instructions, /vault_overrides_guide/);
});

after(() => {
    child?.kill();
    fs.rmSync(root, { recursive: true, force: true });
});

test('advertises the read-first guide and list tools', async () => {
    const listed = await rpc('tools/list', {}, 2);
    const names = listed.body.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, ['vault_overrides_guide', 'list_vaults', 'list_overrides', 'create_override']);

    const guide = await call('vault_overrides_guide');
    assert.match(guide.content[0].text, /exact-path rule/i);
    assert.match(guide.content[0].text, /lorebook-test/);

    const vaults = await call('list_vaults');
    assert.equal(JSON.parse(vaults.content[0].text).vaults[0].name, 'lorebook-test');
});

test('creates an exact-path override and updates experiment.json', async () => {
    const result = await call('create_override', {
        vault: 'lorebook-test',
        experiment: 'test-exp',
        target: 'World/Example.md',
        title: 'Test override',
        summary: 'Temporary override.',
        content: '# Replacement\n\nmarker\n',
    });
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.target, 'World/Example.md');
    assert.equal(payload.overrides, 1);

    const overridePath = path.join(vault, 'Narrative-Experiments', 'test-exp', 'overrides', 'World', 'Example.md');
    assert.equal(fs.readFileSync(overridePath, 'utf8'), '# Replacement\n\nmarker\n');
    const manifest = JSON.parse(fs.readFileSync(path.join(vault, 'Narrative-Experiments', 'test-exp', 'experiment.json'), 'utf8'));
    assert.deepEqual(manifest.overrides, ['overrides/World/Example.md']);
    assert.equal(fs.readFileSync(path.join(vault, 'World', 'Example.md'), 'utf8'), '# Base\n\noriginal\n');

    const listed = JSON.parse((await call('list_overrides', { vault: 'lorebook-test' })).content[0].text);
    assert.equal(listed.experiments[0].experiment, 'test-exp');
});

test('rejects traversal and missing targets', async () => {
    const traversal = await call('create_override', {
        vault: 'lorebook-test',
        experiment: 'bad',
        target: '../outside.md',
        content: 'nope',
    });
    assert.equal(traversal.isError, true);
    assert.match(traversal.content[0].text, /escapes the vault/);

    const missing = await call('create_override', {
        vault: 'lorebook-test',
        experiment: 'bad',
        target: 'World/Missing.md',
        content: 'nope',
    });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /base note not found/);
});
