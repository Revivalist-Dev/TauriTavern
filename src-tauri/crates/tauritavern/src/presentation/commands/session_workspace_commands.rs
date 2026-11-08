use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::app::AppState;
use crate::presentation::commands::helpers::{log_command, map_command_error};
use crate::presentation::errors::CommandError;

#[tauri::command]
pub async fn prepare_group_session_metadata(
    group_id: String,
    chat_id: String,
    metadata: Value,
    app_state: State<'_, Arc<AppState>>,
) -> Result<Value, CommandError> {
    log_command(format!(
        "prepare_group_session_metadata group={} chat={}",
        group_id, chat_id
    ));
    app_state
        .services
        .group_chat_service
        .prepare_group_session_metadata(&group_id, &chat_id, metadata)
        .await
        .map_err(map_command_error(format!(
            "Failed to prepare session workspace for {}",
            chat_id
        )))
}

#[tauri::command]
pub async fn sync_group_session_metadata(
    group_id: String,
    chat_id: String,
    metadata: Value,
    app_state: State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    log_command(format!(
        "sync_group_session_metadata group={} chat={}",
        group_id, chat_id
    ));
    app_state
        .services
        .group_chat_service
        .sync_group_session_metadata(&group_id, &chat_id, metadata)
        .await
        .map_err(map_command_error(format!(
            "Failed to sync session workspace for {}",
            chat_id
        )))
}

#[tauri::command]
pub async fn get_group_session_workspace(
    group_id: String,
    chat_id: String,
    app_state: State<'_, Arc<AppState>>,
) -> Result<Value, CommandError> {
    log_command(format!(
        "get_group_session_workspace group={} chat={}",
        group_id, chat_id
    ));
    app_state
        .services
        .group_chat_service
        .get_group_session_workspace(&group_id, &chat_id)
        .await
        .map_err(map_command_error(format!(
            "Failed to read session workspace for {}",
            chat_id
        )))
}

#[tauri::command]
pub async fn get_group_workspace(
    group_id: String,
    app_state: State<'_, Arc<AppState>>,
) -> Result<Value, CommandError> {
    log_command(format!("get_group_workspace group={}", group_id));
    app_state
        .services
        .group_chat_service
        .get_group_workspace(&group_id)
        .await
        .map_err(map_command_error(format!(
            "Failed to read group workspace for {}",
            group_id
        )))
}

#[tauri::command]
pub async fn write_session_workspace_entry(
    chat_id: String,
    namespace: String,
    key: String,
    value: Value,
    app_state: State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    log_command(format!(
        "write_session_workspace_entry chat={} {}/{}",
        chat_id, namespace, key
    ));
    app_state
        .services
        .group_chat_service
        .write_session_workspace_entry(&chat_id, &namespace, &key, value)
        .await
        .map_err(map_command_error(format!(
            "Failed to write session workspace entry {}",
            chat_id
        )))
}

#[tauri::command]
pub async fn delete_session_workspace_entry(
    chat_id: String,
    namespace: String,
    key: String,
    app_state: State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    log_command(format!(
        "delete_session_workspace_entry chat={} {}/{}",
        chat_id, namespace, key
    ));
    app_state
        .services
        .group_chat_service
        .delete_session_workspace_entry(&chat_id, &namespace, &key)
        .await
        .map_err(map_command_error(format!(
            "Failed to delete session workspace entry {}",
            chat_id
        )))
}

#[tauri::command]
pub async fn write_group_workspace_entry(
    group_id: String,
    namespace: String,
    key: String,
    value: Value,
    app_state: State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    log_command(format!(
        "write_group_workspace_entry group={} {}/{}",
        group_id, namespace, key
    ));
    app_state
        .services
        .group_chat_service
        .write_group_workspace_entry(&group_id, &namespace, &key, value)
        .await
        .map_err(map_command_error(format!(
            "Failed to write group workspace entry {}",
            group_id
        )))
}

#[tauri::command]
pub async fn delete_group_workspace_entry(
    group_id: String,
    namespace: String,
    key: String,
    app_state: State<'_, Arc<AppState>>,
) -> Result<(), CommandError> {
    log_command(format!(
        "delete_group_workspace_entry group={} {}/{}",
        group_id, namespace, key
    ));
    app_state
        .services
        .group_chat_service
        .delete_group_workspace_entry(&group_id, &namespace, &key)
        .await
        .map_err(map_command_error(format!(
            "Failed to delete group workspace entry {}",
            group_id
        )))
}
