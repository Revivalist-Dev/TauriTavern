import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openLayoutPage } from './harness.mjs';

let session;
let page;

before(async () => {
    session = await openLayoutPage({ width: 1440, height: 900 });
    page = session.page;
    await page.evaluate(() => {
        const api = {
            snapshot: async () => ({
                items: [
                    {
                        id: 'vault:rule:harbor',
                        kind: 'rule',
                        name: 'Harbor Rules',
                        description: 'Tide behavior',
                        body: 'Use the tide.',
                        path: '.cursor/rules/harbor.mdc',
                        scope: 'vault',
                        source: 'vault',
                        surfaces: ['native_agent', 'copilot'],
                        enabled: true,
                        alwaysApply: true,
                        globs: [],
                    },
                ],
                warnings: [],
                hookConfig: { version: 1, hooks: { preToolUse: [{ command: 'echo', timeoutSec: 30 }] } },
                hookTrusted: false,
            }),
            context: async () => ({ rules: [], skills: [], agents: [], commands: [] }),
            save: async (request) => request,
            remove: async () => {},
            setEnabled: async () => {},
            hooks: {
                config: async () => null,
                saveConfig: async (config) => config,
                trust: async () => true,
                run: async () => ({ allowed: true, results: [], followupMessage: null, updatedInput: null }),
                logs: async () => [{
                    id: 'log-1',
                    event: 'preToolUse',
                    surface: 'native_agent',
                    command: 'echo',
                    permission: 'deny',
                    exitCode: 0,
                    durationMs: 4,
                    timedOut: false,
                    message: 'Blocked by policy',
                    createdAt: Date.now(),
                }],
                knownEvents: async () => ['preToolUse'],
            },
        };
        window.__TAURITAVERN__.api.customize = api;
        window.dispatchEvent(new Event('tt:open-customize'));
    });
    await page.waitForSelector('.tt-customize', { timeout: 5000 });
});

after(async () => {
    await session?.close();
});

test('Customize panel renders all seven tabs and vault items', async () => {
    const tabs = await page.locator('.tt-customize-tab').allTextContents();
    assert.deepEqual(tabs, ['Rules', 'Skills', 'Subagents', 'Commands', 'Hooks', 'MCP', 'Plugins']);
    assert.match(await page.locator('.tt-customize-item').first().textContent(), /Harbor Rules/);
    assert.match(await page.locator('.tt-customize-badge').first().textContent(), /rule.*vault/);
});

test('Customize hooks tab shows trust state and recent runs', async () => {
    await page.locator('.tt-customize-tab', { hasText: 'Hooks' }).click();
    await page.waitForSelector('.tt-customize-hook-status');
    assert.match(await page.locator('.tt-customize-hook-status').textContent(), /not trusted/i);
    assert.match(await page.locator('.tt-customize-hook-log').first().textContent(), /preToolUse.*deny/is);
    assert.equal(await page.locator('.tt-customize-hook-editor').count(), 1);
});
