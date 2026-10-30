import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openLayoutPage } from './harness.mjs';

const viewport = { width: 1440, height: 900 };
let session;
let page;

before(async () => {
    session = await openLayoutPage({ ...viewport });
    page = session.page;
    await page.waitForSelector('#tt-center-tabs', { timeout: 10_000 });
    await page.evaluate(() => {
        window.__TT_VAULT_API__ = {
            readText: async () => '# Hello\n\nCenter tab content.',
            open: async () => {},
        };
    });
});

after(async () => {
    await session?.close();
});

test('the Tavern tab is pinned and files open in new center tabs', async () => {
    const tavern = page.locator('.tt-center-tab').first();
    assert.match(await tavern.textContent(), /Tavern/);
    assert.equal(await page.locator('.tt-center-tab').count(), 1);

    const fileTab = await page.evaluate(() => window.__TT_CENTER_TABS__.openFile({
        mountId: 'mnt',
        path: 'notes/hello.md',
        name: 'hello.md',
    }));
    assert.equal(fileTab.name, 'hello.md');
    await page.waitForFunction(() => document.querySelector('#tt-center-file-body')?.textContent?.includes('Center tab content.'));

    assert.equal(await page.locator('.tt-center-tab').count(), 2);
    assert.equal(await page.locator('#tt-center-file').isVisible(), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('sheld')).display), 'none');

    await page.locator('.tt-center-tab').filter({ hasText: 'hello.md' }).locator('.tt-center-tab-close').click();
    assert.equal(await page.locator('.tt-center-tab').count(), 1);
    assert.match(await page.locator('.tt-center-tab').first().textContent(), /Tavern/);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById('sheld')).display), 'none');

    await page.evaluate(() => window.__TT_CENTER_TABS__.openFile({
        mountId: 'mnt',
        path: 'notes/hello.md',
        name: 'hello.md',
    }));
    await page.locator('.tt-center-tab').filter({ hasText: 'Tavern' }).click();
    assert.equal(await page.locator('#tt-center-file').isVisible(), false);
});
