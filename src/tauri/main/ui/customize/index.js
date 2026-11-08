import { openPanel, registerPanel } from '../tauri-shell/panels.js';
import { installHooksBridge } from './hooks-bridge.js';

const PANEL_ID = 'customize';
const TABS = [
    ['rules', 'Rules'],
    ['skills', 'Skills'],
    ['agents', 'Subagents'],
    ['commands', 'Commands'],
    ['hooks', 'Hooks'],
    ['mcp', 'MCP'],
    ['plugins', 'Plugins'],
];

let hostPanel = null;
let installed = false;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

async function resolveVaultMounts() {
    try {
        const state = await window.__TAURITAVERN__?.api?.vault?.state?.();
        const mounts = state?.mounts ?? state?.vaults ?? [];
        return mounts.map((mount) => {
            const root = mount?.path ?? mount?.root ?? mount?.rootPath ?? null;
            const name = mount?.name ?? mount?.displayName
                ?? (root ? String(root).split(/[\\/]/).filter(Boolean).pop() : '');
            return {
                id: mount?.id ?? null,
                root,
                name,
                kind: mount?.kind ?? '',
                primary: Boolean(mount?.primary
                    || mount?.id === state?.primaryMountId
                    || mount === state?.primaryMount),
            };
        }).filter((mount) => mount.root);
    } catch {
        return [];
    }
}

async function resolveVaultRoot() {
    const mounts = await resolveVaultMounts();
    const mount = mounts.find((candidate) => candidate.primary) ?? mounts[0];
    return mount?.root ?? null;
}

function tabFor(kind) {
    return {
        rule: 'rules',
        skill: 'skills',
        agent: 'agents',
        command: 'commands',
        hook: 'hooks',
        mcp: 'mcp',
        plugin: 'plugins',
    }[kind] ?? 'rules';
}

function kindForTab(tab) {
    return {
        rules: 'rule',
        skills: 'skill',
        agents: 'agent',
        commands: 'command',
        mcp: 'mcp',
        plugins: 'plugin',
    }[tab] ?? null;
}

function formatDate(value) {
    if (!value) return '';
    try {
        return new Date(value).toLocaleString();
    } catch {
        return '';
    }
}

function defaultSurfaces(kind) {
    if (kind === 'command') return ['native_agent', 'copilot', 'character_chat'];
    if (kind === 'mcp') return ['native_agent', 'copilot', 'deeplore'];
    if (kind === 'hook' || kind === 'plugin') return ['native_agent'];
    return ['native_agent', 'copilot'];
}

function itemBadge(item) {
    const source = item.kind === 'agent' && item.scope === 'global_agents'
        ? ''
        : item.source ? ` · ${item.source}` : '';
    const scope = item.kind === 'agent'
        ? item.scope === 'global_agents' ? ' · global' : item.scope === 'vault' ? ' · lorebook' : ''
        : '';
    return `${item.kind}${scope}${source}${item.enabled === false ? ' · disabled' : ''}`;
}

export function installCustomizePanel() {
    if (installed) return;
    installed = true;
    installHooksBridge();
    registerPanel({
        id: PANEL_ID,
        label: 'Agent Workspace',
        icon: 'fa-solid fa-sliders',
        order: 35,
        render: (container, panel) => {
            hostPanel = { container, panel };
            renderCustomize(container).catch((error) => {
                console.error('TauriTavern: Agent Workspace panel failed:', error);
                container.replaceChildren(el('p', 'tt-customize-error tt-ui-status', `Failed to load Agent Workspace: ${error?.message ?? error}`));
            });
        },
    });
    window.addEventListener('tt:open-customize', () => openPanel(PANEL_ID));
    window.addEventListener('tt:open-agent-workspace', () => openPanel(PANEL_ID));
}

