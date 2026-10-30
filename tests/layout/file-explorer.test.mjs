import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openLayoutPage, rect } from './harness.mjs';

const viewport = { width: 1280, height: 900 };

function installVaultMock() {
    const png = Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const now = Date.now();
    const entries = {
        'mnt-lore|': [
            { name: 'chapters', path: 'chapters', kind: 'directory', size: 0, hidden: false, extension: null },
            { name: 'session-notes.md', path: 'session-notes.md', kind: 'file', size: 128, modifiedMs: now, hidden: false, extension: 'md' },
            { name: 'map.png', path: 'map.png', kind: 'file', size: 4096, modifiedMs: now, hidden: false, extension: 'png' },
            { name: '.hidden.md', path: '.hidden.md', kind: 'file', size: 12, modifiedMs: now, hidden: true, extension: 'md' },
        ],
        'mnt-lore|chapters': [
            { name: 'chapter-01.md', path: 'chapters/chapter-01.md', kind: 'file', size: 512, modifiedMs: now, hidden: false, extension: 'md' },
        ],
        'mnt-notes|': [
            { name: 'ideas.md', path: 'ideas.md', kind: 'file', size: 64, modifiedMs: now, hidden: false, extension: 'md' },
        ],
    };
    const mounts = [
        { id: 'mnt-lore', name: 'Lore Vault', path: 'C:/Vault/Lore', available: true },
        { id: 'mnt-notes', name: 'Notes', path: 'C:/Vault/Notes', available: true },
    ];
    let primaryMountId = 'mnt-lore';
    const state = () => ({
        mounts: mounts.map((mount) => ({ ...mount })),
        primaryMountId,
        primaryPath: mounts.find((mount) => mount.id === primaryMountId)?.path ?? null,
    });
    const key = (mountId, path) => `${mountId}|${path}`;
    const remove = (mountId, path) => {
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        entries[key(mountId, parent)] = (entries[key(mountId, parent)] ?? []).filter((entry) => entry.path !== path);
    };
    window.__TT_VAULT_API__ = {
        state: async () => state(),
        pickMount: async () => {
            mounts.push({ id: 'mnt-new', name: 'New Vault', path: 'C:/Vault/New', available: true });
            entries['mnt-new|'] = [];
            return state();
        },
        setPrimary: async (mountId) => { primaryMountId = mountId; return state(); },
        removeMount: async (mountId) => {
            const index = mounts.findIndex((mount) => mount.id === mountId);
            if (index >= 0) mounts.splice(index, 1);
            if (primaryMountId === mountId) primaryMountId = mounts[0]?.id ?? null;
            return state();
        },
        renameMount: async (mountId, name) => {
            const mount = mounts.find((item) => item.id === mountId);
            if (mount) mount.name = name;
            return state();
        },
        list: async (mountId, path) => (entries[key(mountId, path)] ?? []).map((entry) => ({ ...entry })),
        stat: async (mountId, path) => {
            for (const list of Object.values(entries)) {
                const found = list.find((entry) => entry.path === path);
                if (found) return { ...found };
            }
            return { name: path, path, kind: 'file', size: 0, hidden: false, extension: null };
        },
        readText: async () => '---\nkeys: [harbor, tide]\nsummary: Mock lore note.\n---\n# Preview\n\nMock content.',
        readBytes: async () => png,
        thumbnail: async () => png,
        createEntry: async (mountId, parent, name, directory) => {
            const path = parent ? `${parent}/${name}` : name;
            (entries[key(mountId, parent)] ??= []).push({
                name, path, kind: directory ? 'directory' : 'file', size: 0,
                modifiedMs: Date.now(), hidden: name.startsWith('.'), extension: directory ? null : name.split('.').pop(),
            });
            if (directory) entries[key(mountId, path)] = [];
            return entries[key(mountId, parent)].at(-1);
        },
        renameEntry: async (mountId, path, newName) => {
            const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
            const list = entries[key(mountId, parent)] ?? [];
            const found = list.find((entry) => entry.path === path);
            if (found) {
                found.name = newName;
                found.path = parent ? `${parent}/${newName}` : newName;
            }
            return found;
        },
        deleteEntries: async (mountId, paths) => { for (const path of paths) remove(mountId, path); },
        moveEntries: async (sourceMount, paths, destinationMount, destinationDir, copy) => {
            for (const path of paths) {
                const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
                const source = (entries[key(sourceMount, parent)] ?? []).find((entry) => entry.path === path);
                if (!source) continue;
                const name = source.name;
                const targetPath = destinationDir ? `${destinationDir}/${name}` : name;
                (entries[key(destinationMount, destinationDir)] ??= []).push({ ...source, path: targetPath });
                if (!copy) remove(sourceMount, path);
            }
        },
        writeFile: async (mountId, parent, name, bytes, overwrite) => {
            const path = parent ? `${parent}/${name}` : name;
            const list = entries[key(mountId, parent)] ??= [];
            const found = list.find((entry) => entry.name === name);
            if (found && !overwrite) throw { code: 'exists', message: 'exists' };
            if (!found) list.push({ name, path, kind: 'file', size: bytes.length, hidden: name.startsWith('.'), extension: name.split('.').pop() });
        },
        exportEntry: async () => 'C:/Downloads/file',
        reveal: async () => {},
    };
}

