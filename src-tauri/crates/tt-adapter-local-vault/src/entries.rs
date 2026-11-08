use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VaultKind {
    Folder,
    Lorebook,
}

impl VaultKind {
    pub fn from_path(path: &str) -> Self {
        let name = Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if name.starts_with("lorebook-") {
            Self::Lorebook
        } else {
            Self::Folder
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMount {
    pub id: String,
    pub name: String,
    pub path: String,
    pub available: bool,
    pub kind: VaultKind,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultState {
    pub mounts: Vec<VaultMount>,
    pub primary_mount_id: Option<String>,
    pub primary_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub modified_ms: Option<i64>,
    pub created_ms: Option<i64>,
    pub hidden: bool,
    pub readonly: bool,
    pub extension: Option<String>,
    pub is_symlink: bool,
}

#[cfg(test)]
mod tests {
    use super::VaultKind;

    #[test]
    fn classifies_lorebook_directories() {
        assert_eq!(
            VaultKind::from_path(r"C:\vaults\lorebook-umamusume"),
            VaultKind::Lorebook
        );
        assert_eq!(
            VaultKind::from_path("/vaults/LOREBOOK-naruto/"),
            VaultKind::Lorebook
        );
    }

    #[test]
    fn leaves_other_directories_as_folders() {
        assert_eq!(VaultKind::from_path(r"C:\vaults\notes"), VaultKind::Folder);
        assert_eq!(
            VaultKind::from_path(r"C:\vaults\lorebook"),
            VaultKind::Folder
        );
        assert_eq!(
            VaultKind::from_path(r"C:\vaults\my-lorebook-umamusume"),
            VaultKind::Folder
        );
    }
}
