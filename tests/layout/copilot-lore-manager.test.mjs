import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openLayoutPage } from './harness.mjs';

let session;
let page;

before(async () => {
    session = await openLayoutPage({ width: 1440, height: 900 });
    page = session.page;
    await page.waitForSelector('#scp-window', { timeout: 10_000 });
    await page.evaluate(() => {
        window.deepLoreEnhanced_vault = {
            status: () => ({ configured: true, folder: 'C:/vault' }),
            listFolders: async () => ['Places', 'People'],
            listFiles: async (folder) => [
                'Places/Harbor.md',
                'People/Mira.md',
            ].filter((path) => !folder || path.startsWith(`${folder}/`)),
            read: async (path) => path.endsWith('Harbor.md') ? 'A salt-stained port.' : 'She sails at dawn.',
            refresh: async () => {},
        };
        window.deepLoreEnhanced_matchText = async () => ({ text: '', count: 0, tokens: 0 });
        window.__TT_VAULT_API__ = {
            readText: async () => '# Harbor\n\nA salt-stained port.',
            open: async () => {},
        };
        window.__TAURITAVERN__ = {
            api: {
                vault: { state: async () => ({ primaryMountId: 'mnt' }) },
                workspace: { setFocus: async (focus) => { window.__focusCalls.push(focus); } },
            },
        };
        window.__focusCalls = [];
        window.__ttFileExplorer = { openPath: async (mountId, path) => { window.__explorerCall = [mountId, path]; } };
    });
});

after(async () => {
    await session?.close();
});

test('the Copilot lorebook button opens the vault lore manager', async () => {
    await page.locator('#scp-menu-trigger').click();
    await page.locator('#scp-menu-lb-item').click();
    await page.waitForSelector('#scp-vault-lore-overlay:not([hidden])', { timeout: 5000 });
    assert.match(await page.locator('#scp-vl-heading').textContent(), /All lore/);
    assert.equal(await page.locator('.scp-vl-entry').count(), 2);
    assert.match(await page.locator('.scp-vl-entry').first().textContent(), /Harbor/);

    await page.locator('.scp-vl-entry').first().getByRole('button', { name: 'Open' }).click();
    await page.waitForSelector('.tt-center-tab', { timeout: 5000 });
    assert.equal(await page.locator('#tt-center-file').isVisible(), true);
    assert.ok((await page.locator('.tt-center-tab-label').allTextContents()).some((label) => label.includes('Harbor')));

    await page.locator('#scp-vl-close').click();
    assert.equal(await page.locator('#scp-vault-lore-overlay').isVisible(), false);
});

test('the manager follows the shared default lore folder', async () => {
    await page.locator('#scp-menu-trigger').click();
    await page.locator('#scp-menu-lb-item').click();
    await page.waitForSelector('#scp-vault-lore-overlay:not([hidden])', { timeout: 5000 });
    await page.locator('.scp-vl-folder').filter({ hasText: 'All lore directories' }).click();
    await page.evaluate(() => window.__TT_LORE_DEFAULTS__.set({ vault: { loreFolders: ['People'] } }));
    await page.waitForFunction(() => document.querySelector('#scp-vl-heading')?.textContent === 'People');
    assert.equal(await page.locator('.scp-vl-entry').count(), 1);
    await page.locator('#scp-vl-close').click();
});

