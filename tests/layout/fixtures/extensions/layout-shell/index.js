const panel = {
    id: 'layout-shell-panel',
    label: 'Layout Panel',
    icon: 'fa-solid fa-table-columns',
    render(body) {
        body.innerHTML = '<div class="layout-shell-panel-body">Shell panel content</div>';
    },
};

if (globalThis.__TAURITAVERN_SB_SHELL__) {
    globalThis.__TAURITAVERN_SB_SHELL__.register(panel);
} else {
    globalThis.__SB_PENDING_PANELS__ ??= [];
    globalThis.__SB_PENDING_PANELS__.push(panel);
}

export async function init() {}
