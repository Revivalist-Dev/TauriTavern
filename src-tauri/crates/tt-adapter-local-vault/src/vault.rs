use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::entries::{VaultEntry, VaultKind, VaultMount, VaultState};
use crate::error::VaultError;
use crate::guard::{canonical_root, relative_string, resolve_existing, validate_name};

const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES: u64 = 32 * 1024 * 1024;
const THUMBNAIL_EDGE: u32 = 256;
const HIDDEN_NAMES: &[&str] = &["desktop.ini", "thumbs.db", "$recycle.bin"];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredMount {
    id: String,
    name: String,
    path: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConfig {
    mounts: Vec<StoredMount>,
    primary_mount_id: Option<String>,
}

pub struct LocalVault {
    config_path: PathBuf,
    config: RwLock<StoredConfig>,
}

impl LocalVault {
    pub fn load(config_path: PathBuf) -> Self {
        let config = std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<StoredConfig>(&raw).ok())
            .unwrap_or_default();
        Self {
            config_path,
            config: RwLock::new(config),
        }
    }

    pub async fn state(&self) -> VaultState {
        let config = self.config.read().await;
        let mounts = config
            .mounts
            .iter()
            .map(|mount| VaultMount {
                id: mount.id.clone(),
                name: mount.name.clone(),
                path: mount.path.clone(),
                available: Path::new(&mount.path).is_dir(),
                kind: VaultKind::from_path(&mount.path),
            })
            .collect::<Vec<_>>();
        let primary = config
            .primary_mount_id
            .as_ref()
            .and_then(|id| config.mounts.iter().find(|mount| &mount.id == id))
            .and_then(|mount| Path::new(&mount.path).is_dir().then(|| mount.path.clone()));
        VaultState {
            mounts,
            primary_mount_id: config.primary_mount_id.clone(),
            primary_path: primary,
        }
    }

    pub async fn add_mount(
        &self,
        path: &str,
        name: Option<String>,
    ) -> Result<VaultState, VaultError> {
        let canonical = canonical_root(Path::new(path))?;
        let text = canonical.to_string_lossy().to_string();
        let mut config = self.config.write().await;
        if config
            .mounts
            .iter()
            .any(|mount| mount.path.eq_ignore_ascii_case(&text))
        {
            return Err(VaultError::conflict("that folder is already mounted"));
        }
        let id = Uuid::new_v4().to_string();
        let display_name = name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                canonical
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "Vault".to_string());
        config.mounts.push(StoredMount {
            id: id.clone(),
            name: display_name,
            path: text,
        });
        if config.primary_mount_id.is_none() {
            config.primary_mount_id = Some(id);
        }
        self.save_locked(&config).await?;
        Ok(self.state_locked(&config))
    }

    pub async fn remove_mount(&self, mount_id: &str) -> Result<VaultState, VaultError> {
        let mut config = self.config.write().await;
        let before = config.mounts.len();
        config.mounts.retain(|mount| mount.id != mount_id);
        if config.mounts.len() == before {
            return Err(VaultError::not_found("mount not found"));
        }
        if config.primary_mount_id.as_deref() == Some(mount_id) {
            config.primary_mount_id = config.mounts.first().map(|mount| mount.id.clone());
        }
        self.save_locked(&config).await?;
        Ok(self.state_locked(&config))
    }

    pub async fn set_primary(&self, mount_id: &str) -> Result<VaultState, VaultError> {
        let mut config = self.config.write().await;
        if !config.mounts.iter().any(|mount| mount.id == mount_id) {
            return Err(VaultError::not_found("mount not found"));
        }
        config.primary_mount_id = Some(mount_id.to_string());
        self.save_locked(&config).await?;
        Ok(self.state_locked(&config))
    }

    pub async fn rename_mount(&self, mount_id: &str, name: &str) -> Result<VaultState, VaultError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(VaultError::invalid_name("mount name is empty"));
        }
        let mut config = self.config.write().await;
        let mount = config
            .mounts
            .iter_mut()
            .find(|mount| mount.id == mount_id)
            .ok_or_else(|| VaultError::not_found("mount not found"))?;
        mount.name = name.to_string();
        self.save_locked(&config).await?;
        Ok(self.state_locked(&config))
    }

    pub async fn list(
        &self,
        mount_id: &str,
        relative: &str,
    ) -> Result<Vec<VaultEntry>, VaultError> {
        let (root, _) = self.mount_root(mount_id).await?;
        let directory = resolve_existing(&root, relative)?;
        if !directory.is_dir() {
            return Err(VaultError::new("not_directory", "path is not a folder"));
        }
        tokio::task::spawn_blocking(move || read_entries(&root, &directory))
            .await
            .map_err(|error| VaultError::io(error.to_string()))?
    }

    pub async fn stat(&self, mount_id: &str, relative: &str) -> Result<VaultEntry, VaultError> {
        let (root, _) = self.mount_root(mount_id).await?;
        let path = resolve_existing(&root, relative)?;
        tokio::task::spawn_blocking(move || entry_for(&root, &path))
            .await
            .map_err(|error| VaultError::io(error.to_string()))?
    }

    pub async fn read_text(&self, mount_id: &str, relative: &str) -> Result<String, VaultError> {
        let (root, _) = self.mount_root(mount_id).await?;
        let path = resolve_existing(&root, relative)?;
        let metadata = tokio::fs::metadata(&path).await?;
        if metadata.len() > MAX_TEXT_BYTES {
            return Err(VaultError::too_large("file is too large to preview"));
        }
        let bytes = tokio::fs::read(&path).await?;
        Ok(String::from_utf8_lossy(&bytes).to_string())
    }

    pub async fn read_bytes(&self, mount_id: &str, relative: &str) -> Result<Vec<u8>, VaultError> {
        let (root, _) = self.mount_root(mount_id).await?;
        let path = resolve_existing(&root, relative)?;
        let metadata = tokio::fs::metadata(&path).await?;
        if metadata.len() > MAX_READ_BYTES {
            return Err(VaultError::too_large(
                "file is too large to open in the explorer",
            ));
        }
        Ok(tokio::fs::read(&path).await?)
    }

    pub async fn thumbnail(&self, mount_id: &str, relative: &str) -> Result<Vec<u8>, VaultError> {
        let (root, _) = self.mount_root(mount_id).await?;
        let path = resolve_existing(&root, relative)?;
        let metadata = tokio::fs::metadata(&path).await?;
        if metadata.len() > MAX_THUMBNAIL_BYTES {
            return Err(VaultError::too_large("image is too large to thumbnail"));
        }
        tokio::task::spawn_blocking(move || make_thumbnail(&path))
            .await
            .map_err(|error| VaultError::io(error.to_string()))?
    }

    pub async fn create_entry(
        &self,
        mount_id: &str,
        parent: &str,
        name: &str,
        directory: bool,
    ) -> Result<VaultEntry, VaultError> {
        let name = validate_name(name)?.to_string();
        let (root, _) = self.mount_root(mount_id).await?;
        let parent_path = resolve_existing(&root, parent)?;
        let target = parent_path.join(&name);
        if target.exists() {
            return Err(VaultError::conflict(
                "an entry with that name already exists",
            ));
        }
        if directory {
            tokio::fs::create_dir(&target).await?;
        } else {
            tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .await?;
        }
        let root_clone = root.clone();
        tokio::task::spawn_blocking(move || entry_for(&root_clone, &target))
            .await
            .map_err(|error| VaultError::io(error.to_string()))?
    }

    pub async fn rename_entry(
        &self,
        mount_id: &str,
        relative: &str,
        new_name: &str,
    ) -> Result<VaultEntry, VaultError> {
        if relative.is_empty() {
            return Err(VaultError::invalid_name("a mount root cannot be renamed"));
        }
        let new_name = validate_name(new_name)?.to_string();
        let (root, _) = self.mount_root(mount_id).await?;
        let source = resolve_existing(&root, relative)?;
        let parent = source
            .parent()
            .ok_or_else(|| VaultError::outside_mount("entry has no parent"))?;
        let target = parent.join(&new_name);
        if target.exists() {
            return Err(VaultError::conflict(
                "an entry with that name already exists",
            ));
        }
        tokio::fs::rename(&source, &target).await?;
        let root_clone = root.clone();
        tokio::task::spawn_blocking(move || entry_for(&root_clone, &target))
            .await
            .map_err(|error| VaultError::io(error.to_string()))?
    }

    pub async fn delete_entries(
        &self,
        mount_id: &str,
        paths: &[String],
        recursive: bool,
    ) -> Result<(), VaultError> {
        let (root, _) = self.mount_root(mount_id).await?;
        for relative in paths {
            if relative.is_empty() {
                return Err(VaultError::invalid_name("a mount root cannot be deleted"));
            }
            let path = resolve_existing(&root, relative)?;
            if path.is_dir() && !recursive {
                let mut entries = tokio::fs::read_dir(&path).await?;
                if entries.next_entry().await?.is_some() {
                    return Err(VaultError::new(
                        "not_empty",
                        "folder is not empty; confirm recursive delete",
                    ));
                }
            }
            tokio::task::spawn_blocking(move || trash::delete(&path))
                .await
                .map_err(|error| VaultError::io(error.to_string()))?
                .map_err(|error| VaultError::io(error.to_string()))?;
        }
        Ok(())
    }

    pub async fn move_entries(
        &self,
        source_mount: &str,
        paths: &[String],
        destination_mount: &str,
        destination_dir: &str,
        copy: bool,
    ) -> Result<(), VaultError> {
        let (source_root, _) = self.mount_root(source_mount).await?;
        let (destination_root, _) = self.mount_root(destination_mount).await?;
        let destination = resolve_existing(&destination_root, destination_dir)?;
        if !destination.is_dir() {
            return Err(VaultError::new(
                "not_directory",
                "destination is not a folder",
            ));
        }
        for relative in paths {
            if relative.is_empty() {
                return Err(VaultError::invalid_name("a mount root cannot be moved"));
            }
            let source = resolve_existing(&source_root, relative)?;
            let name = source
                .file_name()
                .ok_or_else(|| VaultError::invalid_name("entry has no name"))?;
            let target = destination.join(name);
            if target.exists() {
                return Err(VaultError::conflict(format!(
                    "{} already exists in the destination",
                    name.to_string_lossy()
                )));
            }
            let source_clone = source.clone();
            let target_clone = target.clone();
            let same_volume = source_root == destination_root;
            tokio::task::spawn_blocking(move || {
                if copy || !same_volume {
                    copy_recursive(&source_clone, &target_clone)?;
                    if !copy {
                        if source_clone.is_dir() {
                            std::fs::remove_dir_all(&source_clone)?;
                        } else {
                            std::fs::remove_file(&source_clone)?;
                        }
                    }
                    Ok::<(), VaultError>(())
                } else {
                    std::fs::rename(&source_clone, &target_clone)?;
                    Ok(())
                }
            })
            .await
            .map_err(|error| VaultError::io(error.to_string()))??;
        }
        Ok(())
    }

    pub async fn write_file(
        &self,
        mount_id: &str,
        parent: &str,
        name: &str,
        bytes: Vec<u8>,
        overwrite: bool,
    ) -> Result<(), VaultError> {
        let name = validate_name(name)?;
        let (root, _) = self.mount_root(mount_id).await?;
        let parent_path = resolve_existing(&root, parent)?;
        let target = parent_path.join(name);
        if target.exists() && !overwrite {
            return Err(VaultError::conflict(
                "an entry with that name already exists",
            ));
        }
        tokio::fs::write(target, bytes).await?;
        Ok(())
    }

    pub async fn absolute_path(
        &self,
        mount_id: &str,
        relative: &str,
    ) -> Result<PathBuf, VaultError> {
        let (root, _) = self.mount_root(mount_id).await?;
        resolve_existing(&root, relative)
    }

    pub async fn export_entry(
        &self,
        mount_id: &str,
        relative: &str,
        target: &str,
    ) -> Result<(), VaultError> {
        let (root, _) = self.mount_root(mount_id).await?;
        let source = resolve_existing(&root, relative)?;
        if source.is_dir() {
            return Err(VaultError::new(
                "not_file",
                "folders are exported by copying them in Explorer",
            ));
        }
        tokio::fs::copy(source, PathBuf::from(target)).await?;
        Ok(())
    }

    pub async fn import_paths(
        &self,
        source_paths: Vec<String>,
        mount_id: &str,
        destination_dir: &str,
    ) -> Result<(), VaultError> {
        let (root, _) = self.mount_root(mount_id).await?;
        let destination = resolve_existing(&root, destination_dir)?;
        for source in source_paths {
            let source = PathBuf::from(source);
            let name = source
                .file_name()
                .ok_or_else(|| VaultError::invalid_name("import source has no name"))?
                .to_os_string();
            let target = destination.join(&name);
            if target.exists() {
                return Err(VaultError::conflict(format!(
                    "{} already exists in the destination",
                    name.to_string_lossy()
                )));
            }
            let source_clone = source.clone();
            tokio::task::spawn_blocking(move || copy_recursive(&source_clone, &target))
                .await
                .map_err(|error| VaultError::io(error.to_string()))??;
        }
        Ok(())
    }

    async fn mount_root(&self, mount_id: &str) -> Result<(PathBuf, StoredMount), VaultError> {
        let config = self.config.read().await;
        let mount = config
            .mounts
            .iter()
            .find(|mount| mount.id == mount_id)
            .cloned()
            .ok_or_else(|| VaultError::not_found("mount not found"))?;
        let root = canonical_root(Path::new(&mount.path))?;
        Ok((root, mount))
    }

    fn state_locked(&self, config: &StoredConfig) -> VaultState {
        let mounts = config
            .mounts
            .iter()
            .map(|mount| VaultMount {
                id: mount.id.clone(),
                name: mount.name.clone(),
                path: mount.path.clone(),
                available: Path::new(&mount.path).is_dir(),
                kind: VaultKind::from_path(&mount.path),
            })
            .collect::<Vec<_>>();
        let primary = config
            .primary_mount_id
            .as_ref()
            .and_then(|id| config.mounts.iter().find(|mount| &mount.id == id))
            .and_then(|mount| Path::new(&mount.path).is_dir().then(|| mount.path.clone()));
        VaultState {
            mounts,
            primary_mount_id: config.primary_mount_id.clone(),
            primary_path: primary,
        }
    }

    async fn save_locked(&self, config: &StoredConfig) -> Result<(), VaultError> {
        if let Some(parent) = self.config_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let payload =
            serde_json::to_vec_pretty(config).map_err(|error| VaultError::io(error.to_string()))?;
        let temporary = self.config_path.with_extension("json.tmp");
        tokio::fs::write(&temporary, payload).await?;
        tokio::fs::rename(&temporary, &self.config_path).await?;
        Ok(())
    }
}

