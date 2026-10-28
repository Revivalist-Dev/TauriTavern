import { createVaultApi } from '../../api/vault.js';
import {
    baseName,
    compareEntries,
    createState,
    el,
    keyOf,
} from './helpers.js';
import { createOverlays } from './overlays.js';
import { createRenderer } from './render.js';
const LS_WIDTH = 'tt.fileExplorer.width';
const LS_VIEW = 'tt.fileExplorer.view';
function getApi() {
    if (window.__TT_VAULT_API__) return window.__TT_VAULT_API__;
    const host = window.__TAURITAVERN__;
    if (host?.api?.vault) return host.api.vault;
    return createVaultApi({
        safeInvoke: (command, args) => window.__TAURITAVERN__?.invoke?.(command, args)
            ?? Promise.reject(new Error('vault API unavailable')),
    });
}
export function createFileExplorer({ api = getApi(), mount = document.body } = {}) {
    const state = createState();
    const host = {};
    let dock;
    let toggle;
    let content;
    let mountsList;
    let breadcrumbs;
    let footer;
    let renderer;
    let overlays;
    let resizeState = null;
    host.api = api;
    host.state = state;
    const getDock = () => dock;
    const getContent = () => content;
    const getFooter = () => footer;
    const getBreadcrumbs = () => breadcrumbs;
    const getMountsList = () => mountsList;
    const getToggle = () => toggle;
    host.getDock = getDock;
    host.getContent = getContent;
    host.getFooter = getFooter;
    host.getBreadcrumbs = getBreadcrumbs;
    host.getMountsList = getMountsList;
    host.getToggle = getToggle;
    const dockWidth = () => {
        const value = Number.parseFloat(localStorage.getItem(LS_WIDTH));
        return Number.isFinite(value) ? value : 340;
    };
    const maxWidth = () => Math.max(260, Math.min(window.innerWidth * 0.5, window.innerWidth - 480));
    const clampWidth = (value) => Math.min(maxWidth(), Math.max(260, value));
    function applyWidth(value) {
        const width = clampWidth(value);
        document.documentElement.style.setProperty('--tt-fe-width', `${Math.round(width)}px`);
        localStorage.setItem(LS_WIDTH, String(Math.round(width)));
        if (dock) dock.style.width = `${Math.round(width)}px`;
        return width;
    }
    function iconButton(icon, label, handler) {
        const button = el('button', 'tt-fe-icon-button');
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.append(el('i', icon));
        button.addEventListener('click', handler);
        return button;
    }
    function buildDock() {
        dock = el('aside');
        dock.id = 'tt-file-explorer';
        dock.setAttribute('aria-label', 'File explorer');
        dock.hidden = true;

        const resizer = el('div', 'tt-fe-resizer');
        resizer.tabIndex = 0;
        resizer.setAttribute('role', 'separator');
        resizer.setAttribute('aria-orientation', 'vertical');
        resizer.setAttribute('aria-label', 'Resize file explorer');
        resizer.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            resizeState = { startX: event.clientX, startWidth: dock.getBoundingClientRect().width };
            resizer.setPointerCapture(event.pointerId);
        });
        resizer.addEventListener('pointermove', (event) => {
            if (resizeState) applyWidth(resizeState.startWidth + (resizeState.startX - event.clientX));
        });
        resizer.addEventListener('pointerup', () => { resizeState = null; });
        resizer.addEventListener('dblclick', () => applyWidth(340));
        resizer.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft') { event.preventDefault(); applyWidth(dock.getBoundingClientRect().width + 16); }
            if (event.key === 'ArrowRight') { event.preventDefault(); applyWidth(dock.getBoundingClientRect().width - 16); }
        });
        dock.append(resizer);

        const header = el('header', 'tt-fe-header');
        const title = el('div', 'tt-fe-title');
        title.append(el('i', 'fa-solid fa-folder-tree'));
        title.append(el('span', '', 'Vault explorer'));
        header.append(title);
        const add = iconButton('fa-solid fa-folder-plus', 'Add a vault folder', () => host.addMount());
        header.append(add);
        const close = iconButton('fa-solid fa-xmark', 'Close file explorer', () => host.close());
        header.append(close);
        dock.append(header);

        const mounts = el('div', 'tt-fe-mounts');
        const mountsHeader = el('div', 'tt-fe-mounts-header');
        mountsHeader.append(el('span', '', 'Vaults'));
        mounts.append(mountsHeader);
        mountsList = el('div');
        mounts.append(mountsList);
        dock.append(mounts);

        const toolbar = el('div', 'tt-fe-toolbar');
        breadcrumbs = el('div', 'tt-fe-breadcrumbs');
        toolbar.append(breadcrumbs);
        toolbar.append(iconButton('fa-solid fa-rotate', 'Refresh', () => host.refreshAll()));
        toolbar.append(iconButton('fa-regular fa-file-circle-plus', 'New file', () => host.createEntry(false)));
        toolbar.append(iconButton('fa-regular fa-folder-plus', 'New folder', () => host.createEntry(true)));
        toolbar.append(iconButton('fa-solid fa-upload', 'Upload files', () => overlays.uploadFiles()));
        toolbar.append(iconButton('fa-solid fa-list', 'Details view', () => host.setView('details')));
        toolbar.append(iconButton('fa-solid fa-table-cells-large', 'Card view', () => host.setView('cards')));
        toolbar.append(iconButton('fa-regular fa-eye', 'Show hidden files', () => {
            state.showHidden = !state.showHidden;
            localStorage.setItem('tt.fileExplorer.hidden', state.showHidden ? '1' : '0');
            host.refreshView();
        }));
        dock.append(toolbar);

        const search = el('input', 'tt-fe-search');
        search.type = 'search';
        search.placeholder = 'Filter this folder';
        search.setAttribute('aria-label', 'Filter this folder');
        search.addEventListener('input', () => {
            state.filter = search.value.trim().toLowerCase();
            host.refreshView();
        });
        dock.append(search);

        content = el('div', 'tt-fe-content');
        content.addEventListener('dragover', (event) => overlays.onContentDragOver(event));
        content.addEventListener('drop', (event) => overlays.onContentDrop(event));
        dock.append(content);

        footer = el('footer', 'tt-fe-footer');
        dock.append(footer);
        mount.append(dock);
    }
    function buildToggle() {
        toggle = el('button', 'tt-fe-edge-toggle');
        toggle.id = 'tt-file-explorer-toggle';
        toggle.type = 'button';
        toggle.title = 'File explorer (Ctrl+Shift+E)';
        toggle.setAttribute('aria-label', 'Toggle file explorer');
        toggle.append(el('i', 'fa-solid fa-folder-tree'));
        toggle.addEventListener('click', () => host.toggle());
        document.body.append(toggle);
    }
    async function loadState({ preserveExpanded = false } = {}) {
        try {
            const result = await api.state();
            state.mounts = result.mounts ?? [];
            state.primaryMountId = result.primaryMountId ?? null;
            if (!preserveExpanded) {
                state.currentMountId = state.primaryMountId ?? state.mounts[0]?.id ?? null;
                state.currentPath = '';
            }
            if (!state.currentMountId && state.mounts[0]) state.currentMountId = state.mounts[0].id;
            host.render();
        } catch (error) {
            host.setError(error);
        }
    }
    async function ensureChildren(mountId, path) {
        const key = keyOf(mountId, path);
        if (state.children.has(key)) return state.children.get(key);
        state.children.set(key, null);
        try {
            const entries = await api.list(mountId, path);
            const visible = entries
                .filter((entry) => state.showHidden || !entry.hidden)
                .filter((entry) => !state.filter || entry.name.toLowerCase().includes(state.filter))
                .sort((left, right) => compareEntries(state, left, right));
            state.children.set(key, visible);
        } catch (error) {
            state.children.set(key, []);
            host.setError(error);
        }
        return state.children.get(key) ?? [];
    }
    const isExpanded = (mountId, path) => state.expanded.has(keyOf(mountId, path));
    function toggleExpanded(mountId, path) {
        const key = keyOf(mountId, path);
        if (state.expanded.has(key)) state.expanded.delete(key);
        else state.expanded.add(key);
        if (state.expanded.has(key)) ensureChildren(mountId, path).then(host.render);
        host.render();
    }

    function select(mountId, entry, additive = false) {
        const key = keyOf(mountId, entry.path);
        if (additive) {
            if (state.selected.has(key)) state.selected.delete(key);
            else state.selected.add(key);
        } else {
            state.selected.clear();
            state.selected.add(key);
        }
        state.lastSelected = { mountId, entry };
        host.render();
    }

    async function addMount() {
        try {
            if (await api.pickMount()) await loadState({ preserveExpanded: false });
        } catch (error) {
            host.setError(error);
        }
    }

    async function setPrimary(mountId) {
        try {
            await api.setPrimary(mountId);
            await loadState({ preserveExpanded: true });
        } catch (error) {
            host.setError(error);
        }
    }

    async function removeMount(mountId) {
        if (!window.confirm('Remove this vault from the explorer? Files are not deleted.')) return;
        try {
            await api.removeMount(mountId);
            state.children.clear();
            await loadState({ preserveExpanded: false });
        } catch (error) {
            host.setError(error);
        }
    }

    async function renameMount(vault) {
        const name = window.prompt('Mount name', vault.name);
        if (!name) return;
        try {
            await api.renameMount(vault.id, name);
            await loadState({ preserveExpanded: true });
        } catch (error) {
            host.setError(error);
        }
    }

    async function createEntry(directory) {
        const vault = state.mounts.find((item) => item.id === state.currentMountId);
        if (!vault) return;
        const name = window.prompt(directory ? 'New folder name' : 'New file name');
        if (!name) return;
        try {
            await api.createEntry(vault.id, state.currentPath, name, directory);
            await refreshPaths([vault.id]);
        } catch (error) {
            host.setError(error);
        }
    }

    async function renameEntry(vault, entry) {
        const name = window.prompt('Rename', entry.name);
        if (!name || name === entry.name) return;
        try {
            await api.renameEntry(vault.id, entry.path, name);
            await refreshPaths([vault.id]);
        } catch (error) {
            host.setError(error);
        }
    }

    async function deleteEntries(vault, entries) {
        if (entries.length === 0) return;
        const label = entries.length === 1 ? entries[0].name : `${entries.length} entries`;
        if (!window.confirm(`Move ${label} to the recycle bin?`)) return;
        try {
            await api.deleteEntries(vault.id, entries.map((entry) => entry.path), true);
            state.selected.clear();
            await refreshPaths([vault.id]);
        } catch (error) {
            host.setError(error);
        }
    }

    async function refreshPaths(mountIds) {
        for (const mountId of new Set(mountIds)) {
            for (const key of [...state.children.keys()]) {
                if (key.startsWith(`${mountId}|`)) state.children.delete(key);
            }
        }
        await loadState({ preserveExpanded: true });
        const expansions = [...state.expanded];
        for (const key of expansions) {
            const separator = key.indexOf('|');
            const mountId = key.slice(0, separator);
            const path = key.slice(separator + 1);
            if (state.mounts.some((mount) => mount.id === mountId)) {
                await ensureChildren(mountId, path);
            }
        }
        host.render();
    }
    async function loadCurrent() {
        const vault = state.mounts.find((item) => item.id === state.currentMountId);
        if (!vault) return;
        await ensureChildren(vault.id, state.currentPath);
        host.render();
    }
    function openFolder(vault, entry) {
        state.currentMountId = vault.id;
        state.currentPath = entry.path;
        state.expanded.add(keyOf(vault.id, entry.path));
        ensureChildren(vault.id, entry.path).then(host.render);
        host.render();
    }
    function setView(view) {
        state.view = view;
        localStorage.setItem(LS_VIEW, view);
        host.loadCurrent();
    }
    function openDock() {
        if (!dock) buildDock();
        dock.hidden = false;
        document.body.classList.add('tt-fe-open');
        applyWidth(dockWidth());
        if (state.currentMountId) state.expanded.add(keyOf(state.currentMountId, ''));
        loadState({ preserveExpanded: true }).then(loadCurrent);
        closeRightNav();
    }

    function closeDock() {
        if (!dock) return;
        dock.hidden = true;
        document.body.classList.remove('tt-fe-open');
        overlays.closePreview();
        overlays.closeContextMenu();
    }

    function toggleDock() {
        if (!dock || dock.hidden) openDock();
        else closeDock();
    }
    function closeRightNav() {
        const panel = document.getElementById('right-nav-panel');
        if (panel?.classList.contains('openDrawer')) {
            document.querySelector('#rightNavHolder .drawer-toggle')?.click();
        }
        panel?.classList.remove('openDrawer');
    }

    function selectedEntries() {
        const result = [];
        for (const key of state.selected) {
            const separator = key.indexOf('|');
            const mountId = key.slice(0, separator);
            const path = key.slice(separator + 1);
            const vault = state.mounts.find((item) => item.id === mountId);
            if (!vault) continue;
            result.push({ vault, entry: findEntry(mountId, path) ?? { path, name: baseName(path), kind: 'file' } });
        }
        return result;
    }

    function findEntry(mountId, path) {
        for (const [key, entries] of state.children) {
            if (!key.startsWith(`${mountId}|`) || !entries) continue;
            const found = entries.find((entry) => entry.path === path);
            if (found) return found;
        }
        return null;
    }

    function moveSelection(direction, additive) {
        if (!state.visibleKeys.length) return;
        const currentKey = [...state.selected][0];
        const index = Math.max(0, state.visibleKeys.indexOf(currentKey));
        const next = state.visibleKeys[Math.min(state.visibleKeys.length - 1, Math.max(0, index + direction))];
        if (!next) return;
        const separator = next.indexOf('|');
        const mountId = next.slice(0, separator);
        const path = next.slice(separator + 1);
        const entry = findEntry(mountId, path) ?? { path, name: baseName(path), kind: path ? 'file' : 'directory' };
        select(mountId, entry, additive);
    }

    function bindKeyboard() {
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'e') {
                event.preventDefault();
                host.toggle();
                return;
            }
            if (dock?.hidden) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeDock();
                return;
            }
            const selected = selectedEntries();
            if (!selected.length) return;
            const [first] = selected;
            if (event.key === 'F2' && selected.length === 1) {
                event.preventDefault();
                host.renameEntry(first.vault, first.entry);
            } else if (event.key === 'Delete') {
                event.preventDefault();
                host.deleteEntries(first.vault, selected.map((item) => item.entry));
            } else if (event.key === 'Enter') {
                event.preventDefault();
                if (first.entry.kind === 'directory') host.toggleExpanded(first.vault.id, first.entry.path);
                else overlays.openPreview(first.vault.id, first.entry);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                moveSelection(event.key === 'ArrowDown' ? 1 : -1, event.shiftKey);
            } else if (event.ctrlKey && event.key.toLowerCase() === 'n') {
                event.preventDefault();
                host.createEntry(event.shiftKey);
            }
        });
        document.addEventListener('click', (event) => {
            if (event.target.closest('#rightNavHolder .drawer-toggle') && !dock?.hidden) closeDock();
        }, true);
    }

    function setError(error) {
        state.error = String(error?.message ?? error);
        host.render();
    }
    async function initialize() {
        buildToggle();
        applyWidth(dockWidth());
        bindKeyboard();
        window.addEventListener('focus', () => {
            if (!dock?.hidden) loadCurrent();
        });
        renderer = createRenderer(host);
        overlays = createOverlays(host);


        Object.assign(host, {
            addMount,
            setPrimary,
            removeMount,
            renameMount,
            createEntry,
            renameEntry,
            deleteEntries,
            refreshPaths,
            loadCurrent,
            openFolder,
            setView,
            render: () => renderer.render(),
            refreshAll: () => loadState({ preserveExpanded: true }).then(loadCurrent),
            refreshView: () => { state.children.clear(); loadCurrent(); },
            ensureChildren,
            isExpanded,
            toggleExpanded,
            select,
            setError,
            openPreview: overlays.openPreview,
            showMountMenu: overlays.showMountMenu,
            showEntryMenu: overlays.showEntryMenu,
            makeDropTarget: overlays.makeDropTarget,
            observeThumbnail: overlays.observeThumbnail,
            close: closeDock,
            toggle: toggleDock,
        });

        await loadState();
        if (state.primaryMountId) {
            state.expanded.add(keyOf(state.primaryMountId, ''));
            await loadCurrent();
        }
        window.__ttFileExplorer = { open: openDock, close: closeDock, toggle: toggleDock, state, api, refresh: loadCurrent };
    }

    void initialize();
    return { open: openDock, close: closeDock, toggle: toggleDock, state, api };
}

let installed = null;

export function installFileExplorer() {
    if (installed) return installed;
    installed = createFileExplorer();
    return installed;
}
