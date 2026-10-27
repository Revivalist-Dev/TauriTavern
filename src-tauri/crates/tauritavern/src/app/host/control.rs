//! Local control API for external bridge processes.
//!
//! The HTTP layer lives in `tt-adapter-control`. This module supplies the Tauri-specific dispatcher:
//! it forwards each method to the main webview and waits for `control_respond`. The webview shim is
//! injected after page load, so the frontend source does not need a build change.

use std::{collections::HashMap, sync::Arc, time::Duration};

use async_trait::async_trait;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use tokio::sync::{Mutex, oneshot};
use tt_adapter_control::{ControlDispatcher, ControlError};

/// A request forwarded to the webview and waiting for a response.
#[derive(Default)]
pub struct ControlPending {
    waiters: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
}

struct WebviewControlDispatcher {
    app: AppHandle,
    pending: Arc<ControlPending>,
}

impl WebviewControlDispatcher {
    fn new(app: AppHandle, pending: Arc<ControlPending>) -> Self {
        Self { app, pending }
    }
}

#[async_trait]
impl ControlDispatcher for WebviewControlDispatcher {
    async fn dispatch(&self, method: &str, params: Value) -> Result<Value, ControlError> {
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.pending.waiters.lock().await.insert(id.clone(), sender);

        let payload = json!({ "id": id, "method": method, "params": params });
        if let Err(error) = self.app.emit_to("main", "control://request", payload) {
            self.pending.waiters.lock().await.remove(&id);
            return Err(ControlError::Dispatch(format!(
                "the main window is not available: {error}"
            )));
        }

        match tokio::time::timeout(Duration::from_secs(120), receiver).await {
            Ok(Ok(Ok(result))) => Ok(result),
            Ok(Ok(Err(error))) => Err(ControlError::Dispatch(error)),
            Ok(Err(_)) => Err(ControlError::Dispatch(
                "the webview dropped the control request".to_string(),
            )),
            Err(_) => {
                self.pending.waiters.lock().await.remove(&id);
                Err(ControlError::Timeout)
            }
        }
    }
}

/// Called from `setup` after the main window exists. Starts the loopback server and writes the
/// handshake file into the app's local data directory.
pub fn start(app: &AppHandle) {
    let pending = Arc::new(ControlPending::default());
    app.manage(pending.clone());

    let Ok(data_dir) = app.path().app_local_data_dir() else {
        tracing::warn!("control API disabled: the local data directory is unavailable");
        return;
    };
    let handshake_path = data_dir.join(tt_adapter_control::CONTROL_FILE_NAME);
    let dispatcher = Arc::new(WebviewControlDispatcher::new(app.clone(), pending));
    let version = env!("CARGO_PKG_VERSION").to_string();

    tauri::async_runtime::spawn(async move {
        match tt_adapter_control::serve(dispatcher, handshake_path.clone(), version).await {
            Ok(server) => {
                tracing::info!(
                    port = server.port(),
                    handshake = %handshake_path.display(),
                    "control API listening"
                );
                // Keep the server handle alive for the lifetime of the process.
                std::future::pending::<()>().await;
                drop(server);
            }
            Err(error) => {
                tracing::error!(%error, "control API failed to start");
            }
        }
    });
}

/// Inject the webview side of the control bridge after the page has loaded.
pub fn install_bridge(webview: &Webview) {
    if let Err(error) = webview.eval(CONTROL_BRIDGE) {
        tracing::warn!(%error, "failed to install the control bridge");
    }
}

/// The response command called by the injected shim.
#[tauri::command]
pub async fn control_respond(
    state: State<'_, Arc<ControlPending>>,
    id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    if let Some(sender) = state.waiters.lock().await.remove(&id) {
        let payload = if ok {
            Ok(result.unwrap_or(Value::Null))
        } else {
            Err(error.unwrap_or_else(|| "control request failed".to_string()))
        };
        let _ = sender.send(payload);
    }
    Ok(())
}

const CONTROL_BRIDGE: &str = r#"
(() => {
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.event || !tauri.core) {
    console.error("control bridge: the Tauri API is unavailable");
    return;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const context = async () => {
    while (!window.SillyTavern || !window.SillyTavern.getContext) {
      await sleep(100);
    }
    return window.SillyTavern.getContext();
  };

  const handlers = {
    "characters.list": async () => {
      const ctx = await context();
      return (ctx.characters || []).map((character) => ({
        id: character.avatar,
        name: character.name,
        description: character.description,
      }));
    },
    "chats.list": async (params) => {
      const ctx = await context();
      const character = (ctx.characters || []).find(
        (candidate) =>
          candidate.avatar === params.character_id || candidate.name === params.character_id,
      );
      return await tauri.core.invoke("get_character_chats_by_id", {
        dto: { name: character ? character.avatar : params.character_id, simple: true },
      });
    },
    "chat.open": async (params) => {
      const ctx = await context();
      if (params.chat_id) {
        await ctx.openCharacterChat(params.chat_id);
      } else if (params.character_id) {
        await ctx.selectCharacterById(params.character_id);
      }
      return { chat_id: ctx.getCurrentChatId() };
    },
    "chat.read": async (params) => {
      const ctx = await context();
      let chat = ctx.chat || [];
      if (params.after) {
        const index = chat.findIndex((message) => message.send_date === params.after);
        if (index >= 0) chat = chat.slice(index + 1);
      }
      if (params.limit) chat = chat.slice(-params.limit);
      return chat.map((message) => ({
        name: message.name,
        is_user: message.is_user,
        text: message.mes,
        send_date: message.send_date,
      }));
    },
    "message.send": async (params) => {
      const ctx = await context();
      const textarea = document.querySelector('#send_textarea');
      if (!textarea) throw new Error("the send textarea is not available");
      textarea.value = params.text;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await ctx.generate("normal");
      const last = (ctx.chat || []).slice(-1)[0];
      return { text: last ? last.mes : "", name: last ? last.name : "" };
    },
    "generate": async (params) => {
      const ctx = await context();
      await ctx.generate(params.mode || "normal");
      return {};
    },
    "stop": async () => {
      const ctx = await context();
      ctx.stopGeneration();
      return {};
    },
  };

  tauri.event.listen("control://request", async (event) => {
    const payload = event.payload || {};
    if (!payload.id) return;
    try {
      const handler = handlers[payload.method];
      if (!handler) throw new Error("unknown control method: " + payload.method);
      const result = await handler(payload.params || {});
      await tauri.core.invoke("control_respond", {
        id: payload.id,
        ok: true,
        result,
      });
    } catch (error) {
      const message =
        error && error.message
          ? String(error.message)
          : typeof error === "string"
            ? error
            : JSON.stringify(error);
      await tauri.core.invoke("control_respond", {
        id: payload.id,
        ok: false,
        error: message,
      });
    }
  });
})();
"#;
