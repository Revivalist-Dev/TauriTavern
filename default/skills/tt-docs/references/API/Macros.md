# Macro evaluation

`SillyTavern.getContext().macros` exposes macro registration, the engine, and the standalone evaluation interface.

Plain `substituteParams()` reads the current chat, character and variables; this document calls that the live environment. When you need to evaluate against a fixed set of inputs, capture them with `captureContext()` first and then call `evaluateWithContext()`. All of these methods run synchronously, and evaluating does not switch the current chat or preset.

```js
const { macros } = SillyTavern.getContext();
const context = macros.captureContext();

macros.evaluateWithContext('{{setvar::topic::investigation}}', context);
const text = macros.evaluateWithContext('{{getvar::topic}} / {{char}}', context);
// topic is written to context.variables.local; the current chat variables are unchanged.

const other = structuredClone(context); // start an independent branch from the current result
```

## Capture and evaluation

`captureContext()` saves the names, raw character template, chat data, settings, time, original local and global variables, and module data as they stand at that moment. Capture itself neither expands the character template nor calls any registered macro handler.

`evaluateWithContext(text, context, options?)` returns the expanded string. `text` must be a string; an empty string returns immediately without evaluating macros from the character card. `context` can be a capture result, or complete data supplied by the caller following the [MacroContext type](../../src/scripts/macros/engine/MacroEnv.types.js).

`options` mirror those of `substituteParams()`:

- `original`: the original content of this piece of text, available once through `{{original}}`.
- `dynamicMacros`: the dynamic macros used for this call.
- `postProcessFn`: a post-processing function for macro results.
- `name1Override`, `name2Override`, `groupOverride`: name overrides for the user, the character and the group.
- `replaceCharacterCard`: whether to expand character card fields.

The context records which engine, new or legacy, was selected at capture time. Each engine keeps its own syntax and evaluation order, and toggling the UI switch afterwards does not change the engine of an existing context.

Extensions that use the low-level interface directly can still call `macros.envBuilder.buildFromRawEnv()` and hand the result to `macros.engine.evaluate()`. The builder prepares environments for the new engine by default; plain `substituteParams()` and `captureContext()` use whichever engine the UI currently selects.

## Context and environment

MacroContext is caller-held data that can be stored; MacroEnv is the runtime environment passed to macro handlers while a piece of text is processed.

Evaluating repeatedly against the same context shares variables and the `bannedWords` banned-word list. Each piece of text records its own content and hash, and the number of times `original` has been used is recalculated. Character fields are expanded on first read, and the result is cached only for that piece of text. If you need to assemble several times from the same inputs, clone the context before each assembly begins.

`resolve()` inside a handler processes nested content and keeps using the current MacroEnv. To process a different piece of text, use `evaluateWithContext()`, or call `env.functions.substitute()` to reuse the current inputs and variables.

Variable operations come from `env.variables.local` and `env.variables.global`: `get`, `set`, `add`, `inc`, `dec`, `has`, `del`. The plain live variable API reads current storage on every operation, so once an extension replaces the whole variable object, later macros see the new object.

In the live environment, chat data and run state are read-only, and every read returns the current value. `captureContext()` copies those values into ordinary data. Names, model overrides, the `extra` container and per-text state are still prepared per call. Live character fields use the existing lazy expansion function; an explicit context expands from the saved template. Both paths use the same macro definitions and variable rules.

## Extension macros

A macro that must support standalone evaluation should read its context from the `env` its handler receives. Extensions can register providers that place their own data in `env.extra`; that data must be copyable by `structuredClone`. `extensionSettings` below stands for the extension's own settings object:

```js
const liveData = Object.freeze({
    get label() { return extensionSettings.label; },
});
macros.envBuilder.registerProvider(env => {
    env.extra.myExtension = liveData;
});
macros.register('myLabel', {
    handler: ({ env }) => env.extra.myExtension?.label ?? '',
});
```

Providers run when a live environment is prepared and when a context is captured. They can supply plain values or enumerable getters: live evaluation calls the getter on demand, while capture stores the value the getter returns. The read-only object in the example above holds no evaluation state and can be shared between calls; state that belongs to one piece of text should live in that call's env.

`evaluateWithContext()` does not rerun providers. A character nickname that a provider set at capture time, for example, is stored with the context, and switching chats afterwards does not change it. A session builds its context from its own inputs and does not call the current chat's providers.

The existing registry, processor, dynamic macro and legacy registration interfaces remain available. The `MacrosParser.registerMacro()` callback still takes the nonce as its first argument and a MacroEnv as its second; when the new engine calls a legacy callback, it passes both as well.

Extension callbacks still run as ordinary JavaScript. When a callback reads globals directly, manipulates the DOM, or calls plain `substituteParams()`, it still touches the live environment. First-party macros and the functions downstream of them read data from `env`; global reads and writes in third-party callbacks do not move to the context automatically.

Macro errors are displayed and recovered exactly as before. Explicit evaluation raises an error when required context is missing rather than filling it in from the current chat.

## Agents and request templates

The chat agent captures its inputs after asynchronous `GENERATE_AFTER_DATA` handlers finish and before a dry run returns. The first standalone preset assembly, and every later sub-agent and handoff, use their own working copy. `CHAT_COMPLETION_SETTINGS_READY` can modify the final request, and live variables written in that event do not enter the saved inputs. For the assembly flow, see [Prompt assembly](../Agent/PromptAssembly.md).

Additional Parameters templates are stored verbatim in the configuration of their source and expanded when a request is prepared. Generation, connection status checks, and custom image captions (Custom Caption) all use the same request preparation function. Status expands headers only; a caption uses the custom channel configuration and the model of the image description in flight.

Prompts, stop sequences, prefill and Additional Parameters in the same assembly share working variables. Request retries and later model turns reuse the prepared request and do not re-run macros in the template.

`adapterHints` on a native LLM connection, payloads an extension builds itself, and parameters an extension overrides after preparation are all used as literal values. Rust performs only the existing read-only text substitutions and does not run the frontend macro engine.
