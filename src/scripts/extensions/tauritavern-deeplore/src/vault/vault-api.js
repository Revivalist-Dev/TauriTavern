/**
 * DeepLore — vault API client.
 * The extension speaks the zedon-byok gateway's vault API, which serves the configured Markdown
 * roots. CORS is enabled by the gateway; the caller supplies its external API key.
 */

import { pushEvent, abortWith } from '../diagnostics/interceptors.js';
import { updateFrontmatterFields } from '../helpers.js';
import { isNativeVaultAvailable, nativeVaultFetch } from './tauritavern-vault.js';

const DEFAULT_TIMEOUT = 30000;
const VAULT_BATCH_SIZE = 50;

/**
 * Validate an Gateway host is a safe local target before attaching `Bearer ${apiKey}`.
 * zedon-byok vault API is meant for loopback and LAN; a bad host config (or
 * an attacker-controlled vault row) must never cause the API key to be sent to a
 * public endpoint or cloud metadata service.
 *
 * Allowlist: loopback (127.0.0.1, ::1), RFC1918 (10/8, 172.16/12, 192.168/16),
 * link-local (169.254/16, fe80::/10), ULA (fd00::/8), "localhost".
 * Blocks: public IPs, metadata IPs (169.254.169.254), 0.0.0.0, 100.64/10 (CGNAT),
 * numeric/octal shorthand, non-dotted IPv4.
 * @param {string} host
 * @throws {Error} if host is not a safe local target.
 */
export function validateVaultHost(host) {
    if (typeof host !== 'string' || !host.trim()) {
        throw new Error('Gateway host is empty');
    }
    const raw = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
    // Blocked exact hosts (cloud metadata endpoints).
    const blockedExact = new Set([
        '169.254.169.254',          // AWS/Azure/GCP IMDS
        'metadata.google.internal',
        '100.100.100.200',          // Alibaba
        '0.0.0.0',
    ]);
    if (blockedExact.has(raw)) {
        throw new Error(`Gateway host "${host}" is blocked (metadata/zero address).`);
    }
    // Numeric IP shorthand (e.g. "2130706433" for 127.0.0.1) — reject to avoid bypassing pattern checks.
    if (/^\d+$/.test(raw) || /^0x[0-9a-f]+$/i.test(raw)) {
        throw new Error(`Gateway host "${host}" uses a numeric IP shorthand — use dotted notation.`);
    }
    if (/(?:^|\.)0\d+(?:\.|$)/.test(raw)) {
        throw new Error(`Gateway host "${host}" uses octal IP notation — use standard dotted decimal.`);
    }
    // Allow named localhost.
    if (raw === 'localhost' || raw === 'localhost.localdomain') return;
    // Allow IPv6 loopback and private ranges.
    if (raw === '::1') return;
    if (/^fd[0-9a-f]{2}:/.test(raw)) return;        // ULA fd00::/8
    if (/^fe80:/.test(raw)) return;                  // link-local fe80::/10
    if (/^::ffff:127\./.test(raw)) return;           // IPv4-mapped loopback
    // For IPv4: require dotted quad and allowlisted range.
    const v4 = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const [, a, b] = v4.map(Number);
        const octets = v4.slice(1).map(Number);
        if (octets.some(n => n > 255)) {
            throw new Error(`Gateway host "${host}" is not a valid IPv4 address.`);
        }
        // Block CGNAT 100.64.0.0/10 explicitly (shared ISP space — not a local vault).
        if (a === 100 && b >= 64 && b <= 127) {
            throw new Error(`Gateway host "${host}" is in the CGNAT range — not a local vault.`);
        }
        const isLoopback = a === 127;
        const isRFC1918 =
            a === 10 ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168);
        const isLinkLocal = a === 169 && b === 254;
        if (isLoopback || isRFC1918 || isLinkLocal) return;
        throw new Error(`Gateway host "${host}" is a public IP — refusing to send API key off-network.`);
    }
    // Reject everything else (public DNS names, raw IPv6 globals, garbage).
    // Named hosts would require DNS resolution to validate — out of scope client-side.
    throw new Error(`Gateway host "${host}" is not a recognized local address (use 127.0.0.1, localhost, or a LAN IP).`);
}

// Per-vault circuit breaker keyed by "host:port" so multi-vault setups isolate
// failures. Backoffs short — the gateway is local and free.
/** @type {Map<string, {failures: number, maxFailures: number, state: string, openedAt: number, baseBackoff: number, maxBackoff: number}>} */
const circuitBreakers = new Map();

function getCircuitBreaker(key) {
    if (!circuitBreakers.has(key)) {
        circuitBreakers.set(key, {
            failures: 0,
            maxFailures: 3,
            state: 'closed',
            openedAt: 0,
            baseBackoff: 2000,
            maxBackoff: 15000,
            halfOpenProbe: false, // exactly one request passes in half-open
        });
    }
    return circuitBreakers.get(key);
}

