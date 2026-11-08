import { baseName } from './helpers.js';
import { parseFrontmatter, approximateTokens, clearMetadataCache } from './metadata.js';

const EXPERIMENT_ROOTS = ['.narrative', 'lore/.narrative', 'Narrative-Experiments', 'lore/Narrative-Experiments'];
const NARRATIVE_ROOT = '.narrative';
const ACTIVE_STORE_KEY = 'tt:narrative-overrides';

function joinPath(...parts) {
    return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

function normalize(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function parentOf(path) {
    const index = path.lastIndexOf('/');
    return index < 0 ? '' : path.slice(0, index);
}

function prettifyName(value) {
    return String(value || '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function currentChatKey() {
    const context = window.SillyTavern?.getContext?.();
    if (!context) return 'default';
    const chat = String(context.chatId ?? context.chatMetadata?.chat_id ?? '');
    const group = String(context.groupId ?? context.chatMetadata?.group_id ?? '');
    if (group) return `group:${group}:${chat}`;
    const character = String(
        context.characterId
        ?? context.character?.avatar
        ?? context.name2
        ?? '',
    );
    return `character:${character}:${chat}`;
}

function readActiveStore() {
    try {
        return JSON.parse(localStorage.getItem(ACTIVE_STORE_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

function writeActiveStore(store) {
    try {
        localStorage.setItem(ACTIVE_STORE_KEY, JSON.stringify(store));
    } catch {
        // Storage is optional; the active override still works for this session.
    }
}

export function createExperimentOverlay({ api, getMountId, mount = document.body }) {
    const state = {
        manifests: [],
        active: null,
        overlay: null,
        busy: false,
        error: '',
        mountId: null,
        chatKey: currentChatKey(),
    };
    let menu = null;
    let button = null;
    let onChange = () => {};
    let chatWatcher = null;

    function activeMount() {
        return typeof getMountId === 'function' ? getMountId() : getMountId;
    }

    async function readJson(mount, path) {
        const text = await api.readText(mount, path);
        return JSON.parse(String(text).replace(/^\uFEFF/, ''));
    }

    async function mountId() {
        const current = activeMount();
        if (current) return current;
        const vaultState = await api.state?.().catch(() => null);
        return vaultState?.primaryMountId ?? vaultState?.mounts?.[0]?.id ?? null;
    }

    async function listNarrativeFiles(mount, directory) {
        const files = [];
        const walk = async (path) => {
            let entries;
            try {
                entries = await api.list(mount, path);
            } catch {
                return;
            }
            for (const entry of entries) {
                if (entry.kind === 'directory') {
                    await walk(entry.path);
                } else if (/\.(md|markdown)$/i.test(entry.name || entry.path)) {
                    if (/^README\.md$/i.test(entry.name || '')) continue;
                    const relative = normalize(entry.path).slice(normalize(directory).length + 1);
                    if (relative) files.push(relative);
                }
            }
        };
        await walk(directory);
        return files;
    }

    async function discover() {
        const mount = await mountId();
        if (!mount) return [];
        state.mountId = mount;
        const found = [];
        const seen = new Set();
        for (const root of EXPERIMENT_ROOTS) {
            let entries;
            try {
                entries = await api.list(mount, root);
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (entry.kind !== 'directory') continue;
                if (seen.has(entry.path)) continue;
                seen.add(entry.path);
                const manifestPath = joinPath(entry.path, 'experiment.json');
                let manifest = null;
                try {
                    manifest = await readJson(mount, manifestPath);
                } catch {
                    if (root !== NARRATIVE_ROOT && root !== `lore/${NARRATIVE_ROOT}`) {
                        // A directory without a manifest in the legacy authoring bay is not an override.
                        continue;
                    }
                }
                let overrides = Array.isArray(manifest?.overrides) ? manifest.overrides : null;
                if (!overrides) {
                    overrides = await listNarrativeFiles(mount, entry.path);
                    if (!overrides.length) continue;
                    manifest = { ...(manifest || {}), overrides };
                }
                found.push({
                    id: entry.path,
                    label: manifest.title || manifest.name || prettifyName(baseName(entry.path)),
                    summary: manifest.summary || manifest.description
                        || `${overrides.length} override file${overrides.length === 1 ? '' : 's'}`,
                    manifestPath: manifest ? manifestPath : null,
                    manifest,
                });
            }
        }
        state.manifests = found;
        return found;
    }

    async function buildOverlay(manifest) {
        const mount = state.mountId ?? await mountId();
        if (!mount) throw new Error('No vault is mounted.');
        state.mountId = mount;
        const base = manifest.id;
        const overlay = {
            id: base,
            label: manifest.label,
            mountId: mount,
            removals: new Set((manifest.manifest.removals || []).flatMap((path) => {
                const normalized = normalize(path);
                const candidates = [normalized];
                if (!normalized.startsWith('lore/')) candidates.push(`lore/${normalized}`);
                if (normalized.startsWith('lore/')) candidates.push(normalized.slice(5));
                return candidates;
            })),
            superseded: new Set(),
            overrides: new Map(),
        };
        let readerName = null;
        try {
            const reader = JSON.parse(await api.readText(mount, joinPath(base, 'reader.json')));
            readerName = typeof reader.name === 'string' && reader.name.trim() ? reader.name.trim() : null;
        } catch {
            readerName = null;
        }
        for (const relative of manifest.manifest.overrides || []) {
            const rel = normalize(relative);
            const sourcePath = joinPath(base, rel);
            let text;
            try {
                text = await api.readText(mount, sourcePath);
            } catch {
                continue;
            }
            if (readerName) text = replaceOutsideFences(text, '{{user}}', readerName);
            const frontmatter = parseFrontmatter(text);
            if (frontmatter.supersedes) {
                overlay.superseded.add(normalize(frontmatter.supersedes));
                if (!normalize(frontmatter.supersedes).startsWith('lore/')) {
                    overlay.superseded.add(normalize(`lore/${frontmatter.supersedes}`));
                }
                if (base.startsWith('lore/')) overlay.superseded.add(normalize(`lore/${frontmatter.supersedes}`));
            }
            let target = rel.replace(/^overrides\/?/, '');
            if (!target) continue;
            if (base.startsWith('lore/') && !target.startsWith('lore/')) target = `lore/${target}`;
            const targets = new Set([target]);
            if (!target.startsWith('lore/')) targets.add(`lore/${target}`);
            else targets.add(target.slice(5));
            const name = baseName(target);
            for (const targetPath of targets) {
                overlay.overrides.set(targetPath, {
                    path: targetPath,
                    name: baseName(targetPath),
                    kind: 'file',
                    sourcePath,
                    readPath: sourcePath,
                    content: text,
                    size: new Blob([text]).size,
                    keys: frontmatter.keys,
                    summary: frontmatter.summary,
                    virtual: true,
                });
            }
        }
        return overlay;
    }

    function activeSelection() {
        return readActiveStore()[state.chatKey] || null;
    }

    function persistSelection(id) {
        const store = readActiveStore();
        if (id) store[state.chatKey] = id;
        else delete store[state.chatKey];
        writeActiveStore(store);
    }

    function clearActive() {
        state.active = null;
        state.overlay = null;
        state.error = '';
        clearMetadataCache();
        syncButton();
        onChange();
        window.dispatchEvent(new CustomEvent('tt:experiments-changed', { detail: status() }));
    }

    async function restoreForChat() {
        state.chatKey = currentChatKey();
        const selected = activeSelection();
        if (!selected) {
            clearActive();
            return;
        }
        const manifests = state.manifests.length ? state.manifests : await discover();
        const manifest = manifests.find((candidate) => candidate.id === selected);
        if (!manifest) {
            persistSelection(null);
            clearActive();
            return;
        }
        await activate(manifest.id, { persist: false });
    }

    async function activate(id, options = {}) {
        if (state.busy) return;
        const manifest = state.manifests.find((candidate) => candidate.id === id)
            ?? (await discover()).find((candidate) => candidate.id === id);
        if (!manifest) return;
        state.busy = true;
        state.error = '';
        try {
            state.active = manifest;
            state.overlay = await buildOverlay(manifest);
            if (options.persist !== false) persistSelection(manifest.id);
        } catch (error) {
            state.active = null;
            state.overlay = null;
            state.error = String(error?.message ?? error);
            if (options.persist !== false) persistSelection(null);
        } finally {
            state.busy = false;
            closeMenu();
            clearMetadataCache();
            syncButton();
            onChange();
            window.dispatchEvent(new CustomEvent('tt:experiments-changed', { detail: status() }));
        }
    }

    function deactivate() {
        persistSelection(null);
        clearActive();
        closeMenu();
    }

    function startChatWatcher() {
        if (chatWatcher) return;
        chatWatcher = setInterval(() => {
            const key = currentChatKey();
            if (key === state.chatKey) return;
            void restoreForChat();
        }, 500);
    }

    function syncButton() {
        button?.classList.toggle('tt-fe-experiment-active', Boolean(state.active));
    }

    function transformEntries(mountId, dir, entries) {
        if (!state.overlay || (activeMount() && mountId !== activeMount())) return entries;
        const removed = state.overlay.removals;
        const superseded = state.overlay.superseded;
        const overrides = state.overlay.overrides;
        const currentDir = normalize(dir);
        const byPath = new Map();

        for (const entry of entries) {
            const path = normalize(entry.path);
            if (removed.has(path) || superseded.has(path)) continue;
            const replacement = overrides.get(path);
            byPath.set(path, replacement ? {
                ...entry,
                ...replacement,
                override: true,
                overrideSource: `experiment:${state.active?.label ?? 'active'}`,
            } : entry);
        }

        for (const [path, override] of overrides) {
            if (parentOf(path) !== currentDir) continue;
            if (!byPath.has(path)) {
                byPath.set(path, {
                    ...override,
                    override: true,
                    overrideSource: `experiment:${state.active?.label ?? 'active'}`,
                });
            }
        }

        return [...byPath.values()];
    }

    function transformLoreEntries(entries) {
        if (!state.overlay) return entries;
        const removed = state.overlay.removals;
        const superseded = state.overlay.superseded;
        const overrides = state.overlay.overrides;
        const result = [];
        const seen = new Set();

        for (const entry of entries) {
            const path = normalize(entry.path);
            const clean = path.replace(/^lore\//, '');
            if (removed.has(path) || removed.has(clean) || superseded.has(path) || superseded.has(clean)) continue;
            const replacement = overrides.get(path) ?? overrides.get(clean);
            if (replacement) {
                result.push({
                    ...entry,
                    content: replacement.content,
                    keys: replacement.keys ?? entry.keys,
                    summary: replacement.summary ?? entry.summary,
                    title: replacement.name.replace(/\.md$/i, ''),
                    path: entry.path,
                    override: true,
                    overrideSource: `experiment:${state.active?.label ?? 'active'}`,
                });
                seen.add(clean);
                continue;
            }
            result.push(entry);
        }

        for (const [path, override] of overrides) {
            const cleanPath = path.replace(/^lore\//, '');
            if (seen.has(cleanPath) || result.some((entry) => normalize(entry.path).replace(/^lore\//, '') === cleanPath)) continue;
            result.push({
                title: override.name.replace(/\.md$/i, ''),
                folder: parentOf(path),
                path,
                content: override.content,
                keys: override.keys,
                summary: override.summary,
                tokenEstimate: approximateTokens(override.content),
                override: true,
            });
        }
        return result;
    }

    function readText(mountId, path) {
        if (!state.overlay || (activeMount() && mountId !== activeMount())) return null;
        const override = state.overlay.overrides.get(normalize(path));
        return override ? override.content : null;
    }

    function readTextByPath(path) {
        const normalized = normalize(path);
        return state.overlay?.overrides.get(normalized)?.content
            ?? state.overlay?.overrides.get(normalized.replace(/^lore\//, ''))?.content
            ?? null;
    }

    function isRemoved(mountId, path) {
        if (!state.overlay || (activeMount() && mountId !== activeMount())) return false;
        const normalized = normalize(path);
        const clean = normalized.replace(/^lore\//, '');
        return state.overlay.removals.has(normalized)
            || state.overlay.removals.has(clean)
            || state.overlay.superseded.has(normalized)
            || state.overlay.superseded.has(clean);
    }

    function readPath(path) {
        return state.overlay?.overrides.get(normalize(path))?.sourcePath ?? path;
    }

    function status() {
        return {
            active: state.active ? { id: state.active.id, label: state.active.label } : null,
            chatKey: state.chatKey,
            error: state.error,
        };
    }

    function closeMenu() {
        menu?.remove();
        menu = null;
        button?.classList.remove('tt-fe-experiment-open');
    }

    async function openMenu(control) {
        button = control;
        if (menu) {
            closeMenu();
            return;
        }
        button.classList.add('tt-fe-experiment-open');
        await discover();
        await restoreForChat();
        syncButton();
        menu = document.createElement('div');
        menu.className = 'tt-fe-experiment-menu';
        const title = document.createElement('div');
        title.className = 'tt-fe-experiment-title';
        title.textContent = 'Narratives';
        menu.append(title);

        const baseRow = document.createElement('div');
        baseRow.className = 'tt-fe-experiment-item';
        baseRow.classList.toggle('tt-fe-experiment-active', !state.active);
        baseRow.innerHTML = '<span>Base vault</span><small>Use the base lore directory</small>';
        const baseUse = document.createElement('button');
        baseUse.type = 'button';
        baseUse.className = 'tt-fe-experiment-use';
        baseUse.textContent = state.active ? 'Use' : 'Active';
        baseUse.disabled = !state.active;
        baseUse.addEventListener('click', (event) => {
            event.stopPropagation();
            deactivate();
        });
        baseRow.append(baseUse);
        menu.append(baseRow);

        for (const manifest of state.manifests) {
            const item = document.createElement('div');
            item.className = 'tt-fe-experiment-item';
            item.classList.toggle('tt-fe-experiment-active', state.active?.id === manifest.id);
            item.innerHTML = `<span>${escapeHtml(manifest.label)}</span><small>${escapeHtml(manifest.summary || manifest.id)}</small>`;
            const use = document.createElement('button');
            use.type = 'button';
            use.className = 'tt-fe-experiment-use';
            use.textContent = state.active?.id === manifest.id ? 'Active' : 'Use';
            use.disabled = state.active?.id === manifest.id;
            use.addEventListener('click', (event) => {
                event.stopPropagation();
                void activate(manifest.id);
            });
            item.append(use);
            item.addEventListener('click', () => {
                if (state.active?.id !== manifest.id) void activate(manifest.id);
            });
            menu.append(item);
        }
        if (state.error) {
            const error = document.createElement('div');
            error.className = 'tt-fe-experiment-error';
            error.textContent = state.error;
            menu.append(error);
        }
        const rect = control.getBoundingClientRect();
        menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 280)}px`;
        menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`;
        mount.append(menu);
        const dismiss = (event) => {
            if (!menu?.contains(event.target) && event.target !== control) {
                closeMenu();
                document.removeEventListener('pointerdown', dismiss, true);
            }
        };
        document.addEventListener('pointerdown', dismiss, true);
    }

    function setOnChange(callback) {
        onChange = callback;
        syncButton();
    }

    startChatWatcher();
    return {
        discover,
        activate,
        deactivate,
        restoreForChat,
        openMenu,
        closeMenu,
        setOnChange,
        transformEntries,
        transformLoreEntries,
        readText,
        readTextByPath,
        readPath,
        isRemoved,
        status,
        get active() { return state.active; },
    };
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function replaceOutsideFences(text, needle, replacement) {
    return String(text)
        .split(/(```[\s\S]*?```)/g)
        .map((part, index) => index % 2 === 0 ? part.split(needle).join(replacement) : part)
        .join('');
}
