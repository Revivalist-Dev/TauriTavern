import { installWebHost } from '/tauri/web-host/install.js';
import { createWebHostFixture } from '/__perf/web-host-fixture.mjs';
const data = JSON.parse(document.getElementById('perf-data').textContent);
const fixture = createWebHostFixture(data.settings, data.theme, data.extensions);
fixture.chatFiles.set('review-chat', data.chat.map(record => JSON.stringify(record)).join('\n'));
fixture.chatFiles.set('ledger-chat', data.ledgerChat.map(record => JSON.stringify(record)).join('\n'));
const respond = (body, status = 200) => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const cards = {
    'Review.png': () => JSON.parse(fixture.backend.handle({ method: 'POST', url: '/api/characters/get', headers: {}, body: '{}' }).body),
    'Ledger.png': () => ({ ...JSON.parse(data.ledgerCard), json_data: data.ledgerCard, avatar: 'Ledger.png',
        chat_size: 160000, data_size: 2100000, date_added: 2, date_last_chat: 2 }),
};
const chatsOf = { 'Review.png': ['review-chat'], 'Ledger.png': ['ledger-chat'] };
// The native host's list entry (tt-domain Character::into_shallow); the full card is read when one opens.
function shallow(card) {
    const data = card.data ?? {}, extensions = data.extensions ?? {};
    const pick = (value, fallback) => String(value ?? '').trim() ? value : fallback ?? '';
    const talkativeness = card.talkativeness || extensions.talkativeness || 0.5;
    const fav = Boolean(card.fav) || Boolean(extensions.fav);
    return {
        shallow: true, name: pick(card.name, data.name), description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
        avatar: card.avatar, chat: card.chat, creator: pick(card.creator, data.creator), creator_notes: pick(card.creator_notes, data.creator_notes),
        character_version: pick(card.character_version, data.character_version), tags: card.tags?.length ? card.tags : data.tags ?? [],
        create_date: card.create_date, talkativeness, fav, chat_size: card.chat_size, data_size: card.data_size,
        date_added: card.date_added, date_last_chat: card.date_last_chat, alternate_greetings: [], system_prompt: '',
        post_history_instructions: '', character_book: null, json_data: null,
        data: { extensions: { talkativeness, fav, ...('world' in extensions ? { world: extensions.world } : {}) } },
    };
}
function handleCharacters(request) {
    const body = typeof request.body === 'string' && request.body ? JSON.parse(request.body) : {};
    switch (`${request.method} ${request.url}`) {
        case 'POST /api/characters/all': return respond(Object.values(cards).map(card => shallow(card())));
        case 'POST /api/characters/get':
            return cards[body.avatar_url] ? respond(cards[body.avatar_url]()) : respond({ error: 'Character not found' }, 404);
        case 'POST /api/characters/chats': {
            const owned = chatsOf[body.avatar_url] ?? [];
            const chats = JSON.parse(fixture.backend.handle(request).body);
            return respond(chats.filter(chat => owned.includes(chat.file_name.replace(/\.jsonl$/, ''))));
        }
        case 'POST /api/characters/edit':
        case 'POST /api/characters/merge-attributes': {
            // The fixture stores one card, Review.
            const fields = request.body?.kind === 'form' ? Object.fromEntries(request.body.entries) : body;
            return (fields.avatar_url ?? fields.avatar) === 'Review.png' ? null : respond({ error: 'Only Review is writable' }, 500);
        }
        default: return null;
    }
}
// Opens the reply stream that the scenario feeds through __perfReply.
function streamReply() {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            const send = data => controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            globalThis.__perfReplyId = (globalThis.__perfReplyId || 0) + 1;
            globalThis.__perfReply = {
                id: globalThis.__perfReplyId,
                push: token => send(JSON.stringify({ choices: [{ delta: { content: token }, index: 0 }] })),
                end() {
                    send('[DONE]');
                    controller.close();
                },
            };
        },
    });
}
globalThis.__perfStartupPhase = true;

installWebHost({
    identity: { platform: 'windows', kind: 'desktop' },
    backend: { handle(request) {
        const characters = handleCharacters(request);
        if (characters) return characters;
        if (request.method === 'POST' && request.url === '/api/worldinfo/get') {
            return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data.lore) };
        }
        if (request.method === 'POST' && request.url === '/api/backends/chat-completions/generate') {
            const body = JSON.parse(request.body);
            if (body.stream) {
                return {
                    status: 200,
                    headers: { 'content-type': 'text/event-stream' },
                    body: globalThis.__perfStartupPhase
                        ? 'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
                        : streamReply(),
                };
            }
            if (globalThis.__perfStartupPhase) {
                return {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'stop' }], model: 'perf' }),
                };
            }
        }
        return fixture.backend.handle(request);
    } },
    store: fixture.store,
});
// Host traffic as the native host sees it: the UTF-8 JSON of every command's arguments and result, with binary
// data counted by its bytes. The trace records every call in order for the backend replay; strings the host
// issued (session ids, revisions) become references to the result that issued them, including results that are
// JSON documents in binary form.
globalThis.__perfHost = { bytes: 0, recording: true, step: 'app/startup', calls: [], issued: new Map() };
const utf8 = new TextEncoder();
function hostBytes(value) {
    let binary = 0;
    const text = JSON.stringify(value, (key, item) => {
        if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
            binary += item.byteLength;
            return null;
        }
        return item;
    });
    return (text === undefined ? 0 : utf8.encode(text).length) + binary;
}
const bytesOf = value => value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
const issuedToken = value => typeof value === 'string' && value.length >= 16 && /[0-9]/.test(value) && /[a-z]/i.test(value);
function base64(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
}
function traced(value, issued) {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return { $bytes: base64(bytesOf(value)) };
    return JSON.parse(JSON.stringify(value ?? {}, (key, item) => {
        if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) return Array.from(bytesOf(item));
        return issued.has(item) ? { $result: issued.get(item) } : item;
    }));
}
const utf8Text = new TextDecoder();
function parsedResult(value) {
    if (!(value instanceof ArrayBuffer || ArrayBuffer.isView(value))) return value;
    try {
        return JSON.parse(utf8Text.decode(bytesOf(value)));
    } catch {
        return undefined;
    }
}
function rememberIssued(issued, index, value, at = []) {
    if (issuedToken(value) && !issued.has(value)) issued.set(value, [index, at]);
    else if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
        for (const [key, item] of Object.entries(value)) rememberIssued(issued, index, item, [...at, key]);
    }
}
const { invoke } = window.__TAURI__.core;
window.__TAURI__.core.invoke = async (command, args, options) => {
    const host = globalThis.__perfHost;
    if (!host.recording) return invoke(command, args, options);
    host.bytes += hostBytes(args);
    const index = host.calls.length;
    host.calls.push({ step: host.step, command, args: traced(args, host.issued), headers: traced(options?.headers, host.issued) });
    const result = await invoke(command, args, options);
    host.bytes += hostBytes(result);
    rememberIssued(host.issued, index, parsedResult(result));
    return result;
};