let session;
let page;

async function openExplorer() {
    if (await page.locator('#tt-file-explorer').isHidden()) await page.click('#tt-file-explorer-toggle');
    await page.waitForSelector('#tt-file-explorer', { state: 'visible' });
    await page.waitForTimeout(150);
}

async function ensureLoreExpanded() {
    const expanded = await page.evaluate(() => window.__ttFileExplorer?.state.expanded.has('mnt-lore|'));
    if (!expanded) {
        await page.click('[data-key="mnt-lore|"]');
        await page.waitForTimeout(200);
    }
    if (!(await page.locator('[data-key="mnt-lore|chapters"]').count())) {
        await page.click('[data-key="mnt-lore|"]');
        await page.click('[data-key="mnt-lore|"]');
        await page.waitForTimeout(250);
    }
    await page.waitForSelector('[data-key="mnt-lore|chapters"]', { state: 'attached' });
}

async function closeExplorer() {
    if (!(await page.locator('#tt-file-explorer').isHidden())) {
        await page.click('#tt-file-explorer button[title="Close file explorer"]');
    }
    await page.waitForTimeout(100);
}

before(async () => {
    session = await openLayoutPage({ ...viewport, initScript: installVaultMock });
    page = session.page;
    await page.waitForSelector('#tt-file-explorer-toggle', { timeout: 10_000 });
    await page.evaluate(() => document.fonts?.ready);
});

after(async () => {
    await session?.close();
});

test('opening the dock shrinks and recenters the chat without moving the rail', async () => {
    const railBefore = await rect(page, '#top-settings-holder');
    const chatBefore = await rect(page, '#sheld');
    const topBefore = await rect(page, '#top-bar');
    await openExplorer();
    const focus = await page.evaluate(() => window.__TAURITAVERN__?.api?.workspace?.getFocus?.());
    assert.equal(focus?.folder, 'lore');
    await page.waitForTimeout(250);
    const dock = await rect(page, '#tt-file-explorer');
    const chat = await rect(page, '#sheld');
    const top = await rect(page, '#top-bar');
    assert.ok(dock && chat && top, 'dock, chat and top bar must exist');
    assert.ok(chat.right <= dock.x + 1, `chat ${chat.right} overlaps dock ${dock.x}`);
    assert.ok(top.right <= dock.x + 1, `top bar ${top.right} overlaps dock ${dock.x}`);
    assert.ok(chat.width <= chatBefore.width + 1, 'chat did not shrink or stay inside');
    const left = await rect(page, '#tt-copilot-dock');
    const leftEdge = left?.right ?? 0;
    assert.ok(Math.abs(chat.x - (leftEdge + (dock.x - leftEdge - chat.width) / 2)) <= 2, 'chat is not centered in the remaining width');
    assert.equal((await rect(page, '#top-settings-holder')).x, railBefore.x);
    assert.equal((await rect(page, '#top-settings-holder')).width, railBefore.width);
    assert.ok(top.width <= topBefore.width + 1);
    await closeExplorer();
    const restored = await rect(page, '#sheld');
    assert.ok(Math.abs(restored.width - chatBefore.width) <= 1, `chat width did not restore: ${restored.width} vs ${chatBefore.width}`);
    assert.ok(Math.abs(restored.x - chatBefore.x) <= 1, 'chat position did not restore');
});

