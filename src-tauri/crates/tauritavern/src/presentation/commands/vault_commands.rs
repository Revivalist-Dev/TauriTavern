use std::sync::Arc;

use tauri::{State, WebviewWindow};
use tt_adapter_local_vault::{
    LocalVault, LoreDirectory, LoreMigrationReport, LoreRetrieval, LoreState, VaultEntry,
    VaultError, VaultState,
};

use crate::platform::file_transfer;

async fn vault<'a>(state: &'a State<'_, Arc<LocalVault>>) -> &'a LocalVault {
    state.inner().as_ref()
}

#[tauri::command]
pub async fn vault_get_state(state: State<'_, Arc<LocalVault>>) -> Result<VaultState, VaultError> {
    Ok(vault(&state).await.state().await)
}

#[tauri::command]
pub async fn vault_pick_mount(
    window: WebviewWindow,
    state: State<'_, Arc<LocalVault>>,
) -> Result<Option<VaultState>, VaultError> {
    let Some(path) = file_transfer::pick_directory(&window)
        .await
        .map_err(|error| VaultError::io(error.to_string()))?
    else {
        return Ok(None);
    };
    let path = path.to_string_lossy().to_string();
    vault(&state).await.add_mount(&path, None).await.map(Some)
}

#[tauri::command]
pub async fn vault_add_mount(
    path: String,
    name: Option<String>,
    state: State<'_, Arc<LocalVault>>,
) -> Result<VaultState, VaultError> {
    vault(&state).await.add_mount(&path, name).await
}

