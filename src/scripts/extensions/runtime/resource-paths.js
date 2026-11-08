import { getCurrentLocale } from '../../i18n.js';

// A WebView2 restart keeps its previous asset cache. Version the extension URL so
// an edited built-in extension is loaded on the next app start instead of the
// previous compiled script.
const EXTENSION_ASSET_VERSION = String(Date.now());

export function normalizeExtensionResourcePath(resourcePath) {
    const locale = getCurrentLocale();
    return String(resourcePath || '')
        .replace(/^\/+/, '')
        .replace(/\$\{locale\}/g, locale);
}

export function getExtensionResourceUrl(name, resourcePath) {
    const normalizedPath = normalizeExtensionResourcePath(resourcePath);
    const cacheBust = globalThis.chrome?.webview ? `?v=${EXTENSION_ASSET_VERSION}` : '';
    return `/scripts/extensions/${name}/${normalizedPath}${cacheBust}`;
}

export function isThirdPartyExtension(name) {
    return String(name || '').startsWith('third-party/');
}
