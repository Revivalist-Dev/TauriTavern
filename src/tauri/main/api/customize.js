// @ts-check

function requireSafeInvoke(context) {
    const safeInvoke = context?.safeInvoke;
    if (typeof safeInvoke !== 'function') {
        throw new Error('Tauri main context safeInvoke is missing');
    }
    return safeInvoke;
}

function createCustomizeApi({ safeInvoke }) {
    return {
        snapshot: async (vaultRoot = null) => safeInvoke('customize_snapshot', { vaultRoot }),
        context: async (surface, vaultRoot = null) => safeInvoke('customize_context', { surface, vaultRoot }),
        save: async (request) => safeInvoke('customize_save', { request }),
        remove: async (id, vaultRoot = null) => safeInvoke('customize_delete', { id, vaultRoot }),
        setEnabled: async (id, enabled) => safeInvoke('customize_set_enabled', { id, enabled }),
        hooks: {
            config: async (vaultRoot = null) => safeInvoke('customize_hook_config', { vaultRoot }),
            saveConfig: async (config, vaultRoot = null) => safeInvoke('customize_save_hook_config', { config, vaultRoot }),
            trust: async (vaultRoot = null) => safeInvoke('customize_trust_hooks', { vaultRoot }),
            run: async (request) => safeInvoke('customize_run_hook', { request }),
            logs: async () => safeInvoke('customize_hook_logs'),
            knownEvents: async () => safeInvoke('customize_known_events'),
        },
    };
}

/**
 * @param {any} context
 */
export function installCustomizeApi(context) {
    const hostWindow = /** @type {any} */ (window);
    const hostAbi = hostWindow.__TAURITAVERN__;
    if (!hostAbi || typeof hostAbi !== 'object') {
        throw new Error('Host ABI __TAURITAVERN__ is missing');
    }
    const safeInvoke = requireSafeInvoke(context);
    const api = createCustomizeApi({ safeInvoke });
    if (!hostAbi.api || typeof hostAbi.api !== 'object') {
        hostAbi.api = {};
    }
    hostAbi.api.customize = api;
    hostAbi.customize = api;
}
