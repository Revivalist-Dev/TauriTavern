use std::sync::Arc;

use tauri::State;

use crate::app::AppState;
use crate::presentation::commands::helpers::{log_command, map_command_error};
use crate::presentation::errors::CommandError;
use tt_domain::models::extension::{
    Extension, ExtensionBranch, ExtensionInstallResult, ExtensionUpdateResult, ExtensionVersion,
};

#[tauri::command]
pub async fn get_extensions(
    app_state: State<'_, Arc<AppState>>,
) -> Result<Vec<Extension>, CommandError> {
    log_command("get_extensions");

    let extensions = app_state
        .services
        .extension_service
        .get_extensions()
        .await
        .map_err(map_command_error("Failed to get extensions"))?;

    Ok(extensions)
}

#[tauri::command]
pub async fn install_extension(
    url: String,
    global: bool,
    branch: Option<String>,
    app_state: State<'_, Arc<AppState>>,
) -> Result<ExtensionInstallResult, CommandError> {
    log_command("install_extension");

    app_state
        .services
        .extension_service
        .install_extension(&url, global, branch)
        .await
        .map_err(map_command_error("Failed to install extension"))
}

#[tauri::command]
pub async fn update_extension(
    extension_name: String,
    global: bool,
    app_state: State<'_, Arc<AppState>>,
) -> Result<ExtensionUpdateResult, CommandError> {
    log_command(format!("update_extension {}", extension_name));

    app_state
        .services
        .extension_service
        .update_extension(&extension_name, global)
        .await
        .map_err(map_command_error("Failed to update extension"))
}

#[tauri::command]
pub async fn delete_extension(
    extension_name: String,
    global: bool,
    app_state: State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    log_command(format!("delete_extension {}", extension_name));

    app_state
        .services
        .extension_service
        .delete_extension(&extension_name, global)
        .await
        .map_err(map_command_error("Failed to delete extension"))
}

#[tauri::command]
pub async fn get_extension_version(
    extension_name: String,
    global: bool,
    app_state: State<'_, Arc<AppState>>,
) -> Result<ExtensionVersion, CommandError> {
    log_command(format!("get_extension_version {}", extension_name));

    app_state
        .services
        .extension_service
        .get_extension_version(&extension_name, global)
        .await
        .map_err(map_command_error("Failed to get extension version"))
}

#[tauri::command]
pub async fn get_extension_branches(
    extension_name: String,
    global: bool,
    app_state: State<'_, Arc<AppState>>,
) -> Result<Vec<ExtensionBranch>, CommandError> {
    log_command(format!("get_extension_branches {}", extension_name));

    app_state
        .services
        .extension_service
        .get_extension_branches(&extension_name, global)
        .await
        .map_err(map_command_error("Failed to get extension branches"))
}

#[tauri::command]
pub async fn switch_extension_branch(
    extension_name: String,
    branch: String,
    global: bool,
    app_state: State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    log_command(format!(
        "switch_extension_branch {} to {}",
        extension_name, branch
    ));

    app_state
        .services
        .extension_service
        .switch_extension_branch(&extension_name, &branch, global)
        .await
        .map_err(map_command_error("Failed to switch extension branch"))
}

#[tauri::command]
pub async fn move_extension(
    extension_name: String,
    source: String,
    destination: String,
    app_state: State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    log_command(format!(
        "move_extension {} from {} to {}",
        extension_name, source, destination
    ));

    app_state
        .services
        .extension_service
        .move_extension(&extension_name, &source, &destination)
        .await
        .map_err(map_command_error("Failed to move extension"))
}
