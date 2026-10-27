#!/usr/bin/env node

/**
 * Windows-only scope gate.
 *
 * This fork builds Windows x64 only. Every run prints the scope notice, and
 * any Linux, macOS, Android, iOS, OpenHarmony, Flatpak or TestFlight path that
 * comes back through an upstream merge fails the run. The policy and the merge
 * procedure live in docs/UpstreamSync.md.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTICE = 'Windows-only fork: Linux, macOS, Android, iOS, OpenHarmony, Flatpak and TestFlight are out of scope for every run.';

const FORBIDDEN_PATHS = [
    '.github/workflows/public-testflight.yml',
    '.github/workflows/nix-package-check.yml',
    '.github/workflows/fastools-build.yml',
    '.github/workflows/issue-platform-labels.yml',
    'packaging/flatpak',
    'scripts/install-linux.sh',
    'scripts/ohos',
    'scripts/macos',
    'scripts/ci/configure-mobile-http.sh',
    'src-tauri/crates/tauritavern/gen/android',
    'src-tauri/crates/tauritavern/gen/apple',
    'src-tauri/crates/tauritavern/icons/AppIcon.icon',
    'src-tauri/crates/tauritavern/icons/icon.icns',
    'src/tauri/main/compat/mobile',
    'src/tauri/main/compat/android-speech-synthesis.js',
    'src/css/tauritavern-drawer-bar.css',
    'src/scripts/drawer-bar.js',
    'docs/AndroidDevelopment.md',
    'docs/iOSDevelopment.md',
    'docs/OpenHarmonyDevelopment.md',
    'docs/CurrentState/iOSPolicy.md',
    'docs/CurrentState/LinuxRepository.md',
    'docs/CurrentState/MobileStyleAdaptation.md',
    'docs/CurrentState/TTS.md',
];

const PLATFORM_CFG = /(?:target_os\s*=\s*"(android|ios|linux|macos|darwin)"|target_env\s*=\s*"ohos"|cfg\s*\(\s*mobile\s*\))/g;
const PLATFORM_SCRIPT = /'(?:android|ios|linux|macos|flatpak)(?::[a-z-]+)?'|"(?:android|ios|linux|macos|flatpak)(?::[a-z-]+)?"/g;

const violations = [];

function report(kind, location, detail) {
    violations.push({ kind, location, detail });
}

function walk(directory, predicate, output = []) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'dist' || entry.name === '.git') {
                continue;
            }
            walk(absolute, predicate, output);
        } else if (predicate(absolute)) {
            output.push(absolute);
        }
    }
    return output;
}

function checkForbiddenPaths() {
    for (const relative of FORBIDDEN_PATHS) {
        if (existsSync(path.join(ROOT, relative))) {
            report('path', relative, 'platform-only file or directory reintroduced');
        }
    }
}

function checkManifests() {
    const manifests = walk(path.join(ROOT, 'src-tauri', 'crates'), (file) => file.endsWith('Cargo.toml'));
    for (const manifest of manifests) {
        const text = readFileSync(manifest, 'utf8');
        for (const match of text.matchAll(PLATFORM_CFG)) {
            report('cargo', path.relative(ROOT, manifest), `target-specific dependency: ${match[1] ?? 'mobile'}`);
        }
    }
}

function checkRustSources() {
    const sources = walk(path.join(ROOT, 'src-tauri', 'crates'), (file) => file.endsWith('.rs'));
    for (const source of sources) {
        const text = readFileSync(source, 'utf8');
        text.split(/\r?\n/).forEach((line, index) => {
            for (const match of line.matchAll(PLATFORM_CFG)) {
                report('rust', `${path.relative(ROOT, source)}:${index + 1}`, line.trim());
            }
        });
    }
}

function checkPackageScripts() {
    const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
        if (typeof command !== 'string') {
            continue;
        }
        for (const match of command.matchAll(PLATFORM_SCRIPT)) {
            report('script', `package.json:${name}`, `${match[0]} in: ${command}`);
        }
    }
}

console.log(`[windows-only] ${NOTICE}`);
console.log('[windows-only] Policy and per-run merge procedure: docs/UpstreamSync.md');

checkForbiddenPaths();
checkManifests();
checkRustSources();
checkPackageScripts();

if (violations.length === 0) {
    console.log('[windows-only] No non-Windows build or runtime paths found.');
    process.exit(0);
}

console.error(`\n[windows-only] ${violations.length} out-of-scope path(s) found:\n`);
for (const violation of violations) {
    console.error(`  - [${violation.kind}] ${violation.location}`);
    console.error(`    ${violation.detail}`);
}
console.error('\nRemove them or record the exception in docs/UpstreamSync.md before continuing.');
process.exit(1);
