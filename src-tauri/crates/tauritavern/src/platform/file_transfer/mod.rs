//! Native file selection and delivery for the Windows host.
//!
//! Callers own content; this module owns dialogs and the lifetime of a delivered
//! source file.

mod desktop;

use serde::Deserialize;
use std::path::PathBuf;
use tauri::{AppHandle, WebviewWindow};
use tt_domain::errors::DomainError;

use crate::infrastructure::staging;
use desktop as native;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PickKind {
    CharacterCard,
    SkillArchive,
    DataArchive,
}

impl PickKind {
    pub fn staging_kind(self) -> &'static str {
        match self {
            Self::CharacterCard => "character-card",
            Self::SkillArchive => "skill-archive",
            Self::DataArchive => "data-archive",
        }
    }

    pub fn extensions(self) -> &'static [&'static str] {
        match self {
            Self::CharacterCard => &["json", "png"],
            Self::SkillArchive => &["zip", "ttskill"],
            Self::DataArchive => &["zip", "tar", "gz", "tgz"],
        }
    }
}

pub struct PickedFile {
    pub name: String,
    pub source: PickedSource,
}

pub enum PickedSource {
    UserPath(PathBuf),
}

pub enum Delivery {
    Delivered,
    Cancelled,
}

pub async fn pick(
    window: &WebviewWindow,
    kind: PickKind,
    multiple: bool,
) -> Result<Option<Vec<PickedFile>>, DomainError> {
    native::pick(window, kind, multiple).await
}

pub async fn pick_directory(window: &WebviewWindow) -> Result<Option<PathBuf>, DomainError> {
    native::pick_directory(window).await
}

pub async fn pick_save_path(
    window: &WebviewWindow,
    file_name: &str,
) -> Result<Option<PathBuf>, DomainError> {
    native::pick_save_path(window, file_name).await
}

pub async fn materialize(
    _app: &AppHandle,
    source: PickedSource,
    destination: PathBuf,
) -> Result<PathBuf, DomainError> {
    let target = destination.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let PickedSource::UserPath(path) = source;
        std::fs::copy(path, &target).map(|_| ())
    })
    .await
    .map_err(|error| DomainError::InternalError(format!("File staging task failed: {error}")))?;

    if let Err(error) = result {
        if let Err(cleanup_error) = staging::discard_file(&destination).await {
            tracing::warn!(%cleanup_error, "Failed to remove incomplete staged file");
        }
        return Err(DomainError::file_io(
            "Stage selected file",
            destination.display().to_string(),
            error,
        ));
    }
    Ok(destination)
}

/// Takes ownership of a private source file, including on cancellation or error.
pub async fn deliver(
    window: &WebviewWindow,
    source: PathBuf,
    file_name: &str,
) -> Result<Delivery, DomainError> {
    let file_name = sanitize_file_name(file_name);
    let result = native::deliver(window, &source, &file_name).await;
    if let Err(error) = staging::discard_file(&source).await {
        tracing::warn!(%error, "Failed to remove file after delivery");
    }
    result
}

fn sanitize_file_name(name: &str) -> String {
    let name: String = name
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*')
            {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let name = name.trim().trim_end_matches(['.', ' ']);
    if name.is_empty() {
        "download".to_string()
    } else {
        name.to_string()
    }
}

fn sync_target(file: &std::fs::File) -> std::io::Result<()> {
    if file.metadata()?.is_file() {
        file.sync_all()?;
    }
    Ok(())
}

async fn pick_dialog(
    dialog: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    multiple: bool,
) -> Result<Option<Vec<tauri_plugin_dialog::FilePath>>, DomainError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    if multiple {
        dialog.pick_files(move |files| {
            let _ = sender.send(files);
        });
    } else {
        dialog.pick_file(move |file| {
            let _ = sender.send(file.map(|file| vec![file]));
        });
    }
    receiver.await.map_err(|error| {
        DomainError::InternalError(format!("File picker did not complete: {error}"))
    })
}

async fn save_dialog(
    dialog: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
) -> Result<Option<tauri_plugin_dialog::FilePath>, DomainError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dialog.save_file(move |file| {
        let _ = sender.send(file);
    });
    receiver.await.map_err(|error| {
        DomainError::InternalError(format!("Save dialog did not complete: {error}"))
    })
}
