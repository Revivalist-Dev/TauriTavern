/**
 * Shared TauriTavern UI components.
 *
 * These builders produce the classes and data attributes defined in
 * src/css/tauri-ui.css. They are intentionally dependency-free.
 */
import { appendChildren, el, icon, setDataset } from './dom.js';
let tabSequence = 0;
function nodeOrText(value) {
    if (value == null || value === false) return null;
    if (value instanceof Node) return value;
    if (Array.isArray(value)) return value.flat(Infinity).filter((item) => item != null);
    return document.createTextNode(String(value));
}

function appendValue(parent, value) {
    const child = nodeOrText(value);
    if (child instanceof Node) parent.append(child);
    else if (Array.isArray(child)) appendChildren(parent, child);
}

export function panel({
    id,
    title,
    subtitle,
    actions,
    body,
    footer,
    className = '',
    ariaLabel,
    role = 'region',
} = {}) {
    const heading = el('div', { className: 'tt-ui-panel__heading' });
    const titleNode = title ? el('h2', { className: 'tt-ui-panel__title', text: title }) : null;
    const subtitleNode = subtitle ? el('p', { className: 'tt-ui-panel__subtitle', text: subtitle }) : null;
    if (titleNode) heading.append(titleNode);
    if (subtitleNode) heading.append(subtitleNode);

    const actionRow = el('div', { className: 'tt-ui-panel__actions' });
    appendValue(actionRow, actions);

    const header = el('header', { className: 'tt-ui-panel__header' }, heading);
    if (actionRow.childNodes.length) header.append(actionRow);

    const bodyNode = el('div', { className: 'tt-ui-panel__body' });
    appendValue(bodyNode, body);

    const footerNode = footer ? el('footer', { className: 'tt-ui-panel__footer' }) : null;
    if (footerNode) appendValue(footerNode, footer);

    const root = el('section', {
        id,
        className: `tt-ui-panel ${className}`.trim(),
        dataset: { ttUi: 'panel' },
        role,
        'aria-label': ariaLabel ?? (typeof title === 'string' ? title : undefined),
    }, header, bodyNode);
    if (footerNode) root.append(footerNode);

    return {
        root,
        header,
        heading,
        title: titleNode,
        subtitle: subtitleNode,
        actions: actionRow,
        body: bodyNode,
        footer: footerNode,
    };
}

