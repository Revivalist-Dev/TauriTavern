//! Window layout surface for the Windows host.
//!
//! The mobile wallpaper/backdrop pipeline was removed with the Windows-only cull.
//! Snapshot stays available to shared callers and simply reports no native layout.

use tauri::AppHandle;
use tt_contracts::window_layout::{WindowBackdropRequest, WindowSnapshot};
use tt_domain::errors::DomainError;

pub async fn snapshot(_app: &AppHandle) -> Result<Option<WindowSnapshot>, DomainError> {
    Ok(None)
}

pub async fn set_backdrop(
    _app: &AppHandle,
    _request: WindowBackdropRequest,
) -> Result<(), DomainError> {
    Err(DomainError::InvalidData(
        "Native window backdrops are not available on Windows".into(),
    ))
}