async function renderCustomize(container) {
    const api = window.__TAURITAVERN__?.api?.customize;
    if (!api) throw new Error('Agent Workspace API is unavailable');
    const vaultRoot = await resolveVaultRoot();
    const state = {
        tab: 'rules',
        vaultRoot,
        primaryMountId: null,
        snapshot: null,
        editing: null,
        logs: [],
        hookConfigText: '',
        hookConfigScope: null,
        hookVaults: [],
        hookScope: null,
        hookRoot: null,
        hookTrustedScope: null,
        busy: false,
    };
    const render = () => renderShell(container, api, state, render);
    state.render = render;
    await refresh(api, state);
    render();
}

async function refresh(api, state) {
    state.snapshot = await api.snapshot(state.vaultRoot);
    const mounts = await resolveVaultMounts();
    const primaryMount = mounts.find((mount) => mount.primary) ?? mounts[0];
    state.primaryMountId = primaryMount?.id ?? null;
    state.hookVaults = mounts.filter((mount) => mount.kind === 'lorebook' || /^lorebook-/i.test(mount.name));
    if (!state.hookVaults.length && state.vaultRoot) {
        state.hookVaults = mounts.filter((mount) => mount.root === state.vaultRoot);
    }

    if (!state.hookScope) {
        const preferred = state.hookVaults.find((mount) => mount.root === state.vaultRoot)
            ?? state.hookVaults[0];
        state.hookScope = preferred ? 'vault' : 'global';
        state.hookRoot = preferred?.root ?? null;
    }
    if (state.hookScope === 'vault' && !state.hookVaults.some((mount) => mount.root === state.hookRoot)) {
        state.hookRoot = state.hookVaults[0]?.root ?? null;
        if (!state.hookRoot) state.hookScope = 'global';
    }

    const scopeKey = `${state.hookScope}:${state.hookRoot ?? ''}`;
    if (state.hookConfigScope !== scopeKey) {
        const root = state.hookScope === 'global' ? null : state.hookRoot;
        const config = await api.hooks.config(root).catch(() => state.snapshot?.hookConfig);
        state.hookConfigText = JSON.stringify(config ?? { version: 1, hooks: {} }, null, 2);
        state.hookConfigScope = scopeKey;
    }
    state.logs = await api.hooks.logs().catch(() => []);
}

function renderShell(container, api, state, rerender) {
    const shell = el('div', 'tt-customize tt-ui-panel');
    shell.dataset.ttUi = 'panel';
    const header = el('div', 'tt-customize-header tt-ui-toolbar');
    const title = el('div', 'tt-customize-title');
    title.append(el('span', 'tt-ui-text-muted tt-ui-text-small', state.vaultRoot ? `Vault: ${state.vaultRoot}` : 'Native storage'));
    const actions = el('div', 'tt-customize-actions');
    const reload = el('button', 'tt-ui-button tt-ui-button--compact', 'Reload');
    reload.type = 'button';
    reload.onclick = async () => {
        state.hookConfigText = '';
        await refresh(api, state);
        rerender();
    };
    actions.append(reload);
    header.append(title, actions);

    const tabs = el('div', 'tt-customize-tabs tt-ui-tablist');
    tabs.dataset.ttUi = 'tabs';
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of TABS) {
        const button = el('button', 'tt-customize-tab tt-ui-tab', label);
        button.dataset.ttUi = 'tab';
        button.type = 'button';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(state.tab === id));
        button.classList.toggle('active', state.tab === id);
        button.classList.toggle('is-active', state.tab === id);
        button.onclick = () => {
            state.tab = id;
            state.editing = null;
            rerender();
        };
        tabs.append(button);
    }

    const body = el('div', 'tt-customize-body tt-ui-panel__body');
    if (state.tab === 'hooks') renderHooks(body, api, state, rerender);
    else if (state.tab === 'mcp') void renderMcp(body, api, state);
    else if (state.tab === 'plugins') renderPlugins(body, api, state);
    else {
        body.classList.add('tt-customize-body--split');
        renderItems(body, api, state, rerender);
    }

    const warnings = el('div', 'tt-customize-warnings tt-ui-status');
    for (const warning of state.snapshot?.warnings ?? []) {
        const row = el('div', 'tt-customize-warning tt-ui-status');
        row.textContent = `${warning.path}: ${warning.message}`;
        warnings.append(row);
    }
    shell.append(header, tabs, body);
    if (warnings.childElementCount) shell.append(warnings);
    container.replaceChildren(shell);
}

