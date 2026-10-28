use std::path::{Component, Path, PathBuf};

use crate::error::VaultError;

const INVALID_NAME_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub(crate) fn canonical_root(path: &Path) -> Result<PathBuf, VaultError> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| VaultError::not_found(format!("vault folder is not readable: {error}")))?;
    if !canonical.is_dir() {
        return Err(VaultError::new(
            "not_directory",
            "the selected path is not a folder",
        ));
    }
    Ok(canonical)
}

pub(crate) fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, VaultError> {
    let candidate = root.join(relative_path(relative)?);
    let canonical = std::fs::canonicalize(&candidate)
        .map_err(|error| VaultError::not_found(error.to_string()))?;
    ensure_within(root, &canonical)?;
    Ok(canonical)
}

pub(crate) fn ensure_within(root: &Path, candidate: &Path) -> Result<(), VaultError> {
    if path_starts_with(candidate, root) {
        Ok(())
    } else {
        Err(VaultError::outside_mount("path escapes its vault mount"))
    }
}

pub(crate) fn relative_path(value: &str) -> Result<PathBuf, VaultError> {
    if value.is_empty() {
        return Ok(PathBuf::new());
    }
    let parsed = Path::new(value);
    if parsed.is_absolute() {
        return Err(VaultError::outside_mount("absolute paths are not accepted"));
    }
    let mut output = PathBuf::new();
    for component in parsed.components() {
        match component {
            Component::Normal(part) => output.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(VaultError::outside_mount("path escapes its vault mount"));
            }
        }
    }
    Ok(output)
}

pub(crate) fn relative_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub(crate) fn validate_name(name: &str) -> Result<&str, VaultError> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err(VaultError::invalid_name("name is empty or reserved"));
    }
    if name
        .chars()
        .any(|character| INVALID_NAME_CHARS.contains(&character))
    {
        return Err(VaultError::invalid_name(
            "name contains a Windows-invalid character",
        ));
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Err(VaultError::invalid_name(
            "name cannot end with a dot or space",
        ));
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    if RESERVED_NAMES.contains(&stem.as_str()) {
        return Err(VaultError::invalid_name("name is reserved by Windows"));
    }
    Ok(name)
}

fn path_starts_with(path: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let path_components = path
            .components()
            .map(|component| component.as_os_str().to_string_lossy().to_lowercase())
            .collect::<Vec<_>>();
        let root_components = root
            .components()
            .map(|component| component.as_os_str().to_string_lossy().to_lowercase())
            .collect::<Vec<_>>();
        path_components.starts_with(&root_components)
    }
    #[cfg(not(windows))]
    {
        path.starts_with(root)
    }
}
