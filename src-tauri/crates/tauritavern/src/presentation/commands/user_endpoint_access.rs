use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::sync::{Mutex, oneshot};

use crate::presentation::errors::CommandError;
use tt_application::services::user_endpoint_access_service::UserEndpointAccessService;

static DIALOG_GATE: Mutex<()> = Mutex::const_new(());

pub(super) async fn ensure_user_endpoint_access(
    endpoint: Option<String>,
    locale: &str,
    app_handle: &AppHandle,
    access_service: &UserEndpointAccessService,
) -> Result<(), CommandError> {
    let Some(endpoint) = endpoint else {
        return Ok(());
    };

    if access_service.is_granted(&endpoint).await {
        return Ok(());
    }

    let _guard = DIALOG_GATE.lock().await;
    if access_service.is_granted(&endpoint).await {
        return Ok(());
    }
    if !show_authorization_dialog(app_handle, &endpoint, locale).await? {
        return Err(CommandError::Cancelled(
            "Endpoint authorization cancelled by user".to_string(),
        ));
    }

    access_service.grant(endpoint).await;
    Ok(())
}

async fn show_authorization_dialog(
    app_handle: &AppHandle,
    endpoint: &str,
    locale: &str,
) -> Result<bool, CommandError> {
    let copy = dialog_copy(locale);
    let http_warning = if endpoint.starts_with("http://") {
        copy.http_warning
    } else {
        ""
    };
    let message = format!(
        "{} {}\n\n{}{}",
        copy.endpoint_label, endpoint, copy.warning, http_warning
    );

    let (sender, receiver) = oneshot::channel();
    app_handle
        .dialog()
        .message(message)
        .title(copy.title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            copy.confirm.to_string(),
            copy.cancel.to_string(),
        ))
        .show(move |confirmed| {
            let _ = sender.send(confirmed);
        });

    receiver.await.map_err(|_| {
        CommandError::InternalServerError(
            "Endpoint authorization dialog closed unexpectedly".to_string(),
        )
    })
}

struct DialogCopy {
    title: &'static str,
    endpoint_label: &'static str,
    warning: &'static str,
    http_warning: &'static str,
    confirm: &'static str,
    cancel: &'static str,
}

fn dialog_copy(_locale: &str) -> DialogCopy {
    DialogCopy {
        title: "Allow custom endpoint?",
        endpoint_label: "Endpoint:",
        warning: "A third-party extension can also request this connection. Continue only if you just configured and recognize this endpoint. TauriTavern may send it API keys, prompts, and chat content. This endpoint will remain trusted; authorize it carefully.",
        http_warning: "\nThis HTTP connection is unencrypted and may be observed or modified in transit.",
        confirm: "Trust & Connect",
        cancel: "Cancel",
    }
}
