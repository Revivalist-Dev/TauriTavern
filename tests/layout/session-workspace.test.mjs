import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openLayoutPage } from './harness.mjs';

let session;
let page;

before(async () => {
    session = await openLayoutPage({ width: 1440, height: 900 });
    page = session.page;
    await page.waitForSelector('#tt-center-tabs', { timeout: 10_000 });
    await page.evaluate(() => {
        const invoke = window.__TAURITAVERN__?.invoke;
        if (!invoke?.safeInvoke) throw new Error('safeInvoke bridge missing');
        invoke.safeInvoke = async (command) => {
            if (command === 'get_group_session_workspace') {
                return {
                    groupId: 'group-1',
                    chatId: 'chat-1',
                    group: {
                        lore: { deeplore_context: { tone: 'noir' } },
                        workflow: { id: 'group-workflow' },
                    },
                    session: {
                        lore: { deeplore_pins: ['session-pin'] },
                        workflow: { id: 'session-workflow' },
                        hooks: {},
                    },
                    effective: {
                        lore: {
                            deeplore_context: { tone: 'noir' },
                            deeplore_pins: ['session-pin'],
                        },
                        workflow: { id: 'session-workflow' },
                    },
                };
            }
            if (command === 'get_group_workspace') {
                return {
                    groupId: 'group-1',
                    lore: { deeplore_context: { tone: 'noir' } },
                    workflow: { id: 'group-workflow' },
                };
            }
            return undefined;
        };
    });
});

after(async () => {
    await session?.close();
});

test('the group session workspace renders lore, workflow, and group defaults', async () => {
    await page.evaluate(() => {
        window.dispatchEvent(
            new CustomEvent('tt:open-session-workspace', {
                detail: { groupId: 'group-1', chatId: 'chat-1', groupName: 'Test Group' },
            }),
        );
    });
    await page.waitForSelector('#tt-session-workspace .tt-session-panel', { timeout: 5000 });
    const panel = page.locator('#tt-session-workspace .tt-session-panel');
    assert.match(await panel.textContent(), /Session workspace · Test Group/);
    assert.match(await panel.textContent(), /Lore overrides/);
    assert.match(await panel.textContent(), /Group defaults/);
    assert.equal(await page.locator('.tt-session-field').count(), 4);
});

test('closing the workspace removes the overlay', async () => {
    await page.locator('#tt-session-workspace .tt-session-header .menu_button', { hasText: 'Close' }).click();
    assert.equal(await page.locator('#tt-session-workspace').count(), 0);
});
