/**
 * Native TauriTavern vault transport.
 *
 * DeepLore's vault client speaks the zedon-byok gateway's `/vault` HTTP API.
 * Inside TauriTavern the same operations are exposed directly by the host ABI,
 * so this module translates the small `/vault` surface onto `api.vault` and
 * `api.lore`. The gateway remains available for browser-only installs.
 */

const encoder = new TextEncoder();
let cachedMountId = null;

if (typeof window !== 'undefined') {
    window.addEventListener('tt:lore-defaults-changed', () => { cachedMountId = null; });
}

function api() {
    return typeof window === 'undefined' ? null : window.__TAURITAVERN__?.api ?? null;
}

export function isNativeVaultAvailable() {
    return Boolean(api()?.vault?.list && api()?.vault?.readText);
}

function splitPath(path) {
    const clean = String(path || '').replace(/^\/+|\/+$/g, '');
    const slash = clean.lastIndexOf('/');
    return slash < 0
        ? { parent: '', name: clean }
        : { parent: clean.slice(0, slash), name: clean.slice(slash + 1) };
}

export async function nativeMountId() {
    if (cachedMountId) return cachedMountId;
    const shared = window.__TT_LORE_DEFAULTS__?.get?.()?.vault?.mountId;
    const state = await api()?.vault?.state?.().catch(() => null);
    const mounts = Array.isArray(state?.mounts) ? state.mounts : [];
    cachedMountId = shared && mounts.some((mount) => mount.id === shared)
        ? shared
        : state?.primaryMountId ?? mounts[0]?.id ?? null;
    return cachedMountId;
}

function response(status, data, extra = {}) {
    return {
        status,
        data: typeof data === 'string' ? data : JSON.stringify(data),
        headers: new Headers(extra.headers ?? {}),
    };
}

export async function nativeVaultFetch({ path, method = 'GET', body = null }) {
    const vault = api()?.vault;
    if (!vault) return response(503, { error: 'Native vault API unavailable' });
    const mountId = await nativeMountId();
    if (!mountId) return response(409, { error: 'No native vault is mounted' });

    const relative = String(path || '').replace(/^\/?vault\/?/, '');
    const isDirectory = relative === '' || relative.endsWith('/');
    const clean = decodeURIComponent(relative.replace(/^\/+|\/+$/g, ''));

    try {
        if (method === 'GET' && isDirectory) {
            const hook = await window.__TAURITAVERN_HOOKS__?.dispatch?.('deeplore', 'beforeReadFile', {
                filePath: clean,
                workspaceRoots: [mountId],
            });
            if (hook && hook.allowed === false) {
                return response(403, { error: hook.results?.[0]?.userMessage || 'Blocked by an Agent Workspace hook.' });
            }
            const entries = await vault.list(mountId, clean);
            const transformed = window.__TT_EXPERIMENTS__?.transformEntries?.(mountId, clean, entries) ?? entries;
            const files = [];
            const directories = [];
            for (const entry of transformed ?? []) {
                if (entry.kind === 'directory') directories.push(`${entry.name}/`);
                else files.push(entry.name);
            }
            return response(200, { files, directories });
        }

        if (method === 'GET') {
            const hook = await window.__TAURITAVERN_HOOKS__?.dispatch?.('deeplore', 'beforeReadFile', {
                filePath: clean,
                workspaceRoots: [mountId],
            });
            if (hook && hook.allowed === false) {
                return response(403, { error: hook.results?.[0]?.userMessage || 'Blocked by an Agent Workspace hook.' });
            }
            if (window.__TT_EXPERIMENTS__?.isRemoved?.(mountId, clean)) {
                return response(404, { error: 'Not found' });
            }
            const override = window.__TT_EXPERIMENTS__?.readText?.(mountId, clean)
                ?? window.__TT_EXPERIMENTS__?.readTextByPath?.(clean);
            if (override !== null && override !== undefined) {
                return response(200, override, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
            }
            const text = await vault.readText(mountId, clean);
            return response(200, text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
        }

        if (method === 'PUT' && isDirectory) {
            const { parent, name } = splitPath(clean);
            if (!name) return response(400, { error: 'Directory name is required' });
            await vault.createEntry(mountId, parent, name, true);
            return response(200, { ok: true });
        }

        if (method === 'PUT') {
            const { parent, name } = splitPath(clean);
            if (!name) return response(400, { error: 'File name is required' });
            await vault.writeFile(mountId, parent, name, encoder.encode(String(body ?? '')), true);
            return response(200, { ok: true });
        }

        if (method === 'DELETE') {
            await vault.deleteEntries(mountId, [clean], true);
            return response(200, { ok: true });
        }

        return response(405, { error: `Unsupported vault method ${method}` });
    } catch (error) {
        const message = String(error?.message ?? error);
        const status = /not found|no such file|does not exist/i.test(message) ? 404 : 500;
        return response(status, { error: message });
    }
}

