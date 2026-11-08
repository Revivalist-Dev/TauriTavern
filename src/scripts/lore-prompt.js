// Native lore prompt is retired. DeepLore is the only lore loader.
// These exports keep the prompt assembly call sites type-compatible.

const EMPTY_LORE_PROMPT = Object.freeze({
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
});

export function defaultLoreFolders() {
    return [];
}

export function getLoreFolders() {
    return [];
}

export async function getLorePrompt(_chat, _maxContext, _dryRun, _globalScanData) {
    return {
        ...EMPTY_LORE_PROMPT,
        worldInfoActivation: { entries: new Map(), text: '' },
    };
}
