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

test('DeepLore exposes the writeNote compatibility API Copilot uses', async () => {
    const result = await page.evaluate(() => {
        const compose = window.__DeepLoreWriteApiDebug?.composeWriteContent;
        return {
            api: typeof window.deepLoreEnhanced_writeNote,
            readApi: typeof window.deepLoreEnhanced_readNote,
            append: compose?.('Old', 'New', 'append'),
            patch: compose?.('Hello old world', 'new', 'patch', 'old'),
            patchMissing: compose?.('Hello', 'new', 'patch', 'absent'),
            overwrite: compose?.('Old', 'New', 'overwrite'),
        };
    });
    assert.equal(result.api, 'function');
    assert.equal(result.readApi, 'function');
    assert.deepEqual(result.overwrite, { ok: true, content: 'New' });
    assert.deepEqual(result.append, { ok: true, content: 'Old\n\nNew' });
    assert.deepEqual(result.patch, { ok: true, content: 'Hello new world' });
    assert.equal(result.patchMissing.ok, false);
});

test('DeepLore for TauriTavern is installed as a system extension', async () => {
    await page.waitForSelector('#dle-open-settings', { state: 'attached', timeout: 10_000 });
    assert.match(await page.locator('#dle-open-settings').textContent(), /DeepLore Settings/);
    assert.equal(await page.locator('#dle-open-lore-defaults').count(), 1);

    const enabled = await page.evaluate(() => window.SillyTavern.getContext().extensionSettings.deeplore_enhanced?.enabled);
    assert.equal(enabled, true);
    assert.equal(await page.locator('#lore-directory-button').count(), 0);
    assert.equal(await page.locator('#lore-directory').count(), 0);

    // SillyTavern-format world-info and character-lore imports are retired.
    assert.equal(await page.locator('#world_import_button').count(), 0);
    assert.equal(await page.locator('#world_import_file').count(), 0);
    assert.equal(await page.locator('#world_import_dialog').count(), 0);
    assert.equal(await page.locator('#import_character_info').count(), 0);

    // DeepLore's own ST-format importer is retired too.
    assert.equal(await page.locator('[data-action="import-wi"]').count(), 0);
    assert.equal(await page.locator('[data-empty-action="import-wi"]').count(), 0);
    assert.equal(await page.locator('#dle-wizard-import-method').count(), 0);
});

test('all lore and shell tabs use opaque surfaces', async () => {
    const result = await page.evaluate(() => {
        const alpha = (value) => {
            if (!value || value === 'transparent') return 0;
            const rgb = value.match(/^rgba?\(([^)]+)\)$/);
            if (rgb) {
                const parts = rgb[1].split(/[,\s/]+/).filter(Boolean);
                return parts.length > 3 ? Number(parts[3]) : 1;
            }
            const modern = value.match(/^color\([^/]+\/\s*([0-9.]+)\)$/);
            return modern ? Number(modern[1]) : 1;
        };
        const tabs = [...document.querySelectorAll('.tt-center-tab, .dle-tab, .dle-librarian-sub-tab, .scp-modal-tab, .tauri-tabs-tab, .tauri-agents--agent-tab')];
        const bars = [...document.querySelectorAll('#tt-center-tabs, .dle-tab-bar, .dle-librarian-sub-tabs, .scp-modal-tabs, .tauri-tabs-nav')];
        const panels = [...document.querySelectorAll('.tauri-panel-content, #deeplore-panel, #scp-window')];
        return {
            tabs: tabs.map((el) => {
                const style = getComputedStyle(el);
                return { className: el.className, backgroundAlpha: alpha(style.backgroundColor), opacity: style.opacity };
            }),
            bars: bars.map((el) => {
                const style = getComputedStyle(el);
                return { className: el.className, backgroundAlpha: alpha(style.backgroundColor), backdropFilter: style.backdropFilter };
            }),
            panels: panels.map((el) => {
                const style = getComputedStyle(el);
                return { className: el.className, backgroundAlpha: alpha(style.backgroundColor) };
            }),
        };
    });

    assert.ok(result.tabs.length > 0, 'expected at least the center and DeepLore tabs');
    for (const tab of result.tabs) {
        assert.equal(tab.opacity, '1', `${tab.className} must not fade`);
        assert.equal(tab.backgroundAlpha, 1, `${tab.className} must have an opaque background`);
    }
    for (const bar of result.bars) {
        assert.equal(bar.backgroundAlpha, 1, `${bar.className} must have an opaque background`);
        assert.equal(bar.backdropFilter, 'none', `${bar.className} must not blur what is behind it`);
    }
    for (const panel of result.panels) {
        assert.equal(panel.backgroundAlpha, 1, `${panel.className} must have an opaque panel surface`);
    }
});

