import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openLayoutPage } from './harness.mjs';

const viewport = { width: 1440, height: 900 };
let session;
let page;

before(async () => {
    session = await openLayoutPage({ ...viewport });
    page = session.page;
    await page.waitForSelector('#tt-copilot-dock', { timeout: 10_000 });
});

after(async () => {
    await session?.close();
});

test('Copilot opens in the left dock and collapses without moving the chat twice', async () => {
    assert.equal(await page.locator('#tt-copilot-dock').isVisible(), true);
    assert.equal(await page.evaluate(() => document.body.classList.contains('tt-copilot-open')), true);
    const geometry = await page.evaluate(() => {
        const dock = document.getElementById('tt-copilot-dock').getBoundingClientRect();
        const shell = document.getElementById('sheld').getBoundingClientRect();
        return { dockRight: dock.right, shellLeft: shell.left };
    });
    assert.ok(geometry.shellLeft >= geometry.dockRight - 1, `expected the chat beside the dock, got ${JSON.stringify(geometry)}`);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('#tt-copilot-dock #scp-window'))), true);
    assert.equal(await page.locator('#scp-search-btn').isVisible(), true);
    assert.equal(await page.locator('#scp-ext-settings-btn').isVisible(), true);
    assert.equal(await page.locator('#scp-close-btn').isVisible(), true);
    assert.equal(await page.locator('#scp-sess-trigger').isVisible(), true);

    const focus = await page.evaluate(() => {
        window.__TAURITAVERN__?.api?.workspace?.setFocus?.({
            mountId: 'mnt',
            path: 'lore/global',
            folder: 'lore/global',
            primary: true,
            selected: ['lore/global/world.md'],
        });
        return window.__TAURITAVERN__?.api?.workspace?.getFocus?.();
    });
    assert.equal(focus?.folder, 'lore/global');
    assert.equal(await page.locator('#tt-copilot-focus').textContent(), 'lore/global');

    const presets = await page.evaluate(() => window.SillyTavern.getContext().chatCompletionPresets);
    assert.ok(Array.isArray(presets), 'chat completion presets should be exposed to extensions');

    assert.equal(await page.locator('#tt-copilot-resizer').getAttribute('tabindex'), '0');
    const resizerFocus = await page.evaluate(() => {
        const resizer = document.getElementById('tt-copilot-resizer');
        resizer.focus();
        const style = getComputedStyle(resizer);
        return { outline: style.outlineStyle, color: style.outlineColor };
    });
    assert.equal(resizerFocus.outline, 'solid');

    await page.locator('#scp-close-btn').click();
    assert.equal(await page.locator('#tt-copilot-dock').isVisible(), false);
    const collapsed = await page.evaluate(() => {
        const dock = document.getElementById('tt-copilot-dock')?.getBoundingClientRect();
        const shell = document.getElementById('sheld').getBoundingClientRect();
        return { dockWidth: dock?.width ?? 0, shellLeft: shell.left };
    });
    assert.ok(collapsed.shellLeft < geometry.shellLeft, 'expected the chat to reclaim the dock width');

    await page.locator('#tt-copilot-toggle').click();
    assert.equal(await page.locator('#tt-copilot-dock').isVisible(), true);
});
