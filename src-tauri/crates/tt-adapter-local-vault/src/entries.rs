use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMount {
    pub id: String,
    pub name: String,
    pub path: String,
    pub available: bool,
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
