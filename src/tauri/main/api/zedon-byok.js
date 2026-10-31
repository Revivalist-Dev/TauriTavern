// @ts-check

/**
 * @param {{ safeInvoke: (command: string, args?: any) => Promise<any> }} deps
 */
function createZedonByokApi({ safeInvoke }) {
    return {
        async service() {
            return safeInvoke('get_zedon_byok_service');
        },
        async models(apiKey, baseUrl = null) {
            return safeInvoke('list_zedon_byok_models', {
                apiKey: String(apiKey || ''),
                baseUrl: baseUrl ? String(baseUrl) : null,
            });
        },
    };
}

/** @param {any} context */
export function installZedonByokApi(context) {
    const hostAbi = window.__TAURITAVERN__;
    if (!hostAbi || typeof hostAbi !== 'object') {
        throw new Error('Host ABI __TAURITAVERN__ is missing');
    }
    if (typeof context?.safeInvoke !== 'function') {
        throw new Error('Tauri main context safeInvoke is missing');
    }
    if (!hostAbi.api || typeof hostAbi.api !== 'object') {
        hostAbi.api = {};
    }
    hostAbi.api.zedonByok = createZedonByokApi({ safeInvoke: context.safeInvoke });
}
