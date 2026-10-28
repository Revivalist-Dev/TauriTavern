# ChatSurface Project Contract v1

ChatSurface establishes exactly one boundary: the full `chat[]` is the data fact, and `#chat > .mes` is a discardable, bounded projection. Any resource an extension holds for the lifetime of a message, a piece of content or a heavy runtime must be released synchronously when that lifetime ends. A projection change is not a message business change, so no SillyTavern events are fabricated for it.

## Host API

```js
window.__TAURITAVERN__.api.chatSurface = {
    protocolVersion: 1,
    isManagedOwnershipRequired(),
    registerParticipant(definition),
    registerContentProcessor(definition),
};
```

TauriTavern ships no second kit or wrapper. Extensions feature-detect the raw API, so they still load in upstream SillyTavern:

```js
const api = window.__TAURITAVERN__?.api?.chatSurface;
const managed = api?.isManagedOwnershipRequired?.() === true;

if (!managed) {
    startLegacyRenderer();
}

const registration = managed ? api.registerParticipant({
    id: 'my-extension/frontend-runtime',
    protocolVersion: api.protocolVersion,

    prepareContent({ content }, claims) {
        rewriteMacros(content);
        for (const source of content.querySelectorAll('[data-my-runtime]')) {
            claims.claim(source, ({ element, mesid, source, signal }) => {
                const runtime = mountRuntime({ element, mesid, source, signal });
                return () => runtime.dispose();
            });
        }
    },

    didMount({ element, signal }) {
        const observer = observeMessage(element);
        return () => observer.disconnect();
    },

    didCommitContent({ content, signal }) {
        return decorateContent(content, signal);
    },
}) : null;

registration?.fault(error); // the participant can no longer keep its contract
```

`isManagedOwnershipRequired()` is a decision frozen when the page starts:

- `true`: only participant owners are enabled, and the legacy DOM watcher is no longer started;
- `false`, or the API is missing: the upstream static renderer is kept.

Extensions must not infer ownership from the current DOM shape. Every participant must be registered before the first projection; hot registration and hot unregistration are not supported on a page.

## Asynchronous content preprocessing

An asynchronous template computes its display HTML through `registerContentProcessor()`, before any participant claims a runtime source. An extension that only processes content does not need to register a participant, and it does not take part in the mutual-exclusion decision for the generic code-block renderer.

An extension declares its own startup hook in the manifest:

```json
{ "hooks": { "chatSurface": "registerChatSurface" } }
```

A bounded startup activates those extensions early, waits for the hooks to finish in the existing manifest order, and only then allows the first chat projection. The hook must be a real named export of the JS entry point; an initialization failure blocks startup rather than continuing after the ordinary activation diagnostic timeout. Upstream SillyTavern ignores this hook, so the extension still needs to keep its own static path.

```js
let registration;

export async function registerChatSurface() {
    await initializeTemplateData();
    registration = window.__TAURITAVERN__.api.chatSurface.registerContentProcessor({
        id: 'my-extension/message-content',
        async prepare({ message, mesid, signal }, renderBase) {
            await processRawMessage(message, mesid, signal);
            const html = await renderBase();
            return evaluateDisplayTemplate(html, { message, mesid, signal });
        },
    });
}

// World Info, settings or another template dependency changed.
await registration.refresh();
```

- `prepare` receives the stable message object, the `mesid` for this request and an `AbortSignal`, and returns an HTML string; it neither reads nor writes the live DOM, and it creates no running iframe, observer or timer.
- `renderBase()` obtains the result of later processors and of host formatting; repeated reads within one `prepare` share a single Promise and do not run downstream processors twice. A processor registered earlier wraps one registered later, and requests for a message run serially. To change the source text, do it before the first call to `renderBase()`; do not call `updateMessageBlock()`, re-render or `refresh()` inside the hook.
- Results of asynchronous processing are cached per message object and reused on remount while the content and the host's formatted output are unchanged; synchronous formatting may still run again. When an external dependency such as World Info or a variable changes, the extension must call `refresh()`.
- The host stores only the HTML string from before participants add wrappers or runtimes; it stores no DOM, does not write back to `extra.display_text`, and releases the result when the chat epoch ends.
- While the first preparation, or an update, is pending, `.mes_text` is empty and marked `aria-busy`; `didMount` still expresses that the message is mounted. Once preparation finishes, the content is committed through the existing content transaction, and then `prepareContent`, `didCommitContent` and runtime admission run.
- Edits and intermediate streaming content neither run processors nor start runtimes. The core generation path commits the final content after `MESSAGE_RECEIVED` handlers finish and then emits the rendered event; synchronous `addOneMessage()` / `updateMessageBlock()` still return synchronously, and completion of the asynchronous display is signalled by `didCommitContent`.
- `refresh()` updates the mounted body and reasoning while keeping the root and the mount lease; edited or streaming content is updated after it finishes. Reasoning does not enter the body's asynchronous processing chain.
- When content is replaced, a message that is being processed is deleted or renumbered, or the chat changes, the signal is aborted and old results must not be written back. The extension has to cooperate by cancelling its own asynchronous work; the host cannot roll back business side effects a template has already produced.
- Registration must happen before the first projection; a duplicate id, an illegal return value or a processing exception reports an error immediately, and a processing exception carries the processor id and the message position and faults the current epoch. The Promise returned by `refresh()` waits for the currently mounted messages to finish preparing and propagates errors.

