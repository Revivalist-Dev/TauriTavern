import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openLayoutPage } from './harness.mjs';

let session;
let page;

before(async () => {
    session = await openLayoutPage({ width: 1440, height: 900 });
    page = session.page;
    await page.waitForSelector('#scp-window', { timeout: 10_000 });
});

after(async () => {
    await session?.close();
});

test('DeepLore for TauriTavern is installed as a system extension', async () => {
    await page.waitForSelector('#dle-open-settings', { state: 'attached', timeout: 10_000 });
    assert.match(await page.locator('#dle-open-settings').textContent(), /DeepLore Settings/);
    assert.equal(await page.locator('#dle-open-lore-defaults').count(), 1);
});
