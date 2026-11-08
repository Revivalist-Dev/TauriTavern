import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
    assertInsideViewport,
    assertRectStable,
    clickDrawer,
    installLayoutShiftObserver,
    openExtensionsDrawer,
    openLayoutPage,
    readLayoutShifts,
    rect,
} from './harness.mjs';

let session;
let page;
const viewport = { width: 1280, height: 900 };

function assertHorizontalStable(before, after, label, tolerance = 1) {
    assert.ok(before && after, `${label}: missing rectangle`);
    for (const key of ['x', 'width']) {
        assert.ok(
            Math.abs(before[key] - after[key]) <= tolerance,
            `${label}: ${key} moved ${before[key]} -> ${after[key]}`,
        );
    }
}

before(async () => {
    session = await openLayoutPage(viewport);
    page = session.page;
    await page.evaluate(() => document.fonts?.ready);
});

after(async () => {
    await session?.close();
});

test('extensions drawer and both settings columns stay inside the shell drawer', async () => {
    await openExtensionsDrawer(page);

    const drawer = await rect(page, '#extensions-settings-button .drawer-content');
    const rail = await rect(page, '#top-settings-holder');
    const left = await rect(page, '#extensions_settings');
    const right = await rect(page, '#extensions_settings2');

    assert.ok(drawer && rail && left && right, 'expected the extensions drawer, rail and columns');
    assertInsideViewport(drawer, 'extensions drawer', viewport);
    assert.equal(Math.round(drawer.x), 58, 'shell drawer starts at the rail edge');
    assert.ok(drawer.width <= 460, `drawer width ${drawer.width} exceeds 460`);
    assert.ok(drawer.scrollWidth <= drawer.clientWidth + 2, 'drawer overflows horizontally');
    assert.ok(Math.abs(left.x - right.x) <= 1, 'settings columns are not aligned');
    assert.ok(Math.abs(left.width - right.width) <= 1, 'settings columns have different widths');
    assert.ok(left.width <= drawer.width, 'left column is wider than the drawer');
    assert.ok(right.width <= drawer.width, 'right column is wider than the drawer');
    assert.ok(rail.width < 100, `rail width ${rail.width} is unexpectedly wide`);
});

test('wide and tall extension panels do not move the columns or add page overflow', async () => {
    await openExtensionsDrawer(page);
    const railBefore = await rect(page, '#top-settings-holder');
    const drawerBefore = await rect(page, '#extensions-settings-button .drawer-content');
    const leftBefore = await rect(page, '#extensions_settings');
    const rightBefore = await rect(page, '#extensions_settings2');

    await page.click('#layout-wide-panel .inline-drawer-header');
    await page.waitForTimeout(200);
    const wide = await rect(page, '#layout-wide-panel');
    assert.ok(wide && wide.height > 0, 'wide panel did not open');

    const leftOpen = await rect(page, '#extensions_settings');
    const drawerOpen = await rect(page, '#extensions-settings-button .drawer-content');
    assertHorizontalStable(leftBefore, leftOpen, 'left column after wide panel');
    assertHorizontalStable(drawerBefore, drawerOpen, 'drawer after wide panel');
    assert.ok(drawerOpen.scrollWidth <= drawerOpen.clientWidth + 2, 'wide panel overflowed the drawer');

    await page.click('#layout-tall-panel .inline-drawer-header');
    await page.waitForTimeout(250);
    const tall = await rect(page, '#layout-tall-panel');
    assert.ok(tall && tall.height > 0, 'tall panel did not open');
    const rightOpen = await rect(page, '#extensions_settings2');
    const drawerTall = await rect(page, '#extensions-settings-button .drawer-content');
    assertHorizontalStable(rightBefore, rightOpen, 'right column after tall panel');
    assertHorizontalStable(drawerBefore, drawerTall, 'drawer after tall panel');
    assert.ok(drawerTall.scrollHeight > drawerTall.clientHeight, 'tall panel did not make the drawer scroll');
    assert.equal(drawerTall.clientWidth, drawerBefore.clientWidth, 'scrollbar changed the drawer content width');

    await page.click('#layout-wide-panel .inline-drawer-header');
    await page.click('#layout-tall-panel .inline-drawer-header');
    await page.waitForTimeout(250);
    assertRectStable(railBefore, await rect(page, '#top-settings-holder'), 'rail after closing panels');
    assertHorizontalStable(drawerBefore, await rect(page, '#extensions-settings-button .drawer-content'), 'drawer after closing panels');
});