After producing ordinary HTML code blocks, JSR can keep claiming them under participant v1. An extension with its own iframe feature must also emit a claimable lazy source, and create and release its iframes through the existing participant grant/revoke lifecycle.

## Participant

```ts
interface ChatSurfaceParticipantV1 {
    id: string;
    protocolVersion: 1;
    prepareContent?(context: DetachedContext, claims: RuntimeClaims): void;
    didMount?(context: MountedContext): void | Disposable;
    didCommitContent?(context: MountedContext): void | Disposable;
}
```

### `prepareContent`

`DetachedContext` contains only `mesid` and the detached `.mes_text` `content`. The hook may rewrite the content synchronously and declare runtime sources, but it must not create iframes, timers or observers, or start asynchronous work.

```ts
claims.claim(source, activate)
```

- `source` must be a descendant of the current detached content;
- a source may be claimed by only one participant;
- claims are valid only during the synchronous `prepareContent` call;
- the hook must return `undefined` and must not return a Promise;
- the source keeps its object identity and is committed to the live DOM along with the content.

### `didMount` and `didCommitContent`

A connected context contains:

```ts
{ mesid, element, content, signal }
```

A hook may return a cleanup function or an object with `dispose()`. The host aborts `signal` first and then calls the disposer synchronously:

| hook | Lifetime | Good for holding |
| --- | --- | --- |
| `didMount` | whole message mount → unmount | root observers, message buttons, element references |
| `didCommitContent` | current content version → replacement or unmount | content decorators, wrapper and source references |

There is one way for an extension to deliver cleanup: return a disposer. The internal lease stack is not part of the Host API.

### Runtime activation

A claimed source is activated only after it receives a runtime grant:

```ts
activate({ source, mesid, element, content, signal }) => Disposable
```

- at activation the source is already connected and still belongs to the content it was claimed for;
- activation must return a disposer synchronously, never `void` or a Promise;
- every `grant → revoke → grant` cycle gets a new signal and a new disposer;
- by the time revoke returns, iframes, timers, listeners, observers and strong references must all be gone;
- when an active runtime is revoked, its stable host should leave behind an `inert` placeholder of matching height that holds none of those resources; a regrant first hands that height to the new runtime, which the renderer's own height protocol then calibrates;
- the source is the anchor from which the runtime can be rebuilt and must not be moved into a detached stash or into another message.

The host may decline to activate a candidate. DOM residency and runtime admission are two separate limits, and budget, ordering and viewport policy are not part of the participant API.

## Error and event boundaries

- invalid registration fields, protocol version or hook arguments throw immediately;
- when a required renderer fails to activate, the original error propagates to the startup caller; required participants are checked only after the activation flow returns normally, so the real cause of a load or hook failure is not masked;
- a duplicate claim, a disagreement about ownership, an asynchronous disposer or a re-entrant synchronous write faults the current bounded epoch;
- a participant that can no longer keep its contract outside a hook calls `registration.fault(error)`;
- a fault keeps the full `chat[]` and the current bounded DOM and does not expand the full history automatically;
- the mount, remount, content and runtime lifecycles do not emit `MESSAGE_UPDATED`, `MORE_MESSAGES_LOADED`, `USER_MESSAGE_RENDERED` or `CHARACTER_MESSAGE_RENDERED`.

## Capability and release boundaries

Known renderers must register their exact identity before the first chat projection:

| Extension | Required participant id |
| --- | --- |
| JS-Slash-Runner | `js-slash-runner/message-runtime` |
| LittleWhiteBox | `littlewhitebox/message-runtime` |

A missing required participant, a protocol mismatch or a participant fault rejects the bounded epoch and does not fall back to full DOM. The static strategy still runs the original renderer.

The first managed release covers only the core frontend and iframe runtimes validated in the capability matrix; it does not claim support for the JSR managed streaming renderer, nor for LWB capabilities that are not wired up, such as immersive, draw, story-outline or custom-template.
