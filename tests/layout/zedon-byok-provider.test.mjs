import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function read(relativePath) {
    return readFile(path.join(repoRoot, relativePath), 'utf8');
}

test('Connection Profile exposes Zedon BYOK as a provider', async () => {
    const html = await read('src/index.html');
    assert.match(html, /value="zedon_byok"/);
    assert.match(html, /id="zedon_byok_discover"/);
    assert.match(html, /id="zedon_byok_model_select"/);
    assert.match(html, /id="zedon_byok_assistant_prefill"/);
    assert.match(html, /data-source="custom,zedon_byok"/);
    assert.match(html, /Zedon BYOK creative warning/);
});

test('Zedon BYOK model picker separates upstream and creative models', async () => {
    const source = await read('src/scripts/openai.js');
    assert.match(source, /ZEDON_BYOK: 'zedon_byok'/);
    assert.match(source, /category !== 'tauritavern'/);
    assert.match(source, /category === 'tauritavern'/);
    assert.match(source, /Creative \(TauriTavern preset\)/);
});

test('custom OpenAI requests carry the TauriTavern assistant prefill', async () => {
    const source = await read('src/scripts/openai.js');
    assert.match(source, /generate_data\.custom_api_format === custom_api_formats\.OPENAI_COMPAT/);
    assert.match(source, /generate_data\.assistant_prefill = type === 'impersonate'/);
});

test('Zedon BYOK source maps to the custom OpenAI-compatible transport', async () => {
    const source = await read('src-tauri/crates/tt-application/src/services/chat_completion_service/config.rs');
    assert.match(source, /ChatCompletionSource::Custom \| ChatCompletionSource::ZedonByok/);
    const payload = await read('src-tauri/crates/tt-application/src/services/chat_completion_service/payload/mod.rs');
    assert.match(payload, /ChatCompletionSource::Custom \| ChatCompletionSource::ZedonByok/);
});

test('presets cannot replace the active provider unless the caller supplies one', async () => {
    const source = await read('src/scripts/custom-request.js');
    assert.match(source, /if \(!overridePayload\.chat_completion_source\)/);
    assert.match(source, /const activeSource = oai_settings\.chat_completion_source/);
    assert.match(source, /overridePayload\.chat_completion_source = activeSource/);
    assert.doesNotMatch(source, /chat_completion_source = payload\.chat_completion_source/);
});

test('Copilot relies on core provider routing instead of overriding it', async () => {
    const source = await read('src/scripts/extensions/tauritavern-deeplore-copilot/index.js');
    assert.doesNotMatch(source, /mainProviderOverrides/);
    assert.doesNotMatch(source, /chat_completion_source:/);
});