test('switching away from Extensions and back restores the geometry', async () => {
    await openExtensionsDrawer(page);
    const railBefore = await rect(page, '#top-settings-holder');
    const drawerBefore = await rect(page, '#extensions-settings-button .drawer-content');

    await clickDrawer(page, 'ai-config-button');
    const aiDrawer = await rect(page, '#ai-config-button .drawer-content');
    assert.ok(aiDrawer, 'AI configuration drawer did not open');
    assertInsideViewport(aiDrawer, 'AI configuration drawer', viewport);
    assertRectStable(railBefore, await rect(page, '#top-settings-holder'), 'rail after switching drawers');

    await clickDrawer(page, 'ai-config-button');
    await openExtensionsDrawer(page);
    assertRectStable(railBefore, await rect(page, '#top-settings-holder'), 'rail after returning');
    assertRectStable(drawerBefore, await rect(page, '#extensions-settings-button .drawer-content'), 'extensions drawer after returning');
});

test('the shell panel keeps the rail and panel geometry fixed', async () => {
    const railBefore = await rect(page, '#top-settings-holder');
    await page.click('#tauri_panel_layout-shell-panel .drawer-toggle');
    await page.waitForSelector('#tauri_panel_layout-shell-panel .drawer-content', { state: 'visible' });

    const panel = await rect(page, '#tauri_panel_layout-shell-panel .drawer-content');
    const body = await rect(page, '#tauri_panel_layout-shell-panel .tauri-panel-body');
    assert.ok(panel && body, 'shell panel did not render');
    assertInsideViewport(panel, 'shell panel', viewport);
    assert.equal(Math.round(panel.x), 58, 'shell panel starts at the rail edge');
    assert.ok(panel.width <= 460, `shell panel width ${panel.width} exceeds 460`);
    assert.ok(body.height > 0, 'shell panel body is empty');
    assertRectStable(railBefore, await rect(page, '#top-settings-holder'), 'rail after opening shell panel');

    await page.click('#tauri_panel_layout-shell-panel .drawer-toggle');
    await page.waitForTimeout(150);
    assertRectStable(railBefore, await rect(page, '#top-settings-holder'), 'rail after closing shell panel');
});

test('opening and closing panels does not layout-shift the chrome', async () => {
    await installLayoutShiftObserver(page);
    await openExtensionsDrawer(page);
    await page.click('#layout-tall-panel .inline-drawer-header');
    await page.waitForTimeout(250);
    await page.click('#layout-tall-panel .inline-drawer-header');
    await page.waitForTimeout(250);

    const shifts = await readLayoutShifts(page);
    const chrome = /^(#top-settings-holder|#extensions-settings-button|#extensions_settings|#extensions_settings2|\.drawer-content|\.tauri-panel)/;
    const chromeShifts = shifts.filter((shift) => shift.sources.some((source) => {
        if (chrome.test(source.selector)) return true;
        const box = source.currentRect;
        return Boolean(box && box.top < 200 && box.left < 600);
    }));
    assert.deepEqual(chromeShifts, [], `layout shift touched the panel chrome: ${JSON.stringify(chromeShifts)}`);
});

test('the rail and drawer headers are not covered by panel content', async () => {
    await openExtensionsDrawer(page);
    const hit = await page.evaluate(() => {
        const railButton = document.querySelector('#extensions-settings-button .drawer-toggle');
        const header = document.querySelector('#extensions-settings-button .drawer-content h3');
        if (!railButton || !header) return null;
        const railBox = railButton.getBoundingClientRect();
        const headerBox = header.getBoundingClientRect();
        const railHit = document.elementFromPoint(railBox.left + railBox.width / 2, railBox.top + railBox.height / 2);
        const headerHit = document.elementFromPoint(headerBox.left + headerBox.width / 2, headerBox.top + headerBox.height / 2);
        return {
            rail: Boolean(railHit?.closest('#top-settings-holder')),
            header: Boolean(headerHit?.closest('#extensions-settings-button')),
        };
    });
    assert.deepEqual(hit, { rail: true, header: true });
});

test('the side rail has no top-row fallback', async () => {
    await page.evaluate(() => document.body.classList.remove('tauri-shell'));
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => ({
        topBar: getComputedStyle(document.querySelector('#top-bar')).display,
        rail: getComputedStyle(document.querySelector('#top-settings-holder')).position,
    }));
    assert.equal(state.topBar, 'none');
    assert.equal(state.rail, 'fixed');
    await page.evaluate(() => document.body.classList.add('tauri-shell'));
    await page.waitForTimeout(250);
});

