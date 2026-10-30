/**
 * DeepLore Enhanced - dedicated monitor tab.
 *
 * Mounts a top-rail button and a wide panel into TauriTavern's settings rail.
 * The panel reads the existing diagnostics ring buffers without clearing them,
 * so it can coexist with the drawer's injection view and the debug export.
 */

import {
    aiCallBuffer, aiPromptBuffer, eventBuffer, networkBuffer,
} from '../diagnostics/interceptors.js';
import { generationBuffer } from '../diagnostics/flight-recorder.js';
import { getRecentVerdicts } from '../verdict/verdict-store.js';
import {
    classifyNetwork, esc, filterNetwork, formatClock, formatDuration, formatNumber,
    formatTokens, shortUrl, summarizeCalls, summarizeGeneration, summarizeVerdict,
} from './monitor-pure.js';

const PANEL_ID = 'dle-monitor-panel';
const REFRESH_MS = 1500;
const MAX_ROWS = 250;
const STYLE_VERSION = '2.8.2';

const state = {
    open: false,
    paused: false,
    tab: 'overview',
    timer: null,
    networkFilter: 'vault',
    callFilter: 'all',
    expanded: new Set(),
};

const TAB_LABELS = [
    ['overview', 'Overview'],
    ['calls', 'AI Calls'],
    ['requests', 'Requests'],
    ['network', 'Network'],
    ['events', 'Events'],
    ['prompts', 'Prompts'],
];

function buttonHtml() {
    return `
        <div id="dle-monitor-button" class="drawer dle-monitor-button" title="DeepLore Monitor">
            <div class="drawer-toggle drawer-header" id="dle-monitor-toggle" role="button" tabindex="0"
                 aria-label="Open DeepLore Monitor" aria-controls="${PANEL_ID}" aria-expanded="false">
                <div class="drawer-icon dle-monitor-icon closedIcon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
                        <path d="M2 12h4l2.5-7 4 14 3-10 2 3h4.5" />
                    </svg>
                </div>
            </div>
        </div>`;
}

function panelHtml() {
    return `
        <div id="${PANEL_ID}" class="dle-monitor-panel" role="dialog" aria-modal="false"
             aria-label="DeepLore Monitor" aria-hidden="true">
            <header class="dle-mon-head">
                <div class="dle-mon-title">
                    <span class="dle-monitor-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
                            <path d="M2 12h4l2.5-7 4 14 3-10 2 3h4.5" />
                        </svg>
                    </span>
                    <span>DeepLore Monitor</span>
                    <span id="dle-mon-status" class="dle-mon-status">Live</span>
                </div>
                <div class="dle-mon-actions">
                    <button type="button" class="dle-mon-btn" id="dle-mon-pause">Pause</button>
                    <button type="button" class="dle-mon-btn" id="dle-mon-refresh">Refresh</button>
                    <button type="button" class="dle-mon-btn" id="dle-mon-export">Export</button>
                    <button type="button" class="dle-mon-btn dle-mon-danger" id="dle-mon-clear">Clear</button>
                    <button type="button" class="dle-mon-btn dle-mon-close" id="dle-mon-close"
                            aria-label="Close DeepLore Monitor">×</button>
                </div>
            </header>
            <nav class="dle-mon-tabs" role="tablist" aria-label="DeepLore Monitor sections">
                ${TAB_LABELS.map(([id, label]) => `<button type="button" class="dle-mon-tab" role="tab"
                    data-mon-tab="${id}" aria-selected="${id === state.tab}">${label}</button>`).join('')}
            </nav>
            <div class="dle-mon-body" id="dle-mon-body"></div>
            <footer class="dle-mon-foot">
                <span>Prompt capture requires Debug Mode. Verdict history is kept per chat.</span>
                <span id="dle-mon-counts"></span>
            </footer>
        </div>`;
}

function isOpen() {
    return state.open;
}

function setStatus() {
    const status = document.getElementById('dle-mon-status');
    if (!status) return;
    status.textContent = state.paused ? 'Paused' : 'Live';
    status.classList.toggle('dle-mon-status-paused', state.paused);
}

function updateTabButtons() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    for (const button of panel.querySelectorAll('[data-mon-tab]')) {
        const active = button.dataset.monTab === state.tab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
    }
}

function startTimer() {
    stopTimer();
    if (!state.open || state.paused) return;
    state.timer = window.setInterval(() => render(), REFRESH_MS);
}

