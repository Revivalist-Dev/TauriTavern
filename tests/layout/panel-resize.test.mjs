import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { clickDrawer, openExtensionsDrawer, openLayoutPage, rect } from './harness.mjs';

let session;
let page;

before(async () => {
    session = await openLayoutPage({ width: 1280, height: 900 });
    page = session.page;
    await page.evaluate(() => document.fonts?.ready);
});

after(async () => {
    await session?.close();
});

test('the side rail layout is the boot layout', async () => {
    const html = await readFile(new URL('../../src/index.html', import.meta.url), 'utf8');
    assert.match(html, /<body[^>]*class="[^"]*\btauri-shell\b/);
    const state = await page.evaluate(() => ({
        body: document.body.classList.contains('tauri-shell'),
        topBar: getComputedStyle(document.querySelector('#top-bar')).display,
        rail: getComputedStyle(document.querySelector('#top-settings-holder')).position,
    }));
    assert.equal(state.body, true);
    assert.equal(state.topBar, 'none');
    assert.equal(state.rail, 'fixed');
});

test('standard rail tabs use one outer skin with a centred icon', async () => {
    await page.evaluate(() => {
        const toggle = [...document.querySelectorAll('#top-settings-holder .drawer-toggle')]
            .find((entry) => entry.querySelector('.drawer-icon') && !entry.querySelector('#rightNavDrawerIcon'));
        const panel = toggle?.closest('.drawer')?.querySelector('.drawer-content');
        if (panel && !panel.classList.contains('openDrawer')) toggle.click();
    });
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => {
        const toggle = [...document.querySelectorAll('#top-settings-holder .drawer-toggle')]
            .find((entry) => entry.querySelector('.drawer-icon') && !entry.querySelector('#rightNavDrawerIcon'));
        const icon = toggle.querySelector('.drawer-icon');
        const t = toggle.getBoundingClientRect();
        const i = icon.getBoundingClientRect();
        return {
            toggleClass: toggle.className,
            iconClass: icon.className,
            toggleBg: getComputedStyle(toggle).backgroundColor,
            iconBg: getComputedStyle(icon).backgroundColor,
            iconShadow: getComputedStyle(icon).boxShadow,
            dx: Math.abs((t.x + t.width / 2) - (i.x + i.width / 2)),
            dy: Math.abs((t.y + t.height / 2) - (i.y + i.height / 2)),
        };
    });
    assert.match(state.toggleClass, /tt-ui-rail-button/);
    assert.doesNotMatch(state.iconClass, /tt-ui-rail-button/);
    assert.notEqual(state.toggleBg, 'rgba(0, 0, 0, 0)');
    assert.equal(state.iconBg, 'rgba(0, 0, 0, 0)');
    assert.equal(state.iconShadow, 'none');
    assert.ok(state.dx <= 1, `icon is ${state.dx}px off-centre horizontally`);
    assert.ok(state.dy <= 1, `icon is ${state.dy}px off-centre vertically`);
});

test('right navigation uses the shared rail and panel surfaces', async () => {
    const iconClass = await page.locator('#rightNavDrawerIcon').getAttribute('class');
    assert.match(iconClass, /tt-ui-rail-button/);
    const railCounts = await page.evaluate(() => {
        const toggles = [...document.querySelectorAll('#top-settings-holder .drawer-toggle')]
            .filter((toggle) => !toggle.querySelector('#rightNavDrawerIcon'));
        return {
            integrated: toggles.filter((toggle) => toggle.classList.contains('tt-ui-rail-button')).length,
            total: toggles.filter((toggle) => toggle.querySelector('.drawer-icon')).length,
            iconSkins: [...document.querySelectorAll('#top-settings-holder .drawer-toggle .drawer-icon.tt-ui-rail-button')]
                .filter((icon) => icon.id !== 'rightNavDrawerIcon').length,
        };
    });
    assert.equal(railCounts.integrated, railCounts.total);
    assert.equal(railCounts.iconSkins, 0);
    await page.click('#rightNavDrawerIcon');
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => {
        const icon = document.querySelector('#rightNavDrawerIcon');
        const panel = document.querySelector('#right-nav-panel');
        const iconBg = getComputedStyle(icon).backgroundColor;
        const panelBg = getComputedStyle(panel).backgroundColor;
        return {
            expanded: icon.getAttribute('aria-expanded'),
            marker: panel?.dataset.ttUi,
            iconBg,
            panelBg,
        };
    });
    assert.equal(state.expanded, 'true');
    assert.equal(state.marker, 'panel');
    assert.notEqual(state.iconBg, 'rgba(0, 0, 0, 0)');
    assert.notEqual(state.panelBg, 'rgba(0, 0, 0, 0)');
    await page.click('#rightNavDrawerIcon');
    await page.waitForTimeout(150);
});

