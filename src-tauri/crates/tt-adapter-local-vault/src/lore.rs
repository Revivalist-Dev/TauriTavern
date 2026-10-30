//! DeepLore-compatible Markdown lore directory.
//!
//! Ported from `zedon-byok/crates/creative-vault` at
//! `3ebf58f697b89f1368e54dec351eb1a27b2e5047`. The scanner and retrieval
//! contract are kept intentionally small; unsupported SillyTavern fields are
//! preserved in `extensions` by the migration path.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use regex::Regex;
use serde::Serialize;
use serde_json::Value as JsonValue;
use serde_yaml::{Mapping, Value as YamlValue};
use tokio::sync::RwLock;
use walkdir::WalkDir;

use crate::error::VaultError;
use crate::vault::LocalVault;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoreEntry {
    pub id: String,
    pub title: String,
    pub folder: String,
    pub path: String,
    pub content: String,
    pub keys: Vec<String>,
    pub secondary_keys: Vec<String>,
    pub regex_keys: Vec<String>,
    pub requires: Vec<String>,
    pub excludes: Vec<String>,
    pub constant: bool,
    pub priority: i64,
    pub position: String,
    pub depth: i64,
    pub role: String,
    pub probability: u8,
    pub enabled: bool,
    pub token_estimate: u64,
    pub modified_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoreFolder {
    pub path: String,
    pub entries: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoreSearchResult {
    pub id: String,
    pub title: String,
    pub folder: String,
    pub path: String,
    pub keys: Vec<String>,
    pub score: f64,
    pub snippet: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoreReadResult {
    pub id: String,
    pub title: String,
    pub folder: String,
    pub path: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoreState {
    pub root: Option<String>,
    pub folders: Vec<LoreFolder>,
    pub entries: usize,
    pub scanned: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoreActivationEntry {
    pub id: String,
    pub uid: i64,
    pub title: String,
    pub folder: String,
    pub content: String,
    pub constant: bool,
    pub position: String,
    pub depth: i64,
    pub role: String,
    pub priority: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoreRetrieval {
    pub before: Vec<LoreActivationEntry>,
    pub after: Vec<LoreActivationEntry>,
    pub depth: Vec<LoreActivationEntry>,
    pub entries: Vec<LoreActivationEntry>,
    pub tokens: u64,
    pub scanned: usize,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoreMigrationReport {
    pub books: usize,
    pub entries: usize,
    pub folders: usize,
    pub backup: Option<String>,
    pub skipped: bool,
}

pub struct LoreDirectory {
    vault: Arc<LocalVault>,
    worlds_dir: PathBuf,
    entries: RwLock<Vec<LoreEntry>>,
    scanned: RwLock<bool>,
}

impl LoreDirectory {
    pub fn new(vault: Arc<LocalVault>, data_root: PathBuf) -> Self {
        Self {
            vault,
            worlds_dir: data_root.join("default-user").join("worlds"),
            entries: RwLock::new(Vec::new()),
            scanned: RwLock::new(false),
        }
    }

    async fn lore_root(&self) -> Result<PathBuf, VaultError> {
        let state = self.vault.state().await;
        let primary = state
            .primary_path
            .ok_or_else(|| VaultError::new("no_vault", "select a primary vault folder first"))?;
        Ok(PathBuf::from(primary).join("lore"))
    }

    pub async fn state(&self) -> Result<LoreState, VaultError> {
        let root = self.lore_root().await?;
        let entries = self.entries.read().await;
        let mut folders: BTreeMap<String, usize> = BTreeMap::new();
        for entry in entries.iter() {
            *folders.entry(entry.folder.clone()).or_default() += 1;
        }
        Ok(LoreState {
            root: Some(root.to_string_lossy().to_string()),
            folders: folders
                .into_iter()
                .map(|(path, entries)| LoreFolder { path, entries })
                .collect(),
            entries: entries.len(),
            scanned: *self.scanned.read().await,
        })
    }

    pub async fn scan(&self) -> Result<LoreState, VaultError> {
        let root = self.lore_root().await?;
        let ignore = load_ignore(&root);
        let mut entries = Vec::new();
        if root.exists() {
            for item in WalkDir::new(&root)
                .follow_links(false)
                .into_iter()
                .filter_entry(|entry| !is_ignored(entry.path(), &root, &ignore))
            {
                let item = item.map_err(|error| VaultError::io(error.to_string()))?;
                if !item.file_type().is_file() {
                    continue;
                }
                let path = item.path();
                if path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| value.eq_ignore_ascii_case("md"))
                    != Some(true)
                {
                    continue;
                }
                match parse_entry(&root, path) {
                    Ok(entry) => entries.push(entry),
                    Err(_error) => {}
                }
            }
        }
        entries.sort_by(|left, right| {
            right
                .priority
                .cmp(&left.priority)
                .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
        });
        *self.entries.write().await = entries;
        *self.scanned.write().await = true;
        self.state().await
    }

    pub async fn read_entry(&self, path: &str) -> Result<LoreReadResult, VaultError> {
        let root = self.lore_root().await?;
        let requested = Path::new(path);
        if requested.is_absolute()
            || requested.components().any(|component| {
                matches!(
                    component,
                    std::path::Component::ParentDir | std::path::Component::Prefix(_)
                )
            })
        {
            return Err(VaultError::new(
                "invalid_path",
                "lore entry path must stay inside the lore directory",
            ));
        }
        let target = root.join(requested);
        let canonical_root = root
            .canonicalize()
            .map_err(|error| VaultError::io(error.to_string()))?;
        let canonical_target = target
            .canonicalize()
            .map_err(|error| VaultError::io(error.to_string()))?;
        if !canonical_target.starts_with(&canonical_root) {
            return Err(VaultError::new(
                "invalid_path",
                "lore entry path escapes the lore directory",
            ));
        }
        let raw = std::fs::read_to_string(&canonical_target)?;
        let (_, body) = split_frontmatter(&raw);
        let entry = parse_entry(&root, &canonical_target)?;
        Ok(LoreReadResult {
            id: entry.id,
            title: entry.title,
            folder: entry.folder,
            path: entry.path,
            content: body.trim().to_string(),
        })
    }

    pub async fn search(
        &self,
        query: &str,
        folders: &[String],
        limit: usize,
    ) -> Result<Vec<LoreSearchResult>, VaultError> {
        self.scan().await?;
        let entries = self.entries.read().await.clone();
        let selected = normalize_folders(folders);
        let tokens = tokenize(query);
        let query_lower = query.to_lowercase();
        let mut results = entries
            .into_iter()
            .filter(|entry| entry.enabled && folder_selected(&entry.folder, &selected))
            .map(|entry| {
                let score = bm25_score(&entry, &tokens)
                    + if !query_lower.is_empty()
                        && entry.content.to_lowercase().contains(&query_lower)
                    {
                        2.0
                    } else {
                        0.0
                    };
                let snippet = snippet_for(&entry.content, query);
                LoreSearchResult {
                    id: entry.id,
                    title: entry.title,
                    folder: entry.folder,
                    path: entry.path,
                    keys: entry.keys,
                    score,
                    snippet,
                }
            })
            .filter(|entry| {
                query.trim().is_empty()
                    || entry.score > 0.0
                    || entry.title.to_lowercase().contains(&query_lower)
            })
            .collect::<Vec<_>>();
        results.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
        });
        results.truncate(limit.clamp(1, 100));
        Ok(results)
    }

    pub async fn entries(&self, folder: Option<&str>) -> Result<Vec<LoreEntry>, VaultError> {
        if !*self.scanned.read().await {
            self.scan().await?;
        }
        let entries = self.entries.read().await;
        let prefix = folder.map(|value| value.trim_matches('/').replace('\\', "/"));
        Ok(entries
            .iter()
            .filter(|entry| {
                prefix
                    .as_ref()
                    .map(|prefix| {
                        prefix.is_empty()
                            || entry.folder == *prefix
                            || entry.folder.starts_with(&format!("{prefix}/"))
                    })
                    .unwrap_or(true)
            })
            .cloned()
            .collect())
    }

    pub async fn retrieve(
        &self,
        query: &str,
        folders: &[String],
        token_budget: u64,
        max_entries: usize,
    ) -> Result<LoreRetrieval, VaultError> {
        self.scan().await?;
        let entries = self.entries.read().await.clone();
        let query_lower = query.to_lowercase();
        let query_tokens = tokenize(query);
        let selected = normalize_folders(folders);
        let mut scored: Vec<(f64, &LoreEntry)> = Vec::new();

        for entry in &entries {
            if !entry.enabled || !folder_selected(&entry.folder, &selected) {
                continue;
            }
            if !entry.excludes.is_empty()
                && entry
                    .excludes
                    .iter()
                    .any(|needle| query_lower.contains(&needle.to_lowercase()))
            {
                continue;
            }
            if !entry.requires.is_empty()
                && !entry
                    .requires
                    .iter()
                    .all(|needle| query_lower.contains(&needle.to_lowercase()))
            {
                continue;
            }
            if entry.probability < 100 && !entry.constant {
                let roll = (stable_uid(&format!("{}:{query}", entry.id)) % 100) as u8;
                if roll >= entry.probability {
                    continue;
                }
            }
            let keyword = entry.constant
                || entry.keys.is_empty()
                || entry.keys.iter().any(|key| key_match(key, &query_lower))
                || entry
                    .regex_keys
                    .iter()
                    .any(|pattern| regex_match(pattern, query));
            let secondary = entry.secondary_keys.is_empty()
                || entry
                    .secondary_keys
                    .iter()
                    .any(|key| key_match(key, &query_lower))
                || entry
                    .regex_keys
                    .iter()
                    .any(|pattern| regex_match(pattern, query));
            if !keyword || !secondary {
                continue;
            }
            let score = if entry.constant {
                1_000_000.0 + entry.priority as f64
            } else {
                bm25_score(entry, &query_tokens) + entry.priority as f64
            };
            scored.push((score, entry));
        }

        scored.sort_by(|left, right| {
            right
                .0
                .partial_cmp(&left.0)
                .unwrap_or(Ordering::Equal)
                .then_with(|| right.1.priority.cmp(&left.1.priority))
                .then_with(|| {
                    left.1
                        .title
                        .to_lowercase()
                        .cmp(&right.1.title.to_lowercase())
                })
        });

        let mut used = 0u64;
        let mut selected_entries = Vec::new();
        for (_, entry) in scored {
            if selected_entries.len() >= max_entries {
                break;
            }
            if used + entry.token_estimate > token_budget && used > 0 {
                continue;
            }
            used += entry.token_estimate;
            selected_entries.push(entry.clone());
        }

        let mut before = Vec::new();
        let mut after = Vec::new();
        let mut depth = Vec::new();
        for entry in &selected_entries {
            let activation = LoreActivationEntry {
                id: entry.id.clone(),
                uid: stable_uid(&entry.id),
                title: entry.title.clone(),
                folder: entry.folder.clone(),
                content: entry.content.clone(),
                constant: entry.constant,
                position: entry.position.clone(),
                depth: entry.depth,
                role: entry.role.clone(),
                priority: entry.priority,
            };
            match entry.position.as_str() {
                "after" | "an_top" | "an_bottom" => after.push(activation),
                "depth" | "at_depth" => depth.push(activation),
                _ => before.push(activation),
            }
        }

        Ok(LoreRetrieval {
            before,
            after,
            depth,
            entries: selected_entries
                .iter()
                .map(|entry| LoreActivationEntry {
                    id: entry.id.clone(),
                    uid: stable_uid(&entry.id),
                    title: entry.title.clone(),
                    folder: entry.folder.clone(),
                    content: entry.content.clone(),
                    constant: entry.constant,
                    position: entry.position.clone(),
                    depth: entry.depth,
                    role: entry.role.clone(),
                    priority: entry.priority,
                })
                .collect(),
            tokens: used,
            scanned: entries.len(),
        })
    }

    pub async fn migrate_legacy(&self) -> Result<LoreMigrationReport, VaultError> {
        let lore_root = self.lore_root().await?;
        let marker = lore_root.join(".lore-migrated");
        let mut report = LoreMigrationReport::default();
        if marker.exists() {
            report.skipped = true;
            return Ok(report);
        }
        if !self.worlds_dir.exists() {
            return Ok(report);
        }
        let backup = self
            .worlds_dir
            .with_file_name(format!("backups/lorebooks-{}", unix_seconds()));
        std::fs::create_dir_all(&backup)?;
        let mut books = 0usize;
        let mut entries = 0usize;
        let mut folders = HashSet::new();
        for item in std::fs::read_dir(&self.worlds_dir)? {
            let item = item?;
            let path = item.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let raw = std::fs::read_to_string(&path)?;
            let value: JsonValue = serde_json::from_str(&raw)
                .map_err(|error| VaultError::io(format!("{}: {error}", path.display())))?;
            let book_name = path
                .file_stem()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "lorebook".to_string());
            let folder_name = sanitize_segment(&book_name);
            let target_dir = lore_root.join("global").join(&folder_name);
            std::fs::create_dir_all(&target_dir)?;
            let book_entries = value
                .get("entries")
                .and_then(JsonValue::as_object)
                .map(|entries| entries.values().cloned().collect::<Vec<_>>())
                .or_else(|| value.as_array().cloned())
                .unwrap_or_default();
            for (index, entry) in book_entries.iter().enumerate() {
                let Some(content) = entry
                    .get("content")
                    .and_then(JsonValue::as_str)
                    .filter(|content| !content.trim().is_empty())
                else {
                    continue;
                };
                let title = entry
                    .get("comment")
                    .and_then(JsonValue::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .map(ToString::to_string)
                    .unwrap_or_else(|| format!("{book_name} {}", index + 1));
                let uid = entry
                    .get("uid")
                    .and_then(JsonValue::as_i64)
                    .unwrap_or(index as i64);
                let filename = format!("{uid:04}-{}.md", sanitize_segment(&title));
                let frontmatter = yaml_for_migrated_entry(entry, &title);
                let body = format!("---\n{frontmatter}---\n\n{content}\n");
                std::fs::write(target_dir.join(filename), body)?;
                entries += 1;
            }
            std::fs::copy(&path, backup.join(item.file_name()))?;
            books += 1;
            folders.insert(folder_name);
        }
        if books > 0 {
            self.scan().await?;
            std::fs::write(&marker, b"migrated\n")?;
            report.books = books;
            report.entries = entries;
            report.folders = folders.len();
            report.backup = Some(backup.to_string_lossy().to_string());
        }
        Ok(report)
    }

    pub async fn migrate_character(
        &self,
        avatar: &str,
        book: JsonValue,
    ) -> Result<LoreMigrationReport, VaultError> {
        let lore_root = self.lore_root().await?;
        let folder_name = sanitize_segment(avatar);
        let target_dir = lore_root.join("characters").join(&folder_name);
        std::fs::create_dir_all(&target_dir)?;
        let entries = book
            .get("entries")
            .and_then(JsonValue::as_object)
            .map(|entries| entries.values().cloned().collect::<Vec<_>>())
            .or_else(|| book.as_array().cloned())
            .unwrap_or_default();
        let mut written = 0usize;
        for (index, entry) in entries.iter().enumerate() {
            let Some(content) = entry
                .get("content")
                .and_then(JsonValue::as_str)
                .filter(|content| !content.trim().is_empty())
            else {
                continue;
            };
            let title = entry
                .get("comment")
                .and_then(JsonValue::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("{avatar} {}", index + 1));
            let uid = entry
                .get("uid")
                .and_then(JsonValue::as_i64)
                .unwrap_or(index as i64);
            let filename = format!("{uid:04}-{}.md", sanitize_segment(&title));
            let target = target_dir.join(filename);
            if target.exists() {
                continue;
            }
            let body = format!(
                "---\n{}---\n\n{content}\n",
                yaml_for_migrated_entry(entry, &title)
            );
            std::fs::write(target, body)?;
            written += 1;
        }
        self.scan().await?;
        Ok(LoreMigrationReport {
            books: 1,
            entries: written,
            folders: 1,
            backup: None,
            skipped: false,
        })
    }
}

fn parse_entry(root: &Path, path: &Path) -> Result<LoreEntry, VaultError> {
    let raw = std::fs::read_to_string(path)?;
    let (frontmatter, body) = split_frontmatter(&raw);
    let map = frontmatter.unwrap_or_else(Mapping::new);
    let title = get_string(&map, &["title", "name"])
        .or_else(|| first_heading(&body))
        .unwrap_or_else(|| {
            path.file_stem()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "Untitled".to_string())
        });
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let folder = relative
        .rsplit_once('/')
        .map(|(parent, _)| format!("lore/{parent}"))
        .unwrap_or_else(|| "lore".to_string());
    let modified_ms = std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_millis()).ok());
    let content = body.trim().to_string();
    let token_estimate = ((content.chars().count() as f64) / 4.0).ceil() as u64;
    Ok(LoreEntry {
        id: relative.clone(),
        title,
        folder,
        path: relative,
        content,
        keys: get_strings(&map, &["keys", "key", "keywords"]),
        secondary_keys: get_strings(&map, &["secondary_keys", "secondaryKeys", "keysecondary"]),
        regex_keys: get_strings(&map, &["regex_keys", "regexKeys"]),
        requires: get_strings(&map, &["requires", "require"]),
        excludes: get_strings(&map, &["excludes", "exclude"]),
        constant: get_bool(&map, &["constant"]).unwrap_or(false),
        priority: get_i64(&map, &["priority", "order"]).unwrap_or(0),
        position: get_string(&map, &["position"]).unwrap_or_else(|| "before".to_string()),
        depth: get_i64(&map, &["depth"]).unwrap_or(4),
        role: get_string(&map, &["role"]).unwrap_or_else(|| "system".to_string()),
        probability: get_i64(&map, &["probability"]).unwrap_or(100).clamp(0, 100) as u8,
        enabled: get_bool(&map, &["enabled"])
            .unwrap_or_else(|| !get_bool(&map, &["disable"]).unwrap_or(false)),
        token_estimate,
        modified_ms,
    })
}

fn split_frontmatter(raw: &str) -> (Option<Mapping>, String) {
    let trimmed = raw.trim_start_matches('\u{feff}');
    if !trimmed.starts_with("---") {
        return (None, raw.to_string());
    }
    let rest = trimmed.strip_prefix("---").unwrap_or(trimmed);
    let Some(end) = rest.find("\n---") else {
        return (None, raw.to_string());
    };
    let yaml = &rest[..end];
    let body = rest[end + 4..].trim_start_matches(['\r', '\n']).to_string();
    let mapping = serde_yaml::from_str::<Mapping>(yaml.trim()).ok();
    (mapping, body)
}

fn get_value<'a>(map: &'a Mapping, names: &[&str]) -> Option<&'a YamlValue> {
    for name in names {
        if let Some(value) = map.get(YamlValue::String((*name).to_string())) {
            return Some(value);
        }
    }
    None
}

