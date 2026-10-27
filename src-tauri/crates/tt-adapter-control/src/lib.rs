//! Local control adapter for external bridge processes.
//!
//! The adapter owns the HTTP surface and the handshake file. It knows nothing about Tauri or the
//! application's chat pipeline: the host implements [`ControlDispatcher`] and decides how a method
//! is executed. The server binds only to loopback and requires a per-launch bearer token, so a
//! process on the machine cannot drive the app without reading the handshake file first.

use std::{
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, StatusCode, header::AUTHORIZATION},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{net::TcpListener, task::JoinHandle};
use uuid::Uuid;

/// The handshake file name written into the app's local data directory.
pub const CONTROL_FILE_NAME: &str = "control.json";

/// The default timeout for a request forwarded to the webview.
pub const DEFAULT_DISPATCH_TIMEOUT: Duration = Duration::from_secs(120);

/// An error raised while serving or dispatching a control request.
#[derive(Debug, thiserror::Error)]
pub enum ControlError {
    #[error("control request failed: {0}")]
    Dispatch(String),
    #[error("control request timed out")]
    Timeout,
    #[error("control server I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("control handshake error: {0}")]
    Handshake(#[from] serde_json::Error),
}

impl ControlError {
    fn status(&self) -> StatusCode {
        match self {
            Self::Dispatch(_) => StatusCode::BAD_REQUEST,
            Self::Timeout => StatusCode::GATEWAY_TIMEOUT,
            Self::Io(_) | Self::Handshake(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for ControlError {
    fn into_response(self) -> Response {
        (
            self.status(),
            Json(json!({ "ok": false, "error": self.to_string() })),
        )
            .into_response()
    }
}

/// Executes a named control method. The host implements this; the adapter only transports it.
#[async_trait]
pub trait ControlDispatcher: Send + Sync + 'static {
    async fn dispatch(&self, method: &str, params: Value) -> Result<Value, ControlError>;
}

/// The contents of [`CONTROL_FILE_NAME`]. The bridge reads this to learn where to connect.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Handshake {
    pub port: u16,
    pub token: String,
    pub pid: u32,
    pub version: String,
    pub started_at_ms: u64,
}

impl Handshake {
    fn new(port: u16, token: String, version: String) -> Self {
        let started_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or_default();
        Self {
            port,
            token,
            pid: std::process::id(),
            version,
            started_at_ms,
        }
    }
}

/// A running control server. Dropping it stops the listener and removes the handshake file.
pub struct ControlServer {
    handshake: Handshake,
    handshake_path: PathBuf,
    task: JoinHandle<()>,
}

impl ControlServer {
    pub fn port(&self) -> u16 {
        self.handshake.port
    }

    pub fn token(&self) -> &str {
        &self.handshake.token
    }

    pub fn handshake_path(&self) -> &Path {
        &self.handshake_path
    }

    /// Stop accepting requests. The handshake file is removed.
    pub async fn shutdown(self) {
        self.task.abort();
        let _ = tokio::fs::remove_file(&self.handshake_path).await;
    }
}

impl Drop for ControlServer {
    fn drop(&mut self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.handshake_path);
    }
}

#[derive(Clone)]
struct AppState {
    token: Arc<str>,
    dispatcher: Arc<dyn ControlDispatcher>,
}

/// Start the control server on `127.0.0.1:0`, write the handshake file, and serve until the handle
/// is dropped or [`ControlServer::shutdown`] runs.
pub async fn serve(
    dispatcher: Arc<dyn ControlDispatcher>,
    handshake_path: impl Into<PathBuf>,
    version: impl Into<String>,
) -> Result<ControlServer, ControlError> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).await?;
    let port = listener.local_addr()?.port();
    let token = new_token();
    let handshake = Handshake::new(port, token.clone(), version.into());

    let handshake_path = handshake_path.into();
    write_handshake(&handshake_path, &handshake).await?;

    let app = router(dispatcher, token);
    let task = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            tracing::warn!(%error, "control server stopped");
        }
    });

    Ok(ControlServer {
        handshake,
        handshake_path,
        task,
    })
}

fn router(dispatcher: Arc<dyn ControlDispatcher>, token: String) -> Router {
    let state = AppState {
        token: Arc::from(token),
        dispatcher,
    };

    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/command", post(command))
        .route("/v1/characters", get(characters))
        .route("/v1/chats", get(chats))
        .route("/v1/chats/open", post(open_chat))
        .route("/v1/messages", get(messages).post(send_message))
        .route("/v1/generate", post(generate))
        .route("/v1/stop", post(stop))
        .layer(middleware::from_fn_with_state(state.clone(), require_token))
        .with_state(state)
}

async fn require_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let authorized = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|token| token == state.token.as_ref());

    if !authorized {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "ok": false, "error": "unauthorized" })),
        )
            .into_response();
    }

    next.run(request).await
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "result": { "status": "ok", "pid": std::process::id() }
    }))
}