test('resizing the dock updates the chat live and clamps both edges', async () => {
    await openExplorer();
    await page.evaluate(() => document.documentElement.style.setProperty('--sheldWidth', '80vw'));
    await page.waitForTimeout(100);
    const before = await rect(page, '#tt-file-explorer');
    const chatBefore = await rect(page, '#sheld');
    const handle = await page.locator('.tt-fe-resizer').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 60, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    const wider = await rect(page, '#tt-file-explorer');
    const chatAfter = await rect(page, '#sheld');
    assert.ok(wider.width > before.width + 30, `dock did not grow: ${wider.width}`);
    assert.ok(chatAfter.width < chatBefore.width, `chat did not shrink: ${chatAfter.width} vs ${chatBefore.width}`);
    assert.ok(chatAfter.right <= wider.x + 1, 'chat overlaps the resized dock');
    await page.dblclick('.tt-fe-resizer');
    const reset = await rect(page, '#tt-file-explorer');
    assert.ok(Math.abs(reset.width - 340) <= 1, `double-click did not reset to 340: ${reset.width}`);
    const stored = await page.evaluate(() => Number(localStorage.getItem('tt.fileExplorer.width')));
    assert.ok(Math.abs(stored - reset.width) <= 2, 'dock width was not persisted');
    await page.evaluate(() => document.documentElement.style.removeProperty('--sheldWidth'));
});

test('the tree shows mounts, expands folders and switches to card thumbnails', async () => {
    await openExplorer();
    const text = await page.locator('#tt-file-explorer').innerText();
    assert.match(text, /Lore Vault/);
    assert.match(text, /Notes/);
    await ensureLoreExpanded();
    await page.dblclick('[data-key="mnt-lore|chapters"] .tt-fe-node-name');
    await page.waitForTimeout(250);
    assert.match(await page.locator('#tt-file-explorer').innerText(), /chapter-01\.md/);
    await page.click('.tt-fe-breadcrumb >> text=Lore Vault');
    await page.waitForTimeout(200);
    await page.click('button[title="Card view"]');
    await page.waitForTimeout(250);
    assert.ok(await page.locator('.tt-fe-cards').count() > 0, 'card view did not render');
    assert.ok(await page.locator('.tt-fe-card img').count() > 0, 'image thumbnail did not render');
    await page.click('button[title="Details view"]');
    await page.waitForTimeout(150);
    assert.ok(await page.locator('.tt-fe-tree').count() > 0, 'details tree did not return');
});

test('hidden files are filtered until the eye toggle is used', async () => {
    await openExplorer();
    await ensureLoreExpanded();
    await page.waitForTimeout(150);
    assert.doesNotMatch(await page.locator('#tt-file-explorer').innerText(), /\.hidden\.md/);
    await page.click('button[title="Show hidden files"]');
    await page.waitForTimeout(150);
    assert.match(await page.locator('#tt-file-explorer').innerText(), /\.hidden\.md/);
    await page.click('button[title="Show hidden files"]');
});

