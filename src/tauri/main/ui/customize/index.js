import { openPanel, registerPanel } from '../sillybunny-shell/panels.js';
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

async function resolveVaultRoot() {
    try {
        const state = await window.__TAURITAVERN__?.api?.vault?.state?.();
        const mounts = state?.mounts ?? state?.vaults ?? [];
        const mount = state?.primaryMount
            ?? mounts.find?.((candidate) => candidate.primary)
            ?? mounts.find?.((candidate) => candidate.id === state?.primaryMountId)
            ?? mounts[0];
        return mount?.path ?? mount?.root ?? mount?.rootPath ?? null;
    } catch {
        return null;
    }
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
    if (kind === 'command') return ['native_agent', 'copilot', 'roleplay'];
    if (kind === 'mcp') return ['native_agent', 'copilot', 'deeplore'];
    if (kind === 'hook' || kind === 'plugin') return ['native_agent'];
    return ['native_agent', 'copilot'];
}

function itemBadge(item) {
    const source = item.source ? ` · ${item.source}` : '';
    return `${item.kind}${source}${item.enabled === false ? ' · disabled' : ''}`;
}

export function installCustomizePanel() {
    if (installed) return;
    installed = true;
    installHooksBridge();
    registerPanel({
        id: PANEL_ID,
        label: 'Customize',
        icon: 'fa-solid fa-sliders',
        order: 35,
        render: (container, panel) => {
            hostPanel = { container, panel };
            renderCustomize(container).catch((error) => {
                console.error('TauriTavern: Customize panel failed:', error);
                container.replaceChildren(el('p', 'tt-customize-error', `Failed to load Customize: ${error?.message ?? error}`));
            });
        },
    });
    window.addEventListener('tt:open-customize', () => openPanel(PANEL_ID));
}

async function renderCustomize(container) {
    const api = window.__TAURITAVERN__?.api?.customize;
    if (!api) throw new Error('Customize API is unavailable');
    const vaultRoot = await resolveVaultRoot();
    const state = {
        tab: 'rules',
        vaultRoot,
        snapshot: null,
        editing: null,
        logs: [],
        hookConfigText: '',
        busy: false,
    };
    const render = () => renderShell(container, api, state, render);
    state.render = render;
    await refresh(api, state);
    render();
}

async function refresh(api, state) {
    state.snapshot = await api.snapshot(state.vaultRoot);
    if (!state.hookConfigText) {
        const config = state.snapshot?.hookConfig;
        state.hookConfigText = JSON.stringify(config ?? { version: 1, hooks: {} }, null, 2);
    }
    state.logs = await api.hooks.logs().catch(() => []);
}

function renderShell(container, api, state, rerender) {
    const shell = el('div', 'tt-customize');
    const header = el('div', 'tt-customize-header');
    const title = el('div', 'tt-customize-title');
    title.append(el('strong', '', 'Customize'));
    title.append(el('span', '', state.vaultRoot ? `Vault: ${state.vaultRoot}` : 'Native storage'));
    const actions = el('div', 'tt-customize-actions');
    const reload = el('button', 'tt-customize-btn', 'Reload');
    reload.type = 'button';
    reload.onclick = async () => {
        state.hookConfigText = '';
        await refresh(api, state);
        rerender();
    };
    actions.append(reload);
    header.append(title, actions);

    const tabs = el('div', 'tt-customize-tabs');
    for (const [id, label] of TABS) {
        const button = el('button', 'tt-customize-tab', label);
        button.type = 'button';
        button.classList.toggle('active', state.tab === id);
        button.onclick = () => {
            state.tab = id;
            state.editing = null;
            rerender();
        };
        tabs.append(button);
    }

    const body = el('div', 'tt-customize-body');
    if (state.tab === 'hooks') renderHooks(body, api, state, rerender);
    else if (state.tab === 'mcp') void renderMcp(body, api, state);
    else if (state.tab === 'plugins') renderPlugins(body, state);
    else renderItems(body, api, state, rerender);

    const warnings = el('div', 'tt-customize-warnings');
    for (const warning of state.snapshot?.warnings ?? []) {
        const row = el('div', 'tt-customize-warning');
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
    const list = el('div', 'tt-customize-list');
    const items = itemsFor(state, state.tab);
    const toolbar = el('div', 'tt-customize-toolbar');
    toolbar.append(el('h3', '', TABS.find(([id]) => id === state.tab)?.[1] ?? 'Items'));
    const newButton = el('button', 'tt-customize-btn primary', '+ New');
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
        list.append(el('p', 'tt-customize-empty', 'Nothing here yet. Create one or add files under .cursor/.'));
    }
    for (const item of items) {
        const row = el('div', 'tt-customize-item');
        const main = el('button', 'tt-customize-item-main');
        main.type = 'button';
        main.onclick = () => {
            state.editing = { ...item, scope: item.scope ?? 'vault' };
            rerender();
        };
        main.append(el('strong', '', item.name));
        main.append(el('span', '', item.description || item.path || ''));
        const badge = el('span', 'tt-customize-badge', itemBadge(item));
        const toggle = el('button', 'tt-customize-toggle', item.enabled === false ? 'Enable' : 'Disable');
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
        list.append(row);
    }
    if (state.editing) {
        list.append(renderEditor(api, state, rerender));
    }
    container.append(list);
}