/**
 * Get the current circuit breaker state (for UI display).
 * @param {string|number} [port] - Vault key (host:port string or legacy port number). If omitted, returns aggregate worst state.
 * @returns {{ state: string, failures: number, backoffRemaining: number }}
 */
export function getCircuitState(port) {
    if (port !== undefined) {
        return _getCircuitStateForBreaker(getCircuitBreaker(port));
    }
    // Aggregate: return worst state across all vaults
    let worst = { state: 'closed', failures: 0, backoffRemaining: 0 };
    for (const cb of circuitBreakers.values()) {
        const s = _getCircuitStateForBreaker(cb);
        if (s.state === 'open' || (s.state === 'half-open' && worst.state === 'closed')) {
            worst = s;
        }
    }
    return worst;
}

/**
 * BUG-045: Prune stale circuit breaker entries for hosts no longer in active vault config.
 * Call this from settings-ui when vault configuration changes.
 * @param {Set<string>} activeKeys - Set of active "host:port" keys
 */
export function pruneCircuitBreakers(activeKeys) {
    for (const key of circuitBreakers.keys()) {
        if (!activeKeys.has(key)) circuitBreakers.delete(key);
    }
}

/**
 * Get per-vault circuit breaker states for diagnostics.
 * @returns {Object<string, {state: string, failures: number, backoffRemaining: number}>}
 */
export function getAllCircuitStates() {
    const out = {};
    for (const [key, cb] of circuitBreakers.entries()) {
        out[key] = _getCircuitStateForBreaker(cb);
    }
    return out;
}

function _getCircuitStateForBreaker(cb) {
    if (cb.state === 'open') {
        const elapsed = Date.now() - cb.openedAt;
        const backoff = Math.min(
            cb.baseBackoff * Math.pow(2, Math.min(cb.failures - cb.maxFailures, 3)),
            cb.maxBackoff,
        );
        const remaining = Math.max(0, backoff - elapsed);
        const effectiveState = remaining === 0 ? 'half-open' : 'open';
        return { state: effectiveState, failures: cb.failures, backoffRemaining: remaining };
    }
    return { state: cb.state, failures: cb.failures, backoffRemaining: 0 };
}

function recordSuccess(port) {
    const cb = getCircuitBreaker(port);
    const wasOpen = cb.state !== 'closed';
    cb.failures = 0;
    cb.state = 'closed';
    cb.halfOpenProbe = false;
    if (wasOpen) pushEvent('vault_circuit', { port, from: 'open', to: 'closed' });
}

function recordFailure(port) {
    const cb = getCircuitBreaker(port);
    const wasClosed = cb.state === 'closed';
    cb.failures++;
    cb.halfOpenProbe = false;
    if (cb.failures >= cb.maxFailures) {
        // Reset openedAt on every transition to open so exponential backoff
        // recalculates from this failure, not the original one.
        cb.openedAt = Date.now();
        cb.state = 'open';
        if (wasClosed) pushEvent('vault_circuit', { port, from: 'closed', to: 'open', failures: cb.failures });
    }
}

function circuitAllows(port) {
    const cb = getCircuitBreaker(port);
    if (cb.state === 'closed') return true;
    if (cb.state === 'half-open') {
        return !cb.halfOpenProbe ? (cb.halfOpenProbe = true, true) : false;
    }
    const elapsed = Date.now() - cb.openedAt;
    const backoff = Math.min(
        cb.baseBackoff * Math.pow(2, Math.min(cb.failures - cb.maxFailures, 3)),
        cb.maxBackoff,
    );
    if (elapsed >= backoff) {
        cb.state = 'half-open';
        cb.halfOpenProbe = true;
        return true;
    }
    return false;
}

/**
 * Encode a vault path for use in the gateway vault URL.
 * Encodes each path segment individually to preserve slashes.
 * @param {string} vaultPath - Path like "LA World/Characters/Alice.md"
 * @returns {string} URL-encoded path like "LA%20World/Characters/Alice.md"
 */
