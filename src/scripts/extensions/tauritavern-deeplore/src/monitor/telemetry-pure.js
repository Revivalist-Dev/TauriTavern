/**
 * DeepLore Monitor telemetry — pure event builders.
 *
 * These functions turn the in-memory diagnostics buffers into the compact
 * records the gateway stores under the "deeplore" category. Prompts and
 * responses are deliberately excluded.
 */

import { classifyNetwork, summarizeVerdict } from './monitor-pure.js';

const DEFAULT_LIMIT = 100;

function clip(value, max = 240) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function vaultPath(url) {
    try {
        return new URL(String(url), 'http://localhost').pathname;
    } catch {
        return String(url ?? '');
    }
}

export function buildAiCallEvents(calls, limit = DEFAULT_LIMIT) {
    const rows = Array.isArray(calls) ? calls.slice(-limit) : [];
    return rows.map((call) => {
        const timestamp = Number(call?.t ?? call?.timestamp) || 0;
        const caller = clip(call?.caller || 'unknown');
        const status = clip(call?.status || 'error', 40);
        const duration = Number(call?.durationMs);
        const inputTokens = Number(call?.inputTokens);
        const outputTokens = Number(call?.outputTokens);
        return {
            key: `ai:${timestamp}:${caller}:${status}:${duration || 0}:${inputTokens || 0}:${outputTokens || 0}`,
            kind: 'ai_call',
            occurred_at_ms: timestamp || Date.now(),
            caller,
            model: call?.model ? clip(call.model) : null,
            status,
            duration_ms: Number.isFinite(duration) ? duration : null,
            input_tokens: Number.isFinite(inputTokens) ? inputTokens : null,
            output_tokens: Number.isFinite(outputTokens) ? outputTokens : null,
            payload: {
                mode: call?.mode ? clip(call.mode, 80) : null,
                abortReason: call?.abortReason ? clip(call.abortReason) : null,
                error: call?.error ? clip(call.error, 500) : null,
                timeoutMs: Number.isFinite(Number(call?.timeoutMs)) ? Number(call.timeoutMs) : null,
            },
        };
    });
}

export function buildRequestEvents(verdicts, limit = DEFAULT_LIMIT) {
    const rows = Array.isArray(verdicts) ? verdicts.slice(0, limit) : [];
    return rows.map((verdict) => {
        const summary = summarizeVerdict(verdict);
        const sources = Array.isArray(verdict?.injectedSources) ? verdict.injectedSources : [];
        return {
            key: `req:${summary.timestamp}:${clip(summary.chatId, 80)}:${summary.messageIndex}:${summary.generationId}`,
            kind: 'request',
            occurred_at_ms: summary.timestamp || Date.now(),
            caller: 'request',
            model: null,
            status: null,
            duration_ms: null,
            input_tokens: null,
            output_tokens: null,
            payload: {
                messageIndex: summary.messageIndex,
                entries: summary.entries,
                tokens: summary.tokens,
                chatId: clip(summary.chatId, 80),
                generationId: summary.generationId,
                states: summary.states,
                injectedSources: sources.map(source => ({
                    title: clip(source?.title ?? source?.filename ?? '', 240),
                    vaultSource: clip(source?.vaultSource ?? '', 120),
                    tokens: Number(source?.tokens) || 0,
                    matchedBy: clip(source?.matchedBy ?? '', 120),
                })),
            },
        };
    });
}

export function buildNetworkEvents(entries, limit = DEFAULT_LIMIT) {
    const rows = Array.isArray(entries) ? entries.slice().reverse() : [];
    const out = [];
    for (const entry of rows) {
        if (classifyNetwork(entry?.url) !== 'vault') continue;
        const timestamp = Number(entry?.t ?? entry?.timestamp) || 0;
        const method = clip(entry?.method || 'GET', 12);
        const path = clip(vaultPath(entry?.url), 500);
        const status = Number(entry?.status);
        const duration = Number(entry?.durMs ?? entry?.durationMs);
        out.push({
            key: `net:${timestamp}:${method}:${path}:${status || 0}:${duration || 0}`,
            kind: 'network',
            occurred_at_ms: timestamp || Date.now(),
            caller: 'vault',
            model: null,
            status: null,
            duration_ms: Number.isFinite(duration) ? duration : null,
            input_tokens: null,
            output_tokens: null,
            payload: {
                method,
                path,
                status: Number.isFinite(status) ? status : null,
            },
        });
        if (out.length >= limit) break;
    }
    return out;
}

export function buildInternalEvents(entries, limit = 50) {
    const rows = Array.isArray(entries) ? entries.slice().reverse() : [];
    const out = [];
    for (const entry of rows) {
        const timestamp = Number(entry?.t ?? entry?.timestamp) || 0;
        const type = clip(entry?.type || entry?.event || 'event', 80);
        const detail = { ...entry };
        delete detail.t;
        delete detail.timestamp;
        let safeDetail;
        try {
            safeDetail = JSON.parse(JSON.stringify(detail));
        } catch {
            safeDetail = { note: 'detail could not be serialized' };
        }
        out.push({
            key: `evt:${timestamp}:${type}:${JSON.stringify(safeDetail).length}`,
            kind: 'event',
            occurred_at_ms: timestamp || Date.now(),
            caller: 'event',
            model: null,
            status: null,
            duration_ms: null,
            input_tokens: null,
            output_tokens: null,
            payload: {
                type,
                detail: safeDetail,            },
        });
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * Build one deduplicated upload batch. Prompts are never included.
 * @param {{calls?: unknown[], verdicts?: unknown[], network?: unknown[], events?: unknown[], limit?: number}} input
 */
export function buildTelemetryBatch(input) {
    const limit = Number(input?.limit) || DEFAULT_LIMIT;
    const events = [
        ...buildAiCallEvents(input?.calls, limit),
        ...buildRequestEvents(input?.verdicts, limit),
        ...buildNetworkEvents(input?.network, limit),
        ...buildInternalEvents(input?.events, Math.min(limit, 50)),
    ];
    const seen = new Set();
    const deduped = events.filter(event => {
        if (!event.key || seen.has(event.key)) return false;
        seen.add(event.key);
        return true;
    });
    return { events: deduped };
}
