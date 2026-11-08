/**
 * TauriTavern's built-in side-rail shell.
 *
 * This is native application UI, not an extension. It restyles SillyTavern's
 * own top-bar drawers as a left rail with a side panel at every window width;
 * there is no top-tab fallback and no extension owns the layout.
 *
 * It does not re-parent application chrome, so stock drawer handlers keep
 * working.
 */

import { installPanelResize } from './panel-resize.js';

const SHELL_CLASS = 'tauri-shell';
const SHELL_INSTALLED = 'tauriShellInstalled';
let railObserver = null;

function integrateRailIcons() {
    const root = document.getElementById('top-settings-holder');
    if (!root) return;
    const apply = () => {
        for (const toggle of root.querySelectorAll('.drawer-toggle')) {
            const icon = toggle.querySelector('.drawer-icon');
            if (!icon) continue;
            if (icon.id === 'rightNavDrawerIcon') {
                toggle.classList.remove('tt-ui-rail-button');
                delete toggle.dataset.ttUi;
                icon.classList.add('tt-ui-rail-button');
                icon.dataset.ttUi = 'rail-button';
                continue;
            }
            icon.classList.remove('tt-ui-rail-button');
            delete icon.dataset.ttUi;
            toggle.classList.add('tt-ui-rail-button');
            toggle.dataset.ttUi = 'rail-button';
        }
        for (const icon of root.querySelectorAll('.drawer-icon')) {
            if (icon.closest('.drawer-toggle')) continue;
            icon.classList.add('tt-ui-rail-button');
            icon.dataset.ttUi = 'rail-button';
        }
        const rightNav = document.getElementById('right-nav-panel');
        if (rightNav) rightNav.dataset.ttUi = 'panel';
    };
    apply();
    if (!railObserver) {
        railObserver = new MutationObserver(apply);
        railObserver.observe(root, { childList: true, subtree: true });
    }
}

export async function installTauriShell() {
    if (document.body.dataset[SHELL_INSTALLED] === 'true') {
        return;
    }
    document.body.dataset[SHELL_INSTALLED] = 'true';

    document.body.classList.add(SHELL_CLASS);

    const { installPanelHost } = await import('./panels.js');
    installPanelHost();
    installPanelResize();
    integrateRailIcons();
    installExclusiveTabs();
}

export function uninstallTauriShell() {
    document.body.classList.remove(SHELL_CLASS);
    delete document.body.dataset[SHELL_INSTALLED];
    document.querySelector('body > .tt-ui-panel-resize')?.remove();
}


const TAB_TOGGLE = '#top-settings-holder .drawer-toggle, #rightNavDrawerIcon, #dle-monitor-toggle';
let switchingTabs = false;

function tabPanelFor(toggle) {
    if (!toggle) return null;
    if (toggle.id === 'dle-monitor-toggle' || toggle.id === 'dle-monitor-button') return document.getElementById('dle-monitor-panel');
    if (toggle.id === 'rightNavDrawerIcon' || toggle.id === 'rightNavHolder') return document.getElementById('right-nav-panel');
    const controls = toggle.getAttribute('aria-controls');
    if (controls) return document.getElementById(controls);
    return toggle.closest('.drawer')?.querySelector(':scope > .drawer-content') ?? null;
}

function tabIsOpen(panel) {
    if (!panel) return false;
    if (panel.id === 'dle-monitor-panel') return panel.getAttribute('aria-hidden') === 'false';
    return panel.classList.contains('openDrawer');
}

function closeTab(toggle) {
    if (!tabIsOpen(tabPanelFor(toggle))) return;
    switchingTabs = true;
    try {
        toggle.click();
    } finally {
        switchingTabs = false;
    }
}

function installExclusiveTabs() {
    document.addEventListener('click', (event) => {
        if (switchingTabs) return;
        const toggle = event.target.closest(TAB_TOGGLE);
        if (!toggle) return;

        const target = tabPanelFor(toggle);
        if (!tabIsOpen(target)) return;

        for (const other of document.querySelectorAll(TAB_TOGGLE)) {
            if (other === toggle) continue;
            if (tabPanelFor(other) === target) continue;
            closeTab(other);
        }
    });
}