function stopTimer() {
    if (state.timer) {
        window.clearInterval(state.timer);
        state.timer = null;
    }
}

function openPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    state.open = true;
    panel.classList.add('dle-monitor-open');
    panel.setAttribute('aria-hidden', 'false');
    document.getElementById('dle-monitor-toggle')?.setAttribute('aria-expanded', 'true');
    document.getElementById('dle-monitor-button')?.classList.add('dle-monitor-active');
    render();
    startTimer();
}

function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    state.open = false;
    panel.classList.remove('dle-monitor-open');
    panel.setAttribute('aria-hidden', 'true');
    document.getElementById('dle-monitor-toggle')?.setAttribute('aria-expanded', 'false');
    document.getElementById('dle-monitor-button')?.classList.remove('dle-monitor-active');
    stopTimer();
}

function detailsRow(key, summary, detail) {
    const open = state.expanded.has(key) ? ' open' : '';
    return `<details class="dle-mon-details" data-mon-key="${esc(key)}"${open}>
        <summary>${summary}</summary>
        <div class="dle-mon-detail">${detail}</div>
    </details>`;
}

function statusPill(status) {
    const value = String(status || 'error');
    const ok = value === 'ok';
    return `<span class="dle-mon-pill ${ok ? 'dle-mon-ok' : 'dle-mon-bad'}">${esc(value)}</span>`;
}

function empty(message) {
    return `<div class="dle-mon-empty">${esc(message)}</div>`;
}

function jsonBlock(value) {
    let text;
    try {
        text = JSON.stringify(value, null, 2);
    } catch {
        text = String(value);
    }
    if (text.length > 4000) text = `${text.slice(0, 4000)}…`;
    return `<pre class="dle-mon-pre">${esc(text)}</pre>`;
}

function callsTable(calls, limit = MAX_ROWS) {
    if (!calls.length) return empty('No AI calls recorded yet.');
    const rows = calls.slice(0, limit).map((call, index) => {
        const key = `call:${call.timestamp || call.t || index}:${call.caller || ''}`;
        const summary = `
            <span>${esc(formatClock(call.timestamp || call.t))}</span>
            <span class="dle-mon-strong">${esc(call.caller || 'unknown')}</span>
            <span>${esc(call.model || call.mode || '—')}</span>
            <span>${statusPill(call.status)}</span>
            <span>${esc(formatDuration(call.durationMs))}</span>
            <span>${esc(formatTokens(call.inputTokens))} / ${esc(formatTokens(call.outputTokens))}</span>`;
        const detail = `
            <div class="dle-mon-kv">
                <span>Mode</span><span>${esc(call.mode || '—')}</span>
                <span>Model</span><span>${esc(call.model || '—')}</span>
                <span>Timeout</span><span>${esc(formatDuration(call.timeoutMs))}</span>
                <span>Abort</span><span>${esc(call.abortReason || '—')}</span>
            </div>
            ${call.error ? `<div class="dle-mon-error">${esc(call.error)}</div>` : ''}`;
        return detailsRow(key, summary, detail);
    }).join('');
    return `<div class="dle-mon-table dle-mon-calls">
        <div class="dle-mon-thead"><span>Time</span><span>Caller</span><span>Model</span><span>Status</span><span>Duration</span><span>In / out tokens</span></div>
        ${rows}
    </div>`;
}

