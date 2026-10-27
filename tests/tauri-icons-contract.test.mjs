import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAURI_APP_ROOT = path.join(REPO_ROOT, 'src-tauri', 'crates', 'tauritavern');
const TAURI_CONFIG_PATH = path.join(TAURI_APP_ROOT, 'tauri.conf.json');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngHeader(buffer, iconPath) {
    assert.ok(
        buffer.length >= 29,
        `${iconPath} is too small to contain a valid PNG IHDR chunk`,
    );
    assert.deepEqual(
        buffer.subarray(0, 8),
        PNG_SIGNATURE,
        `${iconPath} is not a valid PNG file`,
    );
    assert.equal(
        buffer.readUInt32BE(8),
        13,
        `${iconPath} has an invalid IHDR chunk length`,
    );
    assert.equal(
        buffer.toString('ascii', 12, 16),
        'IHDR',
        `${iconPath} is missing the IHDR chunk`,
    );

    return {
        bitDepth: buffer[24],
        colorType: buffer[25],
    };
}

async function assertPngIconsStayRgba(iconPaths, compatibilityMessage) {
    assert.ok(iconPaths.length > 0, 'expected at least one PNG icon to validate');

    for (const iconPath of iconPaths) {
        const header = readPngHeader(await readFile(iconPath.absolutePath), iconPath.displayPath);

        assert.equal(
            header.bitDepth,
            8,
            `${iconPath.displayPath} must use 8-bit channels`,
        );
        assert.equal(
            header.colorType,
            6,
            `${iconPath.displayPath} must stay RGBA (PNG color type 6); ${compatibilityMessage}`,
        );
    }
}

test('Tauri bundle PNG icons remain 8-bit RGBA', async () => {
    const config = JSON.parse(await readFile(TAURI_CONFIG_PATH, 'utf8'));
    const iconDir = path.dirname(TAURI_CONFIG_PATH);
    const pngIcons = config.bundle.icon
        .filter((iconPath) => iconPath.toLowerCase().endsWith('.png'))
        .map((iconPath) => ({
            absolutePath: path.join(iconDir, iconPath),
            displayPath: iconPath,
        }));

    await assertPngIconsStayRgba(
        pngIcons,
        'indexed-color compression breaks Tauri builds',
    );
});
