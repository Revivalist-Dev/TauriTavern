#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const roots = [
    projectRoot,
    path.join(workspaceRoot, 'tauri-tavern-extensions', 'TauriTavern-DeepLore'),
    path.join(workspaceRoot, 'tauri-tavern-extensions', 'TauriTavern-DeepLore-Copilot'),
].filter((root) => !root.includes(`${path.sep}node_modules${path.sep}`));

const ignoredDirectories = new Set(['.git', 'node_modules', 'target', 'dist']);
const ignoredPathParts = [
    `${path.sep}default${path.sep}content${path.sep}presets${path.sep}`,
    `${path.sep}default${path.sep}content${path.sep}index.json`,
    `${path.sep}public${path.sep}lib${path.sep}`,
    `${path.sep}src${path.sep}lib${path.sep}`,
];
const pattern = /role[\s-]?play(?:er|ing|ed)?/i;
const textExtensions = new Set([
    '.css', '.html', '.js', '.json', '.md', '.mjs', '.mdc', '.rs', '.toml', '.ts', '.tsx', '.txt', '.yml', '.yaml',
]);

async function collect(directory, files) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (ignoredDirectories.has(entry.name)) continue;
            if (ignoredPathParts.some((part) => absolute.includes(part))) continue;
            if (absolute.endsWith(`${path.sep}default${path.sep}content${path.sep}presets`)) continue;
            await collect(absolute, files);
        } else if (entry.isFile()) {
            if (ignoredPathParts.some((part) => absolute.includes(part))) continue;
            if (absolute.endsWith(`${path.sep}default${path.sep}content${path.sep}index.json`)) continue;
            if (!textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
            files.push(absolute);
        }
    }
}

const files = [];
for (const root of roots) await collect(root, files);

const failures = [];
for (const file of files) {
    let text;
    try {
        const stats = await readFile(file);
        if (stats.length > 2 * 1024 * 1024) continue;
        text = stats.toString('utf8');
    } catch {
        continue;
    }
    const matches = text.match(new RegExp(pattern.source, 'gi'));
    if (matches?.length) {
        failures.push({ file: path.relative(workspaceRoot, file), count: matches.length });
    }
}

if (failures.length) {
    console.error('Terminology check failed: a retired term is still present.');
    for (const failure of failures) console.error(`  ${failure.file} (${failure.count})`);
    process.exit(1);
}

console.log(`Terminology check passed across ${files.length} files.`);