function itemsFor(state, tab) {
    const kind = kindForTab(tab);
    return (state.snapshot?.items ?? []).filter((item) => item.kind === kind);
}

function renderItems(container, api, state, rerender) {
    const workspace = el('div', 'tt-customize-workspace');
    if (state.editing) workspace.classList.add('tt-customize-workspace--editing');
    const list = el('div', 'tt-customize-list');
    const items = itemsFor(state, state.tab);
    const toolbar = el('div', 'tt-customize-toolbar tt-ui-toolbar');
    toolbar.append(el('h3', 'tt-ui-title', TABS.find(([id]) => id === state.tab)?.[1] ?? 'Items'));
    const newButton = el('button', 'tt-ui-button tt-ui-button--primary tt-ui-button--compact', '+ New');
    newButton.type = 'button';
    newButton.onclick = () => {
        state.editing = {
            id: null,
            kind: kindForTab(state.tab),
            name: '',
            description: '',
            body: '',
            surfaces: defaultSurfaces(kindForTab(state.tab)),
            alwaysApply: false,
            globs: [],
            enabled: true,
            scope: 'vault',
        };
        rerender();
    };
    toolbar.append(newButton);
    list.append(toolbar);
    if (!items.length) {
        list.append(el('p', 'tt-customize-empty tt-ui-empty', 'Nothing here yet. Create one or add files under .cursor/.'));
    }
    for (const item of items) {
        const row = el('div', 'tt-customize-item tt-ui-card');
        const main = el('button', 'tt-customize-item-main');
        main.type = 'button';
        main.onclick = () => {
            state.editing = { ...item, scope: item.scope ?? 'vault' };
            rerender();
        };
        main.append(el('strong', 'tt-ui-card__title', item.name));
        main.append(el('span', 'tt-ui-text-muted tt-ui-text-small', item.description || item.path || ''));
        const badge = el('span', 'tt-customize-badge tt-ui-badge', itemBadge(item));
        const toggle = el('button', 'tt-ui-button tt-ui-button--compact', item.enabled === false ? 'Enable' : 'Disable');
        toggle.type = 'button';
        toggle.disabled = item.source !== 'native';
        toggle.title = item.source !== 'native'
            ? 'Vault items use the enabled field in their frontmatter.'
            : '';
        toggle.onclick = async (event) => {
            event.stopPropagation();
            await api.setEnabled(item.id, item.enabled === false);
            await refresh(api, state);
            rerender();
        };
        row.append(main, badge, toggle);
        const openRaw = el('button', 'tt-customize-item-open tt-ui-icon-button', '');
        openRaw.type = 'button';
        openRaw.title = 'Open raw file';
        openRaw.innerHTML = '<i class="fa-solid fa-file-pen"></i>';
        openRaw.hidden = !item.path || !state.primaryMountId;
        openRaw.onclick = async (event) => {
            event.stopPropagation();
            if (!item.path || !state.primaryMountId) return;
            await window.__TT_CENTER_TABS__?.openFile?.({
                mountId: state.primaryMountId,
                path: item.path,
                name: item.path.split(/[\\/]/).pop() || item.name,
            });
        };
        row.append(openRaw);
        list.append(row);
    }
    if (state.editing) {
        const editorPane = el('div', 'tt-customize-editor-pane');
        editorPane.append(renderEditor(api, state, rerender));
        workspace.append(list, editorPane);
    } else {
        workspace.append(list);
    }
    container.append(workspace);
}

