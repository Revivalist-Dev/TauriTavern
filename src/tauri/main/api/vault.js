import { readByteResponse } from '../kernel/byte-protocol.js';

function asBytes(data) {
    if (Array.isArray(data)) return Uint8Array.from(data);
    return readByteResponse(data);
}

/**
 * Host vault API. All paths are relative to a mount; the backend owns path
 * resolution and rejects anything outside the selected folders.
 *
 * @param {{ safeInvoke: (command: string, args?: any) => Promise<any> }} deps
 */
export function createVaultApi({ safeInvoke }) {
    return {
        state: () => safeInvoke('vault_get_state'),
        pickMount: () => safeInvoke('vault_pick_mount'),
        addMount: (path, name = null) => safeInvoke('vault_add_mount', { path, name }),
        removeMount: (mountId) => safeInvoke('vault_remove_mount', { mountId }),
        setPrimary: (mountId) => safeInvoke('vault_set_primary_mount', { mountId }),
        renameMount: (mountId, name) => safeInvoke('vault_rename_mount', { mountId, name }),
        list: (mountId, path = '') => safeInvoke('vault_list', { mountId, path }),
        stat: (mountId, path) => safeInvoke('vault_stat', { mountId, path }),
        readText: (mountId, path) => safeInvoke('vault_read_text', { mountId, path }),
        readBytes: (mountId, path) => safeInvoke('vault_read_bytes', { mountId, path })
            .then(asBytes),
        thumbnail: (mountId, path) => safeInvoke('vault_thumbnail', { mountId, path })
            .then(asBytes),
        createEntry: (mountId, parent, name, directory) => safeInvoke('vault_create_entry', {
            mountId, parent, name, directory,
        }),
        renameEntry: (mountId, path, newName) => safeInvoke('vault_rename_entry', {
            mountId, path, newName,
        }),
        deleteEntries: (mountId, paths, recursive = false) => safeInvoke('vault_delete_entries', {
            mountId, paths, recursive,
        }),
        moveEntries: (sourceMount, paths, destinationMount, destinationDir, copy = false) => safeInvoke(
            'vault_move_entries',
            { sourceMount, paths, destinationMount, destinationDir, copy },
        ),
        writeFile: (mountId, parent, name, bytes, overwrite = false) => safeInvoke(
            'vault_write_file',
            { mountId, parent, name, bytes: Array.from(bytes), overwrite },
        ),
        exportEntry: (mountId, path) => safeInvoke('vault_export_entry', { mountId, path }),
        reveal: (mountId, path) => safeInvoke('vault_reveal', { mountId, path }),
        open: (mountId, path) => safeInvoke('vault_open', { mountId, path }),
    };
}

/** @param {{ safeInvoke: (command: string, args?: any) => Promise<any> }} deps */
export function createLoreApi({ safeInvoke }) {
    return {
        state: () => safeInvoke('lore_get_state'),
        scan: () => safeInvoke('lore_scan'),
        listEntries: (folder = null) => safeInvoke('lore_list_entries', { folder }),
        retrieve: ({ query, folders = [], tokenBudget = 2048, maxEntries = 24 }) => safeInvoke('lore_retrieve', {
            query,
            folders,
            tokenBudget,
            maxEntries,
        }),
        search: ({ query, folders = [], limit = 20 }) => safeInvoke('lore_search', { query, folders, limit }),
        read: (path) => safeInvoke('lore_read', { path }),
        migrateLegacy: () => safeInvoke('lore_migrate_legacy'),
        migrateCharacter: (avatar, book) => safeInvoke('lore_migrate_character', { avatar, book }),
    };
}

/** @param {ReturnType<typeof createVaultApi>} vault @param {ReturnType<typeof createLoreApi>} lore */
export function installVaultApi(vault, lore) {
    const host = window.__TAURITAVERN__;
    if (!host) throw new Error('installVaultApi requires the host ABI');
    host.api ??= {};
    host.api.vault = vault;
    if (lore) host.api.lore = lore;
}
