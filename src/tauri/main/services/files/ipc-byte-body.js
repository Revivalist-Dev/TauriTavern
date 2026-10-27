import { BYTE_HEADERS } from '../../kernel/byte-protocol.js';

/**
 * Encode the byte body shared by upload and commit commands.
 * Windows WebView2 carries the bytes as a plain Uint8Array over the IPC bridge.
 * @param {Uint8Array} bytes
 */
export function encodeIpcByteBody(bytes) {
    return { body: bytes, headers: /** @type {Record<string, string>} */ ({}) };
}

export { BYTE_HEADERS };
