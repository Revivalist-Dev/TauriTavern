import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { clickDrawer, openLayoutPage } from './harness.mjs';

const viewport = { width: 1280, height: 900 };

function installLoreMock() {
    const state = {
        root: 'C:/Vault/lore',
        folders: [
            { path: 'lore/global', entries: 2 },
            { path: 'lore/characters/hero', entries: 1 },
        ],
        entries: 3,
        scanned: true,
    };
    window.__TT_LORE_API__ = {
        state: async () => state,
        scan: async () => state,
        listEntries: async () => [
            { title: 'World', folder: 'lore/global', path: 'global/world.md' },
            { title: 'Hero', folder: 'lore/characters/hero', path: 'characters/hero/hero.md' },
        ],
        migrateLegacy: async () => ({ skipped: true, books: 0, entries: 0 }),
    };
    window.__TT_VAULT_API__ = {
        state: async () => ({ primaryMountId: 'mnt-lore' }),
    };
}

let session;
let page;

before(async () => {
    session = await openLayoutPage({ ...viewport, initScript: installLoreMock });
    page = session.page;
    await page.waitForSelector('#lore-directory-button', { timeout: 10_000 });
});

after(async () => {
    await session?.close();
});

test('lore drawer lists scoped folders and entries', async () => {
    await clickDrawer(page, 'lore-directory-button');
    await page.waitForSelector('#lore-directory .lore-folder-row', { timeout: 10_000 });
    const folders = await page.locator('#lore-directory .lore-folder-name').allTextContents();
    assert.deepEqual(folders, ['lore/global', 'lore/characters/hero']);
    const entries = await page.locator('#lore-directory .lore-entry-title').allTextContents();
    assert.deepEqual(entries, ['World', 'Hero']);
    assert.equal(await page.locator('#WI-SP-button').isVisible(), false);
});
