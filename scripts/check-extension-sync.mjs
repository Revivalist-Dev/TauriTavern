#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
    },
    {
        label: 'TauriTavern-DeepLore-Copilot',
        source: path.join(workspaceRoot, 'tauri-tavern-extensions', 'TauriTavern-DeepLore-Copilot'),
        installed: path.join(projectRoot, 'src', 'scripts', 'extensions', 'tauritavern-deeplore-copilot'),
        files: ['index.js', 'style.css', 'manifest.json', 'window.html', 'settings.html'],
    },
];

const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
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
}

if (failures.length) {
    console.error('Extension synchronization check failed:');
    for (const failure of failures) console.error(`  ${failure}`);
    console.error('Rebuild the extension and copy its bundle into src/scripts/extensions/.');
    process.exit(1);
}

console.log(`Extension synchronization check passed for ${pairs.length} extensions.`);
