/**
 * DeepLore Enhanced - monitor telemetry uploader.
 *
 * Posts compact AI-call, request, vault-call and event records to the
 * zedon-byok gateway so its DeepLore tab can mirror this monitor. Prompts and
 * responses are never uploaded.
 */

import { getSettings } from '../../settings.js';
import { aiCallBuffer, eventBuffer, networkBuffer } from '../diagnostics/interceptors.js';
import { getRecentVerdicts } from '../verdict/verdict-store.js';
import { buildTelemetryBatch } from './telemetry-pure.js';

const UPLOAD_INTERVAL_MS = 15_000;

let _timer = null;
let _inFlight = false;
let _lastError = null;

function primaryConnection() {
    const settings = getSettings();
    if (settings.deeploreTelemetry === false) return null;
    const vaults = Array.isArray(settings.vaults) ? settings.vaults : [];
    const vault = vaults.find(entry => entry.enabled) || vaults[0];
    if (!vault || !vault.port) return null;
    return vault;
}

function endpoint(vault) {
    const scheme = vault.https ? 'https' : 'http';
    const host = vault.host || '127.0.0.1';
    return `${scheme}://${host}:${vault.port}/deeplore/telemetry`;
}

/** Send the latest monitor records once. Safe to call manually. */
export async function flushDeeploreTelemetry() {
    if (_inFlight) return { skipped: 'busy' };
    const vault = primaryConnection();
    if (!vault) return { skipped: 'disabled' };

    const batch = buildTelemetryBatch({
        calls: aiCallBuffer.drain(),
        verdicts: getRecentVerdicts(100),
        network: networkBuffer.drain(),
        events: eventBuffer.drain(),
        limit: 100,
    });
    if (batch.events.length === 0) return { skipped: 'empty' };

    _inFlight = true;
    try {
        const response = await fetch(endpoint(vault), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${vault.apiKey || ''}`,
                'X-DLE-Source': 'deeplore',
            },
            body: JSON.stringify(batch),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            throw new Error(`telemetry HTTP ${response.status}`);
        }
        _lastError = null;
        return { sent: batch.events.length };
    } catch (error) {
        const message = error?.message || 'telemetry upload failed';
        if (message !== _lastError) {
            _lastError = message;
            console.warn('[DLE monitor] telemetry upload failed:', message);
        }
        return { error: message };
    } finally {
        _inFlight = false;
    }
}

/** Start periodic uploads. Idempotent. */
export function startDeeploreTelemetry() {
    if (_timer) return;
    _timer = window.setInterval(() => {
        void flushDeeploreTelemetry();
    }, UPLOAD_INTERVAL_MS);
    window.setTimeout(() => {
        void flushDeeploreTelemetry();
    }, 3_000);
}

/** Stop periodic uploads. */
export function stopDeeploreTelemetry() {
    if (_timer) {
        window.clearInterval(_timer);
        _timer = null;
    }
    _inFlight = false;
    _lastError = null;
}
