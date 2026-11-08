import { invoke } from '../../../tauri-bridge.js';

/**
 * Rehydrate group chat metadata from the group and session workspaces.
 * @param {string} groupId
 * @param {string} chatId
 * @param {object} metadata
 * @returns {Promise<object>}
 */
export async function hydrateGroupSessionMetadata(groupId, chatId, metadata) {
    if (!groupId || !chatId) {
        return metadata;
    }
    return invoke('prepare_group_session_metadata', { groupId, chatId, metadata });
}

/**
 * Persist changed lore fields into the session workspace.
 * @param {string} groupId
 * @param {string} chatId
 * @param {object} metadata
 * @returns {Promise<void>}
 */
export async function syncGroupSessionMetadata(groupId, chatId, metadata) {
    if (!groupId || !chatId) {
        return;
    }
    await invoke('sync_group_session_metadata', { groupId, chatId, metadata });
}

/**
 * Read the combined session/group workspace for UI.
 * @param {string} groupId
 * @param {string} chatId
 * @returns {Promise<any>}
 */
export async function getGroupSessionWorkspace(groupId, chatId) {
    return invoke('get_group_session_workspace', { groupId, chatId });
}

/**
 * Read the group-level defaults.
 * @param {string} groupId
 * @returns {Promise<any>}
 */
export async function getGroupWorkspace(groupId) {
    return invoke('get_group_workspace', { groupId });
}

/**
 * @param {string} chatId
 * @param {'session'|'deeplore'|'rpgraph'} namespace
 * @param {string} key
 * @param {any} value
 */
export async function writeSessionWorkspaceEntry(chatId, namespace, key, value) {
    await invoke('write_session_workspace_entry', { chatId, namespace, key, value });
}

/**
 * @param {string} chatId
 * @param {'session'|'deeplore'|'rpgraph'} namespace
 * @param {string} key
 */
export async function deleteSessionWorkspaceEntry(chatId, namespace, key) {
    await invoke('delete_session_workspace_entry', { chatId, namespace, key });
}

/**
 * @param {string} groupId
 * @param {'session'|'deeplore'|'rpgraph'} namespace
 * @param {string} key
 * @param {any} value
 */
export async function writeGroupWorkspaceEntry(groupId, namespace, key, value) {
    await invoke('write_group_workspace_entry', { groupId, namespace, key, value });
}

/**
 * @param {string} groupId
 * @param {'session'|'deeplore'|'rpgraph'} namespace
 * @param {string} key
 */
export async function deleteGroupWorkspaceEntry(groupId, namespace, key) {
    await invoke('delete_group_workspace_entry', { groupId, namespace, key });
}
