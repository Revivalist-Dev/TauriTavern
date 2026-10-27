use tt_domain::errors::DomainError;

pub async fn capture_png(webview: &tauri::Webview) -> Result<Vec<u8>, DomainError> {
    crate::infrastructure::webview2_capture::capture_png(webview)
        .await
        .map_err(|error| DomainError::InternalError(format!("Windows viewport capture: {error}")))
}
