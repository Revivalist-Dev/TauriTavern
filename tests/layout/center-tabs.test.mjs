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
            writeFile: async (...args) => { window.__ttSaved = args; },
            open: async () => {},
        };
    });
});

after(async () => {
    await session?.close();
});

test('MJS hook files open with an inline preview', async () => {
    const fileTab = await page.evaluate(() => window.__TT_CENTER_TABS__.openFile({
        mountId: 'mnt',
        path: '.cursor/hooks/lorebook-guard.mjs',
        name: 'lorebook-guard.mjs',
    }));
    assert.equal(fileTab.name, 'lorebook-guard.mjs');
    await page.waitForSelector('#tt-center-file-body');
    assert.match(await page.locator('#tt-center-file-body').innerText(), /Center tab content|Hello/);
    assert.equal(await page.locator('.tt-center-empty').count(), 0);
    await page.locator('.tt-center-tab').filter({ hasText: 'lorebook-guard.mjs' }).locator('.tt-center-tab-close').click();
    assert.equal(await page.locator('.tt-center-tab').count(), 1);
});

test('text file tabs can be edited and saved', async () => {
    await page.evaluate(() => window.__TT_CENTER_TABS__.openFile({
        mountId: 'mnt',
        path: '.cursor/rules/example.mdc',
        name: 'example.mdc',
    }));
    await page.waitForFunction(() => document.querySelector('#tt-center-file-body')?.textContent?.includes('Center tab content.'));
    assert.equal(await page.locator('#tt-center-file-edit').isVisible(), true);

    await page.locator('#tt-center-file-edit').click();
    const editor = page.locator('#tt-center-file-editor');
    assert.equal(await editor.isVisible(), true);
    await editor.fill('# Edited rule\n\nNew content.');
    await page.locator('#tt-center-file-save').click();
    await page.waitForFunction(() => window.__ttSaved?.[2] === 'example.mdc');

    const saved = await page.evaluate(() => ({
        parent: window.__ttSaved[1],
        name: window.__ttSaved[2],
        content: new TextDecoder().decode(window.__ttSaved[3]),
    }));
    assert.equal(saved.parent, '.cursor/rules');
    assert.equal(saved.name, 'example.mdc');
    assert.match(saved.content, /Edited rule/);
    assert.match(await page.locator('#tt-center-file-body').innerText(), /Edited rule/);

    await page.locator('.tt-center-tab').filter({ hasText: 'example.mdc' }).locator('.tt-center-tab-close').click();
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

test('file tabs can move to the right panel and swap with the explorer', async () => {
    await page.evaluate(() => window.__TT_CENTER_TABS__.openFile({
        mountId: 'mnt',
        path: 'notes/right.md',
        name: 'right.md',
    }));
    const tab = page.locator('.tt-center-tab').filter({ hasText: 'right.md' });
    await tab.hover();
    await tab.locator('.tt-center-tab-move').click();

    await page.waitForSelector('#tt-right-tabs:not([hidden])');
    assert.equal(await page.evaluate(() => document.querySelector('#tt-file-explorer').classList.contains('tt-right-tab-mode')), true);
    assert.equal(await page.locator('#tt-right-tabs').getByText('Explorer').count(), 1);
    assert.equal(await page.locator('#tt-right-tabs').getByText('right.md').count(), 1);
    assert.equal(await page.locator('#tt-center-tab').filter({ hasText: 'right.md' }).count(), 0);
    assert.match(await page.locator('#tt-center-file-path').innerText(), /right\.md/);

    await page.locator('.tt-right-tab-explorer').click();
    assert.equal(await page.evaluate(() => document.querySelector('#tt-file-explorer').classList.contains('tt-right-tab-mode')), false);
    assert.equal(await page.locator('#tt-center-file').isVisible(), false);

    await page.locator('#tt-right-tabs .tt-right-tab').filter({ hasText: 'right.md' }).click();
    assert.equal(await page.evaluate(() => document.querySelector('#tt-file-explorer').classList.contains('tt-right-tab-mode')), true);
    assert.equal(await page.locator('#tt-center-file').isVisible(), true);

    await page.evaluate(() => window.__TT_CENTER_TABS__.close(
        window.__TT_CENTER_TABS__.list().find((tab) => tab.title === 'right.md')?.id,
    ));
    await page.waitForFunction(() => document.querySelector('#tt-right-tabs')?.hidden === true);
});