fn read_entries(root: &Path, directory: &Path) -> Result<Vec<VaultEntry>, VaultError> {
    let mut entries = Vec::new();
    for item in std::fs::read_dir(directory)? {
        let item = item?;
        let path = item.path();
        entries.push(entry_for(root, &path)?);
    }
    entries.sort_by(|left, right| {
        let left_dir = left.kind == "directory";
        let right_dir = right.kind == "directory";
        right_dir
            .cmp(&left_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

fn entry_for(root: &Path, path: &Path) -> Result<VaultEntry, VaultError> {
    let metadata = std::fs::symlink_metadata(path)?;
    let is_symlink = metadata.file_type().is_symlink();
    let kind = if metadata.is_dir() {
        "directory"
    } else if is_symlink {
        "symlink"
    } else {
        "file"
    };
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let hidden = name.starts_with('.') || HIDDEN_NAMES.contains(&name.to_lowercase().as_str());
    let readonly = metadata.permissions().readonly();
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase());
    Ok(VaultEntry {
        name,
        path: relative_string(root, path),
        kind: kind.to_string(),
        size: metadata.len(),
        modified_ms: metadata.modified().ok().and_then(system_time_ms),
        created_ms: metadata.created().ok().and_then(system_time_ms),
        hidden,
        readonly,
        extension,
        is_symlink,
    })
}

fn system_time_ms(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn make_thumbnail(path: &Path) -> Result<Vec<u8>, VaultError> {
    let image =
        image::open(path).map_err(|error| VaultError::new("not_image", error.to_string()))?;
    let thumbnail = image.thumbnail(THUMBNAIL_EDGE, THUMBNAIL_EDGE);
    let mut output = std::io::Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| VaultError::io(error.to_string()))?;
    Ok(output.into_inner())
}

fn copy_recursive(source: &Path, target: &Path) -> Result<(), VaultError> {
    let metadata = std::fs::symlink_metadata(source)?;
    if metadata.file_type().is_symlink() {
        return Err(VaultError::new(
            "symlink",
            "symbolic links are not copied by the explorer",
        ));
    }
    if source.is_dir() {
        std::fs::create_dir_all(target)?;
        for item in std::fs::read_dir(source)? {
            let item = item?;
            copy_recursive(&item.path(), &target.join(item.file_name()))?;
        }
    } else {
        std::fs::copy(source, target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(temp: &tempfile::TempDir) -> LocalVault {
        LocalVault::load(temp.path().join("local-vault.json"))
    }

    #[tokio::test]
    async fn mount_state_and_primary() {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("lore");
        std::fs::create_dir(&folder).unwrap();
        let vault = vault(&temp);
        let state = vault
            .add_mount(folder.to_str().unwrap(), None)
            .await
            .unwrap();
        assert_eq!(state.mounts.len(), 1);
        assert_eq!(state.primary_mount_id, Some(state.mounts[0].id.clone()));
        assert!(state.mounts[0].available);
        assert_eq!(
            state.primary_path.as_deref(),
            Some(folder.canonicalize().unwrap().to_str().unwrap())
        );
        let second = temp.path().join("notes");
        std::fs::create_dir(&second).unwrap();
        let state = vault
            .add_mount(second.to_str().unwrap(), None)
            .await
            .unwrap();
        assert_eq!(state.mounts.len(), 2);
        let second_id = state.mounts[1].id.clone();
        let state = vault.set_primary(&second_id).await.unwrap();
        assert_eq!(state.primary_mount_id.as_deref(), Some(second_id.as_str()));
    }

    #[tokio::test]
    async fn list_create_read_and_rename() {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("vault");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("note.md"), "# hello").unwrap();
        std::fs::create_dir(folder.join("sub")).unwrap();
        let vault = vault(&temp);
        let state = vault
            .add_mount(folder.to_str().unwrap(), None)
            .await
            .unwrap();
        let mount_id = state.primary_mount_id.unwrap();
        let entries = vault.list(&mount_id, "").await.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].kind, "directory");
        assert_eq!(
            vault.read_text(&mount_id, "note.md").await.unwrap(),
            "# hello"
        );
        let created = vault
            .create_entry(&mount_id, "", "new.md", false)
            .await
            .unwrap();
        assert_eq!(created.name, "new.md");
        let renamed = vault
            .rename_entry(&mount_id, "new.md", "renamed.md")
            .await
            .unwrap();
        assert_eq!(renamed.name, "renamed.md");
        vault
            .write_file(&mount_id, "", "blocked.md", b"no".to_vec(), false)
            .await
            .unwrap();
        let error = vault
            .write_file(&mount_id, "", "blocked.md", b"yes".to_vec(), false)
            .await
            .unwrap_err();
        assert_eq!(error.code, "exists");
    }

    #[tokio::test]
    async fn rejects_traversal_and_invalid_names() {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("vault");
        std::fs::create_dir(&folder).unwrap();
        let vault = vault(&temp);
        let state = vault
            .add_mount(folder.to_str().unwrap(), None)
            .await
            .unwrap();
        let mount_id = state.primary_mount_id.unwrap();
        assert_eq!(
            vault.list(&mount_id, "../").await.unwrap_err().code,
            "outside_mount"
        );
        assert_eq!(
            vault
                .create_entry(&mount_id, "", "CON", false)
                .await
                .unwrap_err()
                .code,
            "invalid_name"
        );
        assert_eq!(
            vault
                .create_entry(&mount_id, "", "bad:name", false)
                .await
                .unwrap_err()
                .code,
            "invalid_name"
        );
    }

    #[tokio::test]
    async fn move_and_copy_between_mounts() {
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        std::fs::create_dir(&first).unwrap();
        std::fs::create_dir(&second).unwrap();
        std::fs::write(first.join("note.md"), "body").unwrap();
        let vault = vault(&temp);
        let first_state = vault
            .add_mount(first.to_str().unwrap(), None)
            .await
            .unwrap();
        let first_id = first_state.mounts[0].id.clone();
        let second_state = vault
            .add_mount(second.to_str().unwrap(), None)
            .await
            .unwrap();
        let second_id = second_state.mounts[1].id.clone();

        vault
            .move_entries(&first_id, &["note.md".to_string()], &second_id, "", false)
            .await
            .unwrap();
        assert!(!first.join("note.md").exists());
        assert_eq!(
            std::fs::read_to_string(second.join("note.md")).unwrap(),
            "body"
        );

        vault
            .move_entries(&second_id, &["note.md".to_string()], &first_id, "", true)
            .await
            .unwrap();
        assert!(second.join("note.md").exists());
        assert!(first.join("note.md").exists());
    }

    #[tokio::test]
    async fn hidden_entries_are_reported() {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("vault");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join(".hidden"), "x").unwrap();
        std::fs::write(folder.join("visible.md"), "x").unwrap();
        let vault = vault(&temp);
        let state = vault
            .add_mount(folder.to_str().unwrap(), None)
            .await
            .unwrap();
        let entries = vault
            .list(&state.primary_mount_id.unwrap(), "")
            .await
            .unwrap();
        assert!(
            entries
                .iter()
                .any(|entry| entry.name == ".hidden" && entry.hidden)
        );
        assert!(
            entries
                .iter()
                .any(|entry| entry.name == "visible.md" && !entry.hidden)
        );
    }
}
