import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openLayoutPage } from './harness.mjs';

let session;
let page;

before(async () => {
    session = await openLayoutPage({ width: 1440, height: 900 });
    page = session.page;
    await page.waitForSelector('#scp-window', { timeout: 10_000 });
    await page.evaluate(() => {
        window.__TT_VAULT_API__ = {
            readText: async () => '# Harbor\n\nA salt-stained port.',
            open: async () => {},
        };
        window.__TAURITAVERN__ = {
            api: {
                lore: {
                    state: async () => ({
                        root: 'C:/vault',
                        scanned: true,
                        folders: [
                            { path: 'Places', entries: 1 },
                            { path: 'People', entries: 1 },
                        ],
                    }),
                    listEntries: async (folder) => ([
                        { title: 'Harbor', folder: 'Places', path: 'Places/Harbor.md', content: 'A salt-stained port.', keys: ['dock'], tokenEstimate: 34 },
                        { title: 'Mira', folder: 'People', path: 'People/Mira.md', content: 'She sails at dawn.', keys: ['captain'], tokenEstimate: 28 },
                    ]).filter((entry) => !folder || entry.folder === folder),
                    scan: async () => {},
                },
                vault: { state: async () => ({ primaryMountId: 'mnt' }) },
                workspace: { setFocus: async (focus) => { window.__focusCalls.push(focus); } },
            },
        };
        window.__focusCalls = [];
        window.__ttFileExplorer = { openPath: async (mountId, path) => { window.__explorerCall = [mountId, path]; } };
    });
});

after(async () => {
    await session?.close();
});

test('the Copilot lorebook button opens the vault lore manager', async () => {
    await page.locator('#scp-menu-trigger').click();
    await page.locator('#scp-menu-lb-item').click();
    await page.waitForSelector('#scp-vault-lore-overlay:not([hidden])', { timeout: 5000 });
    assert.match(await page.locator('#scp-vl-heading').textContent(), /All lore/);
    assert.equal(await page.locator('.scp-vl-entry').count(), 2);
    assert.match(await page.locator('.scp-vl-entry').first().textContent(), /Harbor/);

    await page.locator('.scp-vl-entry').first().getByRole('button', { name: 'Open' }).click();
    await page.waitForSelector('.tt-center-tab', { timeout: 5000 });
    assert.equal(await page.locator('#tt-center-file').isVisible(), true);
    assert.ok((await page.locator('.tt-center-tab-label').allTextContents()).includes('Harbor.md'));

    await page.locator('#scp-vl-close').click();
    assert.equal(await page.locator('#scp-vault-lore-overlay').isVisible(), false);
});

test('the manager follows the shared default lore folder', async () => {
    await page.locator('#scp-menu-trigger').click();
    await page.locator('#scp-menu-lb-item').click();
    await page.waitForSelector('#scp-vault-lore-overlay:not([hidden])', { timeout: 5000 });
    await page.locator('.scp-vl-folder').filter({ hasText: 'All lore directories' }).click();
    await page.evaluate(() => window.__TT_LORE_DEFAULTS__.set({ vault: { loreFolders: ['People'] } }));
    await page.waitForFunction(() => document.querySelector('#scp-vl-heading')?.textContent === 'People');
    assert.equal(await page.locator('.scp-vl-entry').count(), 1);
    await page.locator('#scp-vl-close').click();
});

test('the vault manager focuses and reveals native lore folders', async () => {
    await page.locator('#scp-menu-trigger').click();
    await page.locator('#scp-menu-lb-item').click();
    await page.waitForSelector('#scp-vault-lore-overlay:not([hidden])', { timeout: 5000 });
    await page.locator('.scp-vl-folder').filter({ hasText: 'Places' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.scp-vl-entry').length === 1);
    await page.locator('#scp-vl-focus').click();
    assert.equal((await page.evaluate(() => window.__focusCalls)).length, 1);
    assert.equal((await page.evaluate(() => window.__focusCalls[0])).path, 'lore/Places');

    await page.locator('#scp-vl-explorer').click();
    assert.deepEqual(await page.evaluate(() => window.__explorerCall), ['mnt', 'lore/Places']);
    assert.equal(await page.locator('#scp-vault-lore-overlay').isVisible(), false);
});
