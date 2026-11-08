import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import {
    defaultSettings,
    defaultTheme,
    frontendRoot,
    systemExtensions,
} from '../helpers/frontend-content.mjs';

const LAYOUT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_EXTENSIONS = ['layout-wide', 'layout-tall', 'layout-shell'];
const MIME = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
]);

function contentType(file) {
    return MIME.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream';
}

function readFixture(file) {
    return readFileSync(file);
}

function layoutIndexHtml() {
    const original = readFileSync(path.join(frontendRoot, 'index.html'), 'utf8');
    const data = {
        settings: defaultSettings,
        theme: defaultTheme,
        extensions: [
            ...systemExtensions,
            ...FIXTURE_EXTENSIONS.map((name) => ({ name, type: 'system' })),
        ],
    };
    const json = JSON.stringify(data).replaceAll('<', '\\u003c');
    const bootstrap = `
    <script type="application/json" id="layout-data">${json}</script>
    <script type="module">
        import { createWebHostFixture } from '/__layout/web-host-fixture.mjs';
        import { installWebHost } from '/tauri/web-host/install.js';
        const data = JSON.parse(document.getElementById('layout-data').textContent);
        window.__LAYOUT_DATA__ = data;
        const fixture = createWebHostFixture(data.settings, data.theme, data.extensions);
        installWebHost({
            identity: { platform: 'windows', kind: 'desktop' },
            backend: fixture.backend,
            store: fixture.store,
        });
        window.__LAYOUT_BOOTSTRAPPED__ = true;
    </script>
    <script type="module" src="init.js"></script>`;

    if (!original.includes('<script type="module" src="init.js"></script>')) {
        throw new Error('layout harness: init.js script tag not found');
    }
    return original.replace('<script type="module" src="init.js"></script>', bootstrap);
}

function createLayoutServer() {
    const transformedIndex = layoutIndexHtml();
    const server = createServer((req, res) => {
        try {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            let pathname = decodeURIComponent(url.pathname);

            if (pathname === '/' || pathname === '/index.html') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(transformedIndex);
                return;
            }

            if (pathname === '/__layout/web-host-fixture.mjs') {
                res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
                res.end(readFixture(path.join(LAYOUT_ROOT, '..', 'browser', 'web-host-fixture.mjs')));
                return;
            }

            const extensionMatch = pathname.match(/^\/scripts\/extensions\/([^/]+)\/(.+)$/);
            if (extensionMatch && FIXTURE_EXTENSIONS.includes(extensionMatch[1])) {
                const file = path.join(LAYOUT_ROOT, 'fixtures', 'extensions', extensionMatch[1], extensionMatch[2]);
                if (existsSync(file) && file.startsWith(path.join(LAYOUT_ROOT, 'fixtures'))) {
                    res.writeHead(200, { 'Content-Type': contentType(file) });
                    res.end(readFileSync(file));
                    return;
                }
            }

            const file = path.join(frontendRoot, pathname.replace(/^\/+/, ''));
            if (existsSync(file) && path.resolve(file).startsWith(path.resolve(frontendRoot))) {
                res.writeHead(200, { 'Content-Type': contentType(file) });
                res.end(readFileSync(file));
                return;
            }

            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('not found');
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(String(error?.stack ?? error));
        }
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                origin: `http://127.0.0.1:${address.port}`,
                close: () => new Promise((done) => server.close(done)),
            });
        });
    });
}

export async function openLayoutPage({ width = 1280, height = 900, waitForShell = true, initScript } = {}) {
    const layoutServer = await createLayoutServer();
    const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width, height } });
    if (initScript) await page.addInitScript(initScript);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error?.stack ?? error)));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(layoutServer.origin, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#top-settings-holder', { timeout: 20_000 });
    await page.waitForSelector('#extensions-settings-button', { timeout: 20_000 });
    if (waitForShell) {
        await page.waitForFunction(() => document.body.dataset.tauriShellInstalled === 'true', null, { timeout: 20_000 });
        await page.waitForFunction(() => {
            const rail = document.getElementById('top-settings-holder')?.getBoundingClientRect();
            return Boolean(rail && rail.width > 0 && rail.width < 100);
        }, { timeout: 20_000 });
        await page.waitForTimeout(300);
    }

    return {
        page,
        browser,
        errors,
        close: async () => {
            await browser.close();
            await layoutServer.close();
        },
    };
}

export async function openExtensionsDrawer(page) {
    const drawer = page.locator('#extensions-settings-button');
    const content = drawer.locator('.drawer-content').first();
    if (!(await content.isVisible())) {
        await drawer.locator('.drawer-toggle').first().click();
        await page.waitForTimeout(150);
    }
    await page.waitForSelector('#extensions-settings-button .drawer-content', { state: 'visible' });
}

export async function clickDrawer(page, id) {
    const toggle = page.locator(`#${id} .drawer-toggle`).first();
    await toggle.click();
    await page.waitForTimeout(120);
}

export async function rect(page, selector) {
    return page.evaluate((target) => {
        const element = document.querySelector(target);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            right: box.right,
            bottom: box.bottom,
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
        };
    }, selector);
}

export async function installLayoutShiftObserver(page) {
    await page.evaluate(() => {
        window.__layoutShifts = [];
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.hadRecentInput) continue;
                window.__layoutShifts.push({
                    value: entry.value,
                    sources: (entry.sources ?? []).map((source) => ({
                        selector: source.node?.id
                            ? `#${source.node.id}`
                            : source.node?.className
                                ? `.${String(source.node.className).split(/\s+/).join('.')}`
                                : source.node?.nodeName ?? 'unknown',
                        previousRect: source.previousRect,
                        currentRect: source.currentRect,
                    })),
                });
            }
        }).observe({ type: 'layout-shift' });
    });
}

export async function readLayoutShifts(page) {
    return page.evaluate(() => window.__layoutShifts ?? []);
}

export function assertRectStable(before, after, label, tolerance = 1) {
    if (!before || !after) throw new Error(`${label}: missing rectangle`);
    for (const key of ['x', 'y', 'width', 'height']) {
        if (Math.abs(before[key] - after[key]) > tolerance) {
            throw new Error(`${label}: ${key} moved ${before[key]} -> ${after[key]}`);
        }
    }
}

export function assertInsideViewport(box, label, viewport) {
    if (!box) throw new Error(`${label}: missing element`);
    if (box.x < -1 || box.y < -1 || box.right > viewport.width + 1 || box.bottom > viewport.height + 1) {
        throw new Error(`${label}: outside viewport ${JSON.stringify(box)}`);
    }
}

