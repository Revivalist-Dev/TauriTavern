import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extensionsRoot = path.resolve(root, '../tauri-tavern-extensions/tauri-extensions/extensions');
const legacyControls = /\.tauri-(button|input|select|textarea)\b/;

async function extensionDirs() {
    return (await readdir(extensionsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(extensionsRoot, entry.name));
}

async function sourceFiles(dir, extensions) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'dist' || entry.name === 'node_modules') continue;
            out.push(...await sourceFiles(full, extensions));
        } else if (extensions.includes(path.extname(entry.name))) {
            out.push(full);
        }
    }
    return out;
}

test('extension styles do not define global control classes', async () => {
    const failures = [];
    for (const dir of await extensionDirs()) {
        for (const file of await sourceFiles(dir, ['.css'])) {
            const source = await readFile(file, 'utf8');
            if (legacyControls.test(source)) {
                failures.push(path.relative(root, file));
            }
        }
    }
    assert.deepEqual(failures, []);
});

test('extensions use shared controls instead of menu_button', async () => {
    const failures = [];
    for (const dir of await extensionDirs()) {
        for (const file of await sourceFiles(dir, ['.js', '.html'])) {
            const source = await readFile(file, 'utf8');
            if (/\bmenu_button(_icon)?\b/.test(source)) {
                failures.push(path.relative(root, file));
            }
        }
    }
    assert.deepEqual(failures, []);
});

test('every extension references the Tauri UI kit', async () => {
    const failures = [];
    for (const dir of await extensionDirs()) {
        const files = await sourceFiles(dir, ['.js', '.html']);
        const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
        if (!/tt-ui-|data-tt-ui|TauriUI|getTauriUI/.test(source)) {
            failures.push(path.basename(dir));
        }
    }
    assert.deepEqual(failures, []);
});