test('the vault manager focuses and reveals native lore folders', async () => {
    await page.locator('#scp-menu-trigger').click();
    await page.locator('#scp-menu-lb-item').click();
    await page.waitForSelector('#scp-vault-lore-overlay:not([hidden])', { timeout: 5000 });
    await page.locator('.scp-vl-folder').filter({ hasText: 'Places' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.scp-vl-entry').length === 1);
    await page.locator('#scp-vl-focus').click();
    assert.equal((await page.evaluate(() => window.__focusCalls)).length, 1);
    assert.equal((await page.evaluate(() => window.__focusCalls[0])).path, 'lore/Places');

    await page.locator('#scp-vl-explorer').click();
    assert.deepEqual(await page.evaluate(() => window.__explorerCall), ['mnt', 'lore/Places']);
    assert.equal(await page.locator('#scp-vault-lore-overlay').isVisible(), false);
});

test('Copilot streams think blocks as reasoning, not answer text', async () => {
    const result = await page.evaluate(() => {
        const parse = window.__STCopilotToolDebug.parseThinkStream;
        return {
            partialOpen: parse('<thi'),
            open: parse('<think>plan'),
            closed: parse('<think>plan</think>Answer'),
            partialClose: parse('<think>plan</thi'),
            provider: parse('Answer', 'provider thought'),
            flush: parse('<think>only thought', '', true),
        };
    });
    assert.equal(result.partialOpen.text, '');
    assert.equal(result.partialOpen.reasoning, '');
    assert.equal(result.open.text, '');
    assert.equal(result.open.reasoning, 'plan');
    assert.equal(result.open.inThinking, true);
    assert.equal(result.closed.text, 'Answer');
    assert.equal(result.closed.reasoning, 'plan');
    assert.equal(result.closed.inThinking, false);
    assert.equal(result.partialClose.text, '');
    assert.equal(result.partialClose.reasoning, 'plan');
    assert.equal(result.partialClose.inThinking, true);
    assert.equal(result.provider.text, 'Answer');
    assert.equal(result.provider.reasoning, 'provider thought');
    assert.equal(result.flush.text, '');
    assert.equal(result.flush.reasoning, 'only thought');
});

test('Copilot resolves group member cards by name', async () => {
    const result = await page.evaluate(() => {
        const original = SillyTavern.getContext;
        const king = { name: 'King Halo', avatar: 'king.png', description: 'King card' };
        const dober = { name: 'Mejiro Dober', avatar: 'dober.png', description: 'Dober card' };
        SillyTavern.getContext = () => ({
            groupId: 'group-1',
            groups: [{ id: 'group-1', name: 'Test Group', members: ['king.png', 'dober.png'] }],
            characters: [king, dober],
            characterId: undefined,
            chatMetadata: {},
        });
        const debug = window.__STCopilotToolDebug;
        const output = {
            king: debug.getCharInfo('King Halo'),
            dober: debug.getCharInfo('mejiro dober'),
            missing: debug.getCharInfo('Nope'),
        };
        SillyTavern.getContext = original;
        return output;
    });
    assert.equal(result.king.name, 'King Halo');
    assert.equal(result.king.description, 'King card');
    assert.equal(result.dober.name, 'Mejiro Dober');
    assert.equal(result.dober.description, 'Dober card');
    assert.equal(result.missing, null);
});

test('Copilot runs a finalization pass when the tool round limit is reached', async () => {
    const tokenSample = '<|tool_calls_section_begin|>\n<|tool_call_begin|> functions.get_deeplore_vaults:0 <|tool_call_argument_begin|> {} <|tool_call_end|>\n<|tool_calls_section_end|>';
    const result = await page.evaluate(async (sample) => {
        const calls = [];
        const run = await window.__STCopilotToolDebug.runToolRounds(
            { messages: [] },
            { toolsMaxRounds: 1 },
            { text: sample, reasoning: null },
            {
                executeTool: async () => ({ ok: true }),
                generate: async () => {
                    calls.push('generate');
                    return { text: 'Recovered final answer.', reasoning: null };
                },
            },
        );
        return { text: run.result.text, toolCalls: run.toolCalls.length, calls };
    }, tokenSample);
    assert.match(result.text, /Recovered final answer\./);
    assert.equal(result.toolCalls, 1);
    assert.equal(result.calls.length, 1);
});

test('Copilot finalizes when a post-tool follow-up is empty', async () => {
    const tokenSample = '<|tool_calls_section_begin|>\n<|tool_call_begin|> functions.get_deeplore_vaults:0 <|tool_call_argument_begin|> {} <|tool_call_end|>\n<|tool_calls_section_end|>';
    const result = await page.evaluate(async (sample) => {
        let generation = 0;
        const run = await window.__STCopilotToolDebug.runToolRounds(
            { messages: [] },
            { toolsMaxRounds: 3 },
            { text: sample, reasoning: null },
            {
                executeTool: async () => ({ ok: true }),
                generate: async () => {
                    generation += 1;
                    return generation === 1
                        ? { text: '', reasoning: 'thinking' }
                        : { text: 'Continued after tools.', reasoning: null };
                },
            },
        );
        return { text: run.result.text, generation };
    }, tokenSample);
    assert.match(result.text, /Continued after tools\./);
    assert.equal(result.generation, 2);
});

test('Copilot native vault tools write root hook files', async () => {
    const result = await page.evaluate(async () => {
        const original = window.__TAURITAVERN__.api.vault;
        const calls = [];
        window.__TAURITAVERN__.api.vault = {
            state: async () => ({
                primaryMountId: 'm1',
                mounts: [{ id: 'm1', name: 'lorebook-test', path: 'C:/vaults/lorebook-test', kind: 'lorebook' }],
            }),
            readText: async () => 'before',
            writeFile: async (...args) => { calls.push(args); return { ok: true }; },
        };
        try {
            const output = await window.__STCopilotToolDebug.vaultFiles.write(
                '.cursor/hooks/lorebook-guard.mjs', 'after', 'overwrite',
            );
            return { output, calls };
        } finally {
            window.__TAURITAVERN__.api.vault = original;
        }
    });
    assert.equal(result.output.path, '.cursor/hooks/lorebook-guard.mjs');
    assert.equal(result.calls[0][0], 'm1');
    assert.equal(result.calls[0][1], '.cursor/hooks');
    assert.equal(result.calls[0][2], 'lorebook-guard.mjs');
    assert.equal(new TextDecoder().decode(result.calls[0][3]), 'after');
});

test('Copilot clamps Kimi output tokens below the Bedrock limit', async () => {
    const result = await page.evaluate(() => ({
        kimi: window.__STCopilotToolDebug.clampMaxTokens(262144, '/moonshot.kimi-k2-thinking'),
        kimi25: window.__STCopilotToolDebug.clampMaxTokens(262144, 'moonshotai.kimi-k2.5'),
        other: window.__STCopilotToolDebug.clampMaxTokens(262144, 'gpt-4.1'),
        small: window.__STCopilotToolDebug.clampMaxTokens(2048, 'kimi-k2.5'),
    }));
    assert.equal(result.kimi, 16384);
    assert.equal(result.kimi25, 16384);
    assert.equal(result.other, 262144);
    assert.equal(result.small, 2048);
});

test('tool-call open state survives a rerender', async () => {
    const result = await page.evaluate(() => {
        const host = document.createElement('div');
        host.innerHTML = '<div class="scp-inline-tool-call open" data-tool-id="read-1"></div>';
        const openIds = window.__STCopilotToolDebug.captureOpenToolCallIds(host);
        host.innerHTML = '<div class="scp-inline-tool-call" data-tool-id="read-1"></div>'
            + '<div class="scp-inline-tool-call" data-tool-id="read-2"></div>';
        window.__STCopilotToolDebug.restoreOpenToolCallIds(host, openIds);
        return {
            count: openIds.size,
            first: host.querySelector('[data-tool-id="read-1"]').classList.contains('open'),
            second: host.querySelector('[data-tool-id="read-2"]').classList.contains('open'),
        };
    });
    assert.equal(result.count, 1);
    assert.equal(result.first, true);
    assert.equal(result.second, false);
});

test('ask_user choices become multiple-choice answers', async () => {
    const result = await page.evaluate(() => ({
        options: window.__STCopilotToolDebug.normalizeAskChoices({
            options: ['Keep the current scene', { label: 'Move to the next day', value: 'next-day', description: 'Time skip' }],
        }),
        json: window.__STCopilotToolDebug.normalizeAskChoices({
            options: '["First", "Second"]',
        }),
        none: window.__STCopilotToolDebug.normalizeAskChoices({ question: 'Free text?' }),
    }));
    assert.deepEqual(result.options.map(option => option.label), ['Keep the current scene', 'Move to the next day']);
    assert.equal(result.options[1].value, 'next-day');
    assert.equal(result.options[1].description, 'Time skip');
    assert.deepEqual(result.json.map(option => option.value), ['First', 'Second']);
    assert.equal(result.none.length, 0);
});

test('ask_user renders clickable choices and returns the selected value', async () => {
    const result = await page.evaluate(async () => {
        const msg = document.createElement('div');
        msg.innerHTML = '<div class="scp-msg-body"></div>';
        document.body.appendChild(msg);
        const pending = window.__STCopilotToolDebug.executeAskUser({
            question: 'Which scene next?',
            options: ['Keep the current scene', { label: 'Move to the next day', value: 'next-day' }],
        }, msg);
        const choices = [...msg.querySelectorAll('.scp-tool-ask-choice')];
        const labels = choices.map(choice => choice.textContent);
        choices[1].click();
        const answer = await pending;
        msg.remove();
        return { labels, answer };
    });
    assert.deepEqual(result.labels, ['Keep the current scene', 'Move to the next day']);
    assert.equal(result.answer, 'next-day');
});

test('ask_user falls back to a modal when there is no message composer', async () => {
    const result = await page.evaluate(async () => {
        const pending = window.__STCopilotToolDebug.executeAskUser({
            question: 'Pick a scene',
            options: ['Morning', 'Evening'],
            allow_custom: false,
        }, null);
        const overlay = document.querySelector('.scp-tool-ask-modal');
        const labels = [...overlay.querySelectorAll('.scp-tool-ask-choice')].map(choice => choice.textContent);
        overlay.querySelectorAll('.scp-tool-ask-choice')[0].click();
        const answer = await pending;
        return { labels, answer, overlayRemoved: !document.querySelector('.scp-tool-ask-modal') };
    });
    assert.deepEqual(result.labels, ['Morning', 'Evening']);
    assert.equal(result.answer, 'Morning');
    assert.equal(result.overlayRemoved, true);
});

test('edited file tool calls expose an open target', async () => {
    const result = await page.evaluate(() => ({
        write: window.__STCopilotToolDebug.getEditedFileTarget({
            name: 'write_vault_file',
            input: { path: '.cursor/rules/new-rule.mdc' },
            result: { ok: true, path: '.cursor/rules/new-rule.mdc', mountId: 'lorebook' },
        }),
        note: window.__STCopilotToolDebug.getEditedFileTarget({
            name: 'edit_deeplore_note',
            input: { vault_root: true, path: '.cursor/hooks/guard.mjs' },
            result: { ok: true, path: '.cursor/hooks/guard.mjs' },
        }),
        noteOnly: window.__STCopilotToolDebug.getEditedFileTarget({
            name: 'edit_deeplore_note',
            input: { note: 'Scene summary' },
            result: { success: true },
        }),
        traversal: window.__STCopilotToolDebug.getEditedFileTarget({
            name: 'write_vault_file',
            input: { path: '../escape.md' },
            result: { ok: true },
        }),
    }));
    assert.deepEqual(result.write, { path: '.cursor/rules/new-rule.mdc', mountId: 'lorebook', name: 'new-rule.mdc' });
    assert.equal(result.note.path, '.cursor/hooks/guard.mjs');
    assert.equal(result.noteOnly, null);
    assert.equal(result.traversal, null);
});

test('edited file tool cards render an Open button', async () => {
    const result = await page.evaluate(() => {
        const card = window.__STCopilotToolDebug.createToolCallEl({
            id: 'edit-1',
            name: 'write_vault_file',
            input: { path: '.cursor/rules/new-rule.mdc' },
            result: { ok: true, path: '.cursor/rules/new-rule.mdc', mountId: 'lorebook' },
            status: 'done',
        });
        return {
            open: !!card.querySelector('.scp-tool-call-open'),
            title: card.querySelector('.scp-tool-call-open')?.title,
        };
    });
    assert.equal(result.open, true);
    assert.match(result.title, /new-rule\.mdc/);
});

test('lorebook changes survive nested code fences in note content', async () => {
    const result = await page.evaluate(() => {
        const payload = JSON.stringify({
            changes: [{
                action: 'add',
                name: 'Novel Stakes Breeding Log',
                content: 'Weight tracking\n\n- Blood panels\n\n```\nmatrix\n```\n\n### Training\n\n- No sprinting',
            }],
        });
        const second = JSON.stringify({
            changes: [{ action: 'add', name: 'Second Note', content: 'Second body' }],
        });
        const text = `Before\n\n\`\`\`lorebook-changes\n${payload}\n\`\`\`\n\nMiddle\n\n\`\`\`lorebook-changes\n${second}\n\`\`\`\n\nAfter`;
        const parsed = window.__STCopilotToolDebug.parseLBChanges(text);
        return {
            parsed: !!parsed,
            title: parsed?.[0]?.name ?? null,
            names: parsed?.map(item => item.name) ?? [],
            stripped: window.__STCopilotToolDebug.stripLBChanges(text),
        };
    });
    assert.equal(result.parsed, true);
    assert.equal(result.title, 'Novel Stakes Breeding Log');
    assert.deepEqual(result.names, ['Novel Stakes Breeding Log', 'Second Note']);
    assert.equal(result.stripped, 'Before\n\nMiddle\n\nAfter');
});

test('Copilot parses special-token and XML tool calls', async () => {
    const tokenSample = '<|tool_calls_section_begin|>\n<|tool_call_begin|> functions.get_deeplore_vaults:0 <|tool_call_argument_begin|> {} <|tool_call_end|>\n<|tool_calls_section_end|>';
    const xmlSample = '<tool_calls_begin><tool_call>{"name":"lorebook_search","arguments":{"query":"umamusume"}}</tool_call></tool_calls_begin>';
    const result = await page.evaluate(({ tokenSample, xmlSample }) => ({
        token: window.__STCopilotToolDebug.parse(tokenSample),
        xml: window.__STCopilotToolDebug.parse(xmlSample),
        extracted: window.__STCopilotToolDebug.extract(`before ${tokenSample} after`).text,
    }), { tokenSample, xmlSample });
    assert.deepEqual(result.token, [{ name: 'get_deeplore_vaults', input: {} }]);
    assert.deepEqual(result.xml, [{ name: 'lorebook_search', input: { query: 'umamusume' } }]);
    assert.doesNotMatch(result.extracted, /tool_calls_section|tool_call_begin|tool_calls_begin/);
    assert.match(result.extracted, /^before\s+/);
    assert.match(result.extracted, /\safter$/);
});

test('Copilot deletion requires confirmation and passes safe paths to the native vault', async () => {
    const result = await page.evaluate(async () => {
        const api = window.__TAURITAVERN__?.api?.vault;
        if (!api || !window.__STCopilotToolDebug?.deleteEntries) return null;
        const originalState = api.state;
        const originalDelete = api.deleteEntries;
        const calls = [];
        api.state = async () => ({ primaryMountId: 'test-mount' });
        api.deleteEntries = async (...args) => { calls.push(args); };
        try {
            const unconfirmed = await window.__STCopilotToolDebug.deleteEntries({
                paths: ['lore/global/eldoria'],
            });
            const confirmed = await window.__STCopilotToolDebug.deleteEntries({
                paths: ['lore/global/eldoria', 'lore/characters/default_seraphina'],
                recursive: true,
                confirmed: true,
            });
            return { unconfirmed, confirmed, calls };
        } finally {
            api.state = originalState;
            api.deleteEntries = originalDelete;
        }
    });
    assert.ok(result, 'native vault API or deletion hook is unavailable');
    assert.match(result.unconfirmed.error, /requires explicit user confirmation/i);
    assert.equal(result.calls.length, 1, 'unconfirmed deletion reached the native vault');
    assert.deepEqual(result.confirmed.deleted, ['lore/global/eldoria', 'lore/characters/default_seraphina']);
    assert.deepEqual(result.calls[0], [
        'test-mount',
        ['lore/global/eldoria', 'lore/characters/default_seraphina'],
        true,
    ]);
});