fn get_string(map: &Mapping, names: &[&str]) -> Option<String> {
    match get_value(map, names)? {
        YamlValue::String(value) if !value.trim().is_empty() => Some(value.trim().to_string()),
        YamlValue::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn get_strings(map: &Mapping, names: &[&str]) -> Vec<String> {
    match get_value(map, names) {
        Some(YamlValue::String(value)) => value
            .split(',')
            .map(|part| part.trim().to_string())
            .filter(|part| !part.is_empty())
            .collect(),
        Some(YamlValue::Sequence(values)) => values
            .iter()
            .filter_map(|value| match value {
                YamlValue::String(value) => Some(value.trim().to_string()),
                _ => None,
            })
            .filter(|value| !value.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

fn get_bool(map: &Mapping, names: &[&str]) -> Option<bool> {
    match get_value(map, names)? {
        YamlValue::Bool(value) => Some(*value),
        YamlValue::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn get_i64(map: &Mapping, names: &[&str]) -> Option<i64> {
    match get_value(map, names)? {
        YamlValue::Number(value) => value.as_i64(),
        YamlValue::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn first_heading(body: &str) -> Option<String> {
    body.lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn tokenize(value: &str) -> Vec<String> {
    value
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| token.len() > 1)
        .map(ToString::to_string)
        .collect()
}

fn bm25_score(entry: &LoreEntry, query_tokens: &[String]) -> f64 {
    if query_tokens.is_empty() {
        return entry.priority as f64;
    }
    let body = entry.content.to_lowercase();
    let title = entry.title.to_lowercase();
    let mut score = 0.0;
    for token in query_tokens {
        if title.contains(token) {
            score += 4.0;
        }
        if entry.keys.iter().any(|key| key.to_lowercase() == *token) {
            score += 3.0;
        }
        if body.contains(token) {
            score += 1.0;
        }
    }
    score
}

fn key_match(key: &str, query: &str) -> bool {
    let key = key.trim().to_lowercase();
    !key.is_empty() && query.contains(&key)
}

fn regex_match(pattern: &str, query: &str) -> bool {
    Regex::new(pattern)
        .map(|regex| regex.is_match(query))
        .unwrap_or(false)
}

fn snippet_for(content: &str, query: &str) -> String {
    let normalized = content.replace(['\r', '\n'], " ");
    let compact = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= 220 {
        return compact;
    }
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return compact.chars().take(220).collect::<String>();
    }
    let lower = compact.to_lowercase();
    if let Some(index) = lower.find(&needle) {
        let start = compact[..index]
            .char_indices()
            .rev()
            .nth(60)
            .map(|(offset, _)| offset)
            .unwrap_or(0);
        return compact[start..].chars().take(220).collect::<String>();
    }
    compact.chars().take(220).collect::<String>()
}

fn normalize_folders(folders: &[String]) -> Vec<String> {
    folders
        .iter()
        .map(|folder| folder.trim_matches('/').replace('\\', "/"))
        .filter(|folder| !folder.is_empty())
        .collect()
}

fn folder_selected(folder: &str, selected: &[String]) -> bool {
    selected.is_empty()
        || selected
            .iter()
            .any(|prefix| folder == prefix || folder.starts_with(&format!("{prefix}/")))
}

fn load_ignore(root: &Path) -> Vec<String> {
    std::fs::read_to_string(root.join(".vaultignore"))
        .ok()
        .map(|raw| {
            raw.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty() && !line.starts_with('#'))
                .map(|line| line.trim_start_matches('/').to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn is_ignored(path: &Path, root: &Path, patterns: &[String]) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path);
    if relative.components().any(|component| {
        let value = component.as_os_str().to_string_lossy();
        value.starts_with('.') && value != "."
    }) {
        return true;
    }
    let relative = relative.to_string_lossy().replace('\\', "/");
    patterns.iter().any(|pattern| {
        if let Some(prefix) = pattern.strip_suffix('*') {
            relative.starts_with(prefix)
        } else if let Some(suffix) = pattern.strip_prefix('*') {
            relative.ends_with(suffix)
        } else {
            relative == *pattern || relative.starts_with(&format!("{pattern}/"))
        }
    })
}

fn sanitize_segment(value: &str) -> String {
    let mut output = String::new();
    for character in value.chars() {
        if character.is_alphanumeric() || character == '-' || character == '_' {
            output.push(character.to_ascii_lowercase());
        } else if character.is_whitespace() {
            output.push('-');
        }
    }
    let trimmed = output.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "lore".to_string()
    } else {
        trimmed
    }
}

fn stable_uid(id: &str) -> i64 {
    let mut hash = 1469598103934665603u64;
    for byte in id.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    (hash % i64::MAX as u64) as i64
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn yaml_for_migrated_entry(entry: &JsonValue, title: &str) -> String {
    let raw_keys = entry
        .get("key")
        .and_then(JsonValue::as_str)
        .map(ToString::to_string)
        .unwrap_or_default();
    let raw_secondary = entry
        .get("keysecondary")
        .and_then(JsonValue::as_str)
        .map(ToString::to_string)
        .unwrap_or_default();
    let (keys, regex_keys) = split_keys(&raw_keys);
    let (secondary, secondary_regex) = split_keys(&raw_secondary);
    let mut map = Mapping::new();
    map.insert(
        YamlValue::String("title".into()),
        YamlValue::String(title.to_string()),
    );
    map.insert(
        YamlValue::String("keys".into()),
        YamlValue::String(keys.join(", ")),
    );
    map.insert(
        YamlValue::String("secondary_keys".into()),
        YamlValue::String(secondary.join(", ")),
    );
    if !regex_keys.is_empty() || !secondary_regex.is_empty() {
        let mut all = regex_keys;
        all.extend(secondary_regex);
        map.insert(
            YamlValue::String("regex_keys".into()),
            YamlValue::String(all.join(", ")),
        );
    }
    map.insert(
        YamlValue::String("constant".into()),
        YamlValue::Bool(
            entry
                .get("constant")
                .and_then(JsonValue::as_bool)
                .unwrap_or(false),
        ),
    );
    map.insert(
        YamlValue::String("priority".into()),
        YamlValue::Number(
            entry
                .get("order")
                .and_then(JsonValue::as_i64)
                .unwrap_or(0)
                .into(),
        ),
    );
    let position = entry
        .get("position")
        .and_then(JsonValue::as_i64)
        .unwrap_or(0);
    map.insert(
        YamlValue::String("position".into()),
        YamlValue::String(
            match position {
                1 => "after",
                2 => "an_top",
                3 => "an_bottom",
                4 => "depth",
                _ => "before",
            }
            .to_string(),
        ),
    );
    map.insert(
        YamlValue::String("depth".into()),
        YamlValue::Number(
            entry
                .get("depth")
                .and_then(JsonValue::as_i64)
                .unwrap_or(4)
                .into(),
        ),
    );
    map.insert(
        YamlValue::String("role".into()),
        YamlValue::String(
            entry
                .get("role")
                .and_then(JsonValue::as_str)
                .unwrap_or("system")
                .to_string(),
        ),
    );
    map.insert(
        YamlValue::String("probability".into()),
        YamlValue::Number(
            entry
                .get("probability")
                .and_then(JsonValue::as_i64)
                .unwrap_or(100)
                .into(),
        ),
    );
    map.insert(
        YamlValue::String("enabled".into()),
        YamlValue::Bool(
            !entry
                .get("disable")
                .and_then(JsonValue::as_bool)
                .unwrap_or(false),
        ),
    );
    let mut extensions = Mapping::new();
    extensions.insert(
        YamlValue::String("sillytavern".into()),
        serde_yaml::to_value(entry).unwrap_or(YamlValue::Null),
    );
    map.insert(
        YamlValue::String("extensions".into()),
        YamlValue::Mapping(extensions),
    );
    serde_yaml::to_string(&map).unwrap_or_default()
}

fn split_keys(raw: &str) -> (Vec<String>, Vec<String>) {
    let mut plain = Vec::new();
    let mut regex = Vec::new();
    for part in raw.split(',') {
        let value = part.trim();
        if value.is_empty() {
            continue;
        }
        if let Some((pattern, flags)) = parse_regex_key(value) {
            regex.push(if flags.contains('i') {
                format!("(?i){pattern}")
            } else {
                pattern
            });
        } else {
            plain.push(value.to_string());
        }
    }
    (plain, regex)
}

fn parse_regex_key(value: &str) -> Option<(String, String)> {
    if !value.starts_with('/') {
        return None;
    }
    let end = value.rfind('/')?;
    if end == 0 {
        return None;
    }
    let pattern = value[1..end].to_string();
    let flags = value[end + 1..].to_string();
    if flags.chars().any(|flag| !"imsxU".contains(flag)) {
        return None;
    }
    Some((pattern, flags))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_entry(root: &Path, folder: &str, name: &str, body: &str) {
        let dir = root.join("lore").join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), body).unwrap();
    }

    #[test]
    fn parses_frontmatter_and_filters_folders() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        write_entry(
            root,
            "global",
            "world.md",
            "---\ntitle: World\nkeys: [dragon]\nconstant: true\n---\nDragons rule.\n",
        );
        write_entry(
            root,
            "characters/hero",
            "hero.md",
            "---\ntitle: Hero\nkeys: [hero]\n---\nA hero.\n",
        );
        let entries = vec![
            parse_entry(
                root.join("lore").as_path(),
                &root.join("lore/global/world.md"),
            )
            .unwrap(),
        ];
        assert_eq!(entries[0].title, "World");
        assert!(entries[0].constant);
        assert!(folder_selected(
            "lore/global",
            &normalize_folders(&["lore/global".to_string()])
        ));
        assert!(!folder_selected(
            "lore/characters/hero",
            &normalize_folders(&["lore/global".to_string()])
        ));
    }

    #[tokio::test]
    async fn retrieval_scopes_to_selected_folders() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("vault");
        std::fs::create_dir_all(root.join("lore/global")).unwrap();
        std::fs::create_dir_all(root.join("lore/characters/hero")).unwrap();
        std::fs::write(
            root.join("lore/global/world.md"),
            "---\ntitle: World\nkeys: [dragon]\n---\nDragons rule.\n",
        )
        .unwrap();
        std::fs::write(
            root.join("lore/global/rules.md"),
            "---\ntitle: Rules\nconstant: true\n---\nAlways active.\n",
        )
        .unwrap();
        std::fs::write(
            root.join("lore/characters/hero/hero.md"),
            "---\ntitle: Hero\nkeys: [dragon]\n---\nA hero.\n",
        )
        .unwrap();
        let vault = LocalVault::load(temp.path().join("vault.json"));
        vault.add_mount(root.to_str().unwrap(), None).await.unwrap();
        let lore = LoreDirectory::new(Arc::new(vault), temp.path().to_path_buf());
        let result = lore
            .retrieve("dragon", &["lore/global".to_string()], 2048, 20)
            .await
            .unwrap();
        assert!(result.before.iter().any(|entry| entry.title == "World"));
        assert!(result.before.iter().any(|entry| entry.title == "Rules"));
        assert!(!result.before.iter().any(|entry| entry.title == "Hero"));
        let all = lore.entries(None).await.unwrap();
        assert_eq!(all.len(), 3);
    }

    #[tokio::test]
    async fn read_and_search_stay_inside_lore() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("vault");
        std::fs::create_dir_all(root.join("lore/global")).unwrap();
        std::fs::write(
            root.join("lore/global/world.md"),
            "---\ntitle: World\nkeys: [dragon]\n---\nDragons rule.\n",
        )
        .unwrap();
        let vault = LocalVault::load(temp.path().join("vault.json"));
        vault.add_mount(root.to_str().unwrap(), None).await.unwrap();
        let lore = LoreDirectory::new(Arc::new(vault), temp.path().to_path_buf());
        let entry = lore.read_entry("global/world.md").await.unwrap();
        assert_eq!(entry.title, "World");
        assert_eq!(entry.content, "Dragons rule.");
        assert!(lore.read_entry("../vault.json").await.is_err());
        let hits = lore
            .search("dragon", &["lore/global".to_string()], 10)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "World");
    }

    #[tokio::test]
    async fn character_migration_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("vault");
        std::fs::create_dir_all(&root).unwrap();
        let vault = LocalVault::load(temp.path().join("vault.json"));
        vault.add_mount(root.to_str().unwrap(), None).await.unwrap();
        let lore = LoreDirectory::new(Arc::new(vault), temp.path().to_path_buf());
        let book = serde_json::json!({
            "entries": {
                "0": { "uid": 1, "comment": "Hero", "key": "hero", "content": "A hero." }
            }
        });
        let first = lore.migrate_character("hero", book.clone()).await.unwrap();
        assert_eq!(first.entries, 1);
        let second = lore.migrate_character("hero", book).await.unwrap();
        assert_eq!(second.entries, 0);
        let result = lore
            .retrieve("hero", &["lore/characters/hero".to_string()], 2048, 20)
            .await
            .unwrap();
        assert!(result.before.iter().any(|entry| entry.title == "Hero"));
    }

    #[tokio::test]
    async fn migration_keeps_regex_keys_and_extensions() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("vault");
        let worlds = temp.path().join("default-user/worlds");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&worlds).unwrap();
        std::fs::write(
            worlds.join("Book.json"),
            r#"{"entries":{"0":{"uid":7,"comment":"Gate","key":"/gate/i, city","content":"A gate.","sticky":3}}}"#,
        )
        .unwrap();
        let vault = LocalVault::load(temp.path().join("vault.json"));
        vault.add_mount(root.to_str().unwrap(), None).await.unwrap();
        let lore = LoreDirectory::new(Arc::new(vault), temp.path().to_path_buf());
        let report = lore.migrate_legacy().await.unwrap();
        assert_eq!(report.books, 1);
        let backup = report.backup.expect("backup path");
        assert!(std::path::Path::new(&backup).join("Book.json").is_file());
        let markdown = std::fs::read_to_string(root.join("lore/global/book/0007-gate.md")).unwrap();
        assert!(markdown.contains("regex_keys"));
        assert!(markdown.contains("extensions"));
        assert!(markdown.contains("sticky"));
        let result = lore
            .retrieve("gate", &["lore/global".to_string()], 2048, 20)
            .await
            .unwrap();
        assert!(result.before.iter().any(|entry| entry.title == "Gate"));
    }
}