test('new file, rename and delete go through the backend and refresh the tree', async () => {
    await openExplorer();
    await ensureLoreExpanded();
    page.on('dialog', async (dialog) => {
        if (dialog.type() === 'prompt') await dialog.accept(dialog.message().includes('New') ? 'new-file.md' : 'renamed.md');
        else await dialog.accept();
    });
    await page.click('button[title="New file"]');
    await page.waitForTimeout(250);
    assert.match(await page.locator('#tt-file-explorer').innerText(), /new-file\.md/);
    await page.click('[data-key="mnt-lore|new-file.md"]', { button: 'right' });
    await page.click('.tt-fe-context-menu button:has-text("Rename")');
    await page.waitForTimeout(250);
    assert.match(await page.locator('#tt-file-explorer').innerText(), /renamed\.md/);
    await page.click('[data-key="mnt-lore|renamed.md"]', { button: 'right' });
    await page.click('.tt-fe-context-menu button:has-text("Delete")');
    await page.waitForTimeout(250);
    assert.doesNotMatch(await page.locator('#tt-file-explorer').innerText(), /renamed\.md/);
});

test('context menu uses the common themed menu button styling', async () => {
    await openExplorer();
    await ensureLoreExpanded();
    await page.click('[data-key="mnt-lore|session-notes.md"]', { button: 'right' });
    const item = page.locator('.tt-fe-context-menu .menu_button').first();
    await item.waitFor();
    assert.match(await item.getAttribute('class'), /\bmenu_button\b/);
    const styles = await item.evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
            background: computed.backgroundColor,
            color: computed.color,
            bodyColor: getComputedStyle(document.body).color,
        };
    });
    assert.notEqual(styles.background, 'rgb(255, 255, 255)');
    assert.notEqual(styles.background, 'rgb(239, 239, 239)');
    assert.equal(styles.color, styles.bodyColor);
    const danger = page.locator('.tt-fe-context-menu .tt-fe-danger').first();
    assert.equal(await danger.count(), 1);
    const dangerColor = await danger.evaluate((element) => getComputedStyle(element).color);
    assert.notEqual(dangerColor, styles.color);
    await page.keyboard.press('Escape');
});

test('file rows show token and size metadata and a keyword hover card', async () => {
    await openExplorer();
    await ensureLoreExpanded();
    const row = page.locator('[data-key="mnt-lore|session-notes.md"]');
    await row.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-key="mnt-lore|session-notes.md"] .tt-fe-node-meta')?.textContent?.includes('tokens |'));
    assert.match(await row.locator('.tt-fe-node-meta').textContent(), /tokens \| \d/);
    await row.hover();
    await page.waitForSelector('.tt-fe-hover');
    assert.match(await page.locator('.tt-fe-hover-keywords').textContent(), /harbor, tide/);
    await page.mouse.move(0, 0);
});

