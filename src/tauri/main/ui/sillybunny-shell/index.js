/**
 * SillyBunny desktop shell — a Windows-only first-party layout layer.
 *
 * The shell re-skins SillyTavern's own top-bar drawers as a left rail with a
 * side panel. It does not re-parent application chrome, so stock drawer
 * handlers keep working; the conversation panel is an ordinary drawer.
 *
 * No mobile layout exists in this layer: the rail only applies at desktop
 * widths, and the app never renders a phone breakpoint shell.
 */

const SHELL_CLASS = 'sb-shell';
const CONVERSATION_DRAWER_ID = 'sb_conversation';

let conversationInstalled = false;

function conversationDrawerMarkup() {
    return `
        <div class="drawer sb-drawer" id="${CONVERSATION_DRAWER_ID}">
            <div class="drawer-toggle drawer-header sb-rail-button" title="Conversation Mode" aria-label="Conversation Mode">
                <div class="drawer-icon fa-solid fa-comments fa-fw closedIcon sb-rail-icon" aria-hidden="true"></div>
            </div>
            <div id="sb_conversation_content" class="drawer-content sb-conversation-content closedDrawer">
                <div class="sb-conversation">
                    <header class="sb-conversation-header">
                        <div>
                            <h2 class="sb-conversation-title">Conversation Mode</h2>
                            <p class="sb-conversation-subtitle" data-sb-conversation-subtitle>最近消息</p>
                        </div>
                        <button type="button" class="sb-icon-button" data-sb-conversation-refresh title="刷新" aria-label="刷新">
                            <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                        </button>
                    </header>
                    <div class="sb-conversation-timeline" data-sb-conversation-timeline role="log" aria-live="polite"></div>
                    <footer class="sb-composer">
                        <textarea class="sb-composer-input" data-sb-composer-input rows="2"
                            placeholder="写点什么…（Enter 发送，Shift+Enter 换行）" aria-label="消息"></textarea>
                        <button type="button" class="sb-composer-send" data-sb-composer-send title="发送" aria-label="发送">
                            <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
                        </button>
                    </footer>
                </div>
            </div>
        </div>`;
}

function ensureConversationDrawer() {
    const holder = document.getElementById('top-settings-holder');
    if (!(holder instanceof HTMLElement)) {
        return null;
    }
    const existing = document.getElementById(CONVERSATION_DRAWER_ID);
    if (existing) {
        return existing;
    }
    holder.insertAdjacentHTML('beforeend', conversationDrawerMarkup());
    return document.getElementById(CONVERSATION_DRAWER_ID);
}

export async function installSillyBunnyShell() {
    if (document.body.classList.contains(SHELL_CLASS)) {
        return;
    }

    document.body.classList.add(SHELL_CLASS);
    ensureConversationDrawer();

    const { installPanelHost, wireInjectedDrawer } = await import('./panels.js');
    installPanelHost();

    const conversationDrawer = document.getElementById(CONVERSATION_DRAWER_ID);
    if (conversationDrawer) {
        wireInjectedDrawer(conversationDrawer);
    }

    if (conversationInstalled) {
        return;
    }
    conversationInstalled = true;

    const { installConversationMode } = await import('./conversation.js');
    installConversationMode();
}

export function uninstallSillyBunnyShell() {
    document.body.classList.remove(SHELL_CLASS);
}