function renderEditor(api, state, rerender) {
    const item = state.editing;
    const form = el('div', 'tt-customize-editor');
    form.append(el('h4', '', item.id ? `Edit ${item.name}` : 'New customization'));
    const field = (label, value, onChange, textarea = false) => {
        const wrapper = el('label', 'tt-customize-field');
        wrapper.append(el('span', '', label));
        const input = document.createElement(textarea ? 'textarea' : 'input');
        input.value = value ?? '';
        if (textarea) input.rows = 12;
        input.oninput = (event) => onChange(event.target.value);
        wrapper.append(input);
        return wrapper;
    };
    form.append(field('Name', item.name, (value) => { item.name = value; }));
    form.append(field('Description', item.description, (value) => { item.description = value; }));
    form.append(field('Body / instructions', item.body, (value) => { item.body = value; }, true));
    form.append(field('Globs (comma separated)', (item.globs ?? []).join(', '), (value) => {
        item.globs = value.split(',').map((part) => part.trim()).filter(Boolean);
    }));
    const always = el('label', 'tt-customize-check');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(item.alwaysApply);
    checkbox.onchange = () => { item.alwaysApply = checkbox.checked; };
    always.append(checkbox, document.createTextNode(' Always apply'));
    form.append(always);

    const surfaces = el('div', 'tt-customize-surfaces');
    for (const [id, label] of [['native_agent', 'Native agent'], ['copilot', 'Copilot'], ['roleplay', 'Roleplay'], ['deeplore', 'DeepLore']]) {
        const wrapper = el('label', 'tt-customize-check');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = (item.surfaces ?? []).includes(id);
        box.onchange = () => {
            item.surfaces = box.checked
                ? [...new Set([...(item.surfaces ?? []), id])]
                : (item.surfaces ?? []).filter((surface) => surface !== id);
        };
        wrapper.append(box, document.createTextNode(` ${label}`));
        surfaces.append(wrapper);
    }
    form.append(surfaces);

    const actions = el('div', 'tt-customize-editor-actions');
    const save = el('button', 'tt-customize-btn primary', 'Save');
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
                vaultRoot: item.scope === 'vault' || !item.id ? state.vaultRoot : null,
            });
            state.editing = null;
            state.hookConfigText = '';
            await refresh(api, state);
            rerender();
        } catch (error) {
            window.toastr?.error?.(String(error?.message ?? error));
        } finally {
            state.busy = false;
        }
    };
    const cancel = el('button', 'tt-customize-btn', 'Cancel');
    cancel.type = 'button';
    cancel.onclick = () => {
        state.editing = null;
        rerender();
    };
    actions.append(save, cancel);
    if (item.id) {
        const remove = el('button', 'tt-customize-btn danger', 'Delete');
        remove.type = 'button';
        remove.onclick = async () => {
            if (!window.confirm(`Delete "${item.name}"?`)) return;
            await api.remove(item.id, state.vaultRoot);
            state.editing = null;
            await refresh(api, state);
            rerender();
        };
        actions.append(remove);
    }
    form.append(actions);
    return form;
}