export function tabs({
    items = [],
    activeId = null,
    label = 'Tabs',
    onChange,
    className = '',
} = {}) {
    const root = el('div', {
        className: `tt-ui-tablist ${className}`.trim(),
        role: 'tablist',
        'aria-label': label,
        dataset: { ttUi: 'tabs' },
    });
    const tabNodes = new Map();
    const tabsSequence = ++tabSequence;
    let activeTabId = activeId ?? null;

    const setActive = (id, emit = false) => {
        let selected = null;
        for (const [tabId, tab] of tabNodes) {
            const isActive = tabId === id;
            tab.setAttribute('aria-selected', String(isActive));
            tab.tabIndex = isActive ? 0 : -1;
            tab.classList.toggle('is-active', isActive);
            if (isActive) selected = tabId;
        }
        if (selected) activeTabId = selected;
        if (emit && selected) onChange?.(selected);
        return selected;
    };

    for (const item of items) {
        if (!item || item.id == null) continue;
        const tabId = `tt-ui-tab-${tabsSequence}-${String(item.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        const tab = el('button', {
            type: 'button',
            id: tabId,
            className: 'tt-ui-tab',
            dataset: { ttUi: 'tab', tabId: String(item.id) },
            role: 'tab',
            'aria-selected': 'false',
            'aria-controls': item.controls,
            disabled: Boolean(item.disabled),
            title: item.title,
        });
        if (item.icon) tab.append(icon(item.icon));
        if (item.label) tab.append(document.createTextNode(String(item.label)));
        if (item.badge != null) tab.append(el('span', { className: 'tt-ui-badge', text: String(item.badge) }));
        tab.addEventListener('click', () => {
            if (!item.disabled) setActive(item.id, true);
        });
        tab.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const enabled = [...tabNodes.entries()].filter(([tabKey, tabNode]) => !tabNode.disabled);
            const current = enabled.findIndex(([tabKey]) => tabKey === activeTabId);
            let next = current;
            if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = enabled.length - 1;
            else if (event.key === 'ArrowLeft') next = (current - 1 + enabled.length) % enabled.length;
            else if (event.key === 'ArrowRight') next = (current + 1) % enabled.length;
            const nextTab = enabled[next]?.[1];
            if (nextTab) {
                nextTab.focus();
                const nextId = enabled[next][0];
                setActive(nextId, true);
            }
        });
        tabNodes.set(item.id, tab);
        root.append(tab);
    }

    const initial = activeId != null
        ? activeId
        : items.find((item) => item && !item.disabled)?.id ?? null;
    if (initial != null) setActive(initial);

    return {
        root,
        setActive,
        getActiveId: () => activeTabId,
        tabs: tabNodes,
    };
}

export function button({
    label,
    icon: iconName,
    title,
    ariaLabel,
    variant = 'secondary',
    size = 'md',
    type = 'button',
    disabled = false,
    className = '',
    onClick,
    dataset,
} = {}) {
    const variantClass = variant && variant !== 'secondary' ? ` tt-ui-button--${variant}` : '';
    const sizeClass = size === 'compact' ? ' tt-ui-button--compact' : '';
    const node = el('button', {
        type,
        className: `tt-ui-button${variantClass}${sizeClass} ${className}`.trim(),
        dataset: { ttUi: 'button', ...(dataset ?? {}) },
        title: title ?? ariaLabel,
        'aria-label': ariaLabel ?? (typeof label === 'string' ? undefined : title),
        disabled,
    });
    if (iconName) node.append(icon(iconName));
    if (label) node.append(document.createTextNode(String(label)));
    if (typeof onClick === 'function') node.addEventListener('click', onClick);
    return node;
}

export function iconButton({
    icon: iconName,
    label,
    title,
    disabled = false,
    className = '',
    onClick,
    dataset,
} = {}) {
    if (!label && !title) throw new Error('iconButton requires a label or title');
    return button({
        icon: iconName,
        ariaLabel: label ?? title,
        title: title ?? label,
        size: 'compact',
        className: `tt-ui-icon-button ${className}`.trim(),
        disabled,
        onClick,
        dataset,
    });
}

export function toolbar({ children, actions, className = '', ariaLabel } = {}) {
    const root = el('div', {
        className: `tt-ui-toolbar ${className}`.trim(),
        role: 'toolbar',
        'aria-label': ariaLabel,
        dataset: { ttUi: 'toolbar' },
    });
    appendValue(root, children);
    if (actions) {
        const actionRow = el('div', { className: 'tt-ui-toolbar__actions' });
        appendValue(actionRow, actions);
        root.append(el('div', { className: 'tt-ui-toolbar__spacer' }), actionRow);
    }
    return root;
}

export function section({ title, children, className = '' } = {}) {
    const root = el('section', { className: `tt-ui-section ${className}`.trim() });
    if (title) root.append(el('h3', { className: 'tt-ui-card__title', text: title }));
    appendValue(root, children);
    return root;
}

export function card({ title, body, actions, className = '', dataset } = {}) {
    const root = el('div', {
        className: `tt-ui-card ${className}`.trim(),
        dataset: { ttUi: 'card', ...(dataset ?? {}) },
    });
    if (title) root.append(el('h3', { className: 'tt-ui-card__title', text: title }));
    if (body != null) {
        const bodyNode = el('div', { className: 'tt-ui-card__body' });
        appendValue(bodyNode, body);
        root.append(bodyNode);
    }
    if (actions) {
        const actionRow = el('div', { className: 'tt-ui-panel__actions' });
        appendValue(actionRow, actions);
        root.append(actionRow);
    }
    return root;
}

export function row({ children, interactive = false, className = '', onClick, dataset } = {}) {
    const root = el('div', {
        className: `tt-ui-row${interactive ? ' tt-ui-row--interactive' : ''} ${className}`.trim(),
        dataset: { ttUi: 'row', ...(dataset ?? {}) },
        role: interactive ? 'button' : undefined,
        tabIndex: interactive ? 0 : undefined,
    });
    appendValue(root, children);
    if (typeof onClick === 'function') {
        root.addEventListener('click', onClick);
        root.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick(event);
            }
        });
    }
    return root;
}

export function field({ label, hint, control, id, className = '' } = {}) {
    const fieldId = id ?? (control?.id || `tt-ui-field-${Math.random().toString(36).slice(2, 9)}`);
    if (control && !control.id) control.id = fieldId;
    const root = el('div', {
        className: `tt-ui-field ${className}`.trim(),
        dataset: { ttUi: 'field' },
    });
    const labelNode = label ? el('label', { className: 'tt-ui-field__label', htmlFor: fieldId, text: label }) : null;
    if (labelNode) root.append(labelNode);
    if (control) root.append(control);
    if (hint) root.append(el('span', { className: 'tt-ui-field__hint', text: hint }));
    return root;
}

export function input({ className = '', ...props } = {}) {
    return el('input', {
        ...props,
        className: `tt-ui-input ${className}`.trim(),
    });
}

export function textarea({ className = '', ...props } = {}) {
    return el('textarea', {
        ...props,
        className: `tt-ui-textarea ${className}`.trim(),
    });
}

export function select({ options = [], className = '', ...props } = {}) {
    const node = el('select', {
        ...props,
        className: `tt-ui-select ${className}`.trim(),
    });
    for (const option of options) {
        if (option == null) continue;
        const value = typeof option === 'object' ? option.value : option;
        const label = typeof option === 'object' ? option.label ?? option.value : option;
        node.append(el('option', { value, text: label }));
    }
    return node;
}

export function checkbox({ className = '', ...props } = {}) {
    return el('input', {
        type: 'checkbox',
        ...props,
        className: `tt-ui-checkbox ${className}`.trim(),
    });
}

export function emptyState({ title, body, action, className = '' } = {}) {
    const root = el('div', {
        className: `tt-ui-empty ${className}`.trim(),
        dataset: { ttUi: 'empty' },
    });
    if (title) root.append(el('h3', { className: 'tt-ui-empty__title', text: title }));
    if (body != null) {
        const bodyNode = el('div', { className: 'tt-ui-card__body' });
        appendValue(bodyNode, body);
        root.append(bodyNode);
    }
    if (action) appendValue(root, action);
    return root;
}

export function badge({ label, tone, className = '' } = {}) {
    return el('span', {
        className: `tt-ui-badge ${className}`.trim(),
        dataset: { ttUi: 'badge', ...(tone ? { tone } : {}) },
        text: label,
    });
}

export function status({ label, state = 'idle', className = '' } = {}) {
    return el('span', {
        className: `tt-ui-status ${className}`.trim(),
        dataset: { ttUi: 'status', state },
        text: label,
    });
}

export function spinner({ label = 'Loading' } = {}) {
    return el('span', {
        className: 'tt-ui-spinner',
        role: 'status',
        'aria-label': label,
    });
}

export function setBusy(node, busy, label = 'Loading') {
    if (!node) return null;
    let spinnerNode = node.querySelector(':scope > .tt-ui-spinner');
    if (busy && !spinnerNode) {
        spinnerNode = spinner({ label });
        node.append(spinnerNode);
    } else if (!busy && spinnerNode) {
        spinnerNode.remove();
        spinnerNode = null;
    }
    node.setAttribute('aria-busy', String(Boolean(busy)));
    return spinnerNode;
}

export { appendChildren, el, icon, setDataset };

export function breadcrumbs({ items = [], label = 'Breadcrumbs', className = '' } = {}) {
    const root = el('nav', {
        className: `tt-ui-breadcrumbs ${className}`.trim(),
        'aria-label': label,
    });
    items.forEach((item, index) => {
        if (index > 0) root.append(el('span', { className: 'tt-ui-breadcrumb__separator', text: '/', attrs: { 'aria-hidden': 'true' } }));
        const crumb = el('button', {
            type: 'button',
            className: 'tt-ui-breadcrumb',
            text: item.label,
            title: item.title ?? item.label,
            'aria-current': item.current ? 'page' : undefined,
        });
        if (typeof item.onClick === 'function') crumb.addEventListener('click', item.onClick);
        root.append(crumb);
    });
    return root;
}

export function searchInput({ placeholder = 'Search', value = '', label = 'Search', className = '', onInput } = {}) {
    const root = el('div', { className: `tt-ui-search ${className}`.trim() });
    root.append(icon('fa-magnifying-glass'));
    const field = input({
        type: 'search',
        placeholder,
        value,
        'aria-label': label,
    });
    if (typeof onInput === 'function') field.addEventListener('input', onInput);
    root.append(field);
    return { root, input: field };
}

export function switchControl({ label, checked = false, disabled = false, name, className = '', onChange } = {}) {
    const checkedState = Boolean(checked);
    const checkbox = el('input', {
        type: 'checkbox',
        checked: checkedState,
        disabled,
        name,
        'aria-label': label,
    });
    if (typeof onChange === 'function') checkbox.addEventListener('change', onChange);
    const root = el('label', {
        className: `tt-ui-switch ${className}`.trim(),
        dataset: { ttUi: 'switch' },
    }, checkbox, el('span', { className: 'tt-ui-switch__track', attrs: { 'aria-hidden': 'true' } }));
    if (label) root.append(el('span', { text: label }));
    return { root, input: checkbox };
}

export function dialog({ title, body, footer, className = '', ariaLabel, onClose } = {}) {
    const headingId = `tt-ui-dialog-${Math.random().toString(36).slice(2, 9)}`;
    const titleNode = title ? el('h2', { className: 'tt-ui-dialog__title', id: headingId, text: title }) : null;
    const close = iconButton({
        icon: 'fa-xmark',
        label: 'Close',
        title: 'Close',
        onClick: () => closeDialog(),
    });
    const header = el('header', { className: 'tt-ui-dialog__header' }, titleNode, close);
    const bodyNode = el('div', { className: 'tt-ui-dialog__body' });
    appendValue(bodyNode, body);
    const footerNode = footer ? el('footer', { className: 'tt-ui-dialog__footer' }) : null;
    if (footerNode) appendValue(footerNode, footer);
    const surface = el('section', {
        className: `tt-ui-dialog__surface ${className}`.trim(),
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': ariaLabel ?? (typeof title === 'string' ? undefined : 'Dialog'),
        'aria-labelledby': titleNode ? headingId : undefined,
        dataset: { ttUi: 'dialog' },
    }, header, bodyNode);
    if (footerNode) surface.append(footerNode);
    const backdrop = el('div', { className: 'tt-ui-dialog__backdrop' });
    const root = el('div', { className: 'tt-ui-dialog' }, backdrop, surface);
    let previouslyFocused = null;

    const onKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDialog();
        }
    };

    const closeDialog = () => {
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        previouslyFocused?.focus?.();
        onClose?.();
    };

    const openDialog = () => {
        if (root.isConnected) return;
        previouslyFocused = document.activeElement;
        document.body.append(root);
        document.addEventListener('keydown', onKeyDown);
        surface.querySelector('button, input, select, textarea, [tabindex]')?.focus?.();
    };

    return { root, surface, header, title: titleNode, body: bodyNode, footer: footerNode, open: openDialog, close: closeDialog };
}

export function progress({ value = 0, max = 100, label = 'Progress', className = '' } = {}) {
    const root = el('div', {
        className: `tt-ui-progress ${className}`.trim(),
        role: 'progressbar',
        'aria-label': label,
        'aria-valuemin': '0',
        'aria-valuemax': String(max),
    });
    const bar = el('div', { className: 'tt-ui-progress__bar' });
    root.append(bar);
    const setValue = (next) => {
        const numeric = Number(next) || 0;
        const clamped = Math.max(0, Math.min(max, numeric));
        bar.style.width = `${max > 0 ? (clamped / max) * 100 : 0}%`;
        root.dataset.value = String(clamped);
        root.setAttribute('aria-valuenow', String(clamped));
        return clamped;
    };
    setValue(value);
    return { root, bar, setValue };
}
