/**
 * Compatibility facade for the retired World Info engine.
 *
 * Lore is now read exclusively from the Markdown directory. This module keeps
 * the small set of settings and editor entry points that other SillyTavern
 * modules still import, so extensions that have not moved to `api.lore` keep
 * loading. No lorebook JSON is read or written here.
 */

import { getLorePrompt } from './lore-prompt.js';

export const world_info = {};
export const selected_world_info = [];
/** @type {string[]} */
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
};

export const getWorldInfoPrompt = getLorePrompt;

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
        world_info_character_strategy,
        world_info_budget_cap,
        world_info_use_group_scoring,
        world_info_max_recursion_steps,
    };
}

export function setWorldInfoSettings(settings) {
    if (settings?.world_info && typeof settings.world_info === 'object') {
        Object.assign(world_info, settings.world_info);
    }
}

export function updateWorldInfoSettings() {}

export async function initWorldInfo() {}

export function setWorldInfoButtonClass() {}

export function checkEmbeddedWorld() {
                return false;
            }

export function getSortedEntries() {
    return [];
}

export async function loadWorldInfo() {
                return null;
            }

export async function reloadEditor() {}

export async function saveWorldInfo() {}

export async function updateWorldInfoList() {}

export function convertCharacterBook(character) {
    return character?.data?.character_book ?? character?.character_book ?? character;
}

export async function importWorldInfo() {
    await window.__TAURITAVERN__?.api?.lore?.migrateLegacy?.();
}

export async function importEmbeddedWorldInfo(character) {
    const book = character?.data?.character_book;
    const avatar = String(character?.avatar || '').replace(/\.[^.]+$/, '');
    if (book && avatar) {
        await window.__TAURITAVERN__?.api?.lore?.migrateCharacter?.(avatar, book);
    }
}

export async function completeCharacterLorebookAdoption() {}

export function flushWorldInfoSaves() {}

export function flushPendingWorldInfoSettings() {}

export async function deleteWorldInfo() {}

export async function charUpdatePrimaryWorld() {}

export async function charSetAuxWorlds() {}

export async function openWorldInfoEditor() {
    document.getElementById('lore-directory-button')?.querySelector('.drawer-toggle')?.click();
}

export async function openWorldInfoEntry() {}
