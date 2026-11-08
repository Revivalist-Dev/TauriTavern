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
                config: async (vaultRoot = null) => {
                    window.__hookConfigCalls = [...(window.__hookConfigCalls || []), vaultRoot];
                    return vaultRoot
                        ? { version: 1, hooks: { preToolUse: [{ command: 'echo local' }] } }
                        : { version: 1, hooks: { preToolUse: [{ command: 'echo global' }] } };
                },
                saveConfig: async (config, vaultRoot = null) => {
                    window.__hookSaves = [...(window.__hookSaves || []), { config, vaultRoot }];
                    return config;
                },
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
        window.__TAURITAVERN__.api.vault = {
            state: async () => ({
                primaryMountId: 'mount-1',
                mounts: [
                    { id: 'mount-1', name: 'lorebook-test', path: 'C:/vaults/lorebook-test', kind: 'lorebook', primary: true },
                ],
            }),
        };
        window.dispatchEvent(new Event('tt:open-customize'));
    });
    await page.waitForSelector('.tt-customize', { timeout: 5000 });
});

after(async () => {
    await session?.close();
});

test('Agent Workspace renders all seven tabs and vault items', async () => {
    const tabs = await page.locator('.tt-customize-tab').allTextContents();
    assert.deepEqual(tabs, ['Rules', 'Skills', 'Subagents', 'Commands', 'Hooks', 'MCP', 'Plugins']);
    assert.equal(await page.locator('#tauri_panel_customize .drawer-toggle').getAttribute('aria-label'), 'Agent Workspace');
    assert.match(await page.locator('.tt-customize-title').textContent(), /Vault:|Native storage/);
    assert.match(await page.locator('.tt-customize-item').first().textContent(), /Harbor Rules/);
    assert.match(await page.locator('.tt-customize-badge').first().textContent(), /rule.*vault/);
});

test('Agent Workspace uses the shared panel shell and resize handle', async () => {
    const root = await page.locator('.tt-customize').getAttribute('class');
    assert.match(root, /\btt-ui-panel\b/);
    assert.equal(await page.locator('.tt-customize-header').getAttribute('class').then((value) => /tt-ui-toolbar/.test(value)), true);
    assert.equal(await page.locator('.tt-customize-title strong').count(), 0);
    assert.equal(await page.locator('.tt-customize-toolbar').getAttribute('class').then((value) => /tt-ui-toolbar/.test(value)), true);
    assert.equal(await page.locator('.tt-customize-tabs').getAttribute('class').then((value) => /tt-ui-tablist/.test(value)), true);
    assert.match(await page.locator('.tt-customize-item').first().getAttribute('class'), /\btt-ui-card\b/);
    assert.match(await page.locator('.tt-customize-actions button').first().getAttribute('class'), /\btt-ui-button\b/);

    const handle = page.locator('.tt-ui-panel-resize[aria-label="Resize Panel"]:not([hidden])');
    assert.equal(await handle.count(), 1);
    assert.equal(await handle.getAttribute('aria-controls'), 'tauri_panel_customize_content');
    const hitTest = await page.evaluate(() => {
        const element = document.querySelector('.tt-ui-panel-resize:not([hidden])');
        const box = element.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
    });
    assert.equal(hitTest, true, 'the shared resize handle is below the panel stacking context');
    const before = (await page.locator('#tauri_panel_customize_content').boundingBox()).width;
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const after = (await page.locator('#tauri_panel_customize_content').boundingBox()).width;
    assert.ok(after > before, `Agent Workspace did not resize by drag: ${before} -> ${after}`);
});

test('Agent Workspace lays out the list and editor without overlap', async () => {
    await page.locator('.tt-customize-tab', { hasText: 'Rules' }).click();
    await page.locator('.tt-customize-item-main').first().click();
    await page.waitForSelector('.tt-customize-editor');

    const layout = await page.evaluate(() => {
        const rect = (selector) => {
            const box = document.querySelector(selector).getBoundingClientRect();
            return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
        };
        return {
            list: rect('.tt-customize-list'),
            editor: rect('.tt-customize-editor'),
            scroll: rect('.tt-customize-editor-scroll'),
            actions: rect('.tt-customize-editor-actions'),
            labels: [...document.querySelectorAll('.tt-customize-check')].map((element) => {
                const box = element.getBoundingClientRect();
                return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width };
            }),
        };
    });

    const sideBySide = layout.list.right <= layout.editor.left + 1;
    const stacked = layout.list.bottom <= layout.editor.top + 1;
    assert.ok(sideBySide || stacked, `the item list overlaps the editor pane: ${JSON.stringify({ list: layout.list, editor: layout.editor })}`);
    assert.ok(layout.actions.top >= layout.scroll.bottom - 1, 'the action bar overlaps the scrolling form');
    assert.ok(layout.actions.bottom <= layout.editor.bottom + 1, 'the action bar escapes the editor card');
    for (const [index, label] of layout.labels.entries()) {
        assert.ok(label.width > 40, `checkbox label ${index} collapsed to ${label.width}px`);
        for (const other of layout.labels.slice(index + 1)) {
            const sharesRow = label.top < other.bottom && other.top < label.bottom;
            const overlaps = label.left < other.right && other.left < label.right;
            assert.equal(sharesRow && overlaps, false, `checkbox labels ${index} and ${index + 1} overlap`);
        }
    }
});

test('Agent Workspace hooks tab edits global and per-lorebook scopes', async () => {
    await page.locator('.tt-customize-tab', { hasText: 'Hooks' }).click();
    await page.waitForSelector('#hook-scope');
    assert.equal(await page.locator('#hook-scope option').count(), 2);
    assert.equal(await page.locator('#hook-scope').inputValue(), 'C:/vaults/lorebook-test');
    assert.match(await page.locator('.tt-customize-hook-editor').inputValue(), /echo local/);

    await page.selectOption('#hook-scope', '__global__');
    await page.waitForTimeout(100);
    assert.match(await page.locator('.tt-customize-hook-editor').inputValue(), /echo global/);
    await page.locator('.tt-customize-actions button', { hasText: 'Save hooks.json' }).click();
    await page.waitForTimeout(100);

    const globalSave = await page.evaluate(() => window.__hookSaves?.at(-1));
    assert.equal(globalSave.vaultRoot, null);

    await page.selectOption('#hook-scope', 'C:/vaults/lorebook-test');
    await page.waitForTimeout(100);
    assert.match(await page.locator('.tt-customize-hook-editor').inputValue(), /echo local/);
    await page.locator('.tt-customize-actions button', { hasText: 'Save hooks.json' }).click();
    await page.waitForTimeout(100);

    const localSave = await page.evaluate(() => window.__hookSaves?.at(-1));
    assert.equal(localSave.vaultRoot, 'C:/vaults/lorebook-test');
});

test('Agent Workspace hooks tab shows trust state and recent runs', async () => {
    await page.locator('.tt-customize-tab', { hasText: 'Hooks' }).click();
    await page.waitForSelector('.tt-customize-hook-status');
    assert.match(await page.locator('.tt-customize-hook-status').textContent(), /not trusted/i);
    assert.match(await page.locator('.tt-customize-hook-log').first().textContent(), /preToolUse.*deny/is);
    assert.equal(await page.locator('.tt-customize-hook-editor').count(), 1);
});

