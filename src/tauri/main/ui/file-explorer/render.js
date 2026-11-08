import {
    IMAGE_EXTENSIONS,
    el,
    iconFor,
    keyOf,
} from './helpers.js';
import { getEntryMetadata, showHoverCard, hideHoverCard, formatBytes } from './metadata.js';

export function createRenderer(host) {
    const { state } = host;

    function render() {
        renderMounts();
        renderBreadcrumbs();
        renderContent();
        const toggle = host.getToggle();
        if (toggle) toggle.classList.toggle('tt-fe-active', !host.getDock()?.hidden);
    }

    function renderMounts() {
        const list = host.getMountsList();
        if (!list) return;
        list.replaceChildren();
        if (state.mounts.length === 0) {
            list.append(el('div', 'tt-fe-empty', 'No vault folders yet. Add a folder to start browsing.'));
            return;
        }
        for (const vault of state.mounts) {
            const row = el('div', `tt-fe-mount${vault.id === state.primaryMountId ? ' tt-fe-primary' : ''}`);
            row.tabIndex = 0;
            row.title = vault.path;
            row.append(el('i', `tt-fe-node-icon tt-fe-folder fa-solid ${vault.available ? 'fa-folder-open' : 'fa-folder'}`));
            row.append(el('span', 'tt-fe-mount-name', vault.name));
            if (vault.id === state.primaryMountId) row.append(el('span', 'tt-fe-badge', 'Primary'));
            row.append(el('span', 'tt-fe-mount-path', vault.available ? '' : 'Missing'));
            row.addEventListener('click', () => {
                state.currentMountId = vault.id;
                state.currentPath = '';
                state.expanded.add(keyOf(vault.id, ''));
                host.ensureChildren(vault.id, '').then(render);
                render();
            });
            row.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                host.showMountMenu(event, vault);
            });
            list.append(row);
        }
    }

    function renderBreadcrumbs() {
        const breadcrumbs = host.getBreadcrumbs();
        if (!breadcrumbs) return;
        breadcrumbs.replaceChildren();
        const vault = state.mounts.find((item) => item.id === state.currentMountId);
        if (!vault) return;
        const root = el('button', 'tt-fe-breadcrumb tt-ui-breadcrumb', vault.name);
        root.type = 'button';
        root.addEventListener('click', () => {
            state.currentPath = '';
            state.expanded.add(keyOf(vault.id, ''));
            host.ensureChildren(vault.id, '').then(render);
            render();
        });
        breadcrumbs.append(root);
        let accumulated = '';
        for (const part of state.currentPath.split('/').filter(Boolean)) {
            accumulated = accumulated ? `${accumulated}/${part}` : part;
            breadcrumbs.append(el('span', 'tt-fe-separator tt-ui-breadcrumb__separator', '/'));
            const path = accumulated;
            const crumb = el('button', 'tt-fe-breadcrumb tt-ui-breadcrumb', part);
            crumb.type = 'button';
            crumb.addEventListener('click', () => {
                state.currentPath = path;
                host.ensureChildren(vault.id, path).then(render);
                render();
            });
            breadcrumbs.append(crumb);
        }
    }

    function renderContent() {
        const content = host.getContent();
        if (!content) return;
        content.replaceChildren();
        if (state.error) content.append(el('div', 'tt-fe-empty', state.error));
        if (state.view === 'cards') renderCards();
        else renderTree();
    }

    function renderTree() {
        const content = host.getContent();
        if (!content) return;
        if (state.mounts.length === 0) {
            content.append(el('div', 'tt-fe-empty', 'Add a vault folder to start browsing.'));
            return;
        }
        const tree = el('ul', 'tt-fe-tree');
        for (const vault of state.mounts) {
            const rootKey = keyOf(vault.id, '');
            const root = el('li');
            const row = el('div', 'tt-fe-node');
            row.dataset.key = rootKey;
            row.append(el('span', 'tt-fe-chevron', host.isExpanded(vault.id, '') ? '▾' : '▸'));
            row.append(el('i', 'tt-fe-node-icon tt-fe-folder fa-solid fa-hard-drive'));
            row.append(el('span', 'tt-fe-node-name', vault.name));
            if (vault.id === state.primaryMountId) row.append(el('span', 'tt-fe-badge', 'Primary'));
            if (vault.kind === 'lorebook') row.append(el('span', 'tt-fe-badge tt-fe-badge-lorebook', 'Lorebook'));
            if (state.selected.has(rootKey)) row.classList.add('tt-fe-selected');
            row.addEventListener('click', (event) => {
                state.currentMountId = vault.id;
                state.currentPath = '';
                host.select(vault.id, { path: '', kind: 'directory', name: vault.name }, event.ctrlKey || event.metaKey);
                host.toggleExpanded(vault.id, '');
            });
            row.addEventListener('dblclick', () => host.toggleExpanded(vault.id, ''));
            host.makeDropTarget(row, vault.id, '');
            root.append(row);
            if (host.isExpanded(vault.id, '')) {
                const children = state.children.get(rootKey);
                if (children === null) root.append(loadingRow());
                else if (children) root.append(renderTreeChildren(vault, '', children));
            }
            tree.append(root);
        }
        content.append(tree);
        collectVisibleKeys();
    }

    function renderTreeChildren(vault, parent, entries) {
        const list = el('ul');
        for (const entry of entries) {
            const key = keyOf(vault.id, entry.path);
            const node = el('li');
            const row = el('div', 'tt-fe-node');
            row.dataset.key = key;
            row.draggable = true;
            const expanded = host.isExpanded(vault.id, entry.path);
            const chevron = el('span', 'tt-fe-chevron', entry.kind === 'directory' ? (expanded ? '▾' : '▸') : '');
            if (entry.kind === 'directory') {
                chevron.classList.add('tt-fe-chevron--toggle');
                chevron.setAttribute('role', 'button');
                chevron.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${entry.name}`);
                chevron.addEventListener('click', (event) => {
                    event.stopPropagation();
                    state.currentMountId = vault.id;
                    host.toggleExpanded(vault.id, entry.path);
                });
            }
            row.append(chevron);
            const extra = entry.kind === 'directory' ? ' tt-fe-folder' : IMAGE_EXTENSIONS.has(entry.extension) ? ' tt-fe-image' : '';
            row.append(el('i', `tt-fe-node-icon ${iconFor(entry)}${extra}`));
            row.append(el('span', 'tt-fe-node-name', entry.name));
            const sessionOverride = window.__TT_VAULT_OVERRIDES__?.getState?.(entry.path) ?? null;
            const overridden = Boolean(entry.override || sessionOverride?.blocked);
            if (overridden) {
                row.classList.add('tt-fe-overridden');
                row.dataset.override = entry.overrideSource ?? sessionOverride?.source ?? 'override';
                row.title = entry.override
                    ? `Overridden by ${entry.overrideSource ?? 'an experiment'}`
                    : 'Blocked for this session';
                row.setAttribute('aria-label', `${entry.name}, overridden`);
                row.append(el('span', 'tt-fe-override-badge', 'Overridden'));
            }
            if (entry.kind !== 'directory') {
                const estimatedTokens = Math.max(1, Math.ceil(Number(entry.size ?? 0) / 4));
                const stats = el('span', 'tt-fe-node-meta', `~${estimatedTokens.toLocaleString()} tokens | ${formatBytes(entry.size)}`);
                row.append(stats);
                row.addEventListener('mouseenter', () => {
                    void getEntryMetadata(host, entry).then((metadata) => {
                        if (!row.isConnected || !row.matches(':hover') || !metadata) return;
                        stats.textContent = `~${metadata.tokens.toLocaleString()} tokens | ${formatBytes(metadata.size)}`;
                        showHoverCard(row, metadata, entry);
                    });
                });
                row.addEventListener('mouseleave', hideHoverCard);
            }
            const narrativeParent = entry.path.slice(0, Math.max(0, entry.path.lastIndexOf('/')));
            if (entry.kind === 'directory' && (narrativeParent === '.narrative' || narrativeParent === 'lore/.narrative')) {
                const active = window.__TT_EXPERIMENTS__?.active?.id === entry.path;
                const use = el('button', 'tt-fe-narrative-use', active ? 'Active' : 'Use');
                use.type = 'button';
                use.title = active
                    ? `${entry.name} is the active narrative for this chat`
                    : `Use ${entry.name} as the override for this chat`;
                use.disabled = active;
                use.addEventListener('click', (event) => {
                    event.stopPropagation();
                    void window.__TT_EXPERIMENTS__?.activate(entry.path);
                });
                row.append(use);
            }
            if (state.selected.has(key)) row.classList.add('tt-fe-selected');
            row.addEventListener('click', (event) => {
                host.select(vault.id, entry, event.ctrlKey || event.metaKey);
                state.currentMountId = vault.id;
                state.currentPath = parent;
            });
            row.addEventListener('dblclick', () => {
                if (entry.kind === 'directory') {
                    state.currentMountId = vault.id;
                    state.currentPath = entry.path;
                    host.toggleExpanded(vault.id, entry.path);
                } else {
                    host.openFileInTab(vault.id, entry);
                }
            });
            row.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                host.select(vault.id, entry, false);
                host.showEntryMenu(event, vault, entry);
            });
            row.addEventListener('dragstart', (event) => {
                event.dataTransfer.setData('application/x-tt-vault', JSON.stringify({
                    mountId: vault.id, path: entry.path, kind: entry.kind,
                }));
                event.dataTransfer.effectAllowed = 'copyMove';
            });
            if (entry.kind === 'directory') host.makeDropTarget(row, vault.id, entry.path);
            node.append(row);
            if (entry.kind === 'directory' && expanded) {
                const children = state.children.get(key);
                if (children === null) node.append(loadingRow());
                else if (children) node.append(renderTreeChildren(vault, entry.path, children));
            }
            list.append(node);
        }
        return list;
    }

    function loadingRow() {
        return el('div', 'tt-fe-empty', 'Loading...');
    }

    function collectVisibleKeys() {
        const content = host.getContent();
        state.visibleKeys = [...(content?.querySelectorAll('[data-key]') ?? [])].map((node) => node.dataset.key);
    }

    function renderCards() {
        const content = host.getContent();
        if (!content) return;
        const vault = state.mounts.find((item) => item.id === state.currentMountId);
        if (!vault) {
            content.append(el('div', 'tt-fe-empty', 'Choose a vault to browse.'));
            return;
        }
        const key = keyOf(vault.id, state.currentPath);
        if (!state.children.has(key)) {
            host.ensureChildren(vault.id, state.currentPath).then(render);
            content.append(loadingRow());
            return;
        }
        const entries = state.children.get(key) ?? [];
        if (entries.length === 0) {
            content.append(el('div', 'tt-fe-empty', 'This folder is empty.'));
            return;
        }
        const grid = el('div', 'tt-fe-cards');
        for (const entry of entries) {
            const card = el('div', 'tt-fe-card');
            card.tabIndex = 0;
            card.dataset.key = keyOf(vault.id, entry.path);
            if (state.selected.has(card.dataset.key)) card.classList.add('tt-fe-selected');
            const thumb = el('div', 'tt-fe-card-thumb');
            if (entry.kind === 'directory') thumb.append(el('i', 'fa-solid fa-folder'));
            else if (IMAGE_EXTENSIONS.has(entry.extension)) {
                thumb.dataset.thumbnail = entry.path;
                host.observeThumbnail(thumb, vault.id, entry.path);
            } else thumb.append(el('i', iconFor(entry)));
            card.append(thumb);
            card.append(el('div', 'tt-fe-card-name', entry.name));
            const sessionOverride = window.__TT_VAULT_OVERRIDES__?.getState?.(entry.path) ?? null;
            const overridden = Boolean(entry.override || sessionOverride?.blocked);
            if (overridden) {
                card.classList.add('tt-fe-overridden');
                card.dataset.override = entry.overrideSource ?? sessionOverride?.source ?? 'override';
                card.title = entry.override
                    ? `Overridden by ${entry.overrideSource ?? 'an experiment'}`
                    : 'Blocked for this session';
                card.append(el('span', 'tt-fe-override-badge', 'Overridden'));
            }
            if (entry.kind !== 'directory') {
                const estimatedTokens = Math.max(1, Math.ceil(Number(entry.size ?? 0) / 4));
                const stats = el('div', 'tt-fe-card-meta', `~${estimatedTokens.toLocaleString()} tokens | ${formatBytes(entry.size)}`);
                card.append(stats);
                card.addEventListener('mouseenter', () => {
                    void getEntryMetadata(host, entry).then((metadata) => {
                        if (!card.isConnected || !card.matches(':hover') || !metadata) return;
                        stats.textContent = `~${metadata.tokens.toLocaleString()} tokens | ${formatBytes(metadata.size)}`;
                        showHoverCard(card, metadata, entry);
                    });
                });
                card.addEventListener('mouseleave', hideHoverCard);
            }
            card.addEventListener('click', (event) => {
                host.select(vault.id, entry, event.ctrlKey || event.metaKey);
                state.currentMountId = vault.id;
                state.currentPath = parentOf(entry.path);
            });
            card.addEventListener('dblclick', () => {
                if (entry.kind === 'directory') host.openFolder(vault, entry);
                else host.openFileInTab(vault.id, entry);
            });
            card.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                host.select(vault.id, entry, false);
                host.showEntryMenu(event, vault, entry);
            });
            card.addEventListener('dragstart', (event) => {
                event.dataTransfer.setData('application/x-tt-vault', JSON.stringify({
                    mountId: vault.id, path: entry.path, kind: entry.kind,
                }));
                event.dataTransfer.effectAllowed = 'copyMove';
            });
            if (entry.kind === 'directory') host.makeDropTarget(card, vault.id, entry.path);
            grid.append(card);
        }
        content.append(grid);
        collectVisibleKeys();
    }

    return {
        render,
        renderMounts,
        renderBreadcrumbs,
        renderContent,
        renderTree,
        renderCards,
        collectVisibleKeys,
    };
}

function parentOf(path) {
    const index = path.lastIndexOf('/');
    return index === -1 ? '' : path.slice(0, index);
}
