#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const extensionsRoot = path.join(projectRoot, 'src', 'scripts', 'extensions');

const jobs = [
    {
        name: 'TauriTavern-DeepLore-Copilot',
        source: path.join(workspaceRoot, 'tauri-tavern-extensions', 'TauriTavern-DeepLore-Copilot'),
        target: path.join(extensionsRoot, 'tauritavern-deeplore-copilot'),
        build: true,
        files: ['index.js', 'style.css', 'manifest.json', 'window.html', 'settings.html'],
    },
    {
        name: 'TauriTavern-DeepLore',
        source: path.join(workspaceRoot, 'tauri-tavern-extensions', 'TauriTavern-DeepLore'),
        target: path.join(extensionsRoot, 'tauritavern-deeplore'),
        build: false,
        files: ['index.js', 'style.css', 'manifest.json', 'settings.html', 'settings.js', 'drawer.html', 'settings-popup.html', 'setup-wizard.html', 'icon.svg'],
    },
];

for (const job of jobs) {
    if (job.build) {
        execSync('npm run build', { cwd: job.source, stdio: 'inherit' });
    }
    mkdirSync(job.target, { recursive: true });
    for (const file of job.files) {
        const source = path.join(job.source, file);
        if (!existsSync(source)) {
            throw new Error(`${job.name}: missing ${file}`);
        }
        copyFileSync(source, path.join(job.target, file));
    }
    console.log(`synced ${job.name}`);
}

execSync(`"${process.execPath}" scripts/check-extension-sync.mjs`, {
    cwd: projectRoot,
    stdio: 'inherit',
});
