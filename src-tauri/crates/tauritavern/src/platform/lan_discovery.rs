use tauri::AppHandle;
use tt_domain::errors::DomainError;

pub(crate) async fn set_lan_discovery_enabled(
    _app_handle: &AppHandle,
    _enabled: bool,
) -> Result<(), DomainError> {
    Ok(())
}