export function encodeVaultPath(vaultPath) {
    return vaultPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/**
 * Validate a vault path to prevent directory traversal.
 * @param {string} filename
 * @returns {string} Normalized filename
 * @throws {Error} If path traversal is detected
 */
export function validateVaultPath(filename) {
    const normalized = filename.replace(/\\/g, '/');
    const segments = normalized.split('/');
    if (normalized.startsWith('/') || segments.some(s => s === '..' || s === '.')) {
        throw new Error('Invalid filename: path traversal not allowed');
    }
    return normalized;
}

/**
 * Make an HTTP/HTTPS request to the zedon-byok vault API.
 * @param {object} options
 * @param {string} [options.host='127.0.0.1'] - Gateway host (IP or hostname)
 * @param {number} options.port - gateway vault port
 * @param {string} options.apiKey - Bearer token
 * @param {string} options.path - API path (e.g. /vault/)
 * @param {boolean} [options.https=false] - Use HTTPS (requires trusted certificate)
 * @param {string} [options.method='GET'] - HTTP method
 * @param {string} [options.accept='application/json'] - Accept header
 * @param {string|null} [options.body=null] - Request body
 * @param {string|null} [options.contentType=null] - Content-Type header
 * @param {number} [options.timeout=30000] - Timeout in ms
 * @returns {Promise<{status: number, data: string}>}
 */
export async function vaultFetch({ host = '127.0.0.1', port, apiKey, path, https: useHttps = false, method = 'GET', accept = 'application/json', body = null, contentType = null, timeout = DEFAULT_TIMEOUT, signal = null, headers: extraHeaders = null }) {
    if (isNativeVaultAvailable()) {
        return nativeVaultFetch({ path, method, body, headers: extraHeaders });
    }
    // Validate host BEFORE building headers — ensures `Bearer ${apiKey}` only ever
    // goes to loopback/LAN. Throws synchronously on public/shorthand/metadata.
    validateVaultHost(host || '127.0.0.1');
    const circuitKey = `${host}:${port}`;
    if (!circuitAllows(circuitKey)) {
        const cs = getCircuitState(circuitKey);
        throw new Error(`Vault gateway paused after ${cs.failures} failures — retrying in ${Math.ceil(cs.backoffRemaining / 1000)}s. Check that the zedon-byok gateway is running.`);
    }

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': accept,
    };
    if (body !== null && contentType) {
        headers['Content-Type'] = contentType;
    }
    if (extraHeaders) {
        Object.assign(headers, extraHeaders);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => abortWith(controller, 'vault:timeout'), timeout);
    // BUG-256: wire caller-supplied signal so sync/scan/import are cancellable.
    let onExternalAbort = null;
    if (signal) {
        if (signal.aborted) {
            clearTimeout(timer);
            const err = new Error('Request aborted');
            err.name = 'AbortError';
            err.userAborted = true;
            throw err;
        }
        onExternalAbort = () => abortWith(controller, signal.reason?.message || 'vault:external_signal');
        signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const _startMs = Date.now();
    try {
        const protocol = useHttps ? 'https' : 'http';
        const response = await fetch(`${protocol}://${host || '127.0.0.1'}:${port}${path}`, {
            method,
            headers,
            body: body ?? undefined,
            signal: controller.signal,
            redirect: 'error',
        });
        const data = await response.text();
        const _durMs = Date.now() - _startMs;
        // BUG-H5: 5xx and 429 trip the breaker (transient). 401/403/404 don't —
        // those are persistent config issues that retries can't fix.
        if (response.status >= 500 || response.status === 429) {
            recordFailure(circuitKey);
            const cs = getCircuitState(circuitKey);
            pushEvent('vault_fetch', { result: 'http_err', status: response.status, durationMs: _durMs, circuit: cs.state, failures: cs.failures, vault: circuitKey });
            console.warn('[DLE] vaultFetch: HTTP %d after %dms — circuit=%s failures=%d vault=%s', response.status, _durMs, cs.state, cs.failures, circuitKey);
        } else if (response.status >= 200 && response.status < 300) {
            recordSuccess(circuitKey);
        }
        return { status: response.status, data, headers: response.headers };
    } catch (err) {
        const _durMs = Date.now() - _startMs;
        if (err.name === 'AbortError') {
            // Aborts (timeout / teardown / user cancel) are not circuit failures.
            // BUG-256: external signal fired → user abort; otherwise it's our timeout.
            if (signal?.aborted) {
                pushEvent('vault_fetch', { result: 'user_abort', durationMs: _durMs, vault: circuitKey });
                const abortErr = new Error('Request aborted by user');
                abortErr.name = 'AbortError';
                abortErr.userAborted = true;
                throw abortErr;
            }
            pushEvent('vault_fetch', { result: 'timeout', durationMs: _durMs, timeoutMs: timeout, vault: circuitKey });
            console.warn('[DLE] vaultFetch: timeout after %dms (limit %dms) vault=%s', _durMs, timeout, circuitKey);
            const timeoutErr = new Error('Request timed out', { cause: err });
            timeoutErr.name = 'AbortError';
            timeoutErr.timedOut = true;
            throw timeoutErr;
        }
        recordFailure(circuitKey);
        const cs = getCircuitState(circuitKey);
        pushEvent('vault_fetch', { result: 'error', durationMs: _durMs, circuit: cs.state, failures: cs.failures, vault: circuitKey, errName: err.name, errMsg: (err.message || '').slice(0, 160) });
        console.warn('[DLE] vaultFetch: %s after %dms — circuit=%s failures=%d vault=%s msg=%s', err.name || 'Error', _durMs, cs.state, cs.failures, circuitKey, (err.message || '').slice(0, 160));
        throw err;
    } finally {
        clearTimeout(timer);
        // BUG-256/248: detach to prevent leaks on long-lived signals.
        if (signal && onExternalAbort) signal.removeEventListener('abort', onExternalAbort);
    }
}

/**
 * Recursively list all file paths from the vault directory listing.
 * @param {number} port
 * @param {string} apiKey
 * @param {string} [directory=''] - Directory path ('' for root)
 * @param {number} [depth=0] - Current recursion depth
 * @returns {Promise<string[]>} Array of full file paths
 */
export async function listAllFiles(host, port, apiKey, directory = '', depth = 0, useHttps = false) {
    if (depth >= 20) {
        throw new Error(`Directory nesting too deep at "${directory}"`);
    }
    const urlPath = directory ? `/vault/${encodeVaultPath(directory)}/` : '/vault/';
    const res = await vaultFetch({ host, port, apiKey, https: useHttps, path: urlPath });

    if (res.status !== 200) {
        throw new Error(`Failed to list files at "${directory}": HTTP ${res.status}`);
    }

    let listing;
    try {
        listing = JSON.parse(res.data);
    } catch (e) {
        throw new Error(`Failed to parse directory listing for "${directory || '/'}": ${e.message}`);
    }

    // The gateway follows the Obsidian listing contract: each entry is named
    // relative to the requested directory. Older builds returned paths relative
    // to the vault root; `relativeEntry` tolerates that shape without breaking
    // a legitimate directory whose name happens to contain no slash.
    const files = (Array.isArray(listing.files) ? listing.files : []).filter(f => typeof f === 'string');
    const directories = (Array.isArray(listing.directories) ? listing.directories : []).filter(
        d => typeof d === 'string',
    );
    const allFiles = [];
    const prefix = directory ? directory + '/' : '';
    const dirs = [];

    for (const entry of [...files, ...directories]) {
        const isDirectory = entry.endsWith('/') || directories.includes(entry);
        const name = relativeEntry(entry.replace(/\/+$/, ''), prefix);
        if (!name) continue;
        if (isDirectory) {
            dirs.push(prefix + name);
        } else {
            allFiles.push(prefix + name);
        }
    }

    // BUG-366: track partial failures so callers can avoid committing a truncated
    // index over the top of a previously-good one.
    let partial = false;
    if (dirs.length > 0) {
        const DIR_BATCH = 10;
        for (let i = 0; i < dirs.length; i += DIR_BATCH) {
            const batch = dirs.slice(i, i + DIR_BATCH);
            const dirResults = await Promise.allSettled(
                batch.map(fullDirPath => listAllFiles(host, port, apiKey, fullDirPath, depth + 1, useHttps)),
            );
            for (const result of dirResults) {
                if (result.status === 'fulfilled') {
                    allFiles.push(...result.value.files);
                    if (result.value.partial) partial = true;
                } else {
                    partial = true;
                    console.warn(`[DLE] Failed to list directory: ${result.reason?.message || result.reason}`);
                }
            }
        }
    }

    return { files: allFiles, partial };
}

/**
 * Test the connection to the zedon-byok vault API.
 * @param {number} port
 * @param {string} apiKey
 * @returns {Promise<{ok: boolean, authenticated?: boolean, versions?: object, error?: string}>}
 */
/**
 * Recursively list directories under a vault base folder. Used by the folder picker.
 * The gateway filters `.vaultignore` paths, so ignored directories never appear.
 * @returns {Promise<string[]>} Vault-relative directory paths, sorted.
 */
export async function listVaultDirectories(host, port, apiKey, useHttps = false, base = '', limit = 1500) {
    const root = normalizeVaultFolder(base);
    const directories = [];
    const seen = new Set();
    let partial = false;
    const queue = [root];
    while (queue.length && directories.length < limit) {
        const current = queue.shift();
        const urlPath = current ? `/vault/${encodeVaultPath(current)}/` : '/vault/';
        let res;
        try {
            res = await vaultFetch({ host, port, apiKey, https: useHttps, path: urlPath });
        } catch {
            partial = true;
            continue;
        }
        if (res.status !== 200) {
            partial = true;
            continue;
        }
        let listing;
        try {
            listing = JSON.parse(res.data);
        } catch {
            partial = true;
            continue;
        }
        const entries = Array.isArray(listing.directories) ? listing.directories : [];
        for (const entry of entries) {
            if (typeof entry !== 'string') continue;
            const name = relativeEntry(entry.replace(/\/+$/, ''), current ? `${current}/` : '');
            if (!name) continue;
            const full = current ? `${current}/${name}` : name;
            if (!seen.has(full)) {
                seen.add(full);
                directories.push(full);
                queue.push(full);
            }
            if (directories.length >= limit) break;
        }
    }
    return {
        directories: directories.sort((left, right) => left.localeCompare(right)),
        partial,
    };
}

export async function testConnection(host, port, apiKey, useHttps = false) {
    try {
        // Force-reset breaker for explicit user-initiated test.
        const circuitKey = `${host || '127.0.0.1'}:${port}`;
        const cb = getCircuitBreaker(circuitKey);
        cb.state = 'closed';
        cb.failures = 0;
        cb.halfOpenProbe = false;
        const result = await vaultFetch({ host, port, apiKey: apiKey || '', https: useHttps, path: '/vault/', timeout: 10000 });
        if (result.status === 200) {
            return { ok: true, authenticated: true };
        }
        if (result.status === 401 || result.status === 403) {
            return { ok: false, error: `Authentication failed (HTTP ${result.status}). Check your API key.` };
        }
        return { ok: false, error: `HTTP ${result.status}` };
    } catch (err) {
        const isFetchFail = err instanceof TypeError || err.message?.includes('Failed to fetch');
        // Self-signed cert errors surface as TypeError / "Failed to fetch".
        if (useHttps && isFetchFail) {
            const probe = await diagnoseFetchFailure(host, port, apiKey);
            const certUrl = `https://${host || '127.0.0.1'}:${port}`;
            return {
                ok: false,
                diagnosis: probe.diagnosis,
                httpWorked: probe.httpWorked,
                httpPort: probe.httpPort,
                certError: probe.diagnosis === 'cert', // backward compat
                certUrl,
                error: probe.diagnosis === 'cert'
                    ? `HTTPS certificate not trusted. HTTP works on port ${probe.httpPort}.`
                    : probe.diagnosis === 'auth'
                        ? `Connected via HTTP but authentication failed. Check your API key.`
                        : `Cannot reach the zedon-byok gateway. Start it, enable its external API, and check the host, port and key.`,
            };
        }
        // Wave E (E2): a plain-HTTP "Failed to fetch" means the gateway is unreachable — the #1
        // onboarding wall. Attach an 'unreachable' diagnosis so callers (wizard / settings)
        // surface the running/plugin/port checklist via buildConnectionGuidanceHtml instead of
        // a raw "Failed to fetch" dead-end with no path forward.
        if (isFetchFail) {
            return {
                ok: false,
                diagnosis: 'unreachable',
                error: `Cannot reach the zedon-byok gateway at ${host || '127.0.0.1'}:${port}. Check that the gateway is running and its external API is enabled.`,
            };
        }
        return { ok: false, error: err.message };
    }
}

/**
 * Diagnose why an HTTPS fetch failed by probing HTTP on the alternate port.
 * Returns a diagnosis string and whether HTTP worked.
 * @param {string} host
 * @param {number} port - The HTTPS port that failed (e.g. 27124)
 * @param {string} apiKey
 * @returns {Promise<{diagnosis: 'cert'|'unreachable'|'auth', httpWorked: boolean, httpPort: number}>}
 */
export async function diagnoseFetchFailure(host, port, apiKey) {
    const httpPort = port;
    // Mirror vaultFetch's validator — the probe must not leak Bearer to a
    // public host when upstream config is bad.
    try { validateVaultHost(host || '127.0.0.1'); }
    catch { return { diagnosis: 'unreachable', httpWorked: false, httpPort }; }
    try {
        const res = await fetch(`http://${host || '127.0.0.1'}:${httpPort}/vault/`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(3000),
        });
        if (res.status === 401 || res.status === 403) {
            return { diagnosis: 'auth', httpWorked: true, httpPort };
        }
        // Any HTTP response → server reachable, HTTPS is the problem.
        return { diagnosis: 'cert', httpWorked: true, httpPort };
    } catch {
        return { diagnosis: 'unreachable', httpWorked: false, httpPort };
    }
}

