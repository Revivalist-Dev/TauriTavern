import {
    IMAGE_EXTENSIONS,
    TEXT_EXTENSIONS,
    baseName,
    el,
    iconFor,
    joinPath,
    keyOf,
    parentPath,
} from './helpers.js';

export function createOverlays(host) {
    const { api, state } = host;
    const thumbnailUrls = new Map();
    let contextMenu;
    let preview;
    let observer;

    function openPreview(vaultId, entry) {
        closePreview();
        const dock = host.getDock();
        if (!dock) return;
        preview = el('div', 'tt-fe-preview');
        const header = el('div', 'tt-fe-preview-header');
        const title = el('div', 'tt-fe-title');
        title.append(el('i', iconFor(entry)));
        title.append(el('span', '', entry.name));
        header.append(title);
        const close = el('button', 'tt-fe-icon-button');
        close.type = 'button';
        close.title = 'Close preview';
        close.append(el('i', 'fa-solid fa-xmark'));
        close.addEventListener('click', closePreview);
        header.append(close);
        preview.append(header);
        const body = el('div', 'tt-fe-preview-body');
        preview.append(body);
        dock.append(preview);
        body.append(el('div', 'tt-fe-empty', 'Loading...'));
        (async () => {
            try {
                if (IMAGE_EXTENSIONS.has(entry.extension)) {
                    const bytes = await api.readBytes(vaultId, entry.path);
                    const url = URL.createObjectURL(new Blob([bytes]));
                    const image = document.createElement('img');
                    image.src = url;
                    image.alt = entry.name;
                    image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
                    body.replaceChildren(image);
                } else if (TEXT_EXTENSIONS.has(entry.extension)) {
                    body.replaceChildren(el('pre', '', await api.readText(vaultId, entry.path)));
                } else {
                    body.replaceChildren(el('div', 'tt-fe-empty', 'No inline preview. Use Reveal in Explorer.'));
                }
            } catch (error) {
                body.replaceChildren(el('div', 'tt-fe-empty', String(error?.message ?? error)));
            }
        })();
    }

    function closePreview() {
        preview?.remove();
        preview = null;
    }

    function observeThumbnail(thumb, mountId, path) {
        const content = host.getContent();
        if (!observer) {
            observer = new IntersectionObserver((entries) => {
                for (const item of entries) {
                    if (!item.isIntersecting) continue;
                    observer.unobserve(item.target);
                    loadThumbnail(item.target);
                }
            }, { root: content, rootMargin: '80px' });
        }
        observer.observe(thumb);
        thumb.__mountId = mountId;
        thumb.__path = path;
    }

    async function loadThumbnail(thumb) {
        try {
            const cacheKey = keyOf(thumb.__mountId, thumb.__path);
            let url = thumbnailUrls.get(cacheKey);
            if (!url) {
                const bytes = await api.thumbnail(thumb.__mountId, thumb.__path);
                url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
                thumbnailUrls.set(cacheKey, url);
            }
            const image = document.createElement('img');
            image.src = url;
            image.alt = '';
            thumb.replaceChildren(image);
        } catch {
            thumb.replaceChildren(el('i', 'fa-regular fa-image'));
        }
    }

    function showMountMenu(event, vault) {
        showContextMenu(event, [
            { label: vault.id === state.primaryMountId ? 'Primary vault' : 'Set as primary', action: () => host.setPrimary(vault.id) },
            { label: 'Rename mount', action: () => host.renameMount(vault) },
            { label: 'Remove mount', danger: true, action: () => host.removeMount(vault.id) },
        ]);
    }

    function showEntryMenu(event, vault, entry) {
        const items = [
            { label: entry.kind === 'directory' ? 'Open folder' : 'Open in tab', action: () => {
                if (entry.kind === 'directory') host.openFolder(vault, entry);
                else host.openFileInTab(vault.id, entry);
            } },
            { label: 'Reveal in Explorer', action: () => api.reveal(vault.id, entry.path).catch(host.setError) },
            { label: 'Copy path', action: () => navigator.clipboard?.writeText(entry.path).catch(() => {}) },
        ];
        if (entry.kind !== 'directory') {
            items.push({ label: 'Download', action: () => api.exportEntry(vault.id, entry.path).catch(host.setError) });
        }
        items.push(
            { label: 'Rename', action: () => host.renameEntry(vault, entry) },
            { label: 'Delete', danger: true, action: () => host.deleteEntries(vault, [entry]) },
        );
        showContextMenu(event, items);
    }

    function showContextMenu(event, items) {
        closeContextMenu();
        contextMenu = el('div', 'tt-fe-context-menu');
        contextMenu.setAttribute('role', 'menu');
        for (const item of items) {
            const button = el(
                'button',
                `menu_button tt-fe-context-item${item.danger ? ' tt-fe-danger' : ''}`,
                item.label,
            );
            button.type = 'button';
            button.setAttribute('role', 'menuitem');
            button.addEventListener('click', () => {
                closeContextMenu();
                item.action();
            });
            contextMenu.append(button);
        }
        document.body.append(contextMenu);
        const rect = contextMenu.getBoundingClientRect();
        contextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
        contextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
        setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
    }

    function closeContextMenu() {
        contextMenu?.remove();
        contextMenu = null;
    }

    function makeDropTarget(node, mountId, path) {
        node.addEventListener('dragover', (event) => {
            if (!event.dataTransfer.types.includes('application/x-tt-vault')) return;
            event.preventDefault();
            node.classList.add('tt-fe-drop-target');
        });
        node.addEventListener('dragleave', () => node.classList.remove('tt-fe-drop-target'));
        node.addEventListener('drop', (event) => {
            node.classList.remove('tt-fe-drop-target');
            const raw = event.dataTransfer.getData('application/x-tt-vault');
            if (!raw) return;
            event.preventDefault();
            event.stopPropagation();
            try {
                moveEntries(JSON.parse(raw), mountId, path, event.ctrlKey);
            } catch (error) {
                host.setError(error);
            }
        });
    }

    async function moveEntries(source, destinationMount, destinationDir, copy) {
        if (source.mountId === destinationMount && source.path === destinationDir) return;
        const sourceParent = parentPath(source.path);
        if (source.mountId === destinationMount && sourceParent === destinationDir) return;
        try {
            state.loading = true;
            host.render();
            await api.moveEntries(source.mountId, [source.path], destinationMount, destinationDir, copy);
            await host.refreshPaths([source.mountId, destinationMount]);
        } catch (error) {
            host.setError(error);
        } finally {
            state.loading = false;
            host.render();
        }
    }

    function onContentDragOver(event) {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }

    async function onContentDrop(event) {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        const vault = state.mounts.find((item) => item.id === state.currentMountId);
        if (!vault) return;
        const items = await collectDroppedEntries(event.dataTransfer);
        await importEntries(vault.id, state.currentPath, items);
    }

    async function collectDroppedEntries(dataTransfer) {
        const result = [];
        for (const item of [...(dataTransfer.items ?? [])]) {
            if (item.kind !== 'file') continue;
            const entry = item.webkitGetAsEntry?.();
            if (entry) await walkEntry(entry, '', result);
            else {
                const file = item.getAsFile();
                if (file) result.push({ file, relativePath: file.name });
            }
        }
        return result;
    }

    async function walkEntry(entry, parent, result) {
        if (entry.isFile) {
            const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
            result.push({ file, relativePath: joinPath(parent, file.name) });
            return;
        }
        if (!entry.isDirectory) return;
        const reader = entry.createReader();
        const children = await new Promise((resolve, reject) => {
            const collected = [];
            const read = () => reader.readEntries((batch) => {
                if (batch.length === 0) resolve(collected);
                else { collected.push(...batch); read(); }
            }, reject);
            read();
        });
        for (const child of children) await walkEntry(child, joinPath(parent, entry.name), result);
    }

    async function importEntries(mountId, parent, items) {
        if (items.length === 0) return;
        state.loading = true;
        host.render();
        try {
            for (const item of items) {
                const parts = item.relativePath.split('/').filter(Boolean);
                const name = parts.pop();
                let directory = parent;
                for (const part of parts) {
                    directory = joinPath(directory, part);
                    try {
                        await api.createEntry(mountId, parentPath(directory), part, true);
                    } catch (error) {
                        if (error?.code !== 'exists') throw error;
                    }
                }
                const bytes = new Uint8Array(await item.file.arrayBuffer());
                try {
                    await api.writeFile(mountId, directory, name, bytes, false);
                } catch (error) {
                    if (error?.code === 'exists' && window.confirm(`Replace ${name}?`)) {
                        await api.writeFile(mountId, directory, name, bytes, true);
                    } else if (error?.code !== 'exists') {
                        throw error;
                    }
                }
            }
            await host.refreshPaths([mountId]);
        } catch (error) {
            host.setError(error);
        } finally {
            state.loading = false;
            host.render();
        }
    }

    function uploadFiles() {
        const vault = state.mounts.find((item) => item.id === state.currentMountId);
        if (!vault) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.addEventListener('change', async () => {
            const items = [...input.files ?? []].map((file) => ({ file, relativePath: file.name }));
            await importEntries(vault.id, state.currentPath, items);
        });
        input.click();
    }

    return {
        openPreview,
        closePreview,
        observeThumbnail,
        showMountMenu,
        showEntryMenu,
        showContextMenu,
        closeContextMenu,
        makeDropTarget,
        onContentDragOver,
        onContentDrop,
        uploadFiles,
    };
}
