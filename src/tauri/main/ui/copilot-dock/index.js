const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 380;
const MAX_WIDTH = 680;
const STORAGE_WIDTH = 'tt.copilot.width';
const STORAGE_OPEN = 'tt.copilot.open';

let installed = false;
let observer = null;
let focusBadge = null;
let loadTimer = null;

function readWidth() {
    const value = Number(localStorage.getItem(STORAGE_WIDTH));
    return Number.isFinite(value) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)) : DEFAULT_WIDTH;
}

function readOpen() {
    const value = localStorage.getItem(STORAGE_OPEN);
    return value === null ? true : value === 'true';
}

function setWidth(width) {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
    document.documentElement.style.setProperty('--tt-copilot-width', `${clamped}px`);
    localStorage.setItem(STORAGE_WIDTH, String(Math.round(clamped)));
}

function buildDock() {
    if (document.getElementById('tt-copilot-dock')) return;
    const dock = document.createElement('section');
    dock.id = 'tt-copilot-dock';
    dock.setAttribute('aria-label', 'Copilot');
    dock.innerHTML = `
        <div class="tt-copilot-head">
            <span class="tt-copilot-title">Copilot</span>
            <span class="tt-copilot-status" id="tt-copilot-status">Directory context</span>
            <button class="tt-copilot-collapse" id="tt-copilot-collapse" type="button" title="Collapse Copilot">‹</button>
        </div>
        <div class="tt-copilot-slot" id="tt-copilot-slot">
            <div class="tt-copilot-empty" id="tt-copilot-empty">Loading Copilot…</div>
        </div>
        <div class="tt-copilot-resizer" id="tt-copilot-resizer" role="separator" aria-orientation="vertical"></div>
    `;
    document.body.append(dock);
    const toggle = document.createElement('button');
    toggle.id = 'tt-copilot-toggle';
    toggle.type = 'button';
    toggle.title = 'Toggle Copilot';
    toggle.textContent = 'C';
    document.body.append(toggle);

    document.getElementById('tt-copilot-collapse')?.addEventListener('click', () => setOpen(false));
    toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('tt-copilot-open')));
    document.getElementById('tt-copilot-slot')?.addEventListener('click', (event) => {
        if (event.target.closest('#scp-close-btn')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            setOpen(false);
        }
    }, true);

    const resizer = document.getElementById('tt-copilot-resizer');
    let startX = 0;
    let startWidth = DEFAULT_WIDTH;
    resizer?.addEventListener('pointerdown', (event) => {
        startX = event.clientX;
        startWidth = readWidth();
        resizer.setPointerCapture(event.pointerId);
        document.body.classList.add('tt-copilot-resizing');
    });
    resizer?.addEventListener('pointermove', (event) => {
        if (!resizer.hasPointerCapture(event.pointerId)) return;
        setWidth(startWidth + event.clientX - startX);
    });
    resizer?.addEventListener('pointerup', (event) => {
        resizer.releasePointerCapture(event.pointerId);
        document.body.classList.remove('tt-copilot-resizing');
    });
    resizer?.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        setWidth(readWidth() + (event.key === 'ArrowRight' ? 16 : -16));
    });
    if (resizer) {
        resizer.tabIndex = 0;
        resizer.setAttribute('aria-label', 'Resize Copilot panel');
    }
}

function ensureExtensionWindow() {
    if (document.getElementById('scp-window')) return true;
    const copilot = window.__TT_ST_COPILOT__;
    if (copilot?.showWindow) {
        try {
            copilot.showWindow();
        } catch {
            // The extension may still be loading; the retry timer reports a
            // useful failure state instead of leaving the dock on "Loading".
        }
    }
    return Boolean(document.getElementById('scp-window'));
}

function showLoadFailure() {
    const empty = document.getElementById('tt-copilot-empty');
    if (!empty || document.getElementById('scp-window')) return;
    const disabled = window.extension_settings?.disabledExtensions?.includes('st-deeplore-copilot');
    empty.replaceChildren();
    const message = document.createElement('div');
    message.className = 'tt-copilot-empty-message';
    message.textContent = disabled
        ? 'Copilot is disabled in Extensions.'
        : 'Copilot did not finish loading.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'menu_button';
    retry.textContent = 'Reload TauriTavern';
    retry.addEventListener('click', () => window.location.reload());
    empty.append(message, retry);
}

function scheduleLoadFailure() {
    if (loadTimer) window.clearTimeout(loadTimer);
    if (document.getElementById('scp-window')) return;
    loadTimer = window.setTimeout(showLoadFailure, 6000);
}

function updateFocusBadge() {
    if (!focusBadge) return;
    const focus = window.__TAURITAVERN__?.api?.workspace?.getFocus?.();
    if (!focus?.mountId) {
        focusBadge.textContent = '';
        focusBadge.hidden = true;
        return;
    }
    const label = focus.folder || focus.path || 'vault root';
    focusBadge.textContent = label;
    focusBadge.title = `Copilot context: ${label}`;
    focusBadge.hidden = false;
}

function installFocusBadge(header) {
    if (!header || focusBadge) return;
    focusBadge = document.createElement('span');
    focusBadge.id = 'tt-copilot-focus';
    focusBadge.className = 'scp-provider-badge';
    header.append(focusBadge);
    window.__TAURITAVERN__?.api?.workspace?.subscribe?.(() => updateFocusBadge());
    updateFocusBadge();
}

function dockCopilotWindow() {
    const dock = document.getElementById('tt-copilot-dock');
    const slot = document.getElementById('tt-copilot-slot');
    const empty = document.getElementById('tt-copilot-empty');
    if (!dock || !slot) return;
    const windowEl = document.getElementById('scp-window');
    if (!windowEl) {
        ensureExtensionWindow();
        scheduleLoadFailure();
        return;
    }
    if (loadTimer) {
        window.clearTimeout(loadTimer);
        loadTimer = null;
    }
    if (windowEl.parentElement !== slot) {
        slot.append(windowEl);
    }
    installFocusBadge(windowEl.querySelector('.scp-header-left'));
    if (document.body.classList.contains('tt-copilot-open')) {
        windowEl.style.display = 'flex';
    }
    empty?.remove();
    dock.classList.add('tt-copilot-ready');
}

function setOpen(open) {
    document.body.classList.toggle('tt-copilot-open', open);
    localStorage.setItem(STORAGE_OPEN, String(open));
    const dock = document.getElementById('tt-copilot-dock');
    if (dock) dock.setAttribute('aria-hidden', String(!open));
    const toggle = document.getElementById('tt-copilot-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (open) dockCopilotWindow();
}

function observeCopilot() {
    dockCopilotWindow();
    if (observer) return;
    observer = new MutationObserver(() => dockCopilotWindow());
    observer.observe(document.body, { childList: true, subtree: true });
}

export function installCopilotDock() {
    if (installed) return;
    installed = true;
    buildDock();
    setWidth(readWidth());
    setOpen(readOpen());
    observeCopilot();
    scheduleLoadFailure();
    window.setInterval(() => {
        ensureExtensionWindow();
        const windowEl = document.getElementById('scp-window');
        if (windowEl && document.body.classList.contains('tt-copilot-open')) {
            if (windowEl.style.display === 'none') windowEl.style.display = 'flex';
            dockCopilotWindow();
        }
    }, 2000);
}