function renderEditor(api, state, rerender) {
    const item = state.editing;
    const form = el('div', 'tt-customize-editor tt-ui-card');
    const scroll = el('div', 'tt-customize-editor-scroll');
    scroll.append(el('h4', 'tt-ui-title', item.id ? `Edit ${item.name}` : 'New workspace item'));
    const field = (label, value, onChange, textarea = false) => {
        const wrapper = el('label', 'tt-customize-field tt-ui-field');
        wrapper.append(el('span', 'tt-ui-field__label', label));
        const input = document.createElement(textarea ? 'textarea' : 'input');
        input.className = textarea ? 'tt-ui-textarea' : 'tt-ui-input';
        input.value = value ?? '';
        if (textarea) input.rows = 12;
        input.oninput = (event) => onChange(event.target.value);
        wrapper.append(input);
        return wrapper;
    };
    const details = el('div', 'tt-customize-field-grid');
    details.append(
        field('Name', item.name, (value) => { item.name = value; }),
        field('Description', item.description, (value) => { item.description = value; }),
    );
    scroll.append(details);
    if (item.kind === 'agent' && (!item.id || item.scope === 'vault' || item.scope === 'global_agents')) {
        const scope = document.createElement('select');
        scope.className = 'tt-ui-select';
        scope.append(new Option('This lorebook', 'vault'), new Option('Global', 'global_agents'));
        scope.value = item.scope === 'global_agents' ? 'global_agents' : 'vault';
        scope.onchange = () => { item.scope = scope.value; };
        const wrapper = el('label', 'tt-customize-field tt-ui-field');
        wrapper.append(el('span', 'tt-ui-field__label', 'Storage'), scope);
        scroll.append(wrapper);
    }
    const bodyField = field('Body / instructions', item.body, (value) => { item.body = value; }, true);
    bodyField.classList.add('tt-customize-field--body');
    scroll.append(bodyField);
    const activation = el('div', 'tt-customize-activation');
    activation.append(field('Globs (comma separated)', (item.globs ?? []).join(', '), (value) => {
        item.globs = value.split(',').map((part) => part.trim()).filter(Boolean);
    }));
    const always = el('label', 'tt-customize-check');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tt-ui-checkbox';
    checkbox.checked = Boolean(item.alwaysApply);
    checkbox.onchange = () => { item.alwaysApply = checkbox.checked; };
    always.append(checkbox, document.createTextNode('Always apply'));
    activation.append(always);

    const surfaces = el('div', 'tt-customize-surfaces');
    for (const [id, label] of [['native_agent', 'Native agent'], ['copilot', 'Copilot'], ['character_chat', 'Character Chat'], ['deeplore', 'DeepLore']]) {
        const wrapper = el('label', 'tt-customize-check');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'tt-ui-checkbox';
        box.checked = (item.surfaces ?? []).includes(id);
        box.onchange = () => {
            item.surfaces = box.checked
                ? [...new Set([...(item.surfaces ?? []), id])]
                : (item.surfaces ?? []).filter((surface) => surface !== id);
        };
        wrapper.append(box, document.createTextNode(label));
        surfaces.append(wrapper);
    }
    activation.append(surfaces);
    scroll.append(activation);

    const actions = el('div', 'tt-customize-editor-actions');
    const save = el('button', 'tt-ui-button tt-ui-button--primary tt-ui-button--compact', 'Save');
    save.type = 'button';
    save.onclick = async () => {
        if (state.busy) return;
        state.busy = true;
        try {
            await api.save({
                id: item.id,
                kind: item.kind,
                name: item.name,
                description: item.description,
                body: item.body,
                scope: item.scope ?? 'vault',
                surfaces: item.surfaces,
                enabled: item.enabled !== false,
                alwaysApply: Boolean(item.alwaysApply),
                globs: item.globs ?? [],
                vaultRoot: item.scope === 'vault' ? state.vaultRoot : null,
            });
            state.editing = null;
            state.hookConfigText = '';
            await refresh(api, state);
            window.dispatchEvent(new CustomEvent('tt:customize-changed', { detail: { kind: item.kind, id: item.id } }));
            rerender();
        } catch (error) {
            window.toastr?.error?.(String(error?.message ?? error));
        } finally {
            state.busy = false;
        }
    };
    const cancel = el('button', 'tt-ui-button tt-ui-button--compact', 'Cancel');
    cancel.type = 'button';
    cancel.onclick = () => {
        state.editing = null;
        rerender();
    };
    actions.append(save, cancel);
    if (item.id) {
        const remove = el('button', 'tt-ui-button tt-ui-button--danger tt-ui-button--compact', 'Delete');
        remove.type = 'button';
        remove.onclick = async () => {
            if (!window.confirm(`Delete "${item.name}"?`)) return;
            await api.remove(item.id, item.scope === 'vault' ? state.vaultRoot : null);
            window.dispatchEvent(new CustomEvent('tt:customize-changed', { detail: { kind: item.kind, id: item.id } }));
            state.editing = null;
            await refresh(api, state);
            rerender();
        };
        actions.append(remove);
    }
    form.append(scroll, actions);
    return form;
}

