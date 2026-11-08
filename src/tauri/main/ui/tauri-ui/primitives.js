/**
 * Shared disclosure, menu, divider, and segmented-control builders.
 */
import { el, icon } from './dom.js';

function nodeOrText(value) {
    if (value == null || value === false) return null;
    if (value instanceof Node) return value;
    if (Array.isArray(value)) return value.flat(Infinity).filter((item) => item != null);
    return document.createTextNode(String(value));
}

function appendValue(parent, value) {
    const child = nodeOrText(value);
    if (child instanceof Node) parent.append(child);
    else if (Array.isArray(child)) {
        for (const item of child.flat(Infinity)) {
            if (item instanceof Node) parent.append(item);
        }
    }
}
export function disclosure({ summary, body, open = false, className = '', id } = {}) {
    const root = el('details', {
        className: `tt-ui-disclosure ${className}`.trim(),
        open,
        id,
        dataset: { ttUi: 'disclosure' },
    });
    root.append(el('summary', { text: summary ?? 'Details' }));
    const bodyNode = el('div', { className: 'tt-ui-disclosure__body' });
    appendValue(bodyNode, body);
    root.append(bodyNode);
    return { root, body: bodyNode };
}

export function menu({ items = [], className = '', label = 'Menu' } = {}) {
    const root = el('div', {
        className: `tt-ui-menu ${className}`.trim(),
        role: 'menu',
        'aria-label': label,
        dataset: { ttUi: 'menu' },
    });
    for (const item of items) {
        if (item === 'divider') {
            root.append(el('hr', { className: 'tt-ui-divider' }));
            continue;
        }
        if (!item) continue;
        const node = el('button', {
            type: 'button',
            className: 'tt-ui-menu__item',
            role: 'menuitem',
            disabled: Boolean(item.disabled),
            dataset: { ttUi: 'menu-item' },
        });
        if (item.icon) node.append(icon(item.icon));
        if (item.label) node.append(document.createTextNode(String(item.label)));
        if (typeof item.onClick === 'function') node.addEventListener('click', item.onClick);
        root.append(node);
    }
    return root;
}

export function divider({ vertical = false, className = '' } = {}) {
    return el('hr', {
        className: `tt-ui-divider${vertical ? ' tt-ui-divider--vertical' : ''} ${className}`.trim(),
        role: 'separator',
        'aria-orientation': vertical ? 'vertical' : 'horizontal',
    });
}

export function segmentedControl({ items = [], value, label = 'Options', className = '', onChange } = {}) {
    const root = el('div', {
        className: `tt-ui-segmented ${className}`.trim(),
        role: 'group',
        'aria-label': label,
        dataset: { ttUi: 'segmented' },
    });
    let current = value ?? items[0]?.id ?? null;
    const nodes = new Map();
    const select = (id, emit = false) => {
        current = id;
        for (const [key, node] of nodes) {
            node.setAttribute('aria-pressed', String(key === id));
            node.classList.toggle('is-active', key === id);
        }
        if (emit) onChange?.(id);
    };
    for (const item of items) {
        if (!item || item.id == null) continue;
        const node = el('button', {
            type: 'button',
            className: 'tt-ui-segmented__item',
            'aria-pressed': 'false',
            text: item.label,
            title: item.title,
        });
        node.addEventListener('click', () => {
            if (!item.disabled) select(item.id, true);
        });
        nodes.set(item.id, node);
        root.append(node);
    }
    if (current != null) select(current);
    return { root, setValue: select, getValue: () => current, items: nodes };
}


export function panelResizeHandle({
    label = 'Resize Panel',
    value = 460,
    min = 320,
    max = 1200,
    step = 16,
    invert = false,
    onChange,
    onCommit,
    onReset,
    className = '',
} = {}) {
    let current = Math.min(Math.max(Number(value) || 460, min), max);
    let startX = 0;
    let startValue = current;

    const root = el('div', {
        className: `tt-ui-panel-resize ${className}`.trim(),
        role: 'separator',
        tabIndex: 0,
        'aria-label': label,
        'aria-orientation': 'vertical',
        dataset: { ttUi: 'panel-resize' },
    });

    const syncAria = () => {
        root.setAttribute('aria-valuenow', String(Math.round(current)));
        root.setAttribute('aria-valuemin', String(Math.round(min)));
        root.setAttribute('aria-valuemax', String(Math.round(max)));
    };

    const setValue = (next, emit = true) => {
        current = Math.min(Math.max(Number(next) || min, min), max);
        syncAria();
        if (emit) onChange?.(current);
    };

    const commit = () => onCommit?.(current);

    root.addEventListener('pointerdown', (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        startX = event.clientX;
        startValue = current;
        root.setPointerCapture?.(event.pointerId);
        root.classList.add('is-dragging');
        document.body.classList.add('is-resizing-panel');
    });
    root.addEventListener('pointermove', (event) => {
        if (!root.hasPointerCapture?.(event.pointerId)) return;
        const delta = event.clientX - startX;
        setValue(startValue + (invert ? -delta : delta));
    });
    const endDrag = (event) => {
        if (root.hasPointerCapture?.(event.pointerId)) root.releasePointerCapture(event.pointerId);
        if (!root.classList.contains('is-dragging')) return;
        root.classList.remove('is-dragging');
        document.body.classList.remove('is-resizing-panel');
        commit();
    };
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    root.addEventListener('keydown', (event) => {
        let next = null;
        if (event.key === 'ArrowLeft') next = current + (invert ? step : -step);
        else if (event.key === 'ArrowRight') next = current + (invert ? -step : step);
        else if (event.key === 'Home') next = min;
        else if (event.key === 'End') next = max;
        if (next === null) return;
        event.preventDefault();
        setValue(next);
        commit();
    });
    if (onReset) {
        root.addEventListener('dblclick', () => {
            setValue(onReset());
            commit();
        });
    }

    syncAria();
    return {
        root,
        setValue,
        getValue: () => current,
        setBounds(next = {}) {
            if (Number.isFinite(next.min)) min = next.min;
            if (Number.isFinite(next.max)) max = next.max;
            setValue(current);
        },
    };
}