function requestEntryTable(sources) {
    if (!sources.length) return empty('No entries were injected.');
    const rows = sources.map(source => `<tr>
        <td>${esc(source.title || source.filename || '—')}</td>
        <td>${esc(source.vaultSource || '—')}</td>
        <td class="dle-mon-num">${esc(formatTokens(source.tokens))}</td>
        <td>${esc(source.matchedBy || '—')}</td>
    </tr>`).join('');
    return `<table class="dle-mon-mini"><thead><tr><th>Entry</th><th>Vault</th><th>Tokens</th><th>Match</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function requestsView(verdicts) {
    if (!verdicts.length) return empty('No request verdicts recorded yet.');
    return verdicts.map((verdict, index) => {
        const summary = summarizeVerdict(verdict);
        const key = `req:${summary.timestamp}:${summary.messageIndex}:${index}`;
        const states = summary.states.length
            ? summary.states.map(state => `<span class="dle-mon-chip">${esc(state.state)} ${state.count}</span>`).join('')
            : '<span class="dle-mon-muted">no per-entry states</span>';
        const head = `
            <span>${esc(formatClock(summary.timestamp))}</span>
            <span>#${esc(summary.messageIndex ?? '—')}</span>
            <span>${summary.entries} entries</span>
            <span>${esc(formatTokens(summary.tokens))} tokens</span>
            <span class="dle-mon-muted">${esc(summary.chatId || '—')}</span>`;
        const detail = `
            <div class="dle-mon-chips">${states}</div>
            ${requestEntryTable(Array.isArray(verdict.injectedSources) ? verdict.injectedSources : [])}
            <div class="dle-mon-muted dle-mon-small">gen ${esc(summary.generationId ?? '—')}</div>`;
        return detailsRow(key, head, detail);
    }).join('');
}

function networkView(entries) {
    const filtered = filterNetwork(entries, state.networkFilter);
    if (!filtered.length) {
        return empty(state.networkFilter === 'vault'
            ? 'No vault API calls recorded yet.'
            : 'No matching network calls recorded yet.');
    }
    const rows = filtered.map((entry, index) => {
        const key = `net:${entry.timestamp || entry.t || index}:${entry.url || ''}`;
        const status = entry.status ?? '—';
        const summary = `
            <span>${esc(formatClock(entry.timestamp || entry.t))}</span>
            <span>${esc(entry.method || 'GET')}</span>
            <span class="${Number(status) >= 400 ? 'dle-mon-bad-text' : ''}">${esc(status)}</span>
            <span>${esc(formatDuration(entry.durationMs ?? entry.durMs))}</span>
            <span class="dle-mon-url">${esc(shortUrl(entry.url))}</span>`;
        const detail = `
            <div class="dle-mon-kv">
                <span>URL</span><span class="dle-mon-break">${esc(entry.url || '—')}</span>
                <span>Kind</span><span>${esc(classifyNetwork(entry.url))}</span>
                <span>Duration</span><span>${esc(formatDuration(entry.durationMs ?? entry.durMs))}</span>
            </div>
            ${entry.error ? `<div class="dle-mon-error">${esc(entry.error)}</div>` : ''}
            ${entry.errorBody ? `<pre class="dle-mon-pre">${esc(String(entry.errorBody).slice(0, 4000))}</pre>` : ''}`;
        return detailsRow(key, summary, detail);
    }).join('');
    return `<div class="dle-mon-filter">
            <label>Traffic
                <select id="dle-mon-network-filter">
                    <option value="vault"${state.networkFilter === 'vault' ? ' selected' : ''}>Vault API</option>
                    <option value="ai"${state.networkFilter === 'ai' ? ' selected' : ''}>AI endpoints</option>
                    <option value="all"${state.networkFilter === 'all' ? ' selected' : ''}>All network</option>
                </select>
            </label>
        </div>
        <div class="dle-mon-table dle-mon-network">
            <div class="dle-mon-thead"><span>Time</span><span>Method</span><span>Status</span><span>Duration</span><span>URL</span></div>
            ${rows}
        </div>`;
}

function eventsView(events) {
    if (!events.length) return empty('No internal events recorded yet.');
    return events.map((event, index) => {
        const timestamp = event.timestamp || event.t || 0;
        const type = event.type || event.event || 'event';
        const key = `evt:${timestamp}:${type}:${index}`;
        const summary = `
            <span>${esc(formatClock(timestamp))}</span>
            <span class="dle-mon-strong">${esc(type)}</span>
            <span class="dle-mon-muted">${esc(shortUrl(JSON.stringify(event), 120))}</span>`;
        return detailsRow(key, summary, jsonBlock(event));
    }).join('');
}

function promptsView(prompts) {
    if (!prompts.length) {
        return empty('No prompt captures. Enable Debug Mode before generating to record prompts.');
    }
    return prompts.map((entry, index) => {
        const timestamp = entry.timestamp || entry.t || 0;
        const key = `pr:${timestamp}:${entry.caller || index}`;
        const summary = `
            <span>${esc(formatClock(timestamp))}</span>
            <span class="dle-mon-strong">${esc(entry.caller || 'unknown')}</span>
            <span>${esc(formatTokens(entry.promptTokens ?? entry.inputTokens))} tokens</span>`;
        const sections = [];
        if (entry.systemPrompt) sections.push(`<h5>System</h5><pre class="dle-mon-pre">${esc(entry.systemPrompt.slice(0, 8000))}</pre>`);
        if (entry.userMessage) sections.push(`<h5>User</h5><pre class="dle-mon-pre">${esc(entry.userMessage.slice(0, 8000))}</pre>`);
        if (entry.prompt) sections.push(`<h5>Prompt</h5><pre class="dle-mon-pre">${esc(entry.prompt.slice(0, 8000))}</pre>`);
        if (entry.response) sections.push(`<h5>Response</h5><pre class="dle-mon-pre">${esc(entry.response.slice(0, 8000))}</pre>`);
        if (!sections.length) sections.push(jsonBlock(entry));
        return detailsRow(key, summary, sections.join(''));
    }).join('');
}

function overviewView(calls, network, verdicts, generations) {
    const callSummary = summarizeCalls(calls);
    const vaultCalls = filterNetwork(network, 'vault');
    const lastVerdict = verdicts[0] ? summarizeVerdict(verdicts[0]) : null;
    const lastGeneration = generations[0] ? summarizeGeneration(generations[0]) : null;
    const cards = `
        <div class="dle-mon-cards">
            <div class="dle-mon-card"><span>AI calls</span><strong>${formatNumber(callSummary.total)}</strong>
                <small>${formatNumber(callSummary.ok)} ok · ${formatNumber(callSummary.failed)} failed</small></div>
            <div class="dle-mon-card"><span>Tokens in / out</span>
                <strong>${formatTokens(callSummary.inputTokens)} / ${formatTokens(callSummary.outputTokens)}</strong>
                <small>across the current buffer</small></div>
            <div class="dle-mon-card"><span>Latency</span><strong>${formatDuration(callSummary.averageMs)}</strong>
                <small>avg · p95 ${formatDuration(callSummary.p95Ms)}</small></div>
            <div class="dle-mon-card"><span>Vault calls</span><strong>${formatNumber(vaultCalls.length)}</strong>
                <small>gateway requests in buffer</small></div>
            <div class="dle-mon-card"><span>Last request</span>
                <strong>${lastVerdict ? `${lastVerdict.entries} entries` : '—'}</strong>
                <small>${lastVerdict ? `${formatTokens(lastVerdict.tokens)} tokens · msg #${lastVerdict.messageIndex ?? '—'}` : 'no verdict yet'}</small></div>
        </div>`;

    const lastRequest = lastVerdict ? `
        <div class="dle-mon-section">
            <h4>What the last request used</h4>
            <div class="dle-mon-kv">
                <span>Message</span><span>#${esc(lastVerdict.messageIndex ?? '—')}</span>
                <span>Injected entries</span><span>${formatNumber(lastVerdict.entries)}</span>
                <span>Injected tokens</span><span>${esc(formatTokens(lastVerdict.tokens))}</span>
                <span>Generation</span><span>${esc(lastVerdict.generationId ?? '—')}</span>
                <span>Circuit</span><span>${lastGeneration?.aiCircuitOpen ? 'AI circuit open' : 'closed'}${lastGeneration?.vaultDegraded ? ' · vault degraded' : ''}</span>
            </div>
            ${requestEntryTable(Array.isArray(verdicts[0]?.injectedSources) ? verdicts[0].injectedSources.slice(0, 8) : [])}
        </div>` : empty('No request verdicts recorded yet.');

    const recent = callSummary.total
        ? `<div class="dle-mon-section"><h4>Recent AI calls</h4>${callsTable(calls, 8)}</div>`
        : '';

    return `${cards}${lastRequest}${recent}
        <div class="dle-mon-note">The Requests tab keeps one row per generation. Vault API traffic is the gateway's
        <code>/vault</code> calls; AI endpoint traffic is shown separately so SillyTavern's own requests stay out of the default view.</div>`;
}

