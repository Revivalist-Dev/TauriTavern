use std::sync::Arc;

use tauri::State;

use crate::app::AppState;
use crate::presentation::commands::helpers::log_command;
use crate::presentation::errors::CommandError;
use tt_application::services::customize::known_events;
use tt_domain::models::customize::{
    CustomizationItem, CustomizationSurface, CustomizeContext, CustomizeSaveRequest,
    CustomizeSnapshot, HookConfig, HookDispatchResult, HookLogEntry, HookRunRequest,
};

fn customize_error<E: std::fmt::Display>(context: &'static str) -> impl FnOnce(E) -> CommandError {
    move |error| CommandError::BadRequest(format!("{context}: {error}"))
}

#[tauri::command]
pub async fn customize_snapshot(
    vault_root: Option<String>,
    app_state: State<'_, Arc<AppState>>,
) -> Result<CustomizeSnapshot, CommandError> {
    log_command("customize_snapshot");
    app_state
        .services
        .customize_service
        .snapshot(vault_root.as_deref())
        .await
        .map_err(customize_error("Failed to load customization snapshot"))
}

#[tauri::command]
pub async fn customize_context(
    surface: CustomizationSurface,
    vault_root: Option<String>,
    app_state: State<'_, Arc<AppState>>,
) -> Result<CustomizeContext, CommandError> {
    log_command("customize_context");
    app_state
        .services
        .customize_service
        .context(surface, vault_root.as_deref())
        .await
        .map_err(customize_error("Failed to load customization context"))
}

#[tauri::command]
pub async fn customize_save(
    request: CustomizeSaveRequest,
    app_state: State<'_, Arc<AppState>>,
) -> Result<CustomizationItem, CommandError> {
    log_command("customize_save");
    app_state
        .services
        .customize_service
        .save_item(request)
        .await
        .map_err(customize_error("Failed to save customization"))
}

#[tauri::command]
pub async fn customize_delete(
    id: String,
    vault_root: Option<String>,
    app_state: State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    log_command("customize_delete");
    app_state
        .services
        .customize_service
        .delete_item(&id, vault_root.as_deref())
        .await
        .map_err(customize_error("Failed to delete customization"))
}

#[tauri::command]
pub async fn customize_set_enabled(
    id: String,
    enabled: bool,
    app_state: State<'_, Arc<AppState>>,
) -> Result<CustomizationItem, CommandError> {
    log_command("customize_set_enabled");
    app_state
        .services
        .customize_service
        .set_enabled(&id, enabled)
        .await
        .map_err(customize_error("Failed to update customization"))
}

#[tauri::command]
pub async fn customize_hook_config(
    vault_root: Option<String>,
    app_state: State<'_, Arc<AppState>>,
) -> Result<Option<HookConfig>, CommandError> {
    log_command("customize_hook_config");
    app_state
        .services
        .customize_service
        .hook_config(vault_root.as_deref())
        .await
        .map_err(customize_error("Failed to load hook configuration"))
}

#[tauri::command]
pub async fn customize_save_hook_config(
    config: HookConfig,
    vault_root: Option<String>,
    app_state: State<'_, Arc<AppState>>,
) -> Result<HookConfig, CommandError> {
    log_command("customize_save_hook_config");
    app_state
        .services
        .customize_service
        .save_hook_config(config, vault_root.as_deref())
        .await
        .map_err(customize_error("Failed to save hook configuration"))
}

#[tauri::command]
pub async fn customize_trust_hooks(
    vault_root: Option<String>,
    app_state: State<'_, Arc<AppState>>,
) -> Result<bool, CommandError> {
    log_command("customize_trust_hooks");
    app_state
        .services
        .customize_service
        .trust_hooks(vault_root.as_deref())
        .await
        .map_err(customize_error("Failed to trust hook configuration"))
}

#[tauri::command]
pub async fn customize_run_hook(
    request: HookRunRequest,
    app_state: State<'_, Arc<AppState>>,
) -> Result<HookDispatchResult, CommandError> {
    log_command("customize_run_hook");
    app_state
        .services
        .customize_service
        .run_hook(request)
        .await
        .map_err(customize_error("Failed to run hook"))
}

#[tauri::command]
pub async fn customize_set_plugin_enabled(
    plugin_id: String,
    enabled: bool,
    app_state: State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    log_command("customize_set_plugin_enabled");
    app_state
        .services
        .customize_service
        .set_plugin_enabled(&plugin_id, enabled)
        .await
        .map_err(customize_error("Failed to update plugin"))
}

#[tauri::command]
pub async fn customize_hook_logs(
    app_state: State<'_, Arc<AppState>>,
) -> Result<Vec<HookLogEntry>, CommandError> {
    log_command("customize_hook_logs");
    app_state
        .services
        .customize_service
        .hook_logs()
        .await
        .map_err(customize_error("Failed to list hook logs"))
}

#[tauri::command]
pub fn customize_known_events() -> Vec<&'static str> {
    known_events()
}
