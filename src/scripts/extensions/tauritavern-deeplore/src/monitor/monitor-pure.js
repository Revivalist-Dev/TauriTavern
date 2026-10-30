/**
 * DeepLore Monitor — pure formatting and aggregation helpers.
 *
 * The monitor reads the diagnostics ring buffers (AI calls, prompts, network,
 * events, flight recorder) and the verdict ring. Nothing here touches the DOM,
 * so these helpers are safe to unit-test in Node.
 */

/** Escape a value for interpolation into HTML text or an attribute. */
export function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Clock time from an epoch-ms timestamp. */
export function formatClock(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return '—';
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour12: false });
}

/** Compact duration: 123 ms, 1.2 s, 1.1 min. */
export function formatDuration(milliseconds) {
    if (milliseconds === null || milliseconds === undefined || milliseconds === '') return '—';
    const value = Number(milliseconds);
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 1000) return `${Math.round(value)} ms`;
    if (value < 60000) return `${(value / 1000).toFixed(1)} s`;
    return `${(value / 60000).toFixed(1)} min`;
}

/** Thousands-separated integer. */
export function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return Math.round(number).toLocaleString();
}

/** Compact token count: 950, 1.2k, 15.4k. */
export function formatTokens(value) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    if (Math.abs(number) < 1000) return String(Math.round(number));
    if (Math.abs(number) < 1000000) return `${(number / 1000).toFixed(1)}k`;
    return `${(number / 1000000).toFixed(2)}M`;
}

/** 95th percentile of a numeric list (0 for an empty list). */
export function percentile95(values) {
    const numbers = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (numbers.length === 0) return 0;
    return numbers[Math.min(numbers.length - 1, Math.floor(numbers.length * 0.95))];
}

/** Trim a URL to its path and query for table display. */
export function shortUrl(value, maxLength = 92) {
    const raw = String(value ?? '');
    let display = raw;
    try {
        const parsed = new URL(raw, 'http://localhost');
        display = `${parsed.pathname}${parsed.search}`;
    } catch {
        display = raw;
    }
    if (display.length <= maxLength) return display;
    return `${display.slice(0, Math.max(0, maxLength - 1))}…`;
}

/**
 * Classify a network entry URL.
 * - vault: the gateway `/vault` API
 * - ai: a provider/backend completion endpoint
 * - host: everything else (SillyTavern's own traffic)
 */
export function classifyNetwork(url) {
    const value = String(url ?? '');
    if (/\/vault(?:\/|$|\?)/.test(value)) return 'vault';
    if (/(?:\/api\/backends|\/v1\/|chat\/completions|\/generate|\/completions)/i.test(value)) {
        return 'ai';
    }
    return 'host';
}

/** Newest-first network entries for the selected filter. */
export function filterNetwork(entries, filter = 'vault', limit = 250) {
    const rows = Array.isArray(entries) ? entries.slice().reverse() : [];
    return rows
        .filter(entry => {
            if (filter === 'all') return true;
            return classifyNetwork(entry?.url) === filter;
        })
        .slice(0, limit);
}

/** Aggregate AI call usage. Tolerates old entries without token fields. */
export function summarizeCalls(calls) {
    const rows = Array.isArray(calls) ? calls : [];
    const durations = [];
    let ok = 0;
    let failed = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    const byCaller = new Map();

    for (const call of rows) {
        const caller = String(call?.caller || 'unknown');
        const duration = Number(call?.durationMs);
        if (Number.isFinite(duration)) durations.push(duration);
        if (call?.status === 'ok') ok += 1;
        else failed += 1;
        if (Number.isFinite(Number(call?.inputTokens))) inputTokens += Number(call.inputTokens);
        if (Number.isFinite(Number(call?.outputTokens))) outputTokens += Number(call.outputTokens);
        const bucket = byCaller.get(caller) || { caller, count: 0, failed: 0, durationMs: 0 };
        bucket.count += 1;
        if (call?.status !== 'ok') bucket.failed += 1;
        if (Number.isFinite(duration)) bucket.durationMs += duration;
        byCaller.set(caller, bucket);
    }

    const average = durations.length
        ? durations.reduce((sum, value) => sum + value, 0) / durations.length
        : 0;

    return {
        total: rows.length,
        ok,
        failed,
        inputTokens,
        outputTokens,
        averageMs: average,
        p95Ms: percentile95(durations),
        byCaller: [...byCaller.values()].sort((left, right) => right.count - left.count),
    };
}

/** Normalize a verdict into the per-request summary the Requests tab shows. */
export function summarizeVerdict(verdict) {
    const sources = Array.isArray(verdict?.injectedSources) ? verdict.injectedSources : [];
    const tokens = sources.reduce((sum, source) => sum + (Number(source?.tokens) || 0), 0);
    const states = new Map();
    for (const row of Array.isArray(verdict?.perEntry) ? verdict.perEntry : []) {
        const state = String(row?.finalState || 'unknown');
        states.set(state, (states.get(state) || 0) + 1);
    }
    return {
        timestamp: Number(verdict?.ts) || 0,
        messageIndex: verdict?.msgIdx ?? null,
        chatId: String(verdict?.chatId || ''),
        generationId: verdict?.genId ?? null,
        entries: sources.length,
        tokens,
        states: [...states.entries()]
            .map(([state, count]) => ({ state, count }))
            .sort((left, right) => right.count - left.count),
    };
}

/** Human label for a flight-recorder generation entry. */
export function summarizeGeneration(entry) {
    return {
        timestamp: Number(entry?.t) || 0,
        generationId: entry?.genId ?? null,
        generationCount: entry?.generationCount ?? null,
        chatEpoch: entry?.chatEpoch ?? null,
        aiCircuitOpen: Boolean(entry?.aiCircuitOpen),
        vaultDegraded: Boolean(entry?.vaultDegraded),
    };
}
