const STORAGE_KEY = 'tauritavern_lore_defaults';

const DEFAULT_DEFAULTS = Object.freeze({
    version: 1,
    vault: {
        mountId: null,
        loreFolders: ['global'],
        useCharacterFolder: true,
        followExplorerFocus: true,
    },
    copilot: {
        profileId: null,
        connectionProfileId: null,
        model: null,
    },
    deeplore: {
        topK: 8,
        maxEntries: 24,
        tokenBudget: 3000,
        minScore: 0.35,
    },
});

let installed = false;
let overlay = null;
let listeners = new Set();
let currentFocus = null;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function merge(base, patch) {
    const result = clone(base);
    for (const [key, value] of Object.entries(patch ?? {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = merge(result[key] ?? {}, value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function extensionSettings() {
    return window.extension_settings
        ?? window.SillyTavern?.getContext?.()?.extensionSettings
        ?? null;
}

function saveSettings() {
    const save = window.saveSettingsDebounced
        ?? window.SillyTavern?.getContext?.()?.saveSettingsDebounced;
    if (typeof save === 'function') {
        save();
        return;
    }
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(get()));
    } catch {
        // Settings are unavailable before SillyTavern finishes booting.
    }
}

function normalize(raw) {
    const settings = merge(DEFAULT_DEFAULTS, raw ?? {});
    settings.version = 1;
    settings.vault.loreFolders = Array.isArray(settings.vault.loreFolders)
        ? settings.vault.loreFolders.map((folder) => String(folder).replace(/^lore\//, '')).filter(Boolean)
        : [];
    return settings;
}

function get() {
    const root = extensionSettings();
    let stored = root?.[STORAGE_KEY];
    if (!stored) {
        try {
            stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
        } catch {
            stored = null;
        }
    }
    return normalize(stored);
}

function persist(next) {
    const root = extensionSettings();
    if (root) root[STORAGE_KEY] = next;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // localStorage can be disabled by the embedded webview policy.
    }
    saveSettings();
    for (const listener of listeners) {
        try {
            listener(clone(next));
        } catch (error) {
            console.error('TauriTavern: lore defaults subscriber failed:', error);
        }
    }
    window.dispatchEvent(new CustomEvent('tt:lore-defaults-changed', { detail: clone(next) }));
}

function set(patch) {
    const next = normalize(merge(get(), patch));
    persist(next);
    return next;
}

function subscribe(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

function field(labelText, control) {
    const label = document.createElement('label');
    label.className = 'tt-lore-default-field';
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(span, control);
    return label;
}

function section(titleText) {
    const sectionEl = document.createElement('section');
    sectionEl.className = 'tt-lore-default-section';
    const heading = document.createElement('h3');
    heading.textContent = titleText;
    sectionEl.append(heading);
    return sectionEl;
}

function input(type, value, options = {}) {
    const element = document.createElement('input');
    element.type = type;
    element.value = value ?? '';
    Object.assign(element, options);
    return element;
}

function makeOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'tt-lore-defaults';
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="tt-lore-default-panel" role="dialog" aria-modal="true" aria-label="Lore Defaults" data-tt-ui="panel">
            <header class="tt-lore-default-header">
                <div>
                    <div class="tt-lore-default-title">Lore Defaults</div>
                    <div class="tt-lore-default-subtitle">Shared by Vault Explorer, DeepLore, and Copilot.</div>
                </div>
                <button type="button" class="menu_button tt-lore-default-close" aria-label="Close">Close</button>
            </header>
            <div class="tt-lore-default-body"></div>
            <footer class="tt-lore-default-footer">
                <span class="tt-lore-default-status" role="status"></span>
                <button type="button" class="menu_button tt-lore-default-save">Save defaults</button>
            </footer>
        </div>`;
    document.body.append(overlay);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });
    overlay.querySelector('.tt-lore-default-close').addEventListener('click', close);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !overlay.hidden) close();
    });
    return overlay;
}

async function render() {
    if (!overlay) makeOverlay();
    const body = overlay.querySelector('.tt-lore-default-body');
    body.replaceChildren();
    const settings = get();
    const mounts = await loadMounts();
    const primary = mounts.find((mount) => mount.primary) ?? mounts[0] ?? null;
    if (!settings.vault.mountId && primary) settings.vault.mountId = primary.id;

    const vaultSection = section('Vault scope');
    const mountSelect = document.createElement('select');
    mountSelect.className = 'text_pole';
    if (!mounts.length) mountSelect.append(new Option('No vault mounted', ''));
    for (const mount of mounts) {
        mountSelect.append(new Option(mount.label || mount.id, mount.id, false, mount.id === settings.vault.mountId));
    }
    vaultSection.append(field('Default vault', mountSelect));

    const loreFolders = input('text', settings.vault.loreFolders.join(', '), {
        placeholder: 'global, Characters/Mira',
    });
    vaultSection.append(field('Default lore folders', loreFolders));

    const characterFolder = document.createElement('input');
    characterFolder.type = 'checkbox';
    characterFolder.checked = settings.vault.useCharacterFolder;
    vaultSection.append(field('Use character lore folder', characterFolder));

    const followFocus = document.createElement('input');
    followFocus.type = 'checkbox';
    followFocus.checked = settings.vault.followExplorerFocus;
    vaultSection.append(field('Follow Vault Explorer focus', followFocus));
    if (currentFocus?.path) {
        const focusHint = document.createElement('div');
        focusHint.className = 'tt-lore-default-hint';
        focusHint.textContent = `Focused now: ${currentFocus.path}`;
        vaultSection.append(focusHint);
    }
    body.append(vaultSection);

    const copilotSection = section('Copilot');
    const profileSelect = document.createElement('select');
    profileSelect.className = 'text_pole';
    profileSelect.append(new Option('Chat / extension default', ''));
    for (const profile of copilotProfiles()) {
        profileSelect.append(new Option(profile.label, profile.id, false, profile.id === settings.copilot.profileId));
    }
    copilotSection.append(field('Default profile', profileSelect));

    const connectionSelect = document.createElement('select');
    connectionSelect.className = 'text_pole';
    connectionSelect.append(new Option('Chat / extension default', ''));
    for (const profile of connectionProfiles()) {
        connectionSelect.append(new Option(profile.label, profile.id, false, profile.id === settings.copilot.connectionProfileId));
    }
    copilotSection.append(field('Default connection', connectionSelect));

    const model = input('text', settings.copilot.model ?? '', {
        placeholder: 'Optional model override',
    });
    copilotSection.append(field('Default model', model));
    body.append(copilotSection);

    const deeploreSection = section('DeepLore retrieval');
    const topK = input('number', settings.deeplore.topK, { min: 1, max: 100 });
    const maxEntries = input('number', settings.deeplore.maxEntries, { min: 1, max: 250 });
    const tokenBudget = input('number', settings.deeplore.tokenBudget, { min: 128, max: 100000 });
    const minScore = input('number', settings.deeplore.minScore, { min: 0, max: 1, step: 0.01 });
    deeploreSection.append(
        field('Top K', topK),
        field('Max entries', maxEntries),
        field('Token budget', tokenBudget),
        field('Minimum score', minScore),
    );
    body.append(deeploreSection);

    overlay.querySelector('.tt-lore-default-save').onclick = () => {
        set({
            vault: {
                mountId: mountSelect.value || null,
                loreFolders: loreFolders.value.split(',').map((value) => value.trim()).filter(Boolean),
                useCharacterFolder: characterFolder.checked,
                followExplorerFocus: followFocus.checked,
            },
            copilot: {
                profileId: profileSelect.value || null,
                connectionProfileId: connectionSelect.value || null,
                model: model.value.trim() || null,
            },
            deeplore: {
                topK: Number(topK.value) || DEFAULT_DEFAULTS.deeplore.topK,
                maxEntries: Number(maxEntries.value) || DEFAULT_DEFAULTS.deeplore.maxEntries,
                tokenBudget: Number(tokenBudget.value) || DEFAULT_DEFAULTS.deeplore.tokenBudget,
                minScore: Number.isFinite(Number(minScore.value)) ? Number(minScore.value) : DEFAULT_DEFAULTS.deeplore.minScore,
            },
        });
        overlay.querySelector('.tt-lore-default-status').textContent = 'Saved.';
    };
}

async function loadMounts() {
    const vault = window.__TAURITAVERN__?.api?.vault;
    const state = await vault?.state?.().catch(() => null);
    const mounts = Array.isArray(state?.mounts) ? state.mounts : [];
    return mounts.map((mount) => ({
        id: mount.id,
        label: mount.label ?? mount.name ?? mount.path ?? mount.id,
        primary: Boolean(mount.primary || state?.primaryMountId === mount.id),
    }));
}

function copilotProfiles() {
    const profiles = extensionSettings()?.st_copilot?.profiles;
    if (!profiles || typeof profiles !== 'object') return [];
    return Object.entries(profiles).map(([id, profile]) => ({
        id,
        label: profile?.name || id,
    }));
}

function connectionProfiles() {
    const profiles = extensionSettings()?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return [];
    return profiles.map((profile) => ({
        id: profile.id ?? profile.name,
        label: profile.name ?? profile.id,
    })).filter((profile) => profile.id);
}

function open() {
    if (!overlay) makeOverlay();
    overlay.hidden = false;
    const status = overlay.querySelector('.tt-lore-default-status');
    if (status) status.textContent = '';
    void render();
}

function close() {
    if (overlay) overlay.hidden = true;
}

export function installLoreDefaults() {
    if (installed) return window.__TT_LORE_DEFAULTS__;
    installed = true;
    makeOverlay();
    window.__TT_LORE_DEFAULTS__ = { get, set, subscribe, open, close };
    window.addEventListener('tt:open-lore-defaults', open);
    window.addEventListener('tt:vault-focus-changed', (event) => {
        currentFocus = event.detail ?? null;
        if (overlay && !overlay.hidden) void render();
    });
    return window.__TT_LORE_DEFAULTS__;
}

