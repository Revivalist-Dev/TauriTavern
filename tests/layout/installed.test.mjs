import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';

const ENABLED = process.env.TAURITAVERN_LIVE_LAYOUT === '1' || process.env.npm_lifecycle_event === 'test:layout:installed';
const CDP_URL = 'http://127.0.0.1:9222';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ARTIFACTS = path.join(import.meta.dirname, 'artifacts');
const INSTALLED = path.join(
    process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
    'com.tauritavern.client',
    'data',
    'default-user',
    'extensions',
);

let browser;
let page;
let child;
let report = { app: 'TauriTavern', extensions: [], shellPanels: [], failures: [] };

async function waitForCdp(timeoutMs = 180_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const response = await fetch(`${CDP_URL}/json/version`);
            if (response.ok) return true;
        } catch {
            // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
}

async function startApp() {
    if (await waitForCdp(1500)) return true;
    child = spawn('pnpm', ['run', 'tauri:dev'], {
        cwd: ROOT,
        shell: true,
        env: {
            ...process.env,
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', () => {});
    return waitForCdp();
}

async function pickAppPage() {
    const contexts = browser.contexts();
    for (const context of contexts) {
        for (const candidate of context.pages()) {
            const url = candidate.url();
            if (url.includes('localhost:1430') || url.startsWith('tauri://') || url.includes('tauri.localhost')) {
                await candidate.waitForSelector('#top-settings-holder', { timeout: 20_000 });
                return candidate;
            }
        }
    }
    throw new Error('no TauriTavern page found over CDP');
}

async function rect(target, selector) {
    return target.evaluate((value) => {
        const element = document.querySelector(value);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    }, selector);
}

async function openExtensions() {
    const content = page.locator('#extensions-settings-button .drawer-content');
    if (!(await content.isVisible())) {
        await page.locator('#extensions-settings-button .drawer-toggle').first().click();
        await page.waitForTimeout(200);
    }
}

before(async () => {
    if (!ENABLED) return;
    if (!(await startApp())) throw new Error(`CDP did not start at ${CDP_URL}`);
    browser = await chromium.connectOverCDP(CDP_URL);
    page = await pickAppPage();
    await page.waitForTimeout(500);
    fs.mkdirSync(ARTIFACTS, { recursive: true });
});

after(async () => {
    if (browser) await browser.close();
    if (child && process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    if (ENABLED) {
        fs.mkdirSync(ARTIFACTS, { recursive: true });
        fs.writeFileSync(path.join(ARTIFACTS, 'layout-report.json'), JSON.stringify(report, null, 2));
    }
});

test('installed extension settings panels open without moving the drawer', { skip: !ENABLED }, async () => {
    const installed = fs.existsSync(INSTALLED) ? fs.readdirSync(INSTALLED, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name) : [];
    await openExtensions();
    await page.waitForTimeout(800);
    await page.waitForSelector('#tauri-agents--settings', { state: 'attached', timeout: 5_000 }).catch(() => {});

    const railBefore = await rect(page, '#top-settings-holder');
    const drawerBefore = await rect(page, '#extensions-settings-button .drawer-content');
    assert.ok(drawerBefore, 'Extensions drawer did not open');

    const panels = await page.evaluate(() => {
        const elements = [
            ...document.querySelectorAll('#extensions_settings .inline-drawer, #extensions_settings2 .inline-drawer'),
            ...document.querySelectorAll('#in_chat_agents_container > *'),
        ].filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
        });
        elements.forEach((element, index) => element.setAttribute('data-live-layout', String(index)));
        return elements.map((element, index) => ({
            index: String(index),
            text: element.querySelector('.inline-drawer-header')?.textContent?.trim().slice(0, 80)
                ?? element.querySelector('h2, h3, h4')?.textContent?.trim().slice(0, 80)
                ?? element.textContent?.trim().slice(0, 80)
                ?? '',
        }));
    });

    for (const panel of panels) {
        const selector = `[data-live-layout="${panel.index}"]`;
        const header = page.locator(`${selector} > .inline-drawer-header`);
        const content = page.locator(`${selector} > .inline-drawer-content`);
        const toggleable = (await header.count()) > 0 && (await content.count()) > 0;
        if (toggleable && !(await content.isVisible())) {
            await header.first().click();
            await page.waitForTimeout(200);
        }
        const box = await rect(page, selector);
        if (box) {
            assert.ok(box.width <= drawerBefore.width + 1, `${panel.text}: panel wider than drawer`);
            assert.ok(box.x >= drawerBefore.x - 1, `${panel.text}: panel left of drawer`);
            assert.ok(box.right <= drawerBefore.right + 1, `${panel.text}: panel right of drawer`);
        }
        report.extensions.push({ panel: panel.text, width: box?.width ?? null });
        if (toggleable) {
            await header.first().click();
            await page.waitForTimeout(120);
        }
    }

    const railAfter = await rect(page, '#top-settings-holder');
    const drawerAfter = await rect(page, '#extensions-settings-button .drawer-content');
    for (const key of ['x', 'width']) {
        assert.ok(Math.abs(railBefore[key] - railAfter[key]) <= 1, `rail ${key} moved`);
        assert.ok(Math.abs(drawerBefore[key] - drawerAfter[key]) <= 1, `drawer ${key} moved`);
    }
    report.installedExtensions = installed;
    assert.ok(panels.length >= 0);
});

test('installed shell panels keep the rail and panel geometry', { skip: !ENABLED }, async () => {
    const railBefore = await rect(page, '#top-settings-holder');
    const panels = await page.evaluate(() => [...document.querySelectorAll('#top-settings-holder .drawer.tauri-panel-drawer')]
        .map((element) => element.id));
    for (const id of panels) {
        await page.locator(`#${id} .drawer-toggle`).first().click();
        await page.waitForTimeout(200);
        const content = await rect(page, `#${id} .drawer-content`);
        if (content) {
            assert.ok(content.x >= 0, `${id}: panel left of viewport`);
            assert.ok(content.right <= (await page.evaluate(() => window.innerWidth)) + 1, `${id}: panel right of viewport`);
            const maxPanelWidth = await page.evaluate(() => window.innerWidth - 58 - 24);
            assert.ok(content.width <= maxPanelWidth + 1, `${id}: panel wider than the viewport limit`);
            report.shellPanels.push({ id, width: content.width, x: content.x });
        }
    }
    const railAfter = await rect(page, '#top-settings-holder');
    assert.equal(railAfter.x, railBefore.x, 'rail moved while switching shell panels');
    assert.equal(railAfter.width, railBefore.width, 'rail resized while switching shell panels');
});

test('installed DeepLore features and migrated cursor hooks are live', { skip: !ENABLED }, async () => {
    const result = await page.evaluate(async () => {
        const context = window.SillyTavern?.getContext?.();
        const settings = context?.extensionSettings?.deeplore_enhanced;
        const vaultApi = window.deepLoreEnhanced_vault;
        const status = await vaultApi?.status?.();
        const vaultState = await window.__TAURITAVERN__.api.vault.state();
        const mount = vaultState.mounts.find((entry) => entry.path.replaceAll('\\', '/').endsWith('/lorebook-umamusume'));
        if (!mount) throw new Error('lorebook-umamusume is not mounted');
        const hooks = window.__TAURITAVERN__.api.customize.hooks;
        const config = await hooks.config(mount.path);
        await hooks.trust(mount.path);
        const run = await hooks.run({
            event: 'preToolUse',
            surface: 'native_agent',
            payload: {
                hook_event_name: 'preToolUse',
                tool_name: 'Write',
                tool_input: { file_path: 'World/Hook Probe.md', content: 'The story begins.' },
            },
            vaultRoot: mount.path,
        });
        const blockedRun = await hooks.run({
            event: 'preToolUse',
            surface: 'native_agent',
            payload: {
                hook_event_name: 'preToolUse',
                tool_name: 'Write',
                tool_input: { file_path: 'World/Hook Probe.md', content: 'The foal arrives.' },
            },
            vaultRoot: mount.path,
        });
        return {
            enabled: settings?.enabled === true,
            injectionMode: settings?.injectionMode,
            featureKeys: settings ? Object.keys(settings) : [],
            vault: {
                status,
                keys: vaultApi ? Object.keys(vaultApi) : [],
            },
            globals: {
                onGenerate: typeof window.deepLoreEnhanced_onGenerate,
                matchText: typeof window.deepLoreEnhanced_matchText,
                vault: typeof vaultApi,
            },
            hookCommand: config.hooks?.preToolUse?.[0]?.command,
            hookRun: run,
            blockedRun,
        };
    });

    assert.equal(result.enabled, true, 'DeepLore is not enabled');
    assert.equal(result.injectionMode, 'extension', 'DeepLore injection is not active');
    assert.ok(result.featureKeys.includes('injectionMode'), 'DeepLore injection settings are missing');
    assert.ok(result.featureKeys.includes('autoSuggestEnabled'), 'DeepLore auto-suggest settings are missing');
    for (const feature of ['aiSearchEnabled', 'aiNotepadEnabled', 'librarianEnabled', 'scribeEnabled', 'notebookEnabled']) {
        assert.ok(result.featureKeys.includes(feature), `DeepLore ${feature} is not available`);
    }
    assert.ok(result.vault.keys.includes('status'), 'DeepLore vault status API is missing');
    assert.ok(result.vault.keys.includes('matchText'), 'DeepLore matching API is missing');
    assert.ok(result.vault.keys.includes('read') && result.vault.keys.includes('write'), 'DeepLore file API is missing');
    assert.equal(result.globals.onGenerate, 'function', 'DeepLore generation hook is missing');
    assert.equal(result.globals.matchText, 'function', 'DeepLore matcher is missing');
    assert.equal(result.globals.vault, 'object', 'DeepLore vault object is missing');
    assert.ok(result.vault.status?.configured, 'DeepLore vault is not configured');
    assert.equal(result.hookCommand, 'node .cursor/hooks/lorebook-guard.mjs');
    assert.equal(result.hookRun.results.length, 1, 'TauriTavern did not execute the vault hook');
    assert.equal(result.hookRun.results[0].exitCode, 0, result.hookRun.results[0].stderr);
    assert.match(result.hookRun.results[0].stdout, /"permission":"allow"/);
    assert.equal(result.blockedRun.results.length, 1, 'TauriTavern did not execute the blocking hook');
    assert.equal(result.blockedRun.results[0].exitCode, 0, result.blockedRun.results[0].stderr);
    assert.match(result.blockedRun.results[0].stdout, /"permission":"deny"/);
});

