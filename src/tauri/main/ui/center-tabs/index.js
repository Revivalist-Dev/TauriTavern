const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'mdc', 'txt', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'rs', 'py', 'go', 'java', 'kt', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'log', 'csv', 'sql', 'graphql', 'gql', 'ini', 'cfg', 'conf', 'env', 'properties', 'svelte', 'vue', 'astro']);

const TAVERN_TAB = Object.freeze({ id: 'tavern', kind: 'tavern', title: 'TauriTavern', pinned: true });

let installed = false;
let tabs = [];
let activeId = TAVERN_TAB.id;
let tabsRoot;
let tabsList;
let fileView;
let filePath;
let fileBody;
let fileOpenExternal;
let fileEdit;
let fileSave;
let fileCancel;
let fileTab = null;
let rightMode = 'explorer';
let rightActiveId = null;
let rightTabsStrip = null;
let rightPanelHost = null;
let rightPanelRetry = null;

function vaultApi() {
    return window.__TT_VAULT_API__ ?? window.__TAURITAVERN__?.api?.vault ?? null;
}

function extensionOf(name) {
    return String(name || '').split('.').pop().toLowerCase();
}

function iconFor(tab) {
    if (tab.kind === 'tavern') return 'fa-solid fa-comments';
    return IMAGE_EXTENSIONS.has(extensionOf(tab.name)) ? 'fa-regular fa-image' : 'fa-regular fa-file-lines';
}

function ensureShell() {
    if (tabsRoot) return;
    tabsRoot = document.createElement('div');
    tabsRoot.id = 'tt-center-tabs';
    tabsRoot.setAttribute('role', 'tablist');
    tabsRoot.setAttribute('aria-label', 'Center pane tabs');

    tabsList = document.createElement('div');
    tabsList.id = 'tt-center-tabs-list';
    tabsList.className = 'tt-ui-tablist';
    tabsList.dataset.ttUi = 'tabs';
    tabsRoot.append(tabsList);

    fileView = document.createElement('section');
    fileView.id = 'tt-center-file';
    fileView.hidden = true;
    fileView.setAttribute('aria-label', 'File viewer');

    const header = document.createElement('div');
    header.id = 'tt-center-file-header';
    filePath = document.createElement('span');
    filePath.id = 'tt-center-file-path';
    fileEdit = document.createElement('button');
    fileEdit.type = 'button';
    fileEdit.id = 'tt-center-file-edit';
    fileEdit.className = 'menu_button';
    fileEdit.title = 'Edit file';
    fileEdit.innerHTML = '<i class="fa-solid fa-pen"></i>';
    fileEdit.addEventListener('click', () => {
        if (!fileTab || !isTextTab(fileTab)) return;
        fileTab.draft = fileTab.content ?? '';
        fileTab.editing = true;
        renderFileBody(fileTab);
        syncFileButtons(fileTab);
    });
    fileSave = document.createElement('button');
    fileSave.type = 'button';
    fileSave.id = 'tt-center-file-save';
    fileSave.className = 'menu_button';
    fileSave.title = 'Save file';
    fileSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';
    fileSave.addEventListener('click', () => { void saveFile(fileTab); });
    fileCancel = document.createElement('button');
    fileCancel.type = 'button';
    fileCancel.id = 'tt-center-file-cancel';
    fileCancel.className = 'menu_button';
    fileCancel.title = 'Cancel editing';
    fileCancel.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    fileCancel.addEventListener('click', () => {
        if (!fileTab) return;
        fileTab.editing = false;
        fileTab.draft = fileTab.content;
        renderFileBody(fileTab);
        syncFileButtons(fileTab);
    });
    fileOpenExternal = document.createElement('button');
    fileOpenExternal.type = 'button';
    fileOpenExternal.id = 'tt-center-file-open';
    fileOpenExternal.className = 'menu_button';
    fileOpenExternal.title = 'Open in external editor';
    fileOpenExternal.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i>';
    fileOpenExternal.addEventListener('click', () => {
        if (!fileTab) return;
        void vaultApi()?.open?.(fileTab.mountId, fileTab.path);
    });
    header.append(filePath, fileEdit, fileSave, fileCancel, fileOpenExternal);

    fileBody = document.createElement('div');
    fileBody.id = 'tt-center-file-body';
    fileView.append(header, fileBody);

    document.body.append(tabsRoot, fileView);
}

