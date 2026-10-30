import { baseName } from './helpers.js';
import { parseFrontmatter, approximateTokens, clearMetadataCache } from './metadata.js';

const EXPERIMENT_ROOTS = ['Narrative-Experiments', 'lore/Narrative-Experiments'];

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

export function createExperimentOverlay({ api, getMountId, mount = document.body }) {
    const state = {
        manifests: [],
        active: null,
        overlay: null,
        busy: false,
        error: '',
        mountId: null,
    };
    let menu = null;
    let button = null;
    let onChange = () => {};

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

    async function discover() {
        const mount = await mountId();
        if (!mount) return [];
        state.mountId = mount;
        const found = [];
        for (const root of EXPERIMENT_ROOTS) {
            let entries;
            try {
                entries = await api.list(mount, root);
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (entry.kind !== 'directory') continue;
                const manifestPath = joinPath(entry.path, 'experiment.json');
                try {
                    const manifest = await readJson(mount, manifestPath);
                    found.push({
                        id: entry.path,
                        label: manifest.title || manifest.name || baseName(entry.path),
                        summary: manifest.summary || manifest.description || '',
                        manifestPath,
                        manifest,
                    });
                } catch {
                    // A directory without a manifest is authoring material, not an experiment.
                }
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
                if (!base.startsWith('lore/') || normalized.startsWith('lore/')) return [normalized];
                return [normalized, `lore/${normalized}`];
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
                if (base.startsWith('lore/')) overlay.superseded.add(normalize(`lore/${frontmatter.supersedes}`));
            }
            let target = rel.replace(/^overrides\/?/, '');
            if (!target) continue;
            if (base.startsWith('lore/') && !target.startsWith('lore/')) target = `lore/${target}`;
            const name = baseName(target);
            overlay.overrides.set(target, {
                path: target,
                name,
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
        return overlay;
    }

    async function activate(id) {
        if (state.busy) return;
        const manifest = state.manifests.find((candidate) => candidate.id === id)
            ?? (await discover()).find((candidate) => candidate.id === id);
        if (!manifest) return;
        state.busy = true;
        state.error = '';
        try {
            state.active = manifest;
            state.overlay = await buildOverlay(manifest);
        } catch (error) {
            state.active = null;
            state.overlay = null;
            state.error = String(error?.message ?? error);
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
        state.active = null;
        state.overlay = null;
        state.error = '';
        closeMenu();
        clearMetadataCache();
        syncButton();
        onChange();
        window.dispatchEvent(new CustomEvent('tt:experiments-changed', { detail: status() }));
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
            byPath.set(path, replacement ? { ...entry, ...replacement } : entry);
        }

        for (const [path, override] of overrides) {
            if (parentOf(path) !== currentDir) continue;
            if (!byPath.has(path)) byPath.set(path, override);
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
                });
                seen.add(clean);
                continue;
            }
            result.push(entry);
        }

        for (const [path, override] of overrides) {
            if (seen.has(path) || result.some((entry) => normalize(entry.path).replace(/^lore\//, '') === path)) continue;
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
        syncButton();
        menu = document.createElement('div');
        menu.className = 'tt-fe-experiment-menu';
        const title = document.createElement('div');
        title.className = 'tt-fe-experiment-title';
        title.textContent = 'Narrative experiments';
        menu.append(title);
        const base = document.createElement('button');
        base.type = 'button';
        base.className = 'tt-fe-experiment-item';
        base.textContent = 'Base vault';
        base.classList.toggle('tt-fe-experiment-active', !state.active);
        base.addEventListener('click', deactivate);
        menu.append(base);
        for (const manifest of state.manifests) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'tt-fe-experiment-item';
            item.classList.toggle('tt-fe-experiment-active', state.active?.id === manifest.id);
            item.innerHTML = `<span>${escapeHtml(manifest.label)}</span><small>${escapeHtml(manifest.summary || manifest.id)}</small>`;
            item.addEventListener('click', () => void activate(manifest.id));
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

    return {
        discover,
        activate,
        deactivate,
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