function renderHooks(container, api, state, rerender) {
    const panel = el('div', 'tt-customize-hooks');
    const scopeField = el('label', 'tt-customize-field tt-ui-field');
    scopeField.append(el('span', 'tt-ui-field__label', 'Hook scope'));
    const scope = document.createElement('select');
    scope.className = 'tt-ui-select';
    scope.id = 'hook-scope';
    const globalOption = document.createElement('option');
    globalOption.value = '__global__';
    globalOption.textContent = 'Global · all vaults';
    scope.append(globalOption);
    for (const vault of state.hookVaults ?? []) {
        const option = document.createElement('option');
        option.value = vault.root;
        option.textContent = `Lorebook · ${vault.name}`;
        scope.append(option);
    }
    scope.value = state.hookScope === 'vault' && state.hookRoot ? state.hookRoot : '__global__';
    scope.onchange = async () => {
        state.hookScope = scope.value === '__global__' ? 'global' : 'vault';
        state.hookRoot = scope.value === '__global__' ? null : scope.value;
        state.hookConfigScope = null;
        await refresh(api, state);
        rerender();
    };
    scopeField.append(scope);
    const scopePath = el('small', 'tt-ui-text-muted tt-ui-text-small',
        state.hookScope === 'global'
            ? 'Global hooks: ~/.cursor/hooks.json'
            : `${state.hookRoot}/.cursor/hooks.json`);
    scopeField.append(scopePath);
    panel.append(scopeField);

    const selectedRoot = state.hookScope === 'global' ? null : state.hookRoot;
    const selectedVaultIsActive = Boolean(selectedRoot && selectedRoot === state.vaultRoot);
    const scopeKey = `${state.hookScope}:${selectedRoot ?? ''}`;
    const trusted = state.hookTrustedScope === scopeKey
        || (selectedVaultIsActive && Boolean(state.snapshot?.hookTrusted));
    const status = el('div', 'tt-customize-hook-status tt-ui-status');
    status.textContent = trusted
        ? 'Hook configuration is trusted for this scope.'
        : 'Hook configuration is not trusted. Commands will not run until trusted.';
    status.classList.toggle('trusted', trusted);
    const actions = el('div', 'tt-customize-actions');
    const trust = el('button', 'tt-ui-button tt-ui-button--primary tt-ui-button--compact', 'Trust configuration');
    trust.type = 'button';
    trust.disabled = trusted;
    trust.onclick = async () => {
        await api.hooks.trust(selectedRoot);
        state.hookTrustedScope = scopeKey;
        await refresh(api, state);
        rerender();
    };
    const save = el('button', 'tt-ui-button tt-ui-button--compact', 'Save hooks.json');
    save.type = 'button';
    save.onclick = async () => {
        try {
            const config = JSON.parse(state.hookConfigText);
            await api.hooks.saveConfig(config, selectedRoot);
            state.hookTrustedScope = null;
            await refresh(api, state);
            rerender();
        } catch (error) {
            window.toastr?.error?.(String(error?.message ?? error));
        }
    };
    actions.append(trust, save);
    const editor = document.createElement('textarea');
    editor.className = 'tt-customize-hook-editor tt-ui-textarea';
    editor.spellcheck = false;
    editor.value = state.hookConfigText;
    editor.oninput = () => { state.hookConfigText = editor.value; };
    const hint = el('p', 'tt-ui-text-muted tt-ui-text-small',
        state.hookScope === 'global'
            ? 'These hooks apply to every vault. A lorebook can override them with its own .cursor/hooks.json.'
            : 'Lorebook hooks inherit the global hooks until this file is saved. Saving creates a local override.');
    const testRow = el('div', 'tt-customize-hook-test');
    const event = document.createElement('select');
    event.className = 'tt-ui-select';
    for (const name of ['beforeSubmitPrompt', 'preToolUse', 'postToolUse', 'afterAgentResponse', 'stop']) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        event.append(option);
    }
    const run = el('button', 'tt-ui-button tt-ui-button--compact', 'Run test event');
    run.type = 'button';
    run.onclick = async () => {
        try {
            const result = await api.hooks.run({
                event: event.value,
                surface: 'native_agent',
                payload: { prompt: 'Agent Workspace test', toolName: 'Read' },
                vaultRoot: selectedRoot,
                test: true,
            });
            window.toastr?.success?.(result.allowed ? 'Hook allowed the event.' : 'Hook denied the event.');
        } catch (error) {
            window.toastr?.error?.(String(error?.message ?? error));
        }
    };
    testRow.append(event, run);
    panel.append(status, hint, actions, editor, testRow);
    const logTitle = el('h4', 'tt-ui-title', 'Recent hook runs');
    panel.append(logTitle);
    for (const log of (state.logs ?? []).slice(0, 20)) {
        const row = el('div', 'tt-customize-hook-log');
        row.append(
            el('span', 'tt-customize-hook-log-event', log.event),
            el('span', '', `${log.permission} · ${log.durationMs}ms · ${formatDate(log.createdAt)}`),
            el('small', '', log.message || log.command),
        );
        panel.append(row);
    }
    container.append(panel);
}