function rightPanelTabs() {
    return tabs.filter((tab) => tab.panel === 'right');
}

function ensureRightPanel() {
    const dock = document.querySelector('#tt-file-explorer');
    if (!dock) return false;
    if (!rightTabsStrip || !rightTabsStrip.isConnected) {
        rightTabsStrip = dock.querySelector('#tt-right-tabs');
        if (!rightTabsStrip) {
            rightTabsStrip = document.createElement('div');
            rightTabsStrip.id = 'tt-right-tabs';
            rightTabsStrip.className = 'tt-right-tabs';
            rightTabsStrip.setAttribute('role', 'tablist');
            dock.prepend(rightTabsStrip);
        }
    }
    if (!rightPanelHost || !rightPanelHost.isConnected) {
        rightPanelHost = dock.querySelector('#tt-right-panel');
        if (!rightPanelHost) {
            rightPanelHost = document.createElement('div');
            rightPanelHost.id = 'tt-right-panel';
            rightPanelHost.className = 'tt-right-panel';
            dock.append(rightPanelHost);
        }
    }
    return true;
}

function scheduleRightPanelInit() {
    if (rightPanelRetry) return;
    let attempts = 0;
    rightPanelRetry = setInterval(() => {
        attempts += 1;
        if (ensureRightPanel() || attempts > 40) {
            clearInterval(rightPanelRetry);
            rightPanelRetry = null;
            renderRightTabs();
            syncRightPanelMode();
        }
    }, 100);
}

function syncRightPanelMode() {
    const dock = document.querySelector('#tt-file-explorer');
    const fileActive = rightMode === 'tab' && Boolean(rightActiveId);
    const hasRightTabs = rightPanelTabs().length > 0;
    if (rightTabsStrip) rightTabsStrip.hidden = !hasRightTabs;
    if (rightPanelHost) rightPanelHost.hidden = !fileActive;
    dock?.classList.toggle('tt-right-tab-mode', fileActive);
    if (!fileView) return;

    if (fileActive) {
        if (rightPanelHost) {
            rightPanelHost.append(fileView);
            fileView.classList.add('tt-center-file-in-right');
        }
        fileView.hidden = false;
    } else {
        if (fileView.parentElement === rightPanelHost) document.body.append(fileView);
        fileView.classList.remove('tt-center-file-in-right');
        fileView.hidden = activeId === TAVERN_TAB.id;
    }
    document.body.classList.toggle('tt-center-file-active', fileActive || activeId !== TAVERN_TAB.id);
}

function makeRightTabButton(label, iconClass, active, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tt-right-tab${active ? ' tt-right-tab-active' : ''}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(active));
    button.innerHTML = `<i class="${iconClass}"></i><span>${label}</span>`;
    button.addEventListener('click', onClick);
    return button;
}

function renderRightTabs() {
    if (!ensureRightPanel() || !rightTabsStrip) return;
    const rightTabs = rightPanelTabs();
    rightTabsStrip.replaceChildren();
    rightTabsStrip.hidden = rightTabs.length === 0;

    const explorer = makeRightTabButton('Explorer', 'fa-solid fa-folder-tree', rightMode === 'explorer', showExplorer);
    explorer.classList.add('tt-right-tab-explorer');
    rightTabsStrip.append(explorer);

    for (const tab of rightTabs) {
        const active = rightMode === 'tab' && rightActiveId === tab.id;
        const wrapper = document.createElement('div');
        wrapper.className = `tt-right-tab${active ? ' tt-right-tab-active' : ''}`;
        wrapper.setAttribute('role', 'tab');
        wrapper.setAttribute('aria-selected', String(active));
        wrapper.title = tab.path ? `${tab.mountId}/${tab.path}` : tab.title;
        wrapper.dataset.tabId = tab.id;
        wrapper.addEventListener('click', () => activateRight(tab.id));

        const label = document.createElement('span');
        label.className = 'tt-right-tab-label';
        label.innerHTML = `<i class="${iconFor(tab)}"></i><span>${tab.title}</span>`;
        wrapper.append(label);

        const move = document.createElement('button');
        move.type = 'button';
        move.className = 'tt-right-tab-action';
        move.title = 'Move tab back to center';
        move.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
        move.addEventListener('click', (event) => {
            event.stopPropagation();
            moveTabToCenter(tab.id);
        });
        wrapper.append(move);

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'tt-right-tab-action tt-right-tab-close';
        close.title = `Close ${tab.title}`;
        close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        close.addEventListener('click', (event) => {
            event.stopPropagation();
            closeTab(tab.id);
        });
        wrapper.append(close);
        rightTabsStrip.append(wrapper);
    }
}

