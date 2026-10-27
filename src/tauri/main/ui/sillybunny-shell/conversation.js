/**
 * Conversation Mode for the SillyBunny desktop shell.
 *
 * The panel renders the chat that SillyTavern already produced and sends
 * through SillyTavern's own input and send button, so generation, streaming,
 * swipes and extensions all keep stock behavior. There is no second
 * generation pipeline in this layer.
 */

const MAX_MESSAGES = 80;
const SCROLL_SLACK_PX = 48;

/** @type {MutationObserver | null} */
let chatObserver = null;
/** @type {number | null} */
let renderFrame = null;
/** @type {HTMLElement | null} */
let lastTimeline = null;

function timelineNode() {
    return document.querySelector('[data-sb-conversation-timeline]');
}

function messageElements() {
    const chat = document.getElementById('chat');
    if (!(chat instanceof HTMLElement)) {
        return [];
    }
    return Array.from(chat.querySelectorAll(':scope > .mes'))
        .filter((node) => node instanceof HTMLElement)
        .slice(-MAX_MESSAGES);
}

function messageRole(node) {
    if (node.dataset.isUser === 'true') {
        return 'user';
    }
    if (node.dataset.isSystem === 'true') {
        return 'system';
    }
    return 'assistant';
}

function messageBody(node) {
    const source = node.querySelector('.mes_text');
    if (!(source instanceof HTMLElement)) {
        return document.createTextNode('');
    }
    const clone = source.cloneNode(true);
    if (clone instanceof HTMLElement) {
        // The timeline mirrors chat markup; strip identifiers and live embeds so
        // the copy cannot collide with the real chat or boot a second runtime.
        clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
        clone.querySelectorAll('script, iframe, object, embed').forEach((element) => element.remove());
        clone.removeAttribute('id');
    }
    return clone;
}

function messageName(node, role) {
    const name = node.querySelector('.name_text');
    const label = name instanceof HTMLElement ? name.textContent?.trim() : '';
    if (label) {
        return label;
    }
    return role === 'user' ? 'You' : role === 'system' ? 'System' : 'Character';
}

function buildCard(node) {
    const role = messageRole(node);
    const card = document.createElement('article');
    card.className = `sb-message sb-message--${role}`;

    const meta = document.createElement('div');
    meta.className = 'sb-message-meta';
    const name = document.createElement('span');
    name.className = 'sb-message-name';
    name.textContent = messageName(node, role);
    meta.append(name);
    card.append(meta);

    const body = document.createElement('div');
    body.className = 'sb-message-body';
    body.append(messageBody(node));
    card.append(body);

    return card;
}

function updateSubtitle() {
    const subtitle = document.querySelector('[data-sb-conversation-subtitle]');
    if (!(subtitle instanceof HTMLElement)) {
        return;
    }
    const character = document.getElementById('character_name_pole')?.textContent?.trim();
    const count = messageElements().length;
    const label = character ? `${character} · ${count} 条消息` : `${count} 条消息`;
    subtitle.textContent = label;
}

function renderTimeline({ forceScroll = false } = {}) {
    const timeline = timelineNode();
    if (!(timeline instanceof HTMLElement)) {
        return;
    }

    const pinnedToBottom = forceScroll
        || timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < SCROLL_SLACK_PX;
    const nodes = messageElements();

    const fragment = document.createDocumentFragment();
    if (nodes.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'sb-conversation-empty';
        empty.textContent = '还没有消息。选择角色后开始对话。';
        fragment.append(empty);
    } else {
        for (const node of nodes) {
            fragment.append(buildCard(node));
        }
    }

    timeline.replaceChildren(fragment);
    lastTimeline = timeline;
    updateSubtitle();

    if (pinnedToBottom) {
        timeline.scrollTop = timeline.scrollHeight;
    }
}

function scheduleRender(options) {
    if (renderFrame !== null) {
        return;
    }
    renderFrame = window.requestAnimationFrame(() => {
        renderFrame = null;
        renderTimeline(options);
    });
}

function isPanelOpen() {
    return document.getElementById('sb_conversation_content')?.classList.contains('openDrawer') === true;
}

function observeChat() {
    const chat = document.getElementById('chat');
    if (!(chat instanceof HTMLElement)) {
        return;
    }
    chatObserver?.disconnect();
    chatObserver = new MutationObserver(() => {
        if (isPanelOpen()) {
            scheduleRender();
        }
    });
    chatObserver.observe(chat, { childList: true, subtree: true, characterData: true });
}

function sendComposerMessage(textarea) {
    const value = textarea.value.trim();
    if (!value) {
        return;
    }
    const input = document.getElementById('send_textarea');
    const sendButton = document.getElementById('send_but');
    if (!(input instanceof HTMLTextAreaElement) || !(sendButton instanceof HTMLElement)) {
        return;
    }
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.value = '';
    sendButton.click();
}

function bindComposer(panel) {
    const textarea = panel.querySelector('[data-sb-composer-input]');
    const send = panel.querySelector('[data-sb-composer-send]');
    const refresh = panel.querySelector('[data-sb-conversation-refresh]');
    if (!(textarea instanceof HTMLTextAreaElement)) {
        return;
    }
    textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendComposerMessage(textarea);
        }
    });
    if (send instanceof HTMLElement) {
        send.addEventListener('click', () => sendComposerMessage(textarea));
    }
    if (refresh instanceof HTMLElement) {
        refresh.addEventListener('click', () => renderTimeline({ forceScroll: true }));
    }
}

export function installConversationMode() {
    const drawer = document.getElementById('sb_conversation');
    const panel = drawer?.querySelector('.drawer-content');
    if (!(panel instanceof HTMLElement)) {
        return;
    }

    bindComposer(panel);
    observeChat();

    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        if (target.closest(`#${'sb_conversation'} .drawer-toggle`)) {
            window.requestAnimationFrame(() => renderTimeline({ forceScroll: true }));
        }
    });

    if (lastTimeline === null) {
        renderTimeline();
    }
}