function buildMcpTestPanel(server, mcpApi) {
    const panel = el('div', 'tt-customize-editor tt-ui-card');
    panel.append(el('h4', '', `Test ${server.displayName ?? server.id ?? 'MCP server'}`));
    const tools = Object.keys(server.toolPermissions ?? {});
    if (!tools.length) {
        panel.append(el('p', 'tt-ui-text-muted tt-ui-text-small', 'Discover tools before making a test call.'));
        return panel;
    }
    const toolField = el('label', 'tt-customize-field tt-ui-field');
    toolField.append(el('span', 'tt-ui-field__label', 'Tool'));
    const tool = document.createElement('select');
    tool.className = 'tt-ui-select';
    for (const name of tools) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        tool.append(option);
    }
    toolField.append(tool);
    const argsField = el('label', 'tt-customize-field tt-ui-field');
    argsField.append(el('span', 'tt-ui-field__label', 'Arguments (JSON)'));
    const args = document.createElement('textarea');
    args.className = 'tt-ui-textarea';
    args.value = '{}';
    args.rows = 4;
    argsField.append(args);
    const result = el('pre', 'tt-customize-result tt-ui-card');
    result.hidden = true;
    const run = el('button', 'tt-ui-button tt-ui-button--primary tt-ui-button--compact', 'Run test call');
    run.type = 'button';
    run.onclick = async () => {
        let parsed;
        try {
            parsed = JSON.parse(args.value || '{}');
        } catch (error) {
            window.toastr?.error?.(`Invalid JSON: ${error?.message ?? error}`);
            return;
        }
        run.disabled = true;
        result.hidden = false;
        result.textContent = 'Running…';
        try {
            const response = await mcpApi.tools.invoke(server.id, tool.value, parsed);
            result.textContent = JSON.stringify(response, null, 2);
        } catch (error) {
            result.textContent = String(error?.message ?? error);
        } finally {
            run.disabled = false;
        }
    };
    panel.append(toolField, argsField, run, result);
    return panel;
}

