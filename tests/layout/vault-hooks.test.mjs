import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vault = path.resolve(root, '../project-roleplay/lorebook-umamusume');

test('the Umamusume vault exposes TauriTavern hook configuration', async () => {
    const config = JSON.parse(await readFile(path.join(vault, '.cursor/hooks.json'), 'utf8'));
    assert.equal(config.version, 1);
    assert.equal(config.hooks.preToolUse[0].command, 'node .cursor/hooks/lorebook-guard.mjs');
    assert.equal(config.hooks.postToolUse[0].command, 'node .cursor/hooks/lorebook-guard.mjs');
    assert.ok(config.hooks.preToolUse[0].timeoutSec > 0);
    assert.equal(config.hooks.preToolUse[0].failClosed, true);
});

test('the Umamusume vault hook runs from the vault root', () => {
    const payload = JSON.stringify({
        hook_event_name: 'preToolUse',
        tool_name: 'Write',
        tool_input: {
            file_path: 'World/Hook Probe.md',
            content: 'The story begins.',
        },
    });
    const result = spawnSync(process.execPath, ['.cursor/hooks/lorebook-guard.mjs'], {
        cwd: vault,
        input: payload,
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const response = JSON.parse(result.stdout);
    assert.equal(response.permission, 'allow');
});

test('the migrated Umamusume MCP servers are local and declared', async () => {
    const config = JSON.parse(await readFile(path.join(vault, '.cursor/mcp.json'), 'utf8'));
    const servers = config.mcpServers ?? config;
    assert.ok(servers.umareader, 'umareader MCP server is not declared');
    assert.deepEqual(servers.umareader.args, ['./.cursor/tools/umareader_mcp/server.py']);
    assert.ok(servers.probharness, 'probability harness server is not declared');
    await readFile(path.join(vault, '.cursor/tools/umareader_mcp/server.py'));
    await readFile(path.join(vault, '.cursor/tools/probability-harness/server.js'));
});

test('every migrated tool has a resolvable entry point', async () => {
    for (const file of [
        'breeding-constants.mjs',
        'scene-bay.mjs',
        'name-tool.mjs',
        'prose-check.mjs',
        'gestation-state.mjs',
        'narrative-experiment.mjs',
    ]) {
        await readFile(path.join(vault, '.cursor/tools', file));
    }
    await readFile(path.join(vault, '.cursor/tools/rules/self_healing_translation_rules.md'));
});