function render() {
    if (!state.open) return;
    const body = document.getElementById('dle-mon-body');
    if (!body) return;

    const calls = aiCallBuffer.drain().slice().reverse();
    const network = networkBuffer.drain().slice().reverse();
    const events = eventBuffer.drain().slice().reverse();
    const verdicts = getRecentVerdicts(50);
    const generations = generationBuffer.drain().slice(-100).reverse();
    const prompts = aiPromptBuffer.drain().slice(-50).reverse();

    let html;
    switch (state.tab) {
        case 'calls':
            html = callsTable(calls);
            break;
        case 'requests':
            html = requestsView(verdicts);
            break;
        case 'network':
            html = networkView(network);
            break;
        case 'events':
            html = eventsView(events.slice(0, MAX_ROWS));
            break;
        case 'prompts':
            html = promptsView(prompts);
            break;
        case 'overview':
        default:
            html = overviewView(calls, network, verdicts, generations);
            break;
    }

    const scroll = body.scrollTop;
    body.innerHTML = html;
    body.scrollTop = scroll;
    updateTabButtons();
    setStatus();
    const counts = document.getElementById('dle-mon-counts');
    if (counts) {
        counts.textContent = `${formatNumber(calls.length)} calls · ${formatNumber(network.length)} network · ${formatNumber(verdicts.length)} requests`;
    }
}

