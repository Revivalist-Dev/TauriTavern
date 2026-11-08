/**
 * Minimal DOM helpers for the TauriTavern UI kit.
 * Components build real nodes, so labels are never interpolated into HTML.
 */

export function appendChildren(node, children) {
    for (const child of children.flat(Infinity)) {
        if (child == null || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(props ?? {})) {
        if (value == null || value === false) continue;

        if (key === 'className' || key === 'class') {
            node.className = String(value);
        } else if (key === 'dataset') {
            Object.assign(node.dataset, value);
        } else if (key === 'attrs') {
            for (const [name, attrValue] of Object.entries(value)) {
                if (attrValue != null && attrValue !== false) node.setAttribute(name, String(attrValue));
            }
        } else if (key === 'style') {
            if (typeof value === 'string') node.setAttribute('style', value);
            else Object.assign(node.style, value);
        } else if (key === 'on') {
            for (const [event, handler] of Object.entries(value)) {
                if (typeof handler === 'function') node.addEventListener(event, handler);
            }
        } else if (key === 'text') {
            node.textContent = String(value);
        } else if (key === 'html') {
            node.innerHTML = String(value);
        } else if (key in node) {
            try {
                node[key] = value;
            } catch {
                node.setAttribute(key, String(value));
            }
        } else {
            node.setAttribute(key, String(value));
        }
    }

    appendChildren(node, children);
    return node;
}

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

export function icon(className, label = '') {
    return el('i', {
        className: `fa-solid ${className}`.trim(),
        attrs: label ? { 'aria-label': label } : { 'aria-hidden': 'true' },
    });
}

export function setDataset(node, values) {
    for (const [key, value] of Object.entries(values)) {
        if (value == null || value === false) delete node.dataset[key];
        else node.dataset[key] = String(value);
    }
    return node;
}