#[tauri::command]
pub async fn vault_remove_mount(
    mount_id: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<VaultState, VaultError> {
    vault(&state).await.remove_mount(&mount_id).await
}

#[tauri::command]
pub async fn vault_set_primary_mount(
    mount_id: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<VaultState, VaultError> {
    vault(&state).await.set_primary(&mount_id).await
}

#[tauri::command]
pub async fn vault_rename_mount(
    mount_id: String,
    name: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<VaultState, VaultError> {
    vault(&state).await.rename_mount(&mount_id, &name).await
}

#[tauri::command]
pub async fn vault_list(
    mount_id: String,
    path: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<Vec<VaultEntry>, VaultError> {
    vault(&state).await.list(&mount_id, &path).await
}

#[tauri::command]
pub async fn vault_stat(
    mount_id: String,
    path: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<VaultEntry, VaultError> {
    vault(&state).await.stat(&mount_id, &path).await
}

#[tauri::command]
pub async fn vault_read_text(
    mount_id: String,
    path: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<String, VaultError> {
    vault(&state).await.read_text(&mount_id, &path).await
}

#[tauri::command]
pub async fn vault_read_bytes(
    mount_id: String,
    path: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<Vec<u8>, VaultError> {
    vault(&state).await.read_bytes(&mount_id, &path).await
}

#[tauri::command]
pub async fn vault_thumbnail(
    mount_id: String,
    path: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<Vec<u8>, VaultError> {
    vault(&state).await.thumbnail(&mount_id, &path).await
}

#[tauri::command]
pub async fn vault_create_entry(
    mount_id: String,
    parent: String,
    name: String,
    directory: bool,
    state: State<'_, Arc<LocalVault>>,
) -> Result<VaultEntry, VaultError> {
    vault(&state)
        .await
        .create_entry(&mount_id, &parent, &name, directory)
        .await
}

#[tauri::command]
pub async fn vault_rename_entry(
    mount_id: String,
    path: String,
    new_name: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<VaultEntry, VaultError> {
    vault(&state)
        .await
        .rename_entry(&mount_id, &path, &new_name)
        .await
}

#[tauri::command]
pub async fn vault_delete_entries(
    mount_id: String,
    paths: Vec<String>,
    recursive: bool,
    state: State<'_, Arc<LocalVault>>,
) -> Result<(), VaultError> {
    vault(&state)
        .await
        .delete_entries(&mount_id, &paths, recursive)
        .await
}

#[tauri::command]
pub async fn vault_move_entries(
    source_mount: String,
    paths: Vec<String>,
    destination_mount: String,
    destination_dir: String,
    copy: bool,
    state: State<'_, Arc<LocalVault>>,
) -> Result<(), VaultError> {
    vault(&state)
        .await
        .move_entries(
            &source_mount,
            &paths,
            &destination_mount,
            &destination_dir,
            copy,
        )
        .await
}

#[tauri::command]
pub async fn vault_write_file(
    mount_id: String,
    parent: String,
    name: String,
    bytes: Vec<u8>,
    overwrite: bool,
    state: State<'_, Arc<LocalVault>>,
) -> Result<(), VaultError> {
    vault(&state)
        .await
        .write_file(&mount_id, &parent, &name, bytes, overwrite)
        .await
}

#[tauri::command]
pub async fn vault_export_entry(
    window: WebviewWindow,
    mount_id: String,
    path: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<Option<String>, VaultError> {
    let name = path.rsplit('/').next().unwrap_or("vault-file");
    let target = file_transfer::pick_save_path(&window, name)
        .await
        .map_err(|error| VaultError::io(error.to_string()))?;
    let Some(target) = target else {
        return Ok(None);
    };
    let target_text = target.to_string_lossy().to_string();
    vault(&state)
        .await
        .export_entry(&mount_id, &path, &target_text)
        .await?;
    Ok(Some(target_text))
}

#[tauri::command]
pub async fn vault_reveal(
    mount_id: String,
    path: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<(), VaultError> {
    let absolute = vault(&state).await.absolute_path(&mount_id, &path).await?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", absolute.to_string_lossy()))
            .spawn()
            .map_err(|error| VaultError::io(error.to_string()))?;
    }
    #[cfg(not(windows))]
    {
        let _ = absolute;
    }
    Ok(())
}

#[tauri::command]
pub async fn vault_open(
    mount_id: String,
    path: String,
    state: State<'_, Arc<LocalVault>>,
) -> Result<(), VaultError> {
    let absolute = vault(&state).await.absolute_path(&mount_id, &path).await?;
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &absolute.to_string_lossy()])
            .spawn()
            .map_err(|error| VaultError::io(error.to_string()))?;
    }
    #[cfg(not(windows))]
    {
        let _ = absolute;
    }
    Ok(())
}

#[tauri::command]
pub async fn lore_get_state(lore: State<'_, Arc<LoreDirectory>>) -> Result<LoreState, VaultError> {
    lore.state().await
}

#[tauri::command]
pub async fn lore_scan(lore: State<'_, Arc<LoreDirectory>>) -> Result<LoreState, VaultError> {
    lore.scan().await
}

#[tauri::command]
pub async fn lore_retrieve(
    query: String,
    folders: Vec<String>,
    token_budget: u64,
    max_entries: usize,
    lore: State<'_, Arc<LoreDirectory>>,
) -> Result<LoreRetrieval, VaultError> {
    lore.retrieve(&query, &folders, token_budget, max_entries)
        .await
}

#[tauri::command]
pub async fn lore_list_entries(
    folder: Option<String>,
    lore: State<'_, Arc<LoreDirectory>>,
) -> Result<Vec<tt_adapter_local_vault::LoreEntry>, VaultError> {
    lore.entries(folder.as_deref()).await
}

#[tauri::command]
pub async fn lore_search(
    query: String,
    folders: Vec<String>,
    limit: usize,
    lore: State<'_, Arc<LoreDirectory>>,
) -> Result<Vec<tt_adapter_local_vault::LoreSearchResult>, VaultError> {
    lore.search(&query, &folders, limit).await
}

#[tauri::command]
pub async fn lore_read(
    path: String,
    lore: State<'_, Arc<LoreDirectory>>,
) -> Result<tt_adapter_local_vault::LoreReadResult, VaultError> {
    lore.read_entry(&path).await
}

#[tauri::command]
pub async fn lore_migrate_legacy(
    lore: State<'_, Arc<LoreDirectory>>,
) -> Result<LoreMigrationReport, VaultError> {
    lore.migrate_legacy().await
}

#[tauri::command]
pub async fn lore_migrate_character(
    avatar: String,
    book: serde_json::Value,
    lore: State<'_, Arc<LoreDirectory>>,
) -> Result<LoreMigrationReport, VaultError> {
    lore.migrate_character(&avatar, book).await
}
