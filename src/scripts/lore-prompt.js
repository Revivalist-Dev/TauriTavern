import { eventSource, event_types } from './events.js';
import { extension_settings, getContext } from './extensions.js';

function sharedLoreDefaults() {
    return window.__TT_LORE_DEFAULTS__?.get?.() ?? null;
}

function loreSettings() {
    const shared = sharedLoreDefaults()?.deeplore ?? {};
    const settings = extension_settings.lore ??= {};
    settings.tokenBudget ??= shared.tokenBudget ?? 2048;
    settings.maxEntries ??= shared.maxEntries ?? 24;
    settings.retrievalMode ??= 'directory';
    return settings;
}

const POSITION_NUMBER = {
    before: 0,
    after: 1,
    an_top: 2,
    an_bottom: 3,
    depth: 4,
};

const migratedCharacters = new Set();
let legacyMigration;

function withTimeout(promise, timeoutMs, fallback = null) {
    return Promise.race([
        Promise.resolve(promise).catch(() => fallback),
        new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
    ]);
}

async function ensureLegacyMigration(api) {
    legacyMigration ??= withTimeout(api.migrateLegacy(), 2000);
    return legacyMigration;
}

async function ensureCharacterMigration(api, context) {
    const group = context.groups?.find((candidate) => candidate.id === context.groupId);
    const avatars = new Set();
    const current = context.characters?.[context.characterId];
    if (current?.avatar) avatars.add(current.avatar);
    for (const avatar of group?.members ?? []) avatars.add(avatar);
    for (const rawAvatar of avatars) {
        const avatar = String(rawAvatar || '').replace(/\.[^.]+$/, '');
        const character = context.characters?.find((candidate) => candidate.avatar === rawAvatar);
        const book = character?.data?.character_book;
        if (!book || !avatar || migratedCharacters.has(avatar)) continue;
        migratedCharacters.add(avatar);
        await withTimeout(api.migrateCharacter(avatar, book), 2000);
    }
}

function loreFolderForAvatar(avatar) {
    const normalized = String(avatar || '').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    return normalized ? `lore/characters/${normalized}` : null;
}

function characterFolder() {
    const context = getContext();
    const character = context.characters?.[context.characterId];
    return loreFolderForAvatar(character?.avatar);
}

function groupFolders() {
    const context = getContext();
    const group = context.groups?.find((candidate) => candidate.id === context.groupId);
    return (group?.members ?? [])
        .map((avatar) => loreFolderForAvatar(avatar))
        .filter(Boolean);
}

export function defaultLoreFolders() {
    const shared = sharedLoreDefaults()?.vault;
    const configured = (shared?.loreFolders ?? [])
        .map((folder) => String(folder || '').replace(/^lore\//, ''))
        .filter(Boolean)
        .map((folder) => `lore/${folder}`);
    const folders = configured.length ? configured : ['lore/global'];
    const character = shared?.useCharacterFolder === false ? null : characterFolder();
    if (character) folders.push(character);
    folders.push(...groupFolders());
    return [...new Set(folders)];
}

export function getLoreFolders() {
    const metadata = getContext().chatMetadata ?? {};
    if (Array.isArray(metadata.loreFolders) && metadata.loreFolders.length > 0) {
        return metadata.loreFolders;
    }
    const folders = defaultLoreFolders();
    const legacyName = String(metadata.world_info || '').trim();
    if (legacyName) {
        const legacyFolder = legacyName.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
        if (legacyFolder) folders.push(`lore/global/${legacyFolder}`);
    }
    return [...new Set(folders)];
}

function recentQuery() {
    const chat = getContext().chat ?? [];
    return chat
        .slice(-20)
        .map((message) => String(message?.mes || ''))
        .filter(Boolean)
        .join('\n');
}

function activationEntry(entry) {
    return {
        world: entry.folder,
        uid: entry.uid,
        displayName: entry.title,
        comment: entry.title,
        inChat: true,
        constant: entry.constant,
        key: [],
        content: entry.content,
        position: POSITION_NUMBER[entry.position] ?? 0,
    };
}

export async function getLorePrompt(_chat, maxContext, _dryRun, _globalScanData) {
    const api = window.__TAURITAVERN__?.api?.lore;
    const empty = {
        worldInfoBefore: '',
        worldInfoAfter: '',
        WIDepthEntries: [],
        EMEntries: [],
        anBefore: '',
        anAfter: '',
        worldInfoString: '',
        worldInfoActivation: { entries: new Map(), text: '' },
        worldInfoExamples: [],
        worldInfoDepthEntries: [],
    };
    if (!api) return empty;

    const context = getContext();
    await ensureLegacyMigration(api);
    await ensureCharacterMigration(api, context);

    const settings = loreSettings();
    let result;
    try {
        result = await withTimeout(
            api.retrieve({
                query: recentQuery(),
                folders: getLoreFolders(),
                tokenBudget: Number.isFinite(maxContext) && maxContext > 0 ? Math.min(settings.tokenBudget, maxContext) : settings.tokenBudget,
                maxEntries: settings.maxEntries,
            }),
            5000,
        );
        if (!result) throw new Error('lore retrieval unavailable');
    } catch {
        await emitScan(null);
        return empty;
    }
    if (!result || result.entries.length === 0) {
        await emitScan(result);
        return empty;
    }

    const before = result.before.map((entry) => entry.content).join('\n');
    const after = result.after.map((entry) => entry.content).join('\n');
    const depth = result.depth.map((entry) => ({
        content: entry.content,
        depth: entry.depth,
        role: entry.role,
    }));
    const entries = new Map(result.entries.map((entry, index) => [index, activationEntry(entry)]));
    const activation = {
        entries,
        text: [before, after].filter(Boolean).join('\n'),
    };
    await emitScan(result, activation);
    return {
        worldInfoBefore: before,
        worldInfoAfter: after,
        WIDepthEntries: depth,
        EMEntries: [],
        anBefore: '',
        anAfter: '',
        worldInfoString: [before, after].filter(Boolean).join('\n'),
        worldInfoActivation: activation,
        worldInfoExamples: [],
        worldInfoDepthEntries: depth,
    };
}

async function emitScan(result, activation) {
    const payload = {
        state: {
            current: 0,
            next: 0,
            loopCount: 1,
        },
        trigger: 'normal',
        isDryRun: false,
        isFinal: true,
        new: {
            all: [],
            successful: [],
        },
        activated: activation ?? { entries: new Map(), text: '' },
        sortedEntries: result?.entries ?? [],
        recursionDelay: {
            availableLevels: 0,
            currentLevel: 0,
        },
        budget: {
            current: result?.tokens ?? 0,
            overflowed: false,
        },
        timedEffects: [],
    };
    await eventSource.emit(event_types.WORLD_INFO_ACTIVATED, [payload.activated]);
    await eventSource.emit(event_types.WORLDINFO_SCAN_DONE, payload);
}
