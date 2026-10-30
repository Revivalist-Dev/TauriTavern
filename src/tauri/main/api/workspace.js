const listeners = new Set();
let focus = {
    mountId: null,
    path: '',
    folder: '',
    primary: false,
    selected: [],
    updatedAt: 0,
};

function snapshot() {
    return {
        ...focus,
        selected: [...focus.selected],
    };
}

/** @param {{ safeInvoke?: Function }} _deps */
export function createWorkspaceApi(_deps = {}) {
    return {
        getFocus: () => snapshot(),
        setFocus: (next = {}) => {
            focus = {
                mountId: next.mountId ?? null,
                path: String(next.path ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
                folder: String(next.folder ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
                primary: Boolean(next.primary),
                selected: Array.isArray(next.selected) ? next.selected.map(String) : [],
                updatedAt: Date.now(),
            };
            const value = snapshot();
            for (const listener of listeners) listener(value);
            return value;
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

/** @param {ReturnType<typeof createWorkspaceApi>} workspace */
export function installWorkspaceApi(workspace) {
    const host = window.__TAURITAVERN__;
    if (!host) throw new Error('installWorkspaceApi requires the host ABI');
    host.api ??= {};
    host.api.workspace = workspace;
}
