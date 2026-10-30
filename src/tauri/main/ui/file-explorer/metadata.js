const cache = new Map();
let hover = null;
let hoverTimer = null;

export function approximateTokens(text) {
    const normalized = String(text || '').trim();
    if (!normalized) return 0;
    return Math.max(1, Math.ceil(normalized.length / 4));
}

export function parseFrontmatter(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return {};
    const values = {};
    let listKey = null;
    for (const rawLine of match[1].split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        const list = line.match(/^\s*-\s+(.+)$/);
        if (list && listKey) {
            values[listKey].push(unquote(list[1]));
            continue;
        }
        const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!pair) continue;
        const [, key, rawValue] = pair;
        const value = rawValue.trim();
        if (!value) {
            values[key] = [];
            listKey = key;
            continue;
        }
        listKey = null;
        if (/^\[.*\]$/.test(value)) {
            values[key] = value.slice(1, -1).split(',').map((item) => unquote(item.trim())).filter(Boolean);
        } else {
            values[key] = unquote(value);
        }
    }
    values.keys = keywordValues(values);
    return values;
}

function keywordValues(values) {
    const keys = [];
    for (const name of ['keys', 'key', 'triggers', 'keywords', 'refine_keys']) {
        const value = values[name];
        if (Array.isArray(value)) keys.push(...value);
        else if (typeof value === 'string' && value.trim()) {
            keys.push(...value.split(',').map((item) => item.trim()));
        }
    }
    return [...new Set(keys.filter(Boolean))];
}

function unquote(value) {
    const trimmed = String(value || '').trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

export async function getEntryMetadata(host, entry) {
    if (!entry || entry.kind === 'directory' || entry.kind === 'dir') return null;
    const path = entry.readPath ?? entry.path;
    const key = `${entry.mountId ?? host?.state?.currentMountId ?? ''}:${path}`;
    if (cache.has(key)) return cache.get(key);
    let text = '';
    try {
        text = await host.api.readText(host.state.currentMountId, path);
    } catch {
        text = '';
    }
    const frontmatter = parseFrontmatter(text);
    const tokens = await countTokens(text);
    const metadata = {
        path,
        size: Number(entry.size ?? new Blob([text]).size ?? 0),
        tokens,
        keys: frontmatter.keys ?? [],
        summary: frontmatter.summary ?? '',
        title: entry.name,
    };
    cache.set(key, metadata);
    return metadata;
}

export function clearMetadataCache() {
    cache.clear();
}

async function countTokens(text) {
    if (!text) return 0;
    try {
        const response = await fetch('/api/tokenizers/openai/count', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ role: 'user', content: text }]),
        });
        if (!response.ok) return approximateTokens(text);
        const data = await response.json();
        return Number(data?.token_count) || approximateTokens(text);
    } catch {
        return approximateTokens(text);
    }
}

export function showHoverCard(anchor, metadata, entry) {
    hideHoverCard();
    if (!metadata) return;
    hoverTimer = window.setTimeout(() => {
        hover = document.createElement('div');
        hover.className = 'tt-fe-hover';
        const title = document.createElement('strong');
        title.textContent = entry.name;
        const keywords = document.createElement('div');
        keywords.className = 'tt-fe-hover-keywords';
        keywords.textContent = metadata.keys.length
            ? `Keywords: ${metadata.keys.join(', ')}`
            : 'Keywords: none in frontmatter';
        const stats = document.createElement('div');
        stats.className = 'tt-fe-hover-stats';
        stats.textContent = `~${metadata.tokens.toLocaleString()} tokens | ${formatBytes(metadata.size)}`;
        hover.append(title, keywords, stats);
        if (metadata.summary) {
            const summary = document.createElement('div');
            summary.className = 'tt-fe-hover-summary';
            summary.textContent = metadata.summary;
            hover.append(summary);
        }
        document.body.append(hover);
        const rect = anchor.getBoundingClientRect();
        const width = 280;
        hover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
        hover.style.top = `${Math.min(rect.bottom + 5, window.innerHeight - hover.offsetHeight - 8)}px`;
    }, 220);
}

export function hideHoverCard() {
    if (hoverTimer) {
        window.clearTimeout(hoverTimer);
        hoverTimer = null;
    }
    hover?.remove();
    hover = null;
}

if (typeof window !== 'undefined') {
    window.addEventListener('scroll', hideHoverCard, true);
    window.addEventListener('blur', hideHoverCard);
}

export function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
