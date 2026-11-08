#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const extensionsRoot = path.join(projectRoot, 'src', 'scripts', 'extensions');

const jobs = [
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
    for (const dir of job.dirs ?? []) {
        const source = path.join(job.source, dir);
        if (!existsSync(source)) {
            throw new Error(`${job.name}: missing ${dir}`);
        }
        cpSync(source, path.join(job.target, dir), { recursive: true });
    }
    console.log(`synced ${job.name}`);
}

execSync(`"${process.execPath}" scripts/check-extension-sync.mjs`, {
    cwd: projectRoot,
    stdio: 'inherit',
});