async function renderMcp(container, api, state) {
    const panel = el('div', 'tt-customize-mcp');
    panel.append(el('h3', 'tt-ui-title', 'MCP servers'));
    panel.append(el('p', 'tt-ui-text-muted tt-ui-text-small', 'Manage the native MCP servers shared by the native agent, Copilot, and DeepLore.'));
    for (const item of (state.snapshot?.items ?? []).filter((candidate) => candidate.kind === 'mcp')) {
        const row = el('div', 'tt-customize-item tt-ui-card');
        const main = el('button', 'tt-customize-item-main');
        main.type = 'button';
        main.append(el('strong', 'tt-ui-card__title', item.name), el('span', 'tt-ui-text-muted tt-ui-text-small', item.path || ''));
        row.append(main, el('span', 'tt-customize-badge tt-ui-badge', itemBadge(item)));
        panel.append(row);
    }

    const mcpApi = window.__TAURITAVERN__?.api?.mcp;
    let servers = [];
    try {
        const result = await mcpApi?.servers?.list?.();
        servers = result?.servers ?? [];
    } catch (error) {
        panel.append(el('p', 'tt-customize-error tt-ui-status', `Could not load MCP servers: ${error?.message ?? error}`));
    }
    panel.append(el('h4', 'tt-ui-title', 'Registered servers'));
    if (!servers.length) panel.append(el('p', 'tt-customize-empty tt-ui-empty', 'No MCP servers are registered.'));
    for (const server of servers) {
        const row = el('div', 'tt-customize-item tt-ui-card');
        const main = el('div', 'tt-customize-item-main');
        main.append(el('strong', 'tt-ui-card__title', server.displayName ?? server.id ?? 'MCP server'));
        main.append(el('span', 'tt-ui-text-muted tt-ui-text-small', server.endpoint ?? server.url ?? ''));
        const tools = Object.keys(server.toolPermissions ?? {});
        main.append(el('span', 'tt-ui-text-muted tt-ui-text-small', tools.length ? `Tools: ${tools.join(', ')}` : 'No tools discovered'));
        const actions = el('div', 'tt-customize-item-actions');
        const discover = el('button', 'tt-ui-button tt-ui-button--compact', 'Discover');
        discover.type = 'button';
        discover.onclick = async () => {
            try {
                await mcpApi.servers.discover(server.id);
                window.toastr?.success?.('MCP tools refreshed.');
                state.tab = 'mcp';
                await new Promise((resolve) => setTimeout(resolve, 250));
                await renderMcp(container, api, state);
            } catch (error) {
                window.toastr?.error?.(String(error?.message ?? error));
            }
        };
        const remove = el('button', 'tt-ui-button tt-ui-button--compact', 'Remove');
        remove.type = 'button';
        remove.onclick = async () => {
            if (!window.confirm(`Remove ${server.displayName ?? server.id}?`)) return;
            try {
                await mcpApi.servers.remove(server.id);
                await renderMcp(container, api, state);
            } catch (error) {
                window.toastr?.error?.(String(error?.message ?? error));
            }
        };
        const test = el('button', 'tt-ui-button tt-ui-button--compact', 'Test call');
        test.type = 'button';
        const testPanel = buildMcpTestPanel(server, mcpApi);
        testPanel.hidden = true;
        test.onclick = () => {
            testPanel.hidden = !testPanel.hidden;
            test.textContent = testPanel.hidden ? 'Test call' : 'Close test';
        };
        actions.append(discover, test, remove);
        row.append(main, el('span', 'tt-customize-badge tt-ui-badge', `${server.state ?? 'unknown'} · ${tools.length} tools`), actions);
        panel.append(row, testPanel);
    }

    const form = el('div', 'tt-customize-editor tt-ui-card');
    form.append(el('h4', 'tt-ui-title', 'Add MCP server'));
    const name = document.createElement('input');
    name.className = 'tt-ui-input';
    name.placeholder = 'Display name';
    const endpoint = document.createElement('input');
    endpoint.className = 'tt-ui-input';
    endpoint.placeholder = 'https://example.com/mcp';
    const add = el('button', 'tt-ui-button tt-ui-button--primary tt-ui-button--compact', 'Add server');
    add.type = 'button';
    add.onclick = async () => {
        if (!name.value.trim() || !endpoint.value.trim()) return;
        try {
            await mcpApi.servers.create({
                displayName: name.value.trim(),
                endpoint: endpoint.value.trim(),
                headers: {},
                protocolVersion: 'auto',
            });
            await renderMcp(container, api, state);
        } catch (error) {
            window.toastr?.error?.(String(error?.message ?? error));
        }
    };
    const nameField = el('label', 'tt-customize-field tt-ui-field');
    nameField.append(el('span', 'tt-ui-field__label', 'Display name'), name);
    const endpointField = el('label', 'tt-customize-field tt-ui-field');
    endpointField.append(el('span', 'tt-ui-field__label', 'Endpoint'), endpoint);
    form.append(nameField, endpointField, add);
    panel.append(form);
    container.append(panel);
}