function showExplorer() {
    rightMode = 'explorer';
    rightActiveId = null;
    const active = tabs.find((tab) => tab.id === activeId);
    if (!active || active.panel === 'right') activeId = TAVERN_TAB.id;
    if (fileView?.parentElement === rightPanelHost) document.body.append(fileView);
    render();
}

function moveTabToRight(id) {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab || tab.pinned) return;
    tab.panel = 'right';
    activeId = id;
    rightActiveId = id;
    rightMode = 'tab';
    ensureRightPanel();
    scheduleRightPanelInit();
    window.__ttFileExplorer?.open?.();
    activateRight(id);
}

function moveTabToCenter(id) {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    tab.panel = 'center';
    rightMode = 'explorer';
    rightActiveId = null;
    activeId = id;
    if (fileView?.parentElement === rightPanelHost) document.body.append(fileView);
    activate(id);
}

function activateRight(id) {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab || tab.panel !== 'right') return;
    ensureRightPanel();
    activeId = id;
    rightActiveId = id;
    rightMode = 'tab';
    window.__ttFileExplorer?.open?.();
    fileView.classList.add('tt-center-file-in-right');
    rightPanelHost?.append(fileView);
    showFileShell(tab);
    render();
    syncRightPanelMode();
    if (tab.kind === 'file' && !tab.editing) void loadFile(tab);
}