/**
 * Build diagnosis-specific HTML guidance for connection failures.
 * Used by wizard, settings, and runtime error surfaces.
 * @param {{diagnosis: string, certUrl?: string, httpPort?: number, error?: string}} result
 * @returns {string} HTML string
 */
export function buildConnectionGuidanceHtml(result) {
    if (result.diagnosis === 'cert') {
        return `
            <div class="dle-connection-guidance">
                <p><strong>HTTPS did not work, but HTTP did.</strong></p>
                <p>The local zedon-byok gateway serves HTTP. Uncheck HTTPS and keep port <code>${result.httpPort || 3000}</code>.</p>
            </div>`;
    }
    if (result.diagnosis === 'unreachable') {
        return `
            <div class="dle-connection-guidance">
                <p><strong>Cannot reach the zedon-byok gateway.</strong></p>
                <p>Check all three:</p>
                <ol>
                    <li><strong>The gateway is running</strong> &mdash; start it from the console or with <code>cargo run</code>.</li>
                    <li><strong>The external API is enabled</strong> &mdash; the console's API settings show the generated key.</li>
                    <li><strong>The host and port match</strong> &mdash; the default is <code>127.0.0.1:3000</code>.</li>
                </ol>
            </div>`;
    }
    if (result.diagnosis === 'auth') {
        return `
            <div class="dle-connection-guidance">
                <p><strong>Connected, but authentication failed.</strong></p>
                <p>The API key must match the zedon-byok external API key. Copy it from the console's API settings.</p>
            </div>`;
    }
    return `<div class="dle-connection-guidance"><p>${result.error || 'Connection failed. Run /dle-health for diagnostics.'}</p></div>`;
}

