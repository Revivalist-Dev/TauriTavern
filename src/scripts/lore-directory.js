import { saveMetadata } from '../script.js';
import { defaultLoreFolders } from './lore-prompt.js';
import { getContext } from './extensions.js';

let initialized = false;

function loreApi() {
    return window.__TT_LORE_API__ ?? window.__TAURITAVERN__?.api?.lore ?? null;
}

function vaultApi() {
    return window.__TT_VAULT_API__ ?? window.__TAURITAVERN__?.api?.vault ?? null;
}

function selectedFolders() {
    const metadata = getContext().chatMetadata ?? {};
    if (!Array.isArray(metadata.loreFolders) || metadata.loreFolders.length === 0) {
        metadata.loreFolders = defaultLoreFolders();
        void saveMetadata().catch(() => {});
    }
    return new Set(metadata.loreFolders);
}

async function saveFolders(folders) {
    const metadata = getContext().chatMetadata ?? {};
    metadata.loreFolders = [...folders].sort();
    await saveMetadata();
}

function renderFolder(folder, active) {
    const row = document.createElement('label');
    row.className = 'lore-folder-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = [...active].some(
        (prefix) => folder.path === prefix || folder.path.startsWith(`${prefix}/`),
    );
    checkbox.addEventListener('change', async () => {
        if (checkbox.checked) {
            active.add(folder.path);
        } else {
            for (const prefix of [...active]) {
                if (folder.path === prefix || folder.path.startsWith(`${prefix}/`)) active.delete(prefix);
            }
            active.delete(folder.path);
        }
        await saveFolders(active);
    });
    const name = document.createElement('span');
    name.className = 'lore-folder-name';
    name.textContent = folder.path;
    const count = document.createElement('span');
    count.className = 'opacity50';
    count.textContent = `${folder.entries}`;
    row.append(checkbox, name, count);
    return row;
}

function renderEntry(entry, mountId) {
    const row = document.createElement('div');
    row.className = 'lore-entry-row';
    row.tabIndex = 0;
    const title = document.createElement('span');
    title.className = 'lore-entry-title';
    title.textContent = entry.title;
    const meta = document.createElement('span');
    meta.className = 'opacity50';
    meta.textContent = entry.folder;
    row.append(title, meta);
    row.addEventListener('dblclick', async () => {
        if (!mountId) return;
        await vaultApi()?.open?.(mountId, `lore/${entry.path}`);
    });
    return row;
}

async function render() {
    const root = document.getElementById('lore-directory-root');
    const folders = document.getElementById('lore-directory-folders');
    const entries = document.getElementById('lore-directory-entries');
    const migration = document.getElementById('lore-directory-migration');
    if (!root || !folders || !entries) return;
    const api = loreApi();
    if (!api) {
        root.textContent = 'Lore directory is unavailable.';
        return;
    }
    try {
        const state = await api.state();
        if (!state.root) {
            root.textContent = 'Choose a primary vault folder in the File Explorer first.';
            folders.replaceChildren();
            entries.replaceChildren();
            return;
        }
        root.textContent = state.root;
        if (!state.scanned) await api.scan();
        const refreshed = await api.state();
        const active = selectedFolders();
        folders.replaceChildren(...refreshed.folders.map((folder) => renderFolder(folder, active)));
        const allEntries = await api.listEntries();
        const mount = await vaultApi()?.state?.();
        const mountId = mount?.primaryMountId;
        entries.replaceChildren(...allEntries.slice(0, 200).map((entry) => renderEntry(entry, mountId)));
        if (migration) {
            migration.textContent = `${allEntries.length} Markdown entries. Double-click an entry to open it externally.`;
        }
    } catch (error) {
        root.textContent = String(error?.message ?? error);
    }
}

async function migrate() {
    const api = loreApi();
    if (!api) return;
    try {
        const report = await api.migrateLegacy();
        if (!report.skipped && report.books > 0) {
            const node = document.getElementById('lore-directory-migration');
            if (node) node.textContent = `Migrated ${report.books} lorebooks and ${report.entries} entries.`;
        }
    } catch {
        // The migration is best-effort; an empty vault simply renders the empty state.
    }
}

export function installLoreDirectory() {
    if (initialized) return;
    initialized = true;
    window.addEventListener('tt:use-lore-folder', async (event) => {
        const folder = String(event.detail?.folder || '').replace(/\/+$/, '');
        if (!folder) return;
        const metadata = getContext().chatMetadata ?? {};
        const folders = new Set(Array.isArray(metadata.loreFolders) ? metadata.loreFolders : defaultLoreFolders());
        folders.add(folder);
        await saveFolders(folders);
        await render();
    });
    const addShortcut = async (folder) => {
        if (!folder) return;
        const metadata = getContext().chatMetadata ?? {};
        const folders = new Set(Array.isArray(metadata.loreFolders) ? metadata.loreFolders : defaultLoreFolders());
        folders.add(folder);
        await saveFolders(folders);
        await render();
    };
    document.getElementById('lore-directory-global')?.addEventListener('click', () => addShortcut('lore/global'));
    document.getElementById('lore-directory-character')?.addEventListener('click', () => {
        const character = defaultLoreFolders().find((folder) => folder.startsWith('lore/characters/'));
        void addShortcut(character);
    });
    const refresh = document.getElementById('lore-directory-refresh');
    refresh?.addEventListener('click', async () => {
        await loreApi()?.scan();
        await render();
    });
    const drawer = document.getElementById('lore-directory-button');
    drawer?.querySelector('.drawer-toggle')?.addEventListener('click', async () => {
        await migrate();
        await render();
    });
    void render();
}
