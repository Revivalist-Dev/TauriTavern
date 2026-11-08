const OVERLAY_ID = 'tt-session-workspace';
const LORE_KEYS = ['deeplore_context', 'deeplore_pins', 'deeplore_blocks', 'deeplore_folder_filter'];

function invoke(command, args) {
    const host = window.__TAURITAVERN__;
    if (host?.invoke?.safeInvoke) {
        return host.invoke.safeInvoke(command, args);
    }
    if (typeof host?.invoke === 'function') {
        return host.invoke(command, args);
    }
    throw new Error('TauriTavern host bridge is not available.');
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function pretty(value) {
    return JSON.stringify(value ?? null, null, 2);
}

function sourceLabel(sessionValue, groupValue) {
    if (sessionValue && Object.keys(sessionValue).length > 0) return 'Session override';
    if (groupValue && Object.keys(groupValue).length > 0) return 'Group default';
    return 'Global default';
}

function createField(key, label, value, onSave) {
    const wrapper = el('div', 'tt-session-field');
    const heading = el('div', 'tt-session-field-heading');
    heading.append(el('span', 'tt-session-field-label', label));
    const badge = el('span', 'tt-session-source', sourceLabel(value.session, value.group));
    heading.append(badge);
    wrapper.append(heading);

    const textarea = el('textarea', 'tt-session-json');
    textarea.rows = Math.min(14, Math.max(4, pretty(value.session ?? value.group ?? {}).split('\n').length));
    textarea.value = pretty(value.session ?? value.group ?? {});
    wrapper.append(textarea);

    const actions = el('div', 'tt-session-actions');
    const save = el('button', 'menu_button', 'Save session override');
    save.type = 'button';
    save.addEventListener('click', async () => {
        try {
            const next = { ...(value.session ?? {}) };
            next[key] = JSON.parse(textarea.value || 'null');
            await onSave(next);
            window.dispatchEvent(new CustomEvent('tt:session-workspace-lore-changed', {
                detail: { key, value: next[key] },
            }));
            badge.textContent = 'Session override';
        } catch (error) {
            window.toastr?.error?.(`Invalid JSON: ${error.message}`);
        }
    });
    const reset = el('button', 'menu_button', 'Reset to inherited');
    reset.type = 'button';
    reset.addEventListener('click', async () => {
        const next = { ...(value.session ?? {}) };
        delete next[key];
        await onSave(next);
        window.dispatchEvent(new CustomEvent('tt:session-workspace-lore-changed', {
            detail: { key, value: value.group },
        }));
        textarea.value = pretty(value.group ?? {});
        badge.textContent = sourceLabel(null, value.group);
    });
    actions.append(save, reset);
    wrapper.append(actions);
    return wrapper;
}

async function saveLore(chatId, lore) {
    if (lore === null) {
        await invoke('delete_session_workspace_entry', {
            chatId,
            namespace: 'deeplore',
            key: 'overrides',
        });
        return;
    }
    await invoke('write_session_workspace_entry', {
        chatId,
        namespace: 'deeplore',
        key: 'overrides',
        value: lore,
    });
}

async function openWorkspace(groupId, chatId, groupName) {
    const existing = document.getElementById(OVERLAY_ID);
    existing?.remove();
    const [workspace, groupWorkspace] = await Promise.all([
        invoke('get_group_session_workspace', { groupId, chatId }),
        invoke('get_group_workspace', { groupId }),
    ]);
    const overlay = el('div', 'tt-session-overlay');
    overlay.id = OVERLAY_ID;
    const panel = el('div', 'tt-session-panel');
    panel.dataset.ttUi = 'panel';
    overlay.append(panel);

    const header = el('div', 'tt-session-header');
    header.append(el('h3', '', `Session workspace · ${groupName || groupId}`));
    const actions = el('div', 'tt-session-actions');
    const exportButton = el('button', 'menu_button', 'Export');
    exportButton.type = 'button';
    exportButton.addEventListener('click', () => {
        const blob = new Blob([pretty({ group: groupWorkspace, session: workspace.session })], {
            type: 'application/json',
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `session-workspace-${chatId}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
    });
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = 'application/json';
    importInput.hidden = true;
    importInput.addEventListener('change', async () => {
        const file = importInput.files?.[0];
        if (!file) return;
        try {
            const bundle = JSON.parse(await file.text());
            if (bundle.session?.lore) {
                await invoke('write_session_workspace_entry', {
                    chatId,
                    namespace: 'deeplore',
                    key: 'overrides',
                    value: bundle.session.lore,
                });
            }
            if (bundle.session?.workflow) {
                await invoke('write_session_workspace_entry', {
                    chatId,
                    namespace: 'rpgraph',
                    key: 'active-workflow',
                    value: bundle.session.workflow,
                });
            }
            if (bundle.session?.hooks) {
                await invoke('write_session_workspace_entry', {
                    chatId,
                    namespace: 'rpgraph',
                    key: 'hooks',
                    value: bundle.session.hooks,
                });
            }
            overlay.remove();
            await openWorkspace(groupId, chatId, groupName);
        } catch (error) {
            window.toastr?.error?.(`Import failed: ${error.message}`);
        }
    });
    const importButton = el('button', 'menu_button', 'Import');
    importButton.type = 'button';
    importButton.addEventListener('click', () => importInput.click());
    const close = el('button', 'menu_button', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => overlay.remove());
    actions.append(exportButton, importButton, close);
    header.append(actions);
    panel.append(header);
    panel.append(importInput);
    panel.append(el('p', 'tt-session-hint', `Chat ${chatId}. Files live under group chats/.tauritavern/${chatId}.`));

    const sessionLore = workspace.session?.lore ?? {};
    const groupLore = workspace.group?.lore ?? {};
    const loreCard = el('section', 'tt-session-card');
    loreCard.append(el('h4', '', 'Lore overrides'));
    for (const key of LORE_KEYS) {
        loreCard.append(createField(key, key.replace('deeplore_', ''), {
            session: sessionLore[key],
            group: groupLore[key],
        }, async (next) => {
            await saveLore(chatId, next);
            for (const existingKey of Object.keys(sessionLore)) delete sessionLore[existingKey];
            Object.assign(sessionLore, next);
        }));
    }
    panel.append(loreCard);

    const workflowCard = el('section', 'tt-session-card');
    workflowCard.append(el('h4', '', 'Workflow'));
    const workflowBadge = el(
        'p',
        'tt-session-source',
        sourceLabel(workspace.session?.workflow, workspace.group?.workflow),
    );
    workflowCard.append(workflowBadge);
    const workflowJson = el('textarea', 'tt-session-json');
    workflowJson.rows = 12;
    workflowJson.value = pretty(workspace.effective?.workflow ?? null);
    workflowCard.append(workflowJson);
    const workflowActions = el('div', 'tt-session-actions');
    const saveWorkflow = el('button', 'menu_button', 'Save session workflow');
    saveWorkflow.type = 'button';
    saveWorkflow.addEventListener('click', async () => {
        try {
            const value = JSON.parse(workflowJson.value || 'null');
            await invoke('write_session_workspace_entry', {
                chatId,
                namespace: 'rpgraph',
                key: 'active-workflow',
                value,
            });
            window.dispatchEvent(new CustomEvent('tt:session-workspace-lore-changed', {
                detail: { key: 'rpgraph_session', value },
            }));
            workflowBadge.textContent = sourceLabel(value, workspace.group?.workflow);
        } catch (error) {
            window.toastr?.error?.(`Invalid workflow JSON: ${error.message}`);
        }
    });
    const resetWorkflow = el('button', 'menu_button', 'Reset to inherited');
    resetWorkflow.type = 'button';
    resetWorkflow.addEventListener('click', async () => {
        await invoke('delete_session_workspace_entry', {
            chatId,
            namespace: 'rpgraph',
            key: 'active-workflow',
        });
        window.dispatchEvent(new CustomEvent('tt:session-workspace-lore-changed', {
            detail: { key: 'rpgraph_session', value: undefined },
        }));
        workflowJson.value = pretty(workspace.group?.workflow ?? null);
        workflowBadge.textContent = sourceLabel(null, workspace.group?.workflow);
    });
    workflowActions.append(saveWorkflow, resetWorkflow);
    workflowCard.append(workflowActions);
    panel.append(workflowCard);

    const hooksCard = el('section', 'tt-session-card');
    hooksCard.append(el('h4', '', 'RPGraph hooks'));
    const hooks = el('textarea', 'tt-session-json');
    hooks.rows = 8;
    hooks.value = pretty(workspace.session?.hooks ?? {});
    hooksCard.append(hooks);
    const saveHooks = el('button', 'menu_button', 'Save hooks');
    saveHooks.type = 'button';
    saveHooks.addEventListener('click', async () => {
        try {
            await invoke('write_session_workspace_entry', {
                chatId,
                namespace: 'rpgraph',
                key: 'hooks',
                value: JSON.parse(hooks.value || '{}'),
            });
        } catch (error) {
            window.toastr?.error?.(`Invalid hooks JSON: ${error.message}`);
        }
    });
    hooksCard.append(saveHooks);
    panel.append(hooksCard);

    const groupCard = el('section', 'tt-session-card');
    groupCard.append(el('h4', '', 'Group defaults'));
    groupCard.append(el('p', 'tt-session-hint', 'These values apply to every session in this group unless the session overrides them.'));
    const groupLoreJson = el('textarea', 'tt-session-json');
    groupLoreJson.rows = 8;
    groupLoreJson.value = pretty(groupWorkspace.lore ?? {});
    groupCard.append(groupLoreJson);
    const groupLoreSave = el('button', 'menu_button', 'Save group lore defaults');
    groupLoreSave.type = 'button';
    groupLoreSave.addEventListener('click', async () => {
        try {
            await invoke('write_group_workspace_entry', {
                groupId,
                namespace: 'deeplore',
                key: 'overrides',
                value: JSON.parse(groupLoreJson.value || '{}'),
            });
        } catch (error) {
            window.toastr?.error?.(`Invalid group lore JSON: ${error.message}`);
        }
    });
    groupCard.append(groupLoreSave);

    const groupWorkflowJson = el('textarea', 'tt-session-json');
    groupWorkflowJson.rows = 8;
    groupWorkflowJson.value = pretty(groupWorkspace.workflow ?? null);
    groupCard.append(groupWorkflowJson);
    const groupWorkflowSave = el('button', 'menu_button', 'Save group workflow default');
    groupWorkflowSave.type = 'button';
    groupWorkflowSave.addEventListener('click', async () => {
        try {
            await invoke('write_group_workspace_entry', {
                groupId,
                namespace: 'rpgraph',
                key: 'default-workflow',
                value: JSON.parse(groupWorkflowJson.value || 'null'),
            });
        } catch (error) {
            window.toastr?.error?.(`Invalid group workflow JSON: ${error.message}`);
        }
    });
    groupCard.append(groupWorkflowSave);
    panel.append(groupCard);

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
    });
    document.body.append(overlay);
}

export function installSessionWorkspace() {
    if (window.__ttSessionWorkspaceInstalled) return;
    window.__ttSessionWorkspaceInstalled = true;

    window.addEventListener('tt:open-session-workspace', (event) => {
        const { groupId, chatId, groupName } = event.detail || {};
        if (!groupId || !chatId) return;
        void openWorkspace(groupId, chatId, groupName).catch((error) => {
            console.error('TauriTavern: Failed to open session workspace:', error);
            window.toastr?.error?.(`Session workspace failed: ${error.message}`);
        });
    });

    const style = document.createElement('style');
    style.textContent = `
        .tt-session-overlay { position: fixed; inset: 0; z-index: 10050; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.62); }
        .tt-session-panel { width: min(860px, 92vw); max-height: 88vh; overflow: auto; border: 1px solid rgba(255,255,255,.16); border-radius: 12px; background: #171b24; color: #e7ecf7; padding: 18px; box-shadow: 0 20px 60px rgba(0,0,0,.45); }
        .tt-session-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .tt-session-header h3 { margin: 0; font-size: 17px; }
        .tt-session-hint { opacity: .62; font-size: 12px; overflow-wrap: anywhere; }
        .tt-session-card { margin-top: 14px; border-top: 1px solid rgba(255,255,255,.1); padding-top: 12px; }
        .tt-session-card h4 { margin: 0 0 8px; }
        .tt-session-field { margin-bottom: 12px; }
        .tt-session-field-heading { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 5px; }
        .tt-session-field-label { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; opacity: .8; }
        .tt-session-source { color: #9ecbff; font-size: 11px; }
        .tt-session-json { box-sizing: border-box; width: 100%; border: 1px solid rgba(255,255,255,.14); border-radius: 7px; background: #0e1219; color: #dbe4f3; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 8px; resize: vertical; }
        .tt-session-actions { display: flex; gap: 8px; margin: 7px 0 0; }
    `;
    document.head.append(style);
}