/**
 * Normalize a vault-relative folder selection. Backslashes become slashes, leading and
 * trailing separators are dropped, and a path containing `..` is rejected (returns '').
 * An empty result means the vault root.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeVaultFolder(value) {
    const raw = String(value ?? '').replace(/\\/g, '/').trim();
    if (!raw) return '';
    const segments = raw.split('/').filter(segment => segment && segment !== '.');
    if (segments.some(segment => segment === '..')) return '';
    return segments.join('/');
}

/**
 * Tolerate a gateway that returns listing entries relative to the vault root.
 * Newer gateways and Obsidian return bare names, which never contain a slash.
 * @param {string} entry
 * @param {string} prefix - requested directory with a trailing slash, or ''
 * @returns {string}
 */
function relativeEntry(entry, prefix) {
    if (!entry.includes('/')) return entry;
    if (prefix && entry.startsWith(prefix)) return entry.slice(prefix.length);
    return entry;
}

/**
 * Join a vault base folder and a vault-relative path without double-prefixing.
 * @param {string} base
 * @param {string} relativePath
 * @returns {string}
 */
export function joinVaultPath(base, relativePath = '') {
    const basePath = normalizeVaultFolder(base);
    const relative = String(relativePath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!basePath) return relative;
    if (!relative) return `${basePath}/`;
    if (relative === basePath || relative.startsWith(`${basePath}/`)) return relative;
    return `${basePath}/${relative}`;
}

