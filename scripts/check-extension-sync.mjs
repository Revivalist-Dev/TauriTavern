#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const pairs = [
    {
        label: 'TauriTavern-DeepLore',
        source: path.join(workspaceRoot, 'tauri-tavern-extensions', 'TauriTavern-DeepLore'),
        installed: path.join(projectRoot, 'src', 'scripts', 'extensions', 'tauritavern-deeplore'),
        files: ['index.js', 'style.css', 'manifest.json', 'settings.html', 'settings.js', 'drawer.html', 'settings-popup.html', 'setup-wizard.html', 'icon.svg'],
        dirs: ['src'],
    },
    {
        label: 'TauriTavern-DeepLore-Copilot',
        source: path.join(workspaceRoot, 'tauri-tavern-extensions', 'TauriTavern-DeepLore-Copilot'),
        installed: path.join(projectRoot, 'src', 'scripts', 'extensions', 'tauritavern-deeplore-copilot'),
        files: ['index.js', 'style.css', 'manifest.json', 'window.html', 'settings.html'],
    },
];

const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function listFiles(root, prefix = '') {
    const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const relative = path.join(prefix, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFiles(root, relative));
        } else if (entry.isFile()) {
            files.push(relative);
        }
    }
    return files;
}

const failures = [];
for (const pair of pairs) {
    for (const file of pair.files) {
        const [source, installed] = await Promise.all([
            readFile(path.join(pair.source, file)).catch(() => null),
            readFile(path.join(pair.installed, file)).catch(() => null),
        ]);
        if (!source || !installed) {
            failures.push(`${pair.label}/${file}: missing on ${source ? 'installed' : 'source'} side`);
        } else if (digest(source) !== digest(installed)) {
            failures.push(`${pair.label}/${file}: installed copy is stale`);
        }
    }
    for (const dir of pair.dirs ?? []) {
        const sourceFiles = await listFiles(path.join(pair.source, dir)).catch(() => []);
        for (const relative of sourceFiles) {
            const source = await readFile(path.join(pair.source, dir, relative)).catch(() => null);
            const installed = await readFile(path.join(pair.installed, dir, relative)).catch(() => null);
            if (!source || !installed) {
                failures.push(`${pair.label}/${dir}/${relative}: missing on ${source ? 'installed' : 'source'} side`);
            } else if (digest(source) !== digest(installed)) {
                failures.push(`${pair.label}/${dir}/${relative}: installed copy is stale`);
            }
        }
    }
}

if (failures.length) {
    console.error('Extension synchronization check failed:');
    for (const failure of failures) console.error(`  ${failure}`);
    console.error('Rebuild the extension and copy its bundle into src/scripts/extensions/.');
    process.exit(1);
}

console.log(`Extension synchronization check passed for ${pairs.length} extensions.`);
