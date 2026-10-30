import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openExtensionsDrawer, openLayoutPage, rect } from './harness.mjs';

let session;
let page;
const viewport = { width: 1280, height: 900 };

async function panelDescriptors(target) {
    return target.evaluate(() => {
        const panels = [...document.querySelectorAll('#extensions_settings > .inline-drawer, #extensions_settings2 > .inline-drawer')];
        panels.forEach((panel, index) => panel.setAttribute('data-layout-panel', String(index)));
        return panels.map((panel, index) => {
            const header = panel.querySelector('.inline-drawer-header');
            return {
                index: String(index),
                id: panel.id || null,
                text: header?.textContent?.trim().slice(0, 80) ?? '',
            };
        });
    });
}

async function ensureOpen(target, index) {
    const panel = `[data-layout-panel="${index}"]`;
    const content = target.locator(`${panel} > .inline-drawer-content`);
    if (!(await content.isVisible())) {
        await target.locator(`${panel} .inline-drawer-header`).click();
        await target.waitForTimeout(180);
    }
    await content.waitFor({ state: 'visible', timeout: 5_000 });
}

before(async () => {
    session = await openLayoutPage(viewport);
    page = session.page;
    await openExtensionsDrawer(page);
});

after(async () => {
    await session?.close();
});

test('every extension settings panel opens inside its column without moving the rail', async () => {
    const railBefore = await rect(page, '#top-settings-holder');
    const drawerBefore = await rect(page, '#extensions-settings-button .drawer-content');
    const leftBefore = await rect(page, '#extensions_settings');
    const rightBefore = await rect(page, '#extensions_settings2');
    const panels = await panelDescriptors(page);
    assert.ok(panels.length >= 2, `expected fixture panels, found ${panels.length}`);

    for (const descriptor of panels) {
        await ensureOpen(page, descriptor.index);
        const panel = await rect(page, `[data-layout-panel="${descriptor.index}"]`);
        const content = await rect(page, `[data-layout-panel="${descriptor.index}"] > .inline-drawer-content`);
        assert.ok(panel && content, `${descriptor.text}: missing panel geometry`);
        assert.ok(content.height > 0, `${descriptor.text}: panel content is empty`);
        assert.ok(panel.x >= drawerBefore.x - 1, `${descriptor.text}: starts left of the drawer`);
        assert.ok(panel.right <= drawerBefore.right + 1, `${descriptor.text}: extends past the drawer`);

        const rail = await rect(page, '#top-settings-holder');
        const drawer = await rect(page, '#extensions-settings-button .drawer-content');
        for (const key of ['x', 'width']) {
            assert.ok(Math.abs(rail[key] - railBefore[key]) <= 1, `${descriptor.text}: rail ${key} moved`);
            assert.ok(Math.abs(drawer[key] - drawerBefore[key]) <= 1, `${descriptor.text}: drawer ${key} moved`);
        }
        const left = await rect(page, '#extensions_settings');
        const right = await rect(page, '#extensions_settings2');
        assert.ok(Math.abs(left.x - leftBefore.x) <= 1, `${descriptor.text}: left column x moved`);
        assert.ok(Math.abs(left.width - leftBefore.width) <= 1, `${descriptor.text}: left column width moved`);
        assert.ok(Math.abs(right.x - rightBefore.x) <= 1, `${descriptor.text}: right column x moved`);
        assert.ok(Math.abs(right.width - rightBefore.width) <= 1, `${descriptor.text}: right column width moved`);

        await page.locator(`[data-layout-panel="${descriptor.index}"] .inline-drawer-header`).click();
        await page.waitForTimeout(120);
    }

    assert.ok(Math.abs((await rect(page, '#top-settings-holder')).x - railBefore.x) <= 1);
});

test('the extensions drawer stays at 460px at 1024 and 1920 viewports', async () => {
    for (const width of [1024, 1920]) {
        const local = await openLayoutPage({ width, height: 900 });
        try {
            await openExtensionsDrawer(local.page);
            const drawer = await rect(local.page, '#extensions-settings-button .drawer-content');
            const left = await rect(local.page, '#extensions_settings');
            const right = await rect(local.page, '#extensions_settings2');
            assert.ok(drawer, `${width}px: drawer missing`);
            assert.ok(drawer.width <= 460, `${width}px: drawer ${drawer.width}px`);
            assert.ok(drawer.right <= width + 1, `${width}px: drawer past viewport`);
            assert.ok(left.width <= drawer.width, `${width}px: left column overflow`);
            assert.ok(right.width <= drawer.width, `${width}px: right column overflow`);
            assert.ok(drawer.scrollWidth <= drawer.clientWidth + 2, `${width}px: drawer horizontal overflow`);
        } finally {
            await local.close();
        }
    }
});