/**
 * Fetch all .md files from the vault with their contents (batch parallel).
 * @param {number} port
 * @param {string} apiKey
 * @param {boolean} [useHttps]
 * @param {string} [base] - Vault-relative folder to index ('' = whole vault)
 * @returns {Promise<{files: Array<{filename: string, content: string}>, total: number, failed: number}>}
 */
export async function fetchAllMdFiles(host, port, apiKey, useHttps = false, base = '') {
    // BUG-366: pass `partial` flag through so caller preserves the previous index
    // instead of committing a truncated one.
    const listing = await listAllFiles(host, port, apiKey, normalizeVaultFolder(base), 0, useHttps);
    const allFiles = listing.files;
    const listingPartial = !!listing.partial;
    const mdFiles = allFiles.filter(f => f.endsWith('.md'));

    const BATCH_SIZE = VAULT_BATCH_SIZE;
    const results = [];
    let failed = 0;

    for (let i = 0; i < mdFiles.length; i += BATCH_SIZE) {
        const batch = mdFiles.slice(i, i + BATCH_SIZE);
        const batchSettled = await Promise.allSettled(
            batch.map(async (filename) => {
                try {
                    const result = await vaultFetch({
                        host,
                        port,
                        apiKey,
                        https: useHttps,
                        path: `/vault/${encodeVaultPath(filename)}`,
                        accept: 'text/markdown',
                    });
                    if (result.status === 200) {
                        return { filename, content: result.data };
                    }
                    console.warn(`[DLE] Failed to fetch "${filename}": HTTP ${result.status}`);
                    failed++;
                    return null;
                } catch (err) {
                    console.warn(`[DLE] Failed to fetch "${filename}": ${err.message}`);
                    failed++;
                    return null;
                }
            }),
        );
        for (const r of batchSettled) {
            if (r.status === 'fulfilled' && r.value) results.push(r.value);
            else if (r.status === 'rejected') { failed++; console.warn(`[DLE] Batch file fetch rejected: ${r.reason?.message || r.reason}`); }
        }
    }

    return { files: results, total: mdFiles.length, failed, partial: listingPartial };
}

/**
 * Write a markdown note to the vault.
 * @param {number} port
 * @param {string} apiKey
 * @param {string} filename - Vault-relative path
 * @param {string} content - Markdown content
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function writeNote(host, port, apiKey, filename, content, useHttps = false, base = '', ifMatch = null) {
    try {
        const normalizedPath = validateVaultPath(joinVaultPath(base, filename));
        const result = await vaultFetch({
            host,
            port,
            apiKey,
            https: useHttps,
            path: `/vault/${encodeVaultPath(normalizedPath)}`,
            method: 'PUT',
            body: content,
            contentType: 'text/markdown',
            accept: 'text/markdown',
            headers: ifMatch ? { 'If-Match': ifMatch } : null,
        });
        if (result.status === 200 || result.status === 204) {
            return { ok: true, etag: result.headers?.get('etag') ?? null };
        }
        return { ok: false, status: result.status, error: `HTTP ${result.status}: ${(result.data || '').substring(0, 200)}` };
    } catch (err) {
        return { ok: false, status: 0, error: err.message };
    }
}

/**
 * Read a single vault note's raw markdown.
 *
 * Returns `{ ok, content, status, error? }`. `ok:false` with `status:404` means
 * the file does not exist (caller can treat as "new entry"). Never throws — a
 * network/transport error is returned as `{ ok:false, status:0, error }`.
 *
 * @param {string} host
 * @param {number} port
 * @param {string} apiKey
 * @param {string} filename - vault-relative path
 * @param {boolean} [useHttps=false]
 * @returns {Promise<{ok: boolean, content?: string, status: number, error?: string}>}
 */
