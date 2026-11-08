// SillyTavern-format world-info handling is retired. DeepLore owns lore.
// This module keeps compatibility exports for prompt assembly and extension APIs
// while importing, exporting, editing and activating zero lore entries.

export const world_info = {};
export const selected_world_info = [];
export let world_names = [];
export const world_info_depth = 2;
export const world_info_min_activations = 0;
export const world_info_min_activations_depth_max = 0;
export const world_info_budget = 25;
export const world_info_include_names = true;
export const world_info_recursive = false;
export const world_info_overflow_alert = false;
export const world_info_case_sensitive = false;
export const world_info_match_whole_words = false;
export const world_info_use_group_scoring = false;
export const world_info_character_strategy = 0;
export const world_info_budget_cap = 0;
export const world_info_max_recursion_steps = 0;

export const wi_anchor_position = {
    before: 0,
    after: 1,
    anTop: 2,
    anBottom: 3,
    atDepth: 4,
    EMTop: 5,
    EMBottom: 6,
};

const EMPTY_LORE_PROMPT = {
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

export const getWorldInfoPrompt = async () => ({
    ...EMPTY_LORE_PROMPT,
    worldInfoActivation: { entries: new Map(), text: '' },
});

export function getWorldInfoSettings() {
    return {
        world_info,
        world_info_depth,
        world_info_min_activations,
        world_info_min_activations_depth_max,
        world_info_budget,
        world_info_include_names,
        world_info_recursive,
        world_info_overflow_alert,
        world_info_case_sensitive,
        world_info_match_whole_words,
        world_info_use_group_scoring,
        world_info_character_strategy,
        world_info_budget_cap,
        world_info_max_recursion_steps,
    };
}

export function setWorldInfoSettings() {}
export function updateWorldInfoSettings() {}
export async function initWorldInfo() {}
export function setWorldInfoButtonClass() {}
export function checkEmbeddedWorld() { return false; }
export function getSortedEntries() { return []; }
export async function loadWorldInfo() { return null; }
export async function reloadEditor() {}
export async function saveWorldInfo() {}
export async function updateWorldInfoList() {}
export function flushWorldInfoSaves() {}
export function flushPendingWorldInfoSettings() {}
export async function deleteWorldInfo() {}
export async function charUpdatePrimaryWorld() {}
export async function charSetAuxWorlds() {}
export async function openWorldInfoEditor() {}
export async function openWorldInfoEntry(..._args) {}
