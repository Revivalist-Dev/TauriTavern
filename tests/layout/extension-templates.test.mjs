import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openLayoutPage } from './harness.mjs';

const copilotTemplates = [
    'lorebook_manager.html',
    'character_manager.html',
    'settings_overlay.html',
    'chat_picker.html',
    'settings.html',
];

const deepLoreTemplates = [
    'drawer.html',
    'settings.html',
    'settings-popup.html',
    'setup-wizard.html',
];

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

test('every Copilot manager template is packaged in the system extension', async () => {
    for (const name of copilotTemplates) {
        const status = await page.evaluate(async (url) => (await fetch(url)).status, `/scripts/extensions/tauritavern-deeplore-copilot/${name}`);
        assert.equal(status, 200, `${name} should be installed`);
    }
    assert.equal(await page.locator('#scp-lb-overlay').count(), 1);
});

test('every DeepLore template is packaged in the system extension', async () => {
    for (const name of deepLoreTemplates) {
        const status = await page.evaluate(async (url) => (await fetch(url)).status, `/scripts/extensions/tauritavern-deeplore/${name}`);
        assert.equal(status, 200, `${name} should be installed`);
    }
    await page.waitForSelector('#dle-open-settings', { state: 'attached', timeout: 10_000 });
});