function renderHooks(container, api, state, rerender) {
    const panel = el('div', 'tt-customize-hooks');
    const status = el('div', 'tt-customize-hook-status');
    status.textContent = state.snapshot?.hookTrusted
        ? 'Hook configuration is trusted for this vault.'
        : 'Hook configuration is not trusted. Commands will not run until trusted.';
    status.classList.toggle('trusted', Boolean(state.snapshot?.hookTrusted));
    const actions = el('div', 'tt-customize-actions');
    const trust = el('button', 'tt-customize-btn primary', 'Trust configuration');
    trust.type = 'button';
    trust.disabled = Boolean(state.snapshot?.hookTrusted) || !state.vaultRoot;
    trust.onclick = async () => {
        await api.hooks.trust(state.vaultRoot);
        await refresh(api, state);
        rerender();
    };
    const save = el('button', 'tt-customize-btn', 'Save hooks.json');
    save.type = 'button';
    save.onclick = async () => {
        try {
            const config = JSON.parse(state.hookConfigText);
            await api.hooks.saveConfig(config, state.vaultRoot);
            await refresh(api, state);
            rerender();
        } catch (error) {
            window.toastr?.error?.(String(error?.message ?? error));
        }
    };
    actions.append(trust, save);
    const editor = document.createElement('textarea');
    editor.className = 'tt-customize-hook-editor';
    editor.spellcheck = false;
    editor.value = state.hookConfigText;
    editor.oninput = () => { state.hookConfigText = editor.value; };
    const testRow = el('div', 'tt-customize-hook-test');
    const event = document.createElement('select');
    for (const name of ['beforeSubmitPrompt', 'preToolUse', 'postToolUse', 'afterAgentResponse', 'stop']) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        event.append(option);
    }
    const run = el('button', 'tt-customize-btn', 'Run test event');
    run.type = 'button';
    run.onclick = async () => {
        try {
            const result = await api.hooks.run({
                event: event.value,
                surface: 'native_agent',
                payload: { prompt: 'Customize test', toolName: 'Read' },
                vaultRoot: state.vaultRoot,
                test: true,
            });
            window.toastr?.success?.(result.allowed ? 'Hook allowed the event.' : 'Hook denied the event.');
        } catch (error) {
            window.toastr?.error?.(String(error?.message ?? error));
        }
    };
    testRow.append(event, run);
    panel.append(status, actions, editor, testRow);
    const logTitle = el('h4', '', 'Recent hook runs');
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

async function renderMcp(container, api, state) {
    const panel = el('div', 'tt-customize-mcp');
    panel.append(el('h3', '', 'MCP servers'));
    panel.append(el('p', 'tt-customize-muted', 'MCP presets from the vault and servers registered with the native MCP service.'));
    for (const item of (state.snapshot?.items ?? []).filter((candidate) => candidate.kind === 'mcp')) {
        const row = el('div', 'tt-customize-item');
        const main = el('button', 'tt-customize-item-main');
        main.type = 'button';
        main.append(el('strong', '', item.name), el('span', '', item.path || ''));
        row.append(main, el('span', 'tt-customize-badge', itemBadge(item)));
        panel.append(row);
    }
    const servers = await window.__TAURITAVERN__?.api?.mcp?.servers?.list?.().catch(() => []) ?? [];
    panel.append(el('h4', '', 'Registered servers'));
    if (!servers.length) panel.append(el('p', 'tt-customize-empty', 'No MCP servers are registered.'));
    for (const server of servers) {
        const row = el('div', 'tt-customize-item');
        const main = el('div', 'tt-customize-item-main');
        main.append(el('strong', '', server.name ?? server.id ?? 'MCP server'));
        main.append(el('span', '', server.transport ?? server.command ?? server.url ?? ''));
        const stateLabel = server.state ?? server.status ?? (server.enabled === false ? 'disabled' : 'enabled');
        row.append(main, el('span', 'tt-customize-badge', stateLabel));
        panel.append(row);
    }
    container.append(panel);
}

function renderPlugins(container, state) {
    const panel = el('div', 'tt-customize-plugins');
    panel.append(el('h3', '', 'Plugin contributions'));
    panel.append(el('p', 'tt-customize-muted', 'Extensions can contribute rules, skills, agents, commands, hooks, and MCP presets through their manifest. Contributions are read-only and require trust before hooks run.'));
    const plugins = (state.snapshot?.items ?? []).filter((item) => item.kind === 'plugin');
    if (!plugins.length) panel.append(el('p', 'tt-customize-empty', 'No plugin contributions were found.'));
    for (const item of plugins) {
        const row = el('div', 'tt-customize-item');
        row.append(el('strong', '', item.name), el('span', 'tt-customize-badge', itemBadge(item)));
        panel.append(row);
    }
    container.append(panel);
}