export async function readNote(host, port, apiKey, filename, useHttps = false) {
    try {
        const normalizedPath = validateVaultPath(filename);
        const result = await vaultFetch({
            host,
            port,
            apiKey,
            https: useHttps,
            path: `/vault/${encodeVaultPath(normalizedPath)}`,
            method: 'GET',
            accept: 'text/markdown',
        });
        if (result.status === 200) {
            return {
                ok: true,
                content: String(result.data ?? ''),
                status: 200,
                etag: result.headers?.get('etag') ?? null,
            };
        }
        return { ok: false, status: result.status, error: `HTTP ${result.status}` };
    } catch (err) {
        return { ok: false, status: 0, error: err.message };
    }
}

/**
 * Create a vault directory. The gateway creates parent directories as needed,
 * so `book/waypoint` is valid even when `book` does not exist yet.
 *
 * Returns `{ ok, status, error? }`. `ok:false` with `status:409` means a file
 * already occupies the path.
 *
 * @param {string} host
 * @param {number} port
 * @param {string} apiKey
 * @param {string} folder - vault-relative directory path
 * @param {boolean} [useHttps=false]
 * @returns {Promise<{ok: boolean, status: number, error?: string}>}
 */
export async function createFolder(host, port, apiKey, folder, useHttps = false) {
    try {
        const normalizedPath = validateVaultPath(folder);
        const result = await vaultFetch({
            host,
            port,
            apiKey,
            https: useHttps,
            path: `/vault/${encodeVaultPath(normalizedPath)}/`,
            method: 'PUT',
            headers: { 'x-vault-kind': 'directory' },
        });
        if (result.status === 200 || result.status === 204) {
            return { ok: true, status: result.status };
        }
        return { ok: false, status: result.status, error: `HTTP ${result.status}` };
    } catch (err) {
        return { ok: false, status: 0, error: err.message };
    }
}

/**
 * Update Existing Entries — read a vault file, surgically patch the requested
 * scalar frontmatter fields, write the merged result back. Body and untouched
 * frontmatter fields are preserved byte-for-byte (no YAML re-serialization).
 *
 * Returns `{ ok, applied, skipped, error? }`. `applied`/`skipped` are passed
 * through from `updateFrontmatterFields`; callers can surface them to the user.
 *
 * Does NOT create the file if missing — returns ok:false with status 404.
 * Caller wraps in `upsertConvertedEntry` or `writeNote` when full-write is wanted.
 *
 * @param {string} host
 * @param {number} port
 * @param {string} apiKey
 * @param {string} filename
 * @param {Record<string, string|number|boolean|null>} updates
 * @param {boolean} [useHttps=false]
 * @returns {Promise<{ok: boolean, applied?: string[], skipped?: string[], error?: string}>}
 */
