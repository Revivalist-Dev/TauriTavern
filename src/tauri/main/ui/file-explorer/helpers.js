export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico']);
export const TEXT_EXTENSIONS = new Set([
    'md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'js', 'mjs', 'cjs',
    'ts', 'tsx', 'jsx', 'css', 'html', 'xml', 'csv', 'log', 'py', 'rs', 'sh', 'ps1', 'sql',
]);

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function keyOf(mountId, path) {
    return `${mountId}|${path}`;
}

export function joinPath(parent, name) {
    return parent ? `${parent}/${name}` : name;
}

export function parentPath(path) {
    const index = path.lastIndexOf('/');
    return index === -1 ? '' : path.slice(0, index);
}

export function baseName(path) {
    return path.slice(path.lastIndexOf('/') + 1);
}

export function formatSize(size) {
    if (!Number.isFinite(size) || size <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = size;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(ms) {
    if (!ms) return '';
    try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
    } catch {
        return '';
    }
}

export function iconFor(entry) {
    if (entry.kind === 'directory') return 'fa-solid fa-folder';
    if (entry.kind === 'symlink') return 'fa-solid fa-link';
    if (IMAGE_EXTENSIONS.has(entry.extension)) return 'fa-regular fa-image';
    if (entry.extension === 'md' || entry.extension === 'markdown') return 'fa-regular fa-file-lines';
    if (entry.extension === 'json') return 'fa-solid fa-brackets-curly';
    if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(entry.extension)) return 'fa-regular fa-file-code';
    return 'fa-regular fa-file';
}

export function createState() {
    return {
        mounts: [],
        primaryMountId: null,
        currentMountId: null,
        currentPath: '',
        expanded: new Set(),
        children: new Map(),
        selected: new Set(),
        visibleKeys: [],
        view: localStorage.getItem('tt.fileExplorer.view') || 'details',
        sort: localStorage.getItem('tt.fileExplorer.sort') || 'name',
        showHidden: localStorage.getItem('tt.fileExplorer.hidden') === '1',
        filter: '',
        loading: false,
        error: '',
        lastSelected: null,
    };
}

export function compareEntries(state, left, right) {
    if (left.kind === 'directory' && right.kind !== 'directory') return -1;
    if (right.kind === 'directory' && left.kind !== 'directory') return 1;
    switch (state.sort) {
        case 'modified':
            return (right.modifiedMs ?? 0) - (left.modifiedMs ?? 0) || left.name.localeCompare(right.name);
        case 'size':
            return (right.size ?? 0) - (left.size ?? 0) || left.name.localeCompare(right.name);
        case 'type':
            return (left.extension ?? '').localeCompare(right.extension ?? '') || left.name.localeCompare(right.name);
        default:
            return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    }
}
