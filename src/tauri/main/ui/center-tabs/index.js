const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'js', 'ts', 'rs', 'py', 'sh', 'ps1', 'log', 'csv']);

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
let fileTab = null;

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
    tabsRoot.append(tabsList);

    fileView = document.createElement('section');
    fileView.id = 'tt-center-file';
    fileView.hidden = true;
    fileView.setAttribute('aria-label', 'File viewer');

    const header = document.createElement('div');
    header.id = 'tt-center-file-header';
    filePath = document.createElement('span');
    filePath.id = 'tt-center-file-path';
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
    header.append(filePath, fileOpenExternal);

    fileBody = document.createElement('div');
    fileBody.id = 'tt-center-file-body';
    fileView.append(header, fileBody);

    document.body.append(tabsRoot, fileView);
}

function render() {
    ensureShell();
    tabsList.replaceChildren();
    for (const tab of tabs) {
        const element = document.createElement('div');
        element.className = 'tt-center-tab';
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
    fileView.hidden = activeId === TAVERN_TAB.id;
    document.body.classList.toggle('tt-center-file-active', activeId !== TAVERN_TAB.id);
}

function showFileShell(tab) {
    fileTab = tab;
    filePath.textContent = `${tab.mountId}/${tab.path}`;
    fileBody.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'tt-center-file-status';
    loading.textContent = 'Loading...';
    fileBody.append(loading);
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
            if (tabs.find((candidate) => candidate.id === tab.id) === tab) {
                const pre = document.createElement('pre');
                pre.className = 'tt-center-file-text';
                pre.textContent = text;
                fileBody.replaceChildren(pre);
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
    activeId = id;
    if (tab.kind === 'file') showFileShell(tab);
    render();
    if (tab.kind === 'file') void loadFile(tab);
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
    const [removed] = tabs.splice(index, 1);
    if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl);
    if (activeId === id) {
        const next = tabs[Math.max(0, index - 1)] ?? TAVERN_TAB;
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
    window.__TT_CENTER_TABS__ = {
        openFile,
        activate,
        close: closeTab,
        list: listTabs,
    };
    return window.__TT_CENTER_TABS__;
}
