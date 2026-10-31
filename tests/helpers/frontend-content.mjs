import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The frontend directory the test hosts serve. */
export const frontendRoot = fileURLToPath(new URL('../../src/', import.meta.url));

export const defaultSettings = JSON.parse(readFileSync(new URL('../../default/content/settings.json', import.meta.url), 'utf8'));
export const defaultTheme = JSON.parse(readFileSync(new URL('../../default/content/themes/Dark Lite.json', import.meta.url), 'utf8'));
export const systemExtensions = readdirSync(path.join(frontendRoot, 'scripts/extensions'))
    .filter(name => existsSync(path.join(frontendRoot, 'scripts/extensions', name, 'manifest.json')))
    .map(name => ({ name, type: 'system' }));

/**
 * Native-only extensions import the Tauri host and cannot initialize in the Web Host fixture.
 * Extend this set when an extension gains a native dependency; the browser and perf fixtures must
 * never count those load failures as application startup failures.
 */
export const webHostUnsupportedExtensions = new Set([
    'tauritavern-deeplore',
    'tauritavern-deeplore-copilot',
]);
export const webHostSystemExtensions = systemExtensions.filter(
    extension => !webHostUnsupportedExtensions.has(extension.name),
);
