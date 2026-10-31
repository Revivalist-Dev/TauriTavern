#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const servicePath = path.join(os.homedir(), '.cursor-byok-v3', 'service.json');
const apiKey = process.env.BYOK_API_KEY?.trim();

if (!apiKey) {
    console.error('BYOK_API_KEY must contain the Zedon-BYOK External API key.');
    process.exit(1);
}

const service = JSON.parse(await readFile(servicePath, 'utf8'));
if (!Number.isInteger(service.port) || service.port <= 0) {
    console.error('Zedon-BYOK did not report a valid service port.');
    process.exit(1);
}
const baseUrl = `http://127.0.0.1:${service.port}/byok/v1`;
const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
};

const catalogResponse = await fetch(`${baseUrl}/models`, { headers });
if (!catalogResponse.ok) {
    console.error(`Zedon-BYOK model catalog returned ${catalogResponse.status}.`);
    process.exit(1);
}
const catalog = await catalogResponse.json();
const models = Array.isArray(catalog?.data) ? catalog.data : [];
const upstream = models.find((model) => model.category !== 'tauritavern');
const creative = models.find((model) => model.category === 'tauritavern');
if (!upstream || !creative) {
    console.error('Expected at least one upstream model and one TauriTavern creative model.');
    process.exit(1);
}

const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
        model: upstream.id,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
        max_tokens: 4,
        stream: false,
    }),
});
if (!response.ok) {
    console.error(`Zedon-BYOK chat completion returned ${response.status}.`);
    process.exit(1);
}
const data = await response.json();
if (!data?.choices?.length) {
    console.error('Zedon-BYOK returned no completion choices.');
    process.exit(1);
}

console.log(`Zedon-BYOK verified: ${models.length} models, ${models.filter((model) => model.category === 'tauritavern').length} creative.`);