export async function updateEntryFields(host, port, apiKey, filename, updates, useHttps = false) {
    try {
        const normalizedPath = validateVaultPath(filename);
        const readResult = await vaultFetch({
            host,
            port,
            apiKey,
            https: useHttps,
            path: `/vault/${encodeVaultPath(normalizedPath)}`,
            method: 'GET',
            accept: 'text/markdown',
        });
        if (readResult.status === 404) {
            return { ok: false, error: 'File not found (use writeNote / upsertConvertedEntry to create)' };
        }
        if (readResult.status !== 200) {
            return { ok: false, error: `HTTP ${readResult.status} on read` };
        }
        const original = String(readResult.data || '');
        const { content, applied, skipped } = updateFrontmatterFields(original, updates);
        if (applied.length === 0) {
            // No-op write avoids touching mtime when nothing actually changed.
            return { ok: true, applied: [], skipped };
        }
        const writeResult = await writeNote(host, port, apiKey, normalizedPath, content, useHttps);
        if (!writeResult.ok) return { ok: false, applied: [], skipped, error: writeResult.error };
        return { ok: true, applied, skipped };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Fetch a YAML field definitions file from the vault.
 * @param {string} host
 * @param {number} port
 * @param {string} apiKey
 * @param {string} filePath - Vault-relative path (e.g., 'DeepLore/field-definitions.yaml')
 * @returns {Promise<{ok: boolean, content?: string, error?: string}>}
 */
export async function fetchFieldDefinitions(host, port, apiKey, filePath, useHttps = false, base = '') {
    try {
        const normalizedPath = validateVaultPath(joinVaultPath(base, filePath));
        const result = await vaultFetch({
            host,
            port,
            apiKey,
            https: useHttps,
            path: `/vault/${encodeVaultPath(normalizedPath)}`,
            method: 'GET',
            accept: 'text/plain',
        });
        if (result.status === 200) {
            return { ok: true, content: result.data };
        }
        if (result.status === 404) {
            return { ok: false, error: 'not_found' };
        }
        return { ok: false, error: `HTTP ${result.status}: ${(result.data || '').substring(0, 200)}` };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Write a YAML field definitions file to the vault.
 * @param {string} host
 * @param {number} port
 * @param {string} apiKey
 * @param {string} filePath - Vault-relative path (e.g., 'DeepLore/field-definitions.yaml')
 * @param {string} content - Serialized YAML string
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function writeFieldDefinitions(host, port, apiKey, filePath, content, useHttps = false, base = '') {
    try {
        const normalizedPath = validateVaultPath(joinVaultPath(base, filePath));
        const result = await vaultFetch({
            host,
            port,
            apiKey,
            https: useHttps,
            path: `/vault/${encodeVaultPath(normalizedPath)}`,
            method: 'PUT',
            body: content,
            contentType: 'text/plain',
            accept: 'text/plain',
        });
        if (result.status === 200 || result.status === 204) {
            return { ok: true };
        }
        return { ok: false, error: `HTTP ${result.status}: ${(result.data || '').substring(0, 200)}` };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Fetch all session notes from a vault folder.
 * @param {number} port
 * @param {string} apiKey
 * @param {string} folder - Folder path within vault
 * @returns {Promise<{ok: boolean, notes?: Array<{filename: string, content: string}>, error?: string}>}
 */
export async function fetchScribeNotes(host, port, apiKey, folder, useHttps = false, base = '') {
    // BUG-040: prevent directory traversal. The selected base scopes the configured folder.
    const scopedFolder = joinVaultPath(base, folder);
    validateVaultPath(scopedFolder);
    try {
        const listing = await listAllFiles(host, port, apiKey, scopedFolder, 0, useHttps);
        const allFiles = listing.files;
        const mdFiles = allFiles.filter(f => f.endsWith('.md'));
        const BATCH_SIZE = VAULT_BATCH_SIZE;
        const notes = [];

        for (let i = 0; i < mdFiles.length; i += BATCH_SIZE) {
            const batch = mdFiles.slice(i, i + BATCH_SIZE);
            const batchSettled = await Promise.allSettled(batch.map(async (filepath) => {
                try {
                    const result = await vaultFetch({
                        host,
                        port,
                        apiKey,
                        https: useHttps,
                        path: `/vault/${encodeVaultPath(filepath)}`,
                        accept: 'text/markdown',
                    });
                    if (result.status !== 200) {
                        console.warn(`[DLE] Failed to fetch scribe note ${filepath}: HTTP ${result.status}`);
                        return null;
                    }
                    return { filename: filepath, content: result.data };
                } catch (err) {
                    console.warn(`[DLE] Failed to fetch scribe note ${filepath}:`, err.message);
                    return null;
                }
            }));
            for (const r of batchSettled) {
                if (r.status === 'fulfilled' && r.value) notes.push(r.value);
                else if (r.status === 'rejected') console.warn(`[DLE] Batch scribe note fetch rejected: ${r.reason?.message || r.reason}`);
            }
        }

        return { ok: true, notes };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}


// ─── Gateway control API: vault settings ─────────────────────────────────────
// The control API is local-only (the gateway rejects non-local origins) and does
// not use the external API key. It is the only supported path for reading and
// replacing VaultSettings.roots; the PUT also rebuilds the index.

function vaultControlBase(host, port, useHttps = false) {
    validateVaultHost(host);
    const scheme = useHttps ? 'https' : 'http';
    return `${scheme}://${host}:${port}/__byok-api__/api/vault`;
}

async function readVaultControlResponse(response) {
    const text = await response.text();
    let data = null;
    if (text) {
        try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!response.ok) {
        const detail = (data && (data.error || data.message)) || text || `HTTP ${response.status}`;
        throw new Error(String(detail));
    }
    return data;
}

export async function getVaultSettings(host, port, useHttps = false) {
    const response = await fetch(`${vaultControlBase(host, port, useHttps)}/settings`, {
        headers: { Accept: 'application/json' },
    });
    return readVaultControlResponse(response);
}

export async function saveVaultSettings(host, port, settings, useHttps = false) {
    const response = await fetch(`${vaultControlBase(host, port, useHttps)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(settings),
    });
    return readVaultControlResponse(response);
}
