import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeOverridePath, pathMatches } from '../../src/tauri/main/ui/file-explorer/vault-overrides.js';

test('normalizes vault override paths', () => {
    assert.equal(normalizeOverridePath('Lore\\Characters\\Uma.md'), 'Lore/Characters/Uma.md');
    assert.equal(normalizeOverridePath('./Characters/Uma.md'), 'Characters/Uma.md');
});

test('matches exact and nested override paths', () => {
    assert.equal(pathMatches(['Characters/Uma.md'], 'Characters/Uma.md'), true);
    assert.equal(pathMatches(['Characters/Uma.md'], 'Characters/Uma.md'), true);
    assert.equal(pathMatches(['Characters/'], 'Characters/Uma.md'), true);
    assert.equal(pathMatches(['Characters/Uma.md'], 'Narrative/Uma.md'), false);
});
