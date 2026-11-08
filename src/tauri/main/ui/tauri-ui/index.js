/**
 * Public TauriTavern UI kit.
 *
 * Import builders from here in app UI code. Extension code can use the same
 * functions through window.TauriUI, or through the tauri-core bridge when it
 * loads before the app kit is installed.
 */
export * from './dom.js';
export * from './components.js';
export * from './primitives.js';

import * as components from './components.js';
import * as primitives from './primitives.js';

const kit = Object.freeze({ ...components, ...primitives });
export const TauriUI = kit;

if (typeof globalThis !== 'undefined') {
    globalThis.TauriUI = kit;
}

export default kit;