function clearBuffers() {
    const ok = window.confirm('Clear DeepLore call, prompt, network, event and generation buffers? Verdict history is kept.');
    if (!ok) return;
    for (const buffer of [aiCallBuffer, aiPromptBuffer, networkBuffer, eventBuffer, generationBuffer]) {
        try {
            buffer?.clear?.();
        } catch {
            /* a buffer may not support clear */
        }
    }
    state.expanded.clear();
    render();
}

function exportReport() {
    const payload = {
        generatedAt: new Date().toISOString(),
        calls: aiCallBuffer.drain(),
        prompts: aiPromptBuffer.drain(),
        network: networkBuffer.drain(),
        events: eventBuffer.drain(),
        generations: generationBuffer.drain(),
        verdicts: getRecentVerdicts(200),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `deeplore-monitor-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

function bindControls(panel) {
    document.getElementById('dle-monitor-toggle')?.addEventListener('click', () => {
        if (state.open) closePanel();
        else openPanel();
    });
    document.getElementById('dle-monitor-toggle')?.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            document.getElementById('dle-monitor-toggle')?.click();
        }
    });
    document.getElementById('dle-mon-close')?.addEventListener('click', closePanel);
    document.getElementById('dle-mon-refresh')?.addEventListener('click', render);
    document.getElementById('dle-mon-export')?.addEventListener('click', exportReport);
    document.getElementById('dle-mon-clear')?.addEventListener('click', clearBuffers);

    document.getElementById('dle-mon-pause')?.addEventListener('click', event => {
        state.paused = !state.paused;
        event.currentTarget.textContent = state.paused ? 'Resume' : 'Pause';
        if (state.paused) stopTimer();
        else startTimer();
        setStatus();
    });

    panel.addEventListener('click', event => {
        const tab = event.target.closest('[data-mon-tab]');
        if (!tab) return;
        state.tab = tab.dataset.monTab;
        render();
    });

    panel.addEventListener('change', event => {
        if (event.target.id !== 'dle-mon-network-filter') return;
        state.networkFilter = event.target.value;
        render();
    });

    panel.addEventListener('toggle', event => {
        const node = event.target;
        if (!(node instanceof HTMLDetailsElement) || !node.dataset.monKey) return;
        if (node.open) state.expanded.add(node.dataset.monKey);
        else state.expanded.delete(node.dataset.monKey);
    }, true);

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && state.open) closePanel();
    });
}

/** Load the monitor stylesheet with a version query so WebView2 does not serve a stale cache. */
function ensureStyles() {
    if (document.getElementById('dle-monitor-style')) return;
    const link = document.createElement('link');
    link.id = 'dle-monitor-style';
    link.rel = 'stylesheet';
    const url = new URL('./monitor.css', import.meta.url);
    url.searchParams.set('v', STYLE_VERSION);
    link.href = url.href;
    document.head.appendChild(link);
}

/** Mount the tab once. Safe to call after every re-init. */
export function initMonitorTab() {
    if (document.getElementById(PANEL_ID)) return;
    const holder = document.getElementById('top-settings-holder');
    if (!holder) {
        console.warn('[DLE monitor] top settings holder not found; monitor tab not mounted');
        return;
    }
    ensureStyles();
    holder.insertAdjacentHTML('beforeend', buttonHtml());
    document.body.insertAdjacentHTML('beforeend', panelHtml());
    const panel = document.getElementById(PANEL_ID);
    if (panel) bindControls(panel);
}

/** Remove the tab and its timer. */
export function destroyMonitorTab() {
    stopTimer();
    state.open = false;
    state.expanded.clear();
    document.getElementById('dle-monitor-button')?.remove();
    document.getElementById(PANEL_ID)?.remove();
}
