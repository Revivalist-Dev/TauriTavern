# Logging / dev observability (current state)

This page records the logging and development observability chain that has already landed. `.cache/PlanDocs/RustCompileAcceleratingPlan/LoggingRefactorPlan/` is historical analysis and a refactoring plan, not the single source of truth for the current implementation.

## 1. The ordinary logging chain

Rust ordinary logs use the `tracing::{debug, info, warn, error}` macros and no longer go through the `infrastructure::logging::logger` facade. At startup a global subscriber is installed in `src-tauri/crates/tauritavern/src/infrastructure/logging/tracing_runtime.rs`:

- a global `EnvFilter` controls every tracing event;
- stdout and the rolling file record ordinary logs;
- the backend log layer writes into the backend log store the Dev panel uses;
- the user-error layer observes only `ERROR + target = tauritavern::user_error`.

`infrastructure::logging::logger.rs` has been deleted. Do not bring back a cross-layer logger facade, and do not inject a Logger trait into an application service; ordinary instrumentation uses `tracing` directly.

## 2. User-visible errors

A backend error toast is not a side effect of an ordinary error log but an explicit product event:

- a command boundary failure is recorded uniformly through `presentation/commands/helpers.rs::map_command_error()`;
- an expected failure such as `Cancelled` / `TooManyRequests` records only a command warn and raises no toast;
- an important background or host failure that cannot come back naturally through `Result` but that the user should notice at once uses the user-visible error target explicitly: host crates use `target: crate::observability_targets::USER_VISIBLE_ERROR`, adapter crates use `target: tt_contracts::observability::USER_VISIBLE_ERROR`;
- an ordinary diagnostic `tracing::error!` only goes to stdout, the file, and the backend log and does not pop up a toast.

The application follows the global `EnvFilter`. If the user filters out the `tauritavern::user_error` target, the matching backend error toast is filtered out too; that is legitimate user control over observability output.

## 3. Frontend bridge

The user-error layer hands messages to `app/backend_errors.rs::BackendErrorHub`. At startup the frontend's `src/tauri/main/bootstrap/backend-error-bridge.js` listens for the Tauri event `tauritavern-backend-error` first, then calls `backend_error_bridge_ready`:

1. the Rust side marks the bridge as ready;
2. pending backend errors queued during early startup are drained to the frontend;
3. later backend errors are emitted directly.

If the ready command fails, Tauri integration initialization fails fast instead of silently disabling backend error toasts. `src/script.js` on the frontend finally consumes the custom event `tauritavern:backend-error` and shows a toastr.

## 4. Dev observability

Dev Observability is exposed to the presentation commands through `app/dev_observability.rs::DevObservabilityHub`. `dev_logging_commands.rs` and `settings_commands.rs` do not touch the `infrastructure::logging::*` stores directly.

LLM API logs are recorded by the infrastructure decorator `LoggingChatCompletionRepository`, which captures raw and readable requests and responses. Before a JSON request or a non-streaming JSON response is written, internal provider state is removed, and base64 data URLs — as well as inline media that carries a non-empty string `data` together with a media type (`media_type`, `mime_type`, or `mimeType`) in the same object — are replaced with a placeholder holding only the MIME type and the encoded length; redaction applies to the log copy only and does not modify the outbound payload. A persistence failure is a diagnostic log and raises no backend error toast.

## 5. Standing guard for continued development

`pnpm run check` runs `pnpm run check:logging-boundaries`, which keeps these old boundaries from creeping back:

- references to the `infrastructure::logging::logger` facade;
- `logger::{debug,info,warn,error}` calls;
- application/presentation depending on logging infrastructure again;
- dev logging commands connecting to infrastructure directly;
- settings commands connecting to `LlmApiLogStore` directly.

A change that touches logging or observability should at least run:

```bash
pnpm run check:logging-boundaries
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
```
