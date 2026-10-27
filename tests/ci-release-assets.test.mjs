import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';

import { collectReleaseAssets } from '../scripts/ci/collect-release-assets.mjs';

// The Windows-only release train publishes these artifacts.
const ARTIFACTS = new Map([
    ['debug-windows-x64-nsis', 'windows-x64-setup-DEBUG.exe'],
    ['windows-x64-msi', 'windows-x64.msi'],
    ['windows-x64-nsis', 'windows-x64-setup.exe'],
    ['windows-x64-portable', 'windows-x64-portable.exe'],
]);

const EXPECTED_RELEASE_ASSETS = [
    'TauriTavern-2.2.0-windows-x64-portable.exe',
    'TauriTavern-2.2.0-windows-x64-setup-DEBUG.exe',
    'TauriTavern-2.2.0-windows-x64-setup.exe',
    'TauriTavern-2.2.0-windows-x64.msi',
].sort();

async function createArtifacts(root, prefix, omittedSuffixes = []) {
    const omitted = new Set(Array.isArray(omittedSuffixes) ? omittedSuffixes : [omittedSuffixes]);
    for (const [suffix, relativeFile] of ARTIFACTS) {
        if (omitted.has(suffix)) {
            continue;
        }
        const file = join(root, `${prefix}${suffix}`, relativeFile);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, suffix);
    }
}

test('collectReleaseAssets publishes the complete naming contract', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'tauritavern-release-assets-'));
    t.after(() => rm(root, { recursive: true, force: true }));

    const inputDirectory = join(root, 'dist');
    const outputDirectory = join(root, 'release-assets');
    const artifactPrefix = 'TauriTavern-2.2.0-';
    await createArtifacts(inputDirectory, artifactPrefix);

    const assets = await collectReleaseAssets({
        inputDirectory,
        outputDirectory,
        artifactPrefix,
        requireDebug: true,
    });

    assert.deepEqual(assets.map((asset) => basename(asset)), EXPECTED_RELEASE_ASSETS);
    assert.deepEqual((await readdir(outputDirectory)).sort(), EXPECTED_RELEASE_ASSETS);
});

test('collectReleaseAssets fails before publishing an incomplete release set', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'tauritavern-release-assets-'));
    t.after(() => rm(root, { recursive: true, force: true }));

    const inputDirectory = join(root, 'dist');
    const outputDirectory = join(root, 'release-assets');
    const artifactPrefix = 'TauriTavern-20260726-canary-';
    await createArtifacts(inputDirectory, artifactPrefix, ['windows-x64-portable', 'debug-windows-x64-nsis']);

    await assert.rejects(
        collectReleaseAssets({ inputDirectory, outputDirectory, artifactPrefix }),
        { message: 'Missing workflow artifacts: TauriTavern-20260726-canary-windows-x64-portable' },
    );
    await assert.rejects(readdir(outputDirectory), { code: 'ENOENT' });
});

test('collectReleaseAssets requires every Stable debug artifact', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'tauritavern-release-assets-'));
    t.after(() => rm(root, { recursive: true, force: true }));

    const inputDirectory = join(root, 'dist');
    const outputDirectory = join(root, 'release-assets');
    const artifactPrefix = 'TauriTavern-2.2.0-';
    await createArtifacts(inputDirectory, artifactPrefix, 'debug-windows-x64-nsis');

    await assert.rejects(
        collectReleaseAssets({ inputDirectory, outputDirectory, artifactPrefix, requireDebug: true }),
        /Missing workflow artifacts: TauriTavern-2\.2\.0-debug-windows-x64-nsis/,
    );
});

test('collectReleaseAssets rejects non-Windows artifacts', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'tauritavern-release-assets-'));
    t.after(() => rm(root, { recursive: true, force: true }));

    const inputDirectory = join(root, 'dist');
    const outputDirectory = join(root, 'release-assets');
    const artifactPrefix = 'TauriTavern-2.2.0-';
    await createArtifacts(inputDirectory, artifactPrefix);
    await mkdir(join(inputDirectory, `${artifactPrefix}android-arm64-apk`), { recursive: true });

    await assert.rejects(
        collectReleaseAssets({ inputDirectory, outputDirectory, artifactPrefix, requireDebug: true }),
        /Unknown workflow artifact: TauriTavern-2\.2\.0-android-arm64-apk/,
    );
});