#[derive(Deserialize)]
struct CommandRequest {
    method: String,
    #[serde(default)]
    params: Value,
}

async fn command(
    State(state): State<AppState>,
    Json(request): Json<CommandRequest>,
) -> Result<Json<Value>, ControlError> {
    let result = state
        .dispatcher
        .dispatch(&request.method, request.params)
        .await?;
    Ok(Json(json!({ "ok": true, "result": result })))
}

async fn characters(State(state): State<AppState>) -> Result<Json<Value>, ControlError> {
    dispatch(&state, "characters.list", Value::Null).await
}

#[derive(Deserialize)]
struct ChatsQuery {
    character_id: Option<String>,
}

async fn chats(
    State(state): State<AppState>,
    Query(query): Query<ChatsQuery>,
) -> Result<Json<Value>, ControlError> {
    dispatch(
        &state,
        "chats.list",
        json!({ "character_id": query.character_id }),
    )
    .await
}

async fn open_chat(
    State(state): State<AppState>,
    Json(params): Json<Value>,
) -> Result<Json<Value>, ControlError> {
    dispatch(&state, "chat.open", params).await
}

#[derive(Deserialize)]
struct MessagesQuery {
    chat_id: Option<String>,
    after: Option<String>,
    limit: Option<usize>,
}

async fn messages(
    State(state): State<AppState>,
    Query(query): Query<MessagesQuery>,
) -> Result<Json<Value>, ControlError> {
    dispatch(
        &state,
        "chat.read",
        json!({
            "chat_id": query.chat_id,
            "after": query.after,
            "limit": query.limit,
        }),
    )
    .await
}

async fn send_message(
    State(state): State<AppState>,
    Json(params): Json<Value>,
) -> Result<Json<Value>, ControlError> {
    dispatch(&state, "message.send", params).await
}

async fn generate(
    State(state): State<AppState>,
    Json(params): Json<Value>,
) -> Result<Json<Value>, ControlError> {
    dispatch(&state, "generate", params).await
}

async fn stop(State(state): State<AppState>) -> Result<Json<Value>, ControlError> {
    dispatch(&state, "stop", Value::Null).await
}

async fn dispatch(
    state: &AppState,
    method: &str,
    params: Value,
) -> Result<Json<Value>, ControlError> {
    let result = state.dispatcher.dispatch(method, params).await?;
    Ok(Json(json!({ "ok": true, "result": result })))
}

fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

async fn write_handshake(path: &Path, handshake: &Handshake) -> Result<(), ControlError> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let contents = serde_json::to_vec_pretty(handshake)?;
    tokio::fs::write(path, contents).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    struct EchoDispatcher;

    #[async_trait]
    impl ControlDispatcher for EchoDispatcher {
        async fn dispatch(&self, method: &str, params: Value) -> Result<Value, ControlError> {
            if method == "fail" {
                return Err(ControlError::Dispatch("nope".to_string()));
            }
            Ok(json!({ "method": method, "params": params }))
        }
    }

    fn app(token: &str) -> Router {
        router(Arc::new(EchoDispatcher), token.to_string())
    }

    async fn request(app: Router, token: &str, request: Request<Body>) -> Response {
        let request = request.into_parts();
        let mut request = Request::from_parts(request.0, request.1);
        request.headers_mut().insert(
            AUTHORIZATION,
            format!("Bearer {token}").parse().expect("valid header"),
        );
        app.oneshot(request).await.expect("router response")
    }

    #[tokio::test]
    async fn rejects_missing_or_wrong_tokens() {
        let app = app("secret");
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/health")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let response = request(
            app,
            "wrong",
            Request::builder()
                .uri("/v1/health")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn health_requires_a_valid_token() {
        let app = app("secret");
        let response = request(
            app,
            "secret",
            Request::builder()
                .uri("/v1/health")
                .body(Body::empty())
                .expect("request"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn command_dispatches_the_method_and_params() {
        let app = app("secret");
        let body = json!({ "method": "chat.read", "params": { "limit": 2 } }).to_string();
        let response = request(
            app,
            "secret",
            Request::builder()
                .method("POST")
                .uri("/v1/command")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .expect("request"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn dispatch_errors_map_to_bad_request() {
        let app = app("secret");
        let body = json!({ "method": "fail" }).to_string();
        let response = request(
            app,
            "secret",
            Request::builder()
                .method("POST")
                .uri("/v1/command")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .expect("request"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn serve_writes_and_removes_the_handshake() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join(CONTROL_FILE_NAME);
        let server = serve(Arc::new(EchoDispatcher), &path, "test")
            .await
            .expect("server");
        assert!(path.exists());

        let handshake: Handshake =
            serde_json::from_slice(&std::fs::read(&path).expect("handshake")).expect("json");
        assert_eq!(handshake.port, server.port());
        assert_eq!(handshake.token, server.token());
        assert_eq!(handshake.version, "test");

        server.shutdown().await;
        assert!(!path.exists());
    }
}
