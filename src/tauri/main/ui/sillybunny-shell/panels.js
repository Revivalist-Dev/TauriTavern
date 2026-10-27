/**
 * Panel host for the SillyBunny desktop shell.
 *
 * Extensions register panels through sb-core's `registerPanel`, which prefers
 * the host API published here. Each panel becomes an ordinary left-rail drawer
 * so SillyTavern's own open/close behaviour keeps working. There is no mobile
 * presentation and no second generation pipeline.
 */

import { doNavbarIconClick } from '../../../../script.js';
import { setTopLevelDrawerOpen } from '../../../../scripts/drawers.js';

const RAIL_ID = 'top-settings-holder';
const PANEL_PREFIX = 'sb_panel_';
const DEFAULT_ICON = 'fa-solid fa-puzzle-piece';

/** @type {Map<string, { panel: object, drawer: HTMLElement, content: HTMLElement, body: HTMLElement, rendered: boolean }>} */
const panels = new Map();
let hostInstalled = false;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function panelId(id) {
    return `${PANEL_PREFIX}${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function closePanel(entry) {
    setTopLevelDrawerOpen(entry.content, false);
}

/**
 * Bind a drawer created after SillyTavern's one-time `.drawer-toggle` binding.
 * @param {HTMLElement} drawer
 * @param {(() => void) | undefined} afterOpen
 */
export function wireInjectedDrawer(drawer, afterOpen) {
    const toggle = drawer?.querySelector('.drawer-toggle');
    if (!(toggle instanceof HTMLElement) || toggle.dataset.sbWired === '1') {
        return;
    }
    toggle.dataset.sbWired = '1';
    toggle.addEventListener('click', () => {
        void (async () => {
            await doNavbarIconClick.call(toggle);
            afterOpen?.();
        })();
    });
}

function renderPanel(entry) {
    try {
        entry.panel.render(entry.body, {
            id: entry.panel.id,
            label: entry.panel.label,
            close: () => closePanel(entry),
        });
        entry.rendered = true;
    } catch (error) {
        entry.body.replaceChildren(element('p', 'sb-panel-error', `面板加载失败：${error?.message ?? error}`));
        console.error(`[sb-shell] Panel "${entry.panel.id}" failed to render:`, error);
    }
}

function createDrawer(panel) {
    const holder = document.getElementById(RAIL_ID);
    if (!(holder instanceof HTMLElement)) {
        throw new Error('SillyTavern top bar is not ready');
    }
    const id = panelId(panel.id);
    const drawer = element('div', 'drawer sb-panel-drawer');
    drawer.id = id;

    const toggle = element('div', 'drawer-toggle drawer-header sb-rail-button');
    toggle.title = panel.label;
    toggle.setAttribute('aria-label', panel.label);
    const icon = element('div', `drawer-icon ${panel.icon || DEFAULT_ICON} fa-fw closedIcon sb-rail-icon`);
    icon.setAttribute('aria-hidden', 'true');
    toggle.append(icon);

    const content = element('div', 'drawer-content sb-panel-content closedDrawer');
    content.id = `${id}_content`;
    const header = element('header', 'sb-panel-header');
    header.append(element('h2', 'sb-panel-heading', panel.label));
    const close = element('button', 'sb-icon-button sb-panel-close');
    close.type = 'button';
    close.title = '关闭';
    close.setAttribute('aria-label', '关闭');
    close.append(element('i', 'fa-solid fa-xmark'));
    header.append(close);

    const body = element('div', 'sb-panel-body');
    content.append(header, body);
    drawer.append(toggle, content);
    if (!holder.querySelector('.sb-rail-separator')) {
        holder.append(element('div', 'sb-rail-separator'));
    }
    holder.append(drawer);

    close.addEventListener('click', () => {
        closePanel(panels.get(panel.id) ?? { drawer, content });
    });
    wireInjectedDrawer(drawer, () => {
        const entry = panels.get(panel.id);
        if (entry && entry.content.classList.contains('openDrawer')) {
            renderPanel(entry);
        }
    });

    return { drawer, content, body };
}

/**
 * Register one panel. Idempotent by id; a re-registration updates the renderer.
 * @param {{ id: string, label: string, icon?: string, render: (container: HTMLElement, api: object) => void }} panel
 */
export function registerPanel(panel) {
    if (!panel?.id || typeof panel.render !== 'function') {
        throw new Error('registerPanel requires an id and a render function');
    }
    if (panels.has(panel.id)) {
        panels.get(panel.id).panel = panel;
        return () => unregisterPanel(panel.id);
    }
    const { drawer, content, body } = createDrawer(panel);
    panels.set(panel.id, { panel, drawer, content, body, rendered: false });
    return () => unregisterPanel(panel.id);
}

export function unregisterPanel(id) {
    const entry = panels.get(id);
    if (!entry) {
        return;
    }
    entry.drawer.remove();
    panels.delete(id);
}

export function openPanel(id) {
    const entry = panels.get(id);
    if (!entry) {
        return false;
    }
    for (const other of panels.values()) {
        if (other !== entry) {
            closePanel(other);
        }
    }
    setTopLevelDrawerOpen(entry.content, true);
    renderPanel(entry);
    return true;
}

export function listPanels() {
    return Array.from(panels.keys());
}

export function installPanelHost() {
    const api = {
        version: 1,
        register: registerPanel,
        unregister: unregisterPanel,
        open: openPanel,
        close: (id) => {
            const entry = panels.get(id);
            if (entry) {
                closePanel(entry);
            }
        },
        list: listPanels,
    };
    globalThis.__TAURITAVERN_SB_SHELL__ = api;

    const pending = Array.isArray(globalThis.__SB_PENDING_PANELS__) ? globalThis.__SB_PENDING_PANELS__.splice(0) : [];
    for (const panel of pending) {
        try {
            registerPanel(panel);
        } catch (error) {
            console.error('[sb-shell] Failed to register a pending panel:', error);
        }
    }
    hostInstalled = true;
    return api;
}

export function isPanelHostInstalled() {
    return hostInstalled;
}
