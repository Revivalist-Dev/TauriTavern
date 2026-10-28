use std::sync::Arc;

use tauri::State;

use crate::app::AppState;
use crate::presentation::commands::helpers::{log_command, map_command_error};
use crate::presentation::errors::CommandError;
use tt_domain::models::update::{UpdateChannel, UpdateCheckResult};

#[tauri::command]
pub async fn check_for_update(
    channel: UpdateChannel,
    app_state: State<'_, Arc<AppState>>,
) -> Result<UpdateCheckResult, CommandError> {
    log_command("check_for_update");

    app_state
        .services
        .update_service
        .check_for_update(channel)
        .await
        .map_err(map_command_error("Failed to check for update"))
}
