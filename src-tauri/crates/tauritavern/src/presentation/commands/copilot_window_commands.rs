//! Commands for detaching Copilot into a native operating-system window.

use tauri::{Manager, WebviewUrl};

use crate::presentation::errors::CommandError;

/// Open (or focus) the standalone Copilot window.
///
/// The second window loads the normal application shell with a popout query
/// flag; the popout shell then keeps only the Copilot UI visible.
#[tauri::command]
pub fn open_copilot_window(app: tauri::AppHandle) -> Result<(), CommandError> {
    if let Some(window) = app.get_webview_window("copilot") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let mut window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .cloned()
        .ok_or_else(|| CommandError::InternalServerError("Main window config is missing".into()))?;
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| CommandError::InternalServerError("Main window is missing".into()))?;
    let mut target_url = main_window
        .url()
        .map_err(|error| CommandError::InternalServerError(error.to_string()))?;
    target_url.set_query(Some("tt_copilot_window=1"));
    target_url.set_fragment(None);
    window_config.url = WebviewUrl::External(target_url.clone());
    window_config.label = "copilot".into();
    window_config.title = "DeepLore Copilot".into();
    window_config.width = 520.0;
    window_config.height = 860.0;
    window_config.min_width = Some(360.0);
    window_config.min_height = Some(480.0);
    window_config.visible = true;

    let target_url_for_navigation = target_url.clone();
    let window = tauri::webview::WebviewWindowBuilder::from_config(&app, &window_config)
        .map_err(|error| CommandError::InternalServerError(error.to_string()))?
        .build()
        .map_err(|error| CommandError::InternalServerError(error.to_string()))?;

    window
        .navigate(target_url_for_navigation)
        .map_err(|error| CommandError::InternalServerError(error.to_string()))?;

    window
        .show()
        .map_err(|error| CommandError::InternalServerError(error.to_string()))?;
    window
        .set_focus()
        .map_err(|error| CommandError::InternalServerError(error.to_string()))?;
    Ok(())
}