function renderPlugins(container, api, state) {
    const panel = el('div', 'tt-customize-plugins');
    panel.append(el('h3', 'tt-ui-title', 'Plugin contributions'));
    panel.append(el('p', 'tt-ui-text-muted tt-ui-text-small', 'Extensions can contribute rules, skills, agents, commands, hooks, and MCP presets through their manifest. Contributions are read-only and require trust before hooks run.'));
    const actions = el('div', 'tt-customize-actions');
    const manage = el('button', 'tt-ui-button tt-ui-button--compact', 'Manage extensions');
    manage.type = 'button';
    manage.onclick = () => {
        const trigger = document.querySelector('#extensions_details');
        if (trigger instanceof HTMLElement) trigger.click();
        else window.toastr?.info?.('Open Extensions from the main menu to install plugins.');
    };
    actions.append(manage);
    panel.append(actions);
    const plugins = (state.snapshot?.items ?? []).filter((item) => item.kind === 'plugin');
    if (!plugins.length) panel.append(el('p', 'tt-customize-empty tt-ui-empty', 'No plugin contributions were found.'));
    for (const item of plugins) {
        const row = el('div', 'tt-customize-item tt-ui-card');
        const main = el('div', 'tt-customize-item-main');
        main.append(el('strong', 'tt-ui-card__title', item.name), el('span', 'tt-ui-text-muted tt-ui-text-small', item.description || item.path || ''));
        const toggle = el('button', 'tt-ui-button tt-ui-button--compact', item.enabled === false ? 'Enable' : 'Disable');
        toggle.type = 'button';
        toggle.onclick = async () => {
            const pluginId = item.pluginId;
            if (!pluginId) return;
            await api.setPluginEnabled(pluginId, item.enabled === false);
            await refresh(api, state);
            state.render?.();
        };
        row.append(main, el('span', 'tt-customize-badge tt-ui-badge', itemBadge(item)), toggle);
        panel.append(row);
    }
    container.append(panel);
}




