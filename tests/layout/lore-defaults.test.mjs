import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openLayoutPage } from './harness.mjs';

let session;
let page;

before(async () => {
    session = await openLayoutPage({ width: 1440, height: 900 });
    page = session.page;
    await page.waitForSelector('#tt-center-tabs', { timeout: 10_000 });
    await page.waitForFunction(() => Boolean(window.__TT_LORE_DEFAULTS__));
});

after(async () => {
    await session?.close();
});

test('lore defaults expose a shared read/write/subscribe contract', async () => {
    const result = await page.evaluate(() => {
        const events = [];
        const unsubscribe = window.__TT_LORE_DEFAULTS__.subscribe((value) => events.push(value.vault.loreFolders));
        window.addEventListener('tt:lore-defaults-changed', (event) => events.push(event.detail.vault.loreFolders));
        window.__TT_LORE_DEFAULTS__.set({
            vault: { mountId: 'mnt', loreFolders: ['global', 'Characters/Mira'], followExplorerFocus: true },
            deeplore: { maxEntries: 31 },
        });
        unsubscribe();
        const saved = window.__TT_LORE_DEFAULTS__.get();
        return { events, saved };
    });
    assert.deepEqual(result.events[0], ['global', 'Characters/Mira']);
    assert.equal(result.saved.vault.mountId, 'mnt');
    assert.deepEqual(result.saved.vault.loreFolders, ['global', 'Characters/Mira']);
    assert.equal(result.saved.deeplore.maxEntries, 31);
});

test('the Vault Explorer header opens the same defaults panel', async () => {
    await page.evaluate(() => window.__ttFileExplorer.open());
    await page.locator('[title="Lore defaults"]').click();
    await page.waitForSelector('#tt-lore-defaults:not([hidden])');
    await page.locator('.tt-lore-default-close').click();
    await page.evaluate(() => window.__ttFileExplorer.close());
});

test('the shared Lore Defaults panel renders and closes', async () => {
    await page.locator('#scp-menu-trigger').click();
    await page.locator('#scp-menu-lb-item').click();
    await page.waitForSelector('#scp-vault-lore-overlay:not([hidden])', { timeout: 5000 });
    await page.locator('#scp-vl-defaults').click();
    await page.waitForSelector('#tt-lore-defaults:not([hidden])');
    assert.match(await page.locator('.tt-lore-default-title').textContent(), /Lore Defaults/);
    assert.equal(await page.locator('.tt-lore-default-section').count(), 3);
    await page.locator('.tt-lore-default-close').click();
    assert.equal(await page.locator('#tt-lore-defaults').isVisible(), false);
    await page.locator('#scp-vl-close').click();
});
