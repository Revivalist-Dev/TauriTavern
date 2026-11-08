import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openLayoutPage } from './harness.mjs';

let session;
let page;

before(async () => {
    session = await openLayoutPage({ width: 1440, height: 900 });
    page = session.page;
});

after(async () => {
    await session?.close();
});

test('TauriUI builds accessible panel and tab components', async () => {
    const result = await page.evaluate(() => {
        const panel = TauriUI.panel({
            title: 'Test panel',
            subtitle: 'Shared chrome',
            actions: TauriUI.button({ label: 'Action', variant: 'primary' }),
            body: TauriUI.card({ title: 'Card', body: 'Body' }),
            footer: TauriUI.button({ label: 'Close', variant: 'ghost' }),
        });
        document.body.append(panel.root);
        const tabs = TauriUI.tabs({
            label: 'Test tabs',
            items: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two', badge: 3 }],
        });
        document.body.append(tabs.root);
        const active = tabs.getActiveId();
        tabs.setActive('two');
        const disclosure = TauriUI.disclosure({ summary: 'Advanced', body: 'Content' });
        const segmented = TauriUI.segmentedControl({ items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
        const menu = TauriUI.menu({ items: [{ label: 'Open' }] });
        const divider = TauriUI.divider();
        const resize = TauriUI.panelResizeHandle({ value: 400, min: 320, max: 800 });
        const result = {
            api: ['panel', 'tabs', 'button', 'toolbar', 'card', 'field', 'breadcrumbs', 'searchInput', 'switchControl', 'dialog', 'progress', 'disclosure', 'menu', 'divider', 'segmentedControl', 'panelResizeHandle']
                .every((name) => typeof TauriUI[name] === 'function'),
            primitives: {
                disclosure: disclosure.root.dataset.ttUi,
                segmented: segmented.root.dataset.ttUi,
                menu: menu.dataset.ttUi,
                divider: divider.className,
                resizeRole: resize.root.getAttribute('role'),
                resizeValue: resize.root.getAttribute('aria-valuenow'),
            },
            panel: {
                dataset: panel.root.dataset.ttUi,
                className: panel.root.className,
                title: panel.title.textContent,
                bodyCards: panel.body.querySelectorAll('.tt-ui-card').length,
                footerButtons: panel.footer.querySelectorAll('.tt-ui-button').length,
            },
            tabs: {
                role: tabs.root.getAttribute('role'),
                count: tabs.root.querySelectorAll('[role="tab"]').length,
                active,
                selected: [...tabs.root.querySelectorAll('[role="tab"]')].filter((node) => node.getAttribute('aria-selected') === 'true').length,
                selectedId: tabs.getActiveId(),
            },
        };
        panel.root.remove();
        tabs.root.remove();
        return result;
    });

    assert.equal(result.api, true);
    assert.match(result.panel.className, /tt-ui-panel/);
    assert.equal(result.panel.title, 'Test panel');
    assert.equal(result.panel.bodyCards, 1);
    assert.equal(result.panel.footerButtons, 1);
    assert.equal(result.primitives.disclosure, 'disclosure');
    assert.equal(result.primitives.segmented, 'segmented');
    assert.equal(result.primitives.menu, 'menu');
    assert.match(result.primitives.divider, /tt-ui-divider/);
    assert.equal(result.primitives.resizeRole, 'separator');
    assert.equal(result.primitives.resizeValue, '400');
    assert.equal(result.tabs.role, 'tablist');
    assert.equal(result.tabs.count, 2);
    assert.equal(result.tabs.active, 'one');
    assert.equal(result.tabs.selected, 1);
    assert.equal(result.tabs.selectedId, 'two');
});

test('panel roots expose the shared panel marker', async () => {
    const roots = await page.evaluate(() => ({
        shellPanels: [...document.querySelectorAll('.tauri-panel-content')].map((node) => ({
            id: node.id,
            marker: node.dataset.ttUi,
        })),
        deepLore: document.querySelector('#deeplore-panel')?.dataset.ttUi,
        copilot: document.querySelector('#scp-window')?.dataset.ttUi,
        appRoots: ['#tt-file-explorer', '.tt-customize', '.tt-session-panel', '.tt-lore-default-panel', '#tt-copilot-dock']
            .map((selector) => {
                const node = document.querySelector(selector);
                return node ? { selector, marker: node.dataset.ttUi } : null;
            })
            .filter(Boolean),
    }));

    assert.ok(roots.shellPanels.length > 0);
    for (const panel of roots.shellPanels) {
        assert.equal(panel.marker, 'panel', `${panel.id || 'unnamed shell panel'} must use the shared panel marker`);
    }
    assert.equal(roots.deepLore, 'panel');
    assert.equal(roots.copilot, 'panel');
    for (const panel of roots.appRoots) {
        assert.equal(panel.marker, 'panel', `${panel.selector} must use the shared panel marker`);
    }
});

test('the floating Copilot panel uses the shared Tauri theme', async () => {
    const style = await page.evaluate(() => {
        const node = document.querySelector('#scp-window');
        const computed = getComputedStyle(node);
        const root = getComputedStyle(document.documentElement);
        return {
            shadow: computed.boxShadow,
            blur: computed.backdropFilter,
            accent: computed.getPropertyValue('--scp-accent'),
            sharedAccent: root.getPropertyValue('--tt-ui-accent'),
            fontSize: computed.getPropertyValue('--scp-font-size'),
            sharedFontSize: root.getPropertyValue('--tt-ui-font-size'),
            surface: computed.getPropertyValue('--scp-bg'),
            sharedSurface: root.getPropertyValue('--tt-ui-surface'),
        };
    });
    assert.equal(style.blur, 'none');
    assert.ok(!/64px|48px|40px 80px/.test(style.shadow), `unexpected harsh shadow: ${style.shadow}`);
    assert.equal(style.accent, style.sharedAccent);
    assert.equal(style.fontSize, style.sharedFontSize);
    assert.equal(style.surface, style.sharedSurface);
});