test('DeepLore Monitor aligns to the side-rail edge', async () => {
    await page.waitForSelector('#dle-monitor-toggle', { state: 'attached', timeout: 10_000 });
    await page.click('#dle-monitor-toggle');
    await page.waitForSelector('#dle-monitor-panel[aria-hidden="false"]', { timeout: 5_000 });
    const state = await page.evaluate(() => {
        const panel = document.getElementById('dle-monitor-panel');
        const rect = panel.getBoundingClientRect();
        const style = getComputedStyle(panel);
        const rail = Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--tauri-rail-width')) || 58;
        return {
            x: rect.x,
            y: rect.y,
            rail,
            marker: panel.dataset.ttUi,
            radius: style.borderTopLeftRadius,
            shadow: style.boxShadow,
        };
    });
    assert.ok(Math.abs(state.x - state.rail) < 2, `panel x ${state.x} is not aligned to rail ${state.rail}`);
    assert.ok(Math.abs(state.y) < 2, `panel top ${state.y} overlaps the tab bar`);
    assert.equal(state.marker, 'panel');
    assert.equal(state.radius, '0px');
    assert.equal(state.shadow, 'none');
    await page.click('#dle-monitor-toggle');
});

test('every DeepLore Monitor control and tab works', async () => {
    const errors = [];
    const onError = (error) => errors.push(String(error));
    page.on('pageerror', onError);
    await page.waitForSelector('#dle-monitor-toggle', { state: 'attached', timeout: 10_000 });
    await page.click('#dle-monitor-toggle');
    await page.waitForSelector('#dle-monitor-panel[aria-hidden="false"]', { timeout: 5_000 });

    for (const id of ['overview', 'calls', 'requests', 'network', 'events', 'prompts']) {
        await page.click(`[data-mon-tab="${id}"]`);
        const selected = await page.locator(`[data-mon-tab="${id}"]`).getAttribute('aria-selected');
        assert.equal(selected, 'true', `tab ${id} did not become active`);
        assert.ok((await page.locator('#dle-mon-body').innerText()).trim().length > 0, `tab ${id} rendered no content`);
    }

    const pause = page.locator('#dle-mon-pause');
    assert.equal((await pause.innerText()).trim(), 'Pause');
    await pause.click();
    assert.equal((await pause.innerText()).trim(), 'Resume');
    await pause.click();
    assert.equal((await pause.innerText()).trim(), 'Pause');

    await page.click('#dle-mon-refresh');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#dle-monitor-panel').getAttribute('aria-hidden'), 'false');

    await page.evaluate(() => {
        window.__monitorDownload = null;
        const originalClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function monitorAnchorClick() {
            if (this.download) {
                window.__monitorDownload = { href: this.href, name: this.download };
                return;
            }
            return originalClick.call(this);
        };
    });
    await page.click('#dle-mon-export');
    const download = await page.evaluate(async () => {
        const captured = window.__monitorDownload;
        if (!captured) return null;
        const response = await fetch(captured.href);
        const payload = await response.json();
        return { name: captured.name, href: captured.href, keys: Object.keys(payload) };
    });
    assert.ok(download, 'export did not create a download anchor');
    assert.match(download.name, /^deeplore-monitor-\d+\.json$/);
    assert.match(download.href, /^blob:/);
    assert.deepEqual(download.keys.sort(), ['calls', 'events', 'generatedAt', 'generations', 'network', 'prompts', 'verdicts']);

    let clearMessage = '';
    page.once('dialog', async (dialog) => {
        clearMessage = dialog.message();
        await dialog.accept();
    });
    await page.click('#dle-mon-clear');
    await page.waitForTimeout(150);
    assert.match(clearMessage, /Clear DeepLore call, prompt, network, event and generation buffers/);

    await page.click('#dle-mon-close');
    await page.waitForSelector('#dle-monitor-panel[aria-hidden="true"]', { state: 'attached', timeout: 3_000 });
    assert.deepEqual(errors, []);
    page.off('pageerror', onError);
});
