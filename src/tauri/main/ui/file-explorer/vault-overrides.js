const invoke = (command, args) => {
    const host = window.__TAURITAVERN__;
    if (host?.invoke?.safeInvoke) return host.invoke.safeInvoke(command, args);
    if (typeof host?.invoke === 'function') return host.invoke(command, args);
    throw new Error('TauriTavern host bridge is not available.');
};

const state = {
    installed: false,
    blocked: new Set(),
    pinned: new Set(),
    loadedFor: null,
};

export function normalizeOverridePath(path) {
    return String(path ?? '').replaceAll('\\', '/').replace(/^\.?\//, '').replace(/^lore\//, '');
}

function parseList(value) {
    if (Array.isArray(value)) return value.map(normalizeOverridePath).filter(Boolean);
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(normalizeOverridePath).filter(Boolean) : [];
    } catch {
        return value.split(/\r?\n/).map(normalizeOverridePath).filter(Boolean);
    }
}

export function pathMatches(list, path) {
    const clean = normalizeOverridePath(path);
    for (const candidate of list) {
        if (!candidate) continue;
        if (clean === candidate || clean.endsWith(`/${candidate}`) || candidate.endsWith(`/${clean}`)) return true;
        if (candidate.endsWith('/') && clean.startsWith(candidate)) return true;
    }
    return false;
}

export async function refreshSessionOverrides() {
    const context = globalThis.SillyTavern?.getContext?.();
    const groupId = context?.groupId;
    const chatId = context?.chatId;
    const key = `${groupId ?? ''}:${chatId ?? ''}`;
    if (!groupId || !chatId) {
        state.blocked.clear();
        state.pinned.clear();
        state.loadedFor = key;
        return;
    }
    if (state.loadedFor === key) return;
    try {
        const workspace = await invoke('get_group_session_workspace', { groupId, chatId });
        const lore = workspace?.effective?.lore ?? {};
        state.blocked = new Set(parseList(lore.deeplore_blocks));
        state.pinned = new Set(parseList(lore.deeplore_pins));
        state.loadedFor = key;
        window.dispatchEvent(new CustomEvent('tt:vault-overrides-changed'));
    } catch (error) {
        console.warn('TauriTavern: could not load session overrides:', error);
    }
}

export function getOverrideState(path) {
    const blocked = pathMatches(state.blocked, path);
    const pinned = pathMatches(state.pinned, path);
    return {
        overridden: blocked,
        blocked,
        pinned,
        source: blocked ? 'session' : pinned ? 'session-pin' : null,
    };
}

export function installVaultOverrides() {
    if (state.installed) return;
    state.installed = true;
    void refreshSessionOverrides();
    window.addEventListener('tt:session-workspace-lore-changed', () => {
        state.loadedFor = null;
        void refreshSessionOverrides();
    });
    window.__TT_VAULT_OVERRIDES__ = {
        getState: getOverrideState,
        refresh: refreshSessionOverrides,
    };
}