test('narrative experiments overlay removals and overrides in the vault', async () => {
    const result = await page.evaluate(async () => {
        const api = window.__TT_VAULT_API__;
        const originalList = api.list;
        const originalRead = api.readText;
        api.list = async (mountId, path) => {
            if (path === 'Narrative-Experiments') {
                return [{ name: 'arranged', path: 'Narrative-Experiments/arranged', kind: 'directory' }];
            }
            if (path === 'Narrative-Experiments/arranged') {
                return [{ name: 'experiment.json', path: 'Narrative-Experiments/arranged/experiment.json', kind: 'file' }];
            }
            return originalList(mountId, path);
        };
        api.readText = async (mountId, path) => {
            if (path.endsWith('experiment.json')) {
                return JSON.stringify({
                    title: 'Arranged Dowry',
                    removals: ['Characters/Old.md'],
                    overrides: ['overrides/Characters/New.md'],
                });
            }
            if (path.endsWith('overrides/Characters/New.md')) {
                return '---\nkeys: [dowry, leaf]\n---\nThe new arrangement.';
            }
            return originalRead(mountId, path);
        };
        const experiments = window.__TT_EXPERIMENTS__;
        const manifests = await experiments.discover();
        await experiments.activate(manifests[0]?.id);
        const transformed = experiments.transformEntries('mnt-lore', 'Characters', [
            { name: 'Old.md', path: 'Characters/Old.md', kind: 'file', size: 10 },
            { name: 'Kept.md', path: 'Characters/Kept.md', kind: 'file', size: 10 },
        ]);
        const read = experiments.readText('mnt-lore', 'Characters/New.md');
        const lore = experiments.transformLoreEntries([
            { title: 'Old', path: 'Characters/Old.md', content: 'old' },
            { title: 'Kept', path: 'Characters/Kept.md', content: 'kept' },
        ]);
        experiments.deactivate();
        return { manifests, transformed, read, lore };
    });
    assert.equal(result.manifests.length, 1);
    assert.deepEqual(result.transformed.map((entry) => entry.name), ['Kept.md', 'New.md']);
    assert.equal(result.transformed.find((entry) => entry.name === 'New.md').readPath, 'Narrative-Experiments/arranged/overrides/Characters/New.md');
    assert.match(result.read, /new arrangement/i);
    assert.deepEqual(result.lore.map((entry) => entry.title), ['Kept', 'New']);
    assert.equal(result.lore.find((entry) => entry.title === 'New').override, true);
});

test('double-clicking a file opens it in a center tab', async () => {
    await openExplorer();
    await ensureLoreExpanded();
    await page.dblclick('[data-key="mnt-lore|session-notes.md"]');
    await page.waitForSelector('.tt-center-tab', { timeout: 5000 });
    const labels = await page.locator('.tt-center-tab-label').allTextContents();
    assert.ok(labels.includes('TauriTavern'));
    assert.ok(labels.includes('session-notes.md'));
    assert.equal(await page.locator('#tt-center-file').isVisible(), true);
    await page.locator('.tt-center-tab').filter({ hasText: 'Tavern' }).click();
});

test('internal drag and drop moves an entry into a folder', async () => {
    await openExplorer();
    await page.evaluate(() => document.querySelector('.tt-fe-context-menu')?.remove());
    await ensureLoreExpanded();
    await page.waitForSelector('[data-key="mnt-lore|session-notes.md"]');
    await page.locator('[data-key="mnt-lore|session-notes.md"]').dragTo(page.locator('[data-key="mnt-lore|chapters"]'));
    await page.waitForTimeout(300);
    const entries = await page.evaluate(() => window.__TT_VAULT_API__.list('mnt-lore', 'chapters'));
    assert.ok(entries.some((entry) => entry.name === 'session-notes.md'), 'drag did not move the file');
});

test('the explorer clamps at 1024 and overlays below 900', async () => {
    await openExplorer();
    for (const [width, overlay] of [[1024, false], [800, true]]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(250);
        const dock = await rect(page, '#tt-file-explorer');
        const chat = await rect(page, '#sheld');
        assert.ok(dock, `${width}px: dock missing`);
        assert.ok(dock.x >= 0 && dock.right <= width + 1, `${width}px: dock outside viewport`);
        if (!overlay) {
            assert.ok(chat.right <= dock.x + 1, `${width}px: chat overlaps dock`);
            assert.ok(dock.width <= 460, `${width}px: dock exceeds 460`);
        } else {
            assert.ok(dock.width <= width * 0.86 + 1, `${width}px: overlay is too wide`);
        }
    }
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
});

test('opening the character panel closes the file explorer', async () => {
    await openExplorer();
    await page.evaluate(() => document.getElementById('right-nav-panel')?.classList.add('openDrawer'));
    await page.click('#rightNavHolder .drawer-toggle');
    await page.waitForTimeout(200);
    assert.ok(await page.locator('#tt-file-explorer').isHidden(), 'file explorer stayed open');
});

export { installVaultMock };