function render() {
    ensureShell();
    tabsList.replaceChildren();
    const centerTabs = tabs.filter((tab) => tab.panel !== 'right');
    for (const tab of centerTabs) {
        const element = document.createElement('div');
        element.className = 'tt-center-tab tt-ui-tab';
        element.dataset.ttUi = 'tab';
        element.setAttribute('role', 'tab');
        element.setAttribute('aria-selected', String(tab.id === activeId));
        element.classList.toggle('tt-center-tab-active', tab.id === activeId);
        element.classList.toggle('tt-center-tab-pinned', Boolean(tab.pinned));
        element.dataset.tabId = tab.id;
        element.setAttribute('role', 'tab');
        element.setAttribute('aria-selected', String(tab.id === activeId));
        element.tabIndex = tab.id === activeId ? 0 : -1;
        element.title = tab.path ? `${tab.mountId}/${tab.path}` : tab.title;

        const icon = document.createElement('i');
        icon.className = iconFor(tab);
        const label = document.createElement('span');
        label.className = 'tt-center-tab-label';
        label.textContent = tab.title;
        element.append(icon, label);

        if (!tab.pinned) {
            const move = document.createElement('button');
            move.type = 'button';
            move.className = 'tt-center-tab-move';
            move.title = 'Move to right panel';
            move.setAttribute('aria-label', `Move ${tab.title} to right panel`);
            move.innerHTML = '<i class="fa-solid fa-table-columns"></i>';
            move.addEventListener('click', (event) => {
                event.stopPropagation();
                moveTabToRight(tab.id);
            });
            element.append(move);

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'tt-center-tab-close';
            close.title = `Close ${tab.title}`;
            close.setAttribute('aria-label', `Close ${tab.title}`);
            close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            close.addEventListener('click', (event) => {
                event.stopPropagation();
                closeTab(tab.id);
            });
            element.append(close);
        }

        element.addEventListener('click', () => activate(tab.id));
        element.addEventListener('auxclick', (event) => {
            if (event.button === 1 && !tab.pinned) {
                event.preventDefault();
                closeTab(tab.id);
            }
        });
        tabsList.append(element);
    }
    const active = tabsList.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`);
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rightActive = rightMode === 'tab' && rightPanelTabs().some((tab) => tab.id === activeId);
    fileView.hidden = !rightActive && activeId === TAVERN_TAB.id;
    document.body.classList.toggle('tt-center-file-active', rightActive || activeId !== TAVERN_TAB.id);
    renderRightTabs();
    syncRightPanelMode();
}

function isTextTab(tab) {
    if (!tab) return false;
    const ext = extensionOf(tab.name || tab.path);
    return !IMAGE_EXTENSIONS.has(ext) && (TEXT_EXTENSIONS.has(ext) || !ext);
}

function splitVaultPath(path) {
    const normalized = String(path || '').replace(/\\/g, '/');
    const slash = normalized.lastIndexOf('/');
    return slash < 0
        ? { parent: '', name: normalized }
        : { parent: normalized.slice(0, slash), name: normalized.slice(slash + 1) };
}

function syncFileButtons(tab) {
    if (!fileEdit) return;
    const text = isTextTab(tab);
    fileEdit.hidden = !text || Boolean(tab?.editing);
    fileSave.hidden = !tab?.editing;
    fileCancel.hidden = !tab?.editing;
    fileSave.disabled = !tab?.editing;
    fileEdit.setAttribute('aria-pressed', String(Boolean(tab?.editing)));
}

function renderFileBody(tab) {
    fileBody.replaceChildren();
    if (!tab) return;
    if (tab.editing) {
        const editor = document.createElement('textarea');
        editor.id = 'tt-center-file-editor';
        editor.className = 'tt-center-file-editor';
        editor.spellcheck = false;
        editor.value = tab.draft ?? '';
        editor.addEventListener('input', () => {
            tab.draft = editor.value;
        });
        editor.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void saveFile(tab);
            }
            if (event.key === 'Escape') {
                tab.editing = false;
                tab.draft = tab.content;
                renderFileBody(tab);
                syncFileButtons(tab);
            }
        });
        fileBody.append(editor);
        editor.focus();
        return;
    }
    if (tab.content !== undefined) {
        const pre = document.createElement('pre');
        pre.className = 'tt-center-file-text';
        pre.textContent = tab.content;
        fileBody.append(pre);
        return;
    }
    const loading = document.createElement('div');
    loading.className = 'tt-center-file-status';
    loading.textContent = 'Loading...';
    fileBody.append(loading);
}

async function saveFile(tab) {
    const api = vaultApi();
    if (!tab || !api || !isTextTab(tab)) return;
    const { parent, name } = splitVaultPath(tab.path);
    try {
        const bytes = new TextEncoder().encode(tab.draft ?? '');
        await api.writeFile(tab.mountId, parent, name, bytes, true);
        tab.content = tab.draft ?? '';
        tab.editing = false;
        tab.draft = tab.content;
        renderFileBody(tab);
        syncFileButtons(tab);
        window.toastr?.success?.(`Saved ${tab.name}`);
    } catch (error) {
        window.toastr?.error?.(String(error?.message ?? error));
    }
}

function showFileShell(tab) {
    fileTab = tab;
    filePath.textContent = `${tab.mountId}/${tab.path}`;
    syncFileButtons(tab);
    renderFileBody(tab);
}

async function loadFile(tab) {
    const api = vaultApi();
    if (!api) {
        fileBody.replaceChildren(Object.assign(document.createElement('div'), {
            className: 'tt-center-file-status',
            textContent: 'Vault API unavailable.',
        }));
        return;
    }
    try {
        if (IMAGE_EXTENSIONS.has(extensionOf(tab.name))) {
            const bytes = await api.readBytes(tab.mountId, tab.path);
            const url = URL.createObjectURL(new Blob([bytes]));
            tab.objectUrl = url;
            const image = document.createElement('img');
            image.src = url;
            image.alt = tab.name;
            image.addEventListener('load', () => {
                if (tab.objectUrl === url) {
                    URL.revokeObjectURL(url);
                    tab.objectUrl = null;
                }
            }, { once: true });
            if (tabs.find((candidate) => candidate.id === tab.id) === tab) {
                fileBody.replaceChildren(image);
            }
        } else if (TEXT_EXTENSIONS.has(extensionOf(tab.name)) || !extensionOf(tab.name)) {
            const text = await api.readText(tab.mountId, tab.path);
            tab.content = text;
            tab.draft = text;
            if (tabs.find((candidate) => candidate.id === tab.id) === tab) {
                renderFileBody(tab);
                syncFileButtons(tab);
            }
        } else {
            const status = document.createElement('div');
            status.className = 'tt-center-file-status';
            status.textContent = 'No inline preview for this file type. Use Open externally.';
            fileBody.replaceChildren(status);
        }
    } catch (error) {
        const status = document.createElement('div');
        status.className = 'tt-center-file-status tt-center-file-error';
        status.textContent = String(error?.message ?? error);
        fileBody.replaceChildren(status);
    }
}

export function activate(id) {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    if (tab.panel === 'right') {
        activateRight(id);
        return;
    }
    rightMode = 'explorer';
    rightActiveId = null;
    activeId = id;
    if (fileView?.parentElement === rightPanelHost) document.body.append(fileView);
    fileView.classList.remove('tt-center-file-in-right');
    if (tab.kind === 'file') showFileShell(tab);
    render();
    if (tab.kind === 'file' && !tab.editing) void loadFile(tab);
}

export function openFile({ mountId, path, name, extension } = {}) {
    ensureShell();
    const id = `file:${mountId}:${path}`;
    let tab = tabs.find((candidate) => candidate.id === id);
    if (!tab) {
        tab = {
            id,
            kind: 'file',
            mountId,
            path,
            name: name || String(path || '').split('/').pop() || 'Untitled',
            title: name || String(path || '').split('/').pop() || 'Untitled',
            extension: extension || extensionOf(name || path),
            panel: 'center',
        };
        tabs.push(tab);
        activate(id);
        return tab;
    }
    activate(id);
    return tab;
}

export function closeTab(id) {
    if (id === TAVERN_TAB.id) return;
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const tab = tabs[index];
    if (tab?.editing && (tab.draft ?? '') !== (tab.content ?? '')) {
        if (!window.confirm('Discard unsaved changes?')) return;
    }
    const [removed] = tabs.splice(index, 1);
    if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl);
    if (removed?.panel === 'right') {
        rightMode = 'explorer';
        rightActiveId = null;
        if (fileView?.parentElement === rightPanelHost) document.body.append(fileView);
    }
    if (activeId === id) {
        const next = tabs.filter((tab) => tab.panel === 'center')
            .reverse()
            .find((tab) => tab.id !== id) ?? TAVERN_TAB;
        activeId = next.id;
    }
    render();
}

export function listTabs() {
    return tabs.map((tab) => ({ ...tab }));
}

export function installCenterTabs() {
    if (installed) return window.__TT_CENTER_TABS__;
    installed = true;
    ensureShell();
    tabs = [TAVERN_TAB];
    activeId = TAVERN_TAB.id;
    tabsList?.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        const index = tabs.findIndex((tab) => tab.id === activeId);
        if (index < 0) return;
        event.preventDefault();
        const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        if (next) activate(next.id);
    });
    render();
    scheduleRightPanelInit();
    window.__TT_CENTER_TABS__ = {
        openFile,
        activate,
        close: closeTab,
        list: listTabs,
        moveToRight: moveTabToRight,
        moveToCenter: moveTabToCenter,
        showExplorer,
        panels: () => ({ rightMode, rightActiveId, right: rightPanelTabs().map(tab => tab.id) }),
    };
    return window.__TT_CENTER_TABS__;
}
