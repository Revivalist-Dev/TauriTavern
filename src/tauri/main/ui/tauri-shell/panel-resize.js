import { panelResizeHandle } from '../tauri-ui/index.js';

const PANEL_WIDTH = '--tauri-panel-width';
const RAIL_WIDTH = '--tauri-rail-width';
const STORAGE_KEY = 'tauri.panel.width';
const MIN_WIDTH = 320;
const MIN_EDGE_GAP = 24;

function cssNumber(name, fallback) {
    const value = Number.parseFloat(getComputedStyle(document.body).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
}

function currentPanelWidth() {
    return cssNumber(PANEL_WIDTH, 460);
}

function maximumPanelWidth() {
    const rail = cssNumber(RAIL_WIDTH, 58);
    return Math.max(MIN_WIDTH, window.innerWidth - rail - MIN_EDGE_GAP);
}

function activePanel() {
    const panels = [...document.querySelectorAll('#top-settings-holder .drawer-content.openDrawer')]
        .filter((panel) => !panel.matches('#WorldInfo, #floatingPrompt'));
    return panels.at(-1) ?? null;
}

function applyPanelWidth(width) {
    document.body.style.setProperty(PANEL_WIDTH, `${Math.round(width)}px`);
}

function storedPanelWidth() {
    const value = Number.parseFloat(localStorage.getItem(STORAGE_KEY) ?? '');
    return Number.isFinite(value) ? value : null;
}

export function installPanelResize() {
    if (document.body.querySelector(':scope > .tt-ui-panel-resize')) return null;

    const saved = storedPanelWidth();
    const initial = Math.min(Math.max(saved ?? currentPanelWidth(), MIN_WIDTH), maximumPanelWidth());
    applyPanelWidth(initial);

    const handle = panelResizeHandle({
        label: 'Resize Panel',
        value: initial,
        min: MIN_WIDTH,
        max: maximumPanelWidth(),
        step: 16,
        onChange: applyPanelWidth,
        onCommit: (width) => {
            try {
                localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
            } catch {
                // A blocked storage partition only loses the preference.
            }
        },
    });
    handle.root.hidden = true;
    document.body.append(handle.root);

    const sync = () => {
        const panel = activePanel();
        handle.root.hidden = !panel;
        if (panel?.id) handle.root.setAttribute('aria-controls', panel.id);
        else handle.root.removeAttribute('aria-controls');
        const limit = maximumPanelWidth();
        handle.setBounds({ min: MIN_WIDTH, max: limit });
        if (handle.getValue() > limit) {
            handle.setValue(limit);
            applyPanelWidth(limit);
        }
    };

    const holder = document.getElementById('top-settings-holder');
    if (holder) {
        new MutationObserver(sync).observe(holder, {
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });
    }
    window.addEventListener('resize', sync);
    sync();
    return handle;
}
