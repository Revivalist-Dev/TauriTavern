# Zedon BYOK provider

TauriTavern can use the local [Zedon BYOK](https://github.com/Revivalist-Dev/zedon-byok) service as
an OpenAI-compatible provider. This lets TauriTavern reach upstream models configured in BYOK,
including plans such as OpenCode Go, without copying provider credentials into TauriTavern.

## Requirements

- Zedon BYOK is running and has written its service record at
  `%USERPROFILE%\.cursor-byok-v3\service.json`.
- BYOK's **External API** is enabled.
- You have copied its external API key.

The service record supplies the local port. The external API key is not stored in that file.

## Configure TauriTavern

1. Open **AI Response Configuration** and set **Chat Completion Source** to **Zedon BYOK**.
2. Select **Discover Zedon BYOK**. TauriTavern fills `http://127.0.0.1:<port>/byok/v1`.
3. Paste the External API key into the custom API key field.
4. Select **Discover Zedon BYOK** again to load the catalog.
5. Pick a model and save. Create a **Connection Profile** or **Model Target** as usual.

The native service only permits loopback HTTP endpoints. A remote URL is rejected rather than
forwarded. The catalog request uses an eight-second timeout and does not log the key.

## Catalog groups

The picker separates two kinds of model:

- **Upstream models** are BYOK's configured provider models. Use these when a TauriTavern preset
  should own the creative instructions.
- **Creative (TauriTavern preset)** models are BYOK imports of TauriTavern presets. BYOK owns their
  preset. Use a neutral local preset so the same instructions are not applied twice.

The API returns the distinction as `category: "tauritavern"`. TauriTavern keeps it visible in the
catalog and does not infer ownership from the model name.

## Model Targets and Connection Profiles

A Zedon BYOK connection stores:

- `chat_completion_source: "zedon_byok"`;
- `custom_url: "http://127.0.0.1:<port>/byok/v1"`;
- `custom_model: "<BYOK model id>"`;
- the external key in the custom API key secret.

Connection Profiles capture these fields. Model Targets materialize them as
`provider.chatCompletionSource: "zedon_byok"` with `endpoint.baseUrl`. Existing Custom
OpenAI-compatible model targets are unchanged.

## Recursion guard

BYOK imports TauriTavern presets for its creative catalog. A preset whose source is Zedon BYOK would
otherwise import a model that calls BYOK again, producing a recursive route.

BYOK now detects both `zedon_byok` sources and custom endpoints whose `/byok/v1` host is loopback.
Such presets are skipped with an explicit warning instead of being imported. The safe configurations
are:

- BYOK upstream model plus a TauriTavern-owned preset;
- BYOK creative model with a neutral TauriTavern preset.

## Provider routing and prefill ownership

TauriTavern resolves the provider from the live AI Response Configuration, not from the selected
preset. Presets contribute generation settings only. A caller that explicitly supplies
`chat_completion_source`, such as a Connection Profile or Model Target, still wins.

This rule lives in one place, `src/scripts/custom-request.js`. Extensions such as DeepLore Copilot
must not copy provider fields or build their own override; they call the normal chat completion path
and inherit the active provider.

Assistant Prefill is owned by TauriTavern. The request builder appends the configured prefill as a
trailing assistant message for the Custom OpenAI-compatible transport, including Zedon BYOK. BYOK's
model-level prefill fields remain accepted on the wire for older clients but are not the source of
truth and are hidden from the BYOK model editor. Prefill only produces the intended result when the
upstream accepts an assistant-terminated message.

## Verification

Automated coverage lives in:

- `tests/layout/zedon-byok-provider.test.mjs` for the provider controls and catalog groups;
- the TauriTavern command tests for loopback validation;
- `server/src/tauritavern.rs` tests for the recursion guard.

A live check requires a running BYOK service and an external key. Set `BYOK_API_KEY` and run
`pnpm run check:byok`; it verifies both catalog groups and a minimal chat completion.