test('one shared handle resizes every side panel', async () => {
    await openExtensionsDrawer(page);
    await page.waitForSelector('.tt-ui-panel-resize:not([hidden])');

    const before = await rect(page, '#extensions-settings-button .drawer-content');
    const handle = page.locator('.tt-ui-panel-resize[aria-label="Resize Panel"]:not([hidden])');
    await handle.focus();
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');

    const after = await rect(page, '#extensions-settings-button .drawer-content');
    assert.ok(after.width > before.width, `panel did not grow: ${before.width} -> ${after.width}`);
    assert.equal(await page.evaluate(() => localStorage.getItem('tauri.panel.width') !== null), true);

    await clickDrawer(page, 'ai-config-button');
    const ai = await rect(page, '#ai-config-button .drawer-content');
    assert.equal(Math.round(ai.width), Math.round(after.width), 'panels do not share the resized width');

    const controlled = await page.locator('.tt-ui-panel-resize[aria-label="Resize Panel"]:not([hidden])').count();
    assert.equal(controlled, 1, 'handle is not visible for the open panel');
    assert.equal(await page.locator('.tt-ui-panel-resize[aria-label="Resize Panel"]').getAttribute('aria-controls'), 'left-nav-panel');

    await page.evaluate(() => {
        localStorage.removeItem('tauri.panel.width');
        document.body.style.removeProperty('--tauri-panel-width');
    });
    await page.click('#ai-config-button .drawer-toggle');
    await page.waitForTimeout(120);
    await page.waitForSelector('.tt-ui-panel-resize[aria-label="Resize Panel"]', { state: 'hidden' });
});

test('side tabs are exclusive and toggle closed on a second click', async () => {
    const state = () => page.evaluate(() => ({
        drawers: [...document.querySelectorAll('#top-settings-holder .drawer-content.openDrawer')].map((node) => node.id),
        monitor: document.getElementById('dle-monitor-panel')?.getAttribute('aria-hidden') === 'false',
        rightNav: document.getElementById('right-nav-panel')?.classList.contains('openDrawer') ?? false,
    }));

    const extensions = page.locator('#extensions-settings-button .drawer-toggle');
    await extensions.click();
    assert.equal((await state()).drawers.length, 1);
    await extensions.click();
    assert.equal((await state()).drawers.length, 0);

    await extensions.click();
    await page.waitForTimeout(120);
    const firstDrawer = (await state()).drawers[0];
    await page.click('#ai-config-button .drawer-toggle');
    await page.waitForTimeout(120);
    let current = await state();
    assert.equal(current.drawers.length, 1, 'opening a second drawer left more than one open');
    assert.notEqual(current.drawers[0], firstDrawer, 'the previous drawer stayed open');

    await page.click('#dle-monitor-toggle');
    await extensions.click();
    current = await state();
    assert.equal(current.monitor, false, 'opening a drawer left the monitor open');
    assert.equal(current.drawers.length, 1);

    await page.click('#ai-config-button .drawer-toggle');
    await page.click('#dle-monitor-toggle');
    current = await state();
    assert.equal(current.monitor, true, 'monitor did not open');
    assert.equal(current.drawers.length, 0, 'monitor and a drawer were open together');
    await page.click('#dle-monitor-toggle');
    await page.waitForTimeout(120);

    await page.click('#rightNavDrawerIcon');
    await page.waitForTimeout(120);
    await extensions.click();
    await page.waitForTimeout(120);
    current = await state();
    assert.equal(current.rightNav, false, 'opening a drawer left the right nav open');
    assert.equal(current.drawers.length, 1);
    await extensions.click();
});

