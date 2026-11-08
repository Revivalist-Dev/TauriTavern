const state = {
    installed: false,
    vaultRoot: null,
};

function getApi() {
    return window.__TAURITAVERN__?.api?.customize
        ?? window.__TAURITAVERN__?.customize
        ?? null;
}

export function resolveVaultRootFromContext() {
    if (state.vaultRoot) return state.vaultRoot;
    try {
        const explorer = window.__ttFileExplorer;
        const mounts = explorer?.state?.mounts ?? [];
        const current = explorer?.state?.currentMountId;
        const mount = mounts.find((item) => item.id === current) ?? mounts[0];
        state.vaultRoot = mount?.path ?? mount?.root ?? mount?.rootPath ?? null;
    } catch {
        state.vaultRoot = null;
    }
    return state.vaultRoot;
}

export async function dispatchHook(surface, event, payload = {}, options = {}) {
    const api = getApi();
    if (!api?.hooks?.run) return null;
    const vaultRoot = options.vaultRoot ?? resolveVaultRootFromContext();
    try {
        return await api.hooks.run({
            event,
            surface,
            payload,
            vaultRoot,
            test: Boolean(options.test),
        });
    } catch (error) {
        if (options.required) throw error;
        console.debug(`TauriTavern hook ${event} skipped:`, error?.message ?? error);
        return null;
    }
}

export async function getCustomizeContext(surface) {
    const api = getApi();
    if (!api?.context) return null;
    try {
        return await api.context(surface, resolveVaultRootFromContext());
    } catch {
        return null;
    }
}

export function installHooksBridge() {
    if (state.installed) return;
    state.installed = true;
    window.__TAURITAVERN_HOOKS__ = {
        dispatch: dispatchHook,
        context: getCustomizeContext,
        getVaultRoot: resolveVaultRootFromContext,
    };
    installCharacterChatBridge();
    void registerCharacterChatCommands();
}

async function registerCharacterChatCommands() {
    const context = window.SillyTavern?.getContext?.();
    const parser = context?.SlashCommandParser ?? window.SlashCommandParser;
    const commandType = context?.SlashCommand ?? window.SlashCommand;
    if (!parser?.addCommandObject || !commandType?.fromProps) return;
    const customize = await getCustomizeContext('character_chat');
    for (const item of customize?.commands ?? []) {
        const name = String(item.name || '').replace(/\s+/g, '-').toLowerCase();
        if (!name) continue;
        try {
            parser.addCommandObject(commandType.fromProps({
                name,
                helpString: item.description || 'Agent Workspace command',
                callback: (args) => {
                    const value = typeof args === 'string' ? args : args?.value ?? '';
                    return String(item.body || '').replaceAll('$ARGUMENTS', String(value));
                },
            }));
        } catch (error) {
            console.debug(`TauriTavern command /${name} was not registered:`, error?.message ?? error);
        }
    }
}

function installCharacterChatBridge() {
    const context = window.SillyTavern?.getContext?.();
    const events = context?.eventSource;
    const types = context?.eventTypes ?? context?.event_types ?? window.event_types;
    if (!events?.on) return;

    const emit = (event, payload) => {
        if (!event) return;
        void dispatchHook('character_chat', event, payload).then((result) => {
            if (result && result.allowed === false) {
                window.toastr?.warning?.(result.results?.[0]?.userMessage || `An Agent Workspace hook blocked ${event}.`);
            }
            if (result?.followupMessage) {
                window.dispatchEvent(new CustomEvent('tt:hook-followup', {
                    detail: { event, message: result.followupMessage },
                }));
            }
        });
    };

    events.on(types?.CHAT_CHANGED, () => {
        state.vaultRoot = null;
        emit('sessionStart', { conversationId: context.chatId ?? '' });
    });
    events.on(types?.MESSAGE_SENT, (message) => {
        emit('beforeSubmitPrompt', {
            prompt: message?.mes ?? context.chat?.[context.chat?.length - 1]?.mes ?? '',
            conversationId: context.chatId ?? '',
        });
    });
    events.on(types?.MESSAGE_RECEIVED, (messageId) => {
        const message = context.chat?.[messageId];
        emit('afterAgentResponse', {
            prompt: message?.mes ?? '',
            conversationId: context.chatId ?? '',
        });
    });
    events.on(types?.GENERATION_ENDED, () => {
        emit('stop', { stopHookActive: false, conversationId: context.chatId ?? '' });
    });
    events.on(types?.GENERATION_STOPPED, () => {
        emit('sessionEnd', { conversationId: context.chatId ?? '' });
    });
}

