mod hooks;
mod parsing;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use tt_domain::models::customize::{
    CustomizationItem, CustomizationKind, CustomizationScope, CustomizationSource,
    CustomizationSurface, CustomizeContext, CustomizeSaveRequest, CustomizeSnapshot,
    CustomizeWarning, HookConfig, HookDispatchResult, HookEventPayload, HookLogEntry,
    HookRunRequest,
};

pub use hooks::HookError;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeStore {
    #[serde(default)]
    items: Vec<CustomizationItem>,
    #[serde(default)]
    hook_config: Option<HookConfig>,
    #[serde(default)]
    trusted_hooks: BTreeMap<String, String>,
    #[serde(default)]
    hook_logs: Vec<HookLogEntry>,
}

#[derive(Clone)]
pub struct CustomizeService {
    root: Arc<PathBuf>,
    plugin_roots: Arc<Vec<PathBuf>>,
    store: Arc<RwLock<NativeStore>>,
}

impl CustomizeService {
    pub fn new(root: PathBuf, plugin_roots: Vec<PathBuf>) -> Self {
        Self {
            root: Arc::new(root),
            plugin_roots: Arc::new(plugin_roots),
            store: Arc::new(RwLock::new(NativeStore::default())),
        }
    }

    fn store_path(&self) -> PathBuf {
        self.root.join("store.json")
    }

    async fn load_store(&self) -> Result<NativeStore, String> {
        let path = self.store_path();
        if !path.exists() {
            return Ok(NativeStore::default());
        }
        let data = tokio::fs::read_to_string(&path)
            .await
            .map_err(|error| format!("read customize store: {error}"))?;
        serde_json::from_str(&data).map_err(|error| format!("parse customize store: {error}"))
    }

    async fn save_store(&self, store: &NativeStore) -> Result<(), String> {
        tokio::fs::create_dir_all(self.root.as_ref())
            .await
            .map_err(|error| format!("create customize directory: {error}"))?;
        let data = serde_json::to_string_pretty(store)
            .map_err(|error| format!("serialize customize store: {error}"))?;
        tokio::fs::write(self.store_path(), data)
            .await
            .map_err(|error| format!("write customize store: {error}"))
    }

    async fn store(&self) -> Result<NativeStore, String> {
        let cached = self.store.read().await;
        if !cached.items.is_empty()
            || cached.hook_config.is_some()
            || !cached.trusted_hooks.is_empty()
            || !cached.hook_logs.is_empty()
        {
            return Ok(NativeStore {
                items: cached.items.clone(),
                hook_config: cached.hook_config.clone(),
                trusted_hooks: cached.trusted_hooks.clone(),
                hook_logs: cached.hook_logs.clone(),
            });
        }
        drop(cached);
        let store = self.load_store().await?;
        *self.store.write().await = NativeStore {
            items: store.items.clone(),
            hook_config: store.hook_config.clone(),
            trusted_hooks: store.trusted_hooks.clone(),
            hook_logs: store.hook_logs.clone(),
        };
        Ok(store)
    }

    pub async fn snapshot(&self, vault_root: Option<&str>) -> Result<CustomizeSnapshot, String> {
        let mut store = self.store().await?;
        let mut warnings = Vec::new();
        let mut items = std::mem::take(&mut store.items);
        let mut hook_config = store.hook_config.clone();
        let mut vault_relative_hooks = None;

        if let Some(vault_root) = vault_root.map(str::trim).filter(|value| !value.is_empty()) {
            let root = PathBuf::from(vault_root);
            if !root.is_dir() {
                warnings.push(CustomizeWarning {
                    path: root.display().to_string(),
                    message: "Vault root does not exist.".to_string(),
                });
            } else {
                let (vault_items, scan_warnings) = self.scan_vault(&root).await;
                items.extend(vault_items);
                warnings.extend(scan_warnings);
                if let Ok(Some(config)) = self.read_vault_hook_config(&root).await {
                    hook_config = Some(config);
                    vault_relative_hooks = Some(root);
                }
            }
        }

        let (plugin_items, plugin_warnings) = self.scan_plugins().await;
        items.extend(plugin_items);
        warnings.extend(plugin_warnings);
        let items = merge_items(items);
        let hook_trusted = self.is_trusted(&hook_config, vault_relative_hooks.as_deref(), &store);
        Ok(CustomizeSnapshot {
            items,
            warnings,
            hook_config,
            hook_trusted,
        })
    }

    async fn scan_plugins(&self) -> (Vec<CustomizationItem>, Vec<CustomizeWarning>) {
        let mut items = Vec::new();
        let mut warnings = Vec::new();
        for plugin_root in self.plugin_roots.iter() {
            if !plugin_root.is_dir() {
                continue;
            }
            let Ok(mut entries) = tokio::fs::read_dir(plugin_root).await else {
                continue;
            };
            while let Ok(Some(entry)) = entries.next_entry().await {
                if !entry
                    .file_type()
                    .await
                    .map(|kind| kind.is_dir())
                    .unwrap_or(false)
                {
                    continue;
                }
                let extension_root = entry.path();
                let manifest_path = extension_root.join("manifest.json");
                if !manifest_path.is_file() {
                    continue;
                }
                let manifest = match tokio::fs::read_to_string(&manifest_path).await {
                    Ok(data) => serde_json::from_str::<serde_json::Value>(&data).ok(),
                    Err(error) => {
                        warnings.push(warning(&manifest_path, error));
                        None
                    }
                };
                let Some(manifest) = manifest else {
                    continue;
                };
                let plugin_id = entry.file_name().to_string_lossy().to_string();
                let plugin_name = manifest
                    .get("display_name")
                    .or_else(|| manifest.get("displayName"))
                    .or_else(|| manifest.get("name"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(&plugin_id)
                    .to_string();
                let Some(customize) = manifest
                    .get("customize")
                    .and_then(serde_json::Value::as_object)
                else {
                    continue;
                };
                items.push(CustomizationItem {
                    id: format!("plugin:{plugin_id}"),
                    kind: CustomizationKind::Plugin,
                    name: plugin_name.clone(),
                    description: manifest
                        .get("description")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("TauriTavern extension")
                        .to_string(),
                    body: String::new(),
                    path: Some(relative_path(&extension_root, &manifest_path)),
                    scope: CustomizationScope::Plugin,
                    source: CustomizationSource::Plugin,
                    surfaces: default_surfaces(CustomizationKind::Plugin),
                    enabled: true,
                    always_apply: false,
                    globs: Vec::new(),
                    plugin_id: Some(plugin_id.clone()),
                    read_only: true,
                    metadata: BTreeMap::new(),
                });
                for (key, kind) in [
                    ("rules", CustomizationKind::Rule),
                    ("skills", CustomizationKind::Skill),
                    ("agents", CustomizationKind::Agent),
                    ("commands", CustomizationKind::Command),
                ] {
                    let Some(paths) = customize.get(key).and_then(serde_json::Value::as_array)
                    else {
                        continue;
                    };
                    for relative in paths.iter().filter_map(serde_json::Value::as_str) {
                        let path = match self.safe_plugin_path(&extension_root, relative) {
                            Ok(path) => path,
                            Err(error) => {
                                warnings.push(CustomizeWarning {
                                    path: extension_root.display().to_string(),
                                    message: error,
                                });
                                continue;
                            }
                        };
                        let mut files = Vec::new();
                        if path.is_dir() {
                            self.collect_markdown_files(&path, &mut files).await;
                        } else if path.is_file() {
                            files.push(path);
                        }
                        for file in files {
                            let body = match tokio::fs::read_to_string(&file).await {
                                Ok(body) => body,
                                Err(error) => {
                                    warnings.push(warning(&file, error));
                                    continue;
                                }
                            };
                            let mut item = file_item(&extension_root, &file, kind, "plugin", &body);
                            item.id = format!("plugin:{plugin_id}:{}:{key}", item.id);
                            item.scope = CustomizationScope::Plugin;
                            item.source = CustomizationSource::Plugin;
                            item.plugin_id = Some(plugin_id.clone());
                            item.read_only = true;
                            item.name = format!("{} — {}", plugin_name, item.name);
                            items.push(item);
                        }
                    }
                }
                if let Some(hooks) = customize.get("hooks").and_then(serde_json::Value::as_str) {
                    match self.safe_plugin_path(&extension_root, hooks) {
                        Ok(path) if path.is_file() => {
                            if let Ok(body) = tokio::fs::read_to_string(&path).await {
                                items.push(CustomizationItem {
                                    id: format!("plugin:{plugin_id}:hooks"),
                                    kind: CustomizationKind::Hook,
                                    name: format!("{plugin_name} hooks"),
                                    description: "Plugin hook configuration (requires trust)"
                                        .to_string(),
                                    body,
                                    path: Some(relative_path(&extension_root, &path)),
                                    scope: CustomizationScope::Plugin,
                                    source: CustomizationSource::Plugin,
                                    surfaces: default_surfaces(CustomizationKind::Hook),
                                    enabled: false,
                                    always_apply: false,
                                    globs: Vec::new(),
                                    plugin_id: Some(plugin_id.clone()),
                                    read_only: true,
                                    metadata: BTreeMap::new(),
                                });
                            }
                        }
                        Ok(_) => {}
                        Err(error) => warnings.push(CustomizeWarning {
                            path: extension_root.display().to_string(),
                            message: error,
                        }),
                    }
                }
            }
        }
        (items, warnings)
    }

    fn safe_plugin_path(&self, root: &Path, relative: &str) -> Result<PathBuf, String> {
        let candidate = root.join(relative);
        let canonical_root = std::fs::canonicalize(root)
            .map_err(|error| format!("invalid extension root: {error}"))?;
        let canonical = std::fs::canonicalize(&candidate)
            .map_err(|error| format!("invalid plugin customization path: {error}"))?;
        if !canonical.starts_with(&canonical_root) {
            return Err("plugin customization path escapes the extension directory".to_string());
        }
        Ok(canonical)
    }

    async fn collect_markdown_files(&self, directory: &Path, files: &mut Vec<PathBuf>) {
        let mut stack = vec![directory.to_path_buf()];
        while let Some(current) = stack.pop() {
            let Ok(mut entries) = tokio::fs::read_dir(&current).await else {
                continue;
            };
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let Ok(file_type) = entry.file_type().await else {
                    continue;
                };
                if file_type.is_dir() {
                    stack.push(path);
                } else if matches!(
                    path.extension().and_then(|value| value.to_str()),
                    Some("md" | "mdc")
                ) {
                    files.push(path);
                }
            }
        }
    }

    async fn scan_vault(&self, root: &Path) -> (Vec<CustomizationItem>, Vec<CustomizeWarning>) {
        let cursor = root.join(".cursor");
        let mut items = Vec::new();
        let mut warnings = Vec::new();

        let agents_file = root.join("AGENTS.md");
        if agents_file.is_file() {
            match tokio::fs::read_to_string(&agents_file).await {
                Ok(body) => {
                    items.push(file_item(
                        root,
                        &agents_file,
                        CustomizationKind::Rule,
                        "AGENTS.md",
                        &body,
                    ));
                }
                Err(error) => warnings.push(warning(&agents_file, error)),
            }
        }

        let rules_dir = cursor.join("rules");
        self.scan_markdown_dir(
            root,
            &rules_dir,
            CustomizationKind::Rule,
            &mut items,
            &mut warnings,
            true,
        )
        .await;
        let agents_dir = cursor.join("agents");
        self.scan_markdown_dir(
            root,
            &agents_dir,
            CustomizationKind::Agent,
            &mut items,
            &mut warnings,
            false,
        )
        .await;
        let commands_dir = cursor.join("commands");
        self.scan_markdown_dir(
            root,
            &commands_dir,
            CustomizationKind::Command,
            &mut items,
            &mut warnings,
            false,
        )
        .await;

        let skills_dir = cursor.join("skills");
        if skills_dir.is_dir() {
            if let Ok(mut entries) = tokio::fs::read_dir(&skills_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path().join("SKILL.md");
                    if !path.is_file() {
                        continue;
                    }
                    match tokio::fs::read_to_string(&path).await {
                        Ok(body) => items.push(file_item(
                            root,
                            &path,
                            CustomizationKind::Skill,
                            entry.file_name().to_string_lossy().as_ref(),
                            &body,
                        )),
                        Err(error) => warnings.push(warning(&path, error)),
                    }
                }
            }
        }

        let mcp_path = cursor.join("mcp.json");
        if mcp_path.is_file() {
            match tokio::fs::read_to_string(&mcp_path).await {
                Ok(body) => {
                    let mut item =
                        file_item(root, &mcp_path, CustomizationKind::Mcp, "mcp.json", &body);
                    item.surfaces = vec![
                        CustomizationSurface::NativeAgent,
                        CustomizationSurface::Copilot,
                        CustomizationSurface::Deeplore,
                    ];
                    items.push(item);
                }
                Err(error) => warnings.push(warning(&mcp_path, error)),
            }
        }

        (items, warnings)
    }

    async fn scan_markdown_dir(
        &self,
        root: &Path,
        directory: &Path,
        kind: CustomizationKind,
        items: &mut Vec<CustomizationItem>,
        warnings: &mut Vec<CustomizeWarning>,
        recursive: bool,
    ) {
        if !directory.is_dir() {
            return;
        }
        let mut stack = vec![directory.to_path_buf()];
        while let Some(current) = stack.pop() {
            let Ok(mut entries) = tokio::fs::read_dir(&current).await else {
                continue;
            };
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let Ok(file_type) = entry.file_type().await else {
                    continue;
                };
                if file_type.is_dir() {
                    if recursive {
                        stack.push(path);
                    }
                    continue;
                }
                if !matches!(
                    path.extension().and_then(|value| value.to_str()),
                    Some("md" | "mdc")
                ) {
                    continue;
                }
                let name = path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("untitled");
                match tokio::fs::read_to_string(&path).await {
                    Ok(body) => items.push(file_item(root, &path, kind, name, &body)),
                    Err(error) => warnings.push(warning(&path, error)),
                }
            }
        }
    }

    pub async fn context(
        &self,
        surface: CustomizationSurface,
        vault_root: Option<&str>,
    ) -> Result<CustomizeContext, String> {
        let snapshot = self.snapshot(vault_root).await?;
        let mut context = CustomizeContext::default();
        for item in snapshot
            .items
            .into_iter()
            .filter(|item| item.applies_to(surface))
        {
            match item.kind {
                CustomizationKind::Rule => context.rules.push(item),
                CustomizationKind::Skill => context.skills.push(item),
                CustomizationKind::Agent => context.agents.push(item),
                CustomizationKind::Command => context.commands.push(item),
                _ => {}
            }
        }
        context
            .rules
            .sort_by(|left, right| right.always_apply.cmp(&left.always_apply));
        Ok(context)
    }

    pub async fn save_item(
        &self,
        request: CustomizeSaveRequest,
    ) -> Result<CustomizationItem, String> {
        if request.name.trim().is_empty() {
            return Err("name is required".to_string());
        }
        let surfaces = if request.surfaces.is_empty() {
            default_surfaces(request.kind)
        } else {
            request.surfaces.clone()
        };
        let mut store = self.store().await?;
        if request.scope == CustomizationScope::Vault {
            let root = request
                .vault_root
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "vaultRoot is required for a vault customization".to_string())?;
            let root = PathBuf::from(root);
            let path = self.vault_write_path(&root, &request)?;
            let body = format_body(&request, &surfaces);
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|error| format!("create customization directory: {error}"))?;
            }
            tokio::fs::write(&path, &body)
                .await
                .map_err(|error| format!("write customization: {error}"))?;
            let body = self
                .scan_vault(&root)
                .await
                .0
                .into_iter()
                .find(|item| item.path.as_deref() == Some(relative_path(&root, &path).as_str()))
                .ok_or_else(|| "saved customization could not be scanned".to_string())?;
            return Ok(body);
        }
        let id = request.id.clone().unwrap_or_else(|| {
            format!(
                "native:{}:{}",
                kind_name(request.kind),
                parsing::slugify(&request.name)
            )
        });
        let item = CustomizationItem {
            id: id.clone(),
            kind: request.kind,
            name: request.name,
            description: request.description,
            body: request.body,
            path: None,
            scope: request.scope,
            source: CustomizationSource::Native,
            surfaces,
            enabled: request.enabled,
            always_apply: request.always_apply,
            globs: request.globs,
            plugin_id: None,
            read_only: false,
            metadata: BTreeMap::new(),
        };
        if let Some(existing) = store.items.iter_mut().find(|candidate| candidate.id == id) {
            *existing = item.clone();
        } else {
            store.items.push(item.clone());
        }
        self.save_store(&store).await?;
        *self.store.write().await = store;
        Ok(item)
    }

    pub async fn delete_item(&self, id: &str, vault_root: Option<&str>) -> Result<(), String> {
        let mut store = self.store().await?;
        if let Some(index) = store.items.iter().position(|item| item.id == id) {
            store.items.remove(index);
            self.save_store(&store).await?;
            *self.store.write().await = store;
            return Ok(());
        }
        let Some(vault_root) = vault_root.map(str::trim).filter(|value| !value.is_empty()) else {
            return Err("customization not found".to_string());
        };
        let snapshot = self.snapshot(Some(vault_root)).await?;
        let item = snapshot
            .items
            .iter()
            .find(|item| item.id == id)
            .ok_or_else(|| "customization not found".to_string())?;
        let path =
            self.resolve_vault_path(Path::new(vault_root), item.path.as_deref().unwrap_or(""))?;
        tokio::fs::remove_file(&path)
            .await
            .map_err(|error| format!("delete customization: {error}"))
    }

    pub async fn set_enabled(&self, id: &str, enabled: bool) -> Result<CustomizationItem, String> {
        let mut store = self.store().await?;
        let item = store
            .items
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| "only native customizations can be toggled".to_string())?;
        item.enabled = enabled;
        let item = item.clone();
        self.save_store(&store).await?;
        *self.store.write().await = store;
        Ok(item)
    }

    pub async fn hook_config(
        &self,
        vault_root: Option<&str>,
    ) -> Result<Option<HookConfig>, String> {
        if let Some(root) = vault_root.map(str::trim).filter(|value| !value.is_empty()) {
            if let Some(config) = self.read_vault_hook_config(Path::new(root)).await? {
                return Ok(Some(config));
            }
        }
        Ok(self.store().await?.hook_config)
    }

    async fn read_vault_hook_config(&self, root: &Path) -> Result<Option<HookConfig>, String> {
        let path = root.join(".cursor").join("hooks.json");
        if !path.is_file() {
            return Ok(None);
        }
        let data = tokio::fs::read_to_string(&path)
            .await
            .map_err(|error| format!("read hooks.json: {error}"))?;
        serde_json::from_str(&data)
            .map(Some)
            .map_err(|error| format!("parse hooks.json: {error}"))
    }

    pub async fn save_hook_config(
        &self,
        config: HookConfig,
        vault_root: Option<&str>,
    ) -> Result<HookConfig, String> {
        if let Some(root) = vault_root.map(str::trim).filter(|value| !value.is_empty()) {
            let cursor = Path::new(root).join(".cursor");
            tokio::fs::create_dir_all(&cursor)
                .await
                .map_err(|error| format!("create .cursor directory: {error}"))?;
            let data = serde_json::to_string_pretty(&config)
                .map_err(|error| format!("serialize hooks.json: {error}"))?;
            tokio::fs::write(cursor.join("hooks.json"), data)
                .await
                .map_err(|error| format!("write hooks.json: {error}"))?;
            return Ok(config);
        }
        let mut store = self.store().await?;
        store.hook_config = Some(config.clone());
        self.save_store(&store).await?;
        *self.store.write().await = store;
        Ok(config)
    }

    pub async fn trust_hooks(&self, vault_root: Option<&str>) -> Result<bool, String> {
        let config = self
            .hook_config(vault_root)
            .await?
            .ok_or_else(|| "no hook configuration to trust".to_string())?;
        let key = trust_key(vault_root);
        let hash = config_hash(&config)?;
        let mut store = self.store().await?;
        store.trusted_hooks.insert(key, hash);
        self.save_store(&store).await?;
        *self.store.write().await = store;
        Ok(true)
    }

    fn is_trusted(
        &self,
        config: &Option<HookConfig>,
        vault_root: Option<&Path>,
        store: &NativeStore,
    ) -> bool {
        let Some(config) = config else {
            return false;
        };
        let Ok(hash) = config_hash(config) else {
            return false;
        };
        store
            .trusted_hooks
            .get(&trust_key(vault_root.and_then(Path::to_str)))
            .is_some_and(|trusted| trusted == &hash)
    }

    pub async fn run_hook(&self, request: HookRunRequest) -> Result<HookDispatchResult, String> {
        let config = self
            .hook_config(request.vault_root.as_deref())
            .await?
            .unwrap_or_else(hooks::empty_config);
        if !config.hooks.contains_key(&request.event) {
            return Ok(HookDispatchResult::allow());
        }
        let trusted = self
            .snapshot(request.vault_root.as_deref())
            .await?
            .hook_trusted;
        if !request.test && !trusted {
            return Err(
                "hook configuration is not trusted; trust it in Customize > Hooks".to_string(),
            );
        }
        let payload: HookEventPayload =
            hooks::payload_from_value(&request.event, &request.surface, request.payload.clone());
        let results = hooks::dispatch(&config, &payload)
            .await
            .map_err(|error| error.to_string())?;
        let mut store = self.store().await?;
        for matcher in config.hooks.get(&request.event).into_iter().flatten() {
            if let Some(result) = results.iter().find(|result| {
                result.matcher == matcher.matcher && result.hook_event_name == request.event
            }) {
                store.hook_logs.push(hooks::summarize_log(
                    &request.event,
                    &request.surface,
                    &matcher.command,
                    result,
                ));
            }
        }
        if store.hook_logs.len() > 200 {
            let drain = store.hook_logs.len() - 200;
            store.hook_logs.drain(0..drain);
        }
        self.save_store(&store).await?;
        *self.store.write().await = store;
        Ok(hooks::merge_results(&request.event, results))
    }

    pub async fn hook_logs(&self) -> Result<Vec<HookLogEntry>, String> {
        let mut logs = self.store().await?.hook_logs;
        logs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(logs)
    }

    fn vault_write_path(
        &self,
        root: &Path,
        request: &CustomizeSaveRequest,
    ) -> Result<PathBuf, String> {
        let slug = parsing::slugify(&request.name);
        if slug.is_empty() {
            return Err("name must contain at least one letter or digit".to_string());
        }
        let relative = match request.kind {
            CustomizationKind::Rule => format!(".cursor/rules/{slug}.mdc"),
            CustomizationKind::Skill => format!(".cursor/skills/{slug}/SKILL.md"),
            CustomizationKind::Agent => format!(".cursor/agents/{slug}.md"),
            CustomizationKind::Command => format!(".cursor/commands/{slug}.md"),
            CustomizationKind::Mcp => ".cursor/mcp.json".to_string(),
            _ => return Err("this customization kind is not file-backed".to_string()),
        };
        self.resolve_vault_path(root, &relative)
    }

    fn resolve_vault_path(&self, root: &Path, relative: &str) -> Result<PathBuf, String> {
        let candidate = Path::new(relative);
        if candidate.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err("customization path escapes the vault".to_string());
        }
        Ok(root.join(candidate))
    }
}

fn warning(path: &Path, error: impl std::fmt::Display) -> CustomizeWarning {
    CustomizeWarning {
        path: path.display().to_string(),
        message: error.to_string(),
    }
}

fn default_surfaces(kind: CustomizationKind) -> Vec<CustomizationSurface> {
    match kind {
        CustomizationKind::Command => vec![
            CustomizationSurface::NativeAgent,
            CustomizationSurface::Copilot,
            CustomizationSurface::Roleplay,
        ],
        CustomizationKind::Mcp => vec![
            CustomizationSurface::NativeAgent,
            CustomizationSurface::Copilot,
            CustomizationSurface::Deeplore,
        ],
        CustomizationKind::Hook | CustomizationKind::Plugin => {
            vec![CustomizationSurface::NativeAgent]
        }
        _ => vec![
            CustomizationSurface::NativeAgent,
            CustomizationSurface::Copilot,
        ],
    }
}

fn file_item(
    root: &Path,
    path: &Path,
    kind: CustomizationKind,
    fallback_name: &str,
    body: &str,
) -> CustomizationItem {
    let parsed = parsing::parse_document(body);
    let name = parsing::value(&parsed.frontmatter, "name")
        .or_else(|| parsing::value(&parsed.frontmatter, "title"))
        .map(str::to_string)
        .unwrap_or_else(|| parsing::title_from_body(&parsed.body, fallback_name));
    let description = parsing::value(&parsed.frontmatter, "description")
        .unwrap_or_default()
        .to_string();
    let mut surfaces = parsing::list(&parsed.frontmatter, "surfaces")
        .into_iter()
        .filter_map(|surface| match surface.as_str() {
            "native_agent" => Some(CustomizationSurface::NativeAgent),
            "copilot" => Some(CustomizationSurface::Copilot),
            "roleplay" => Some(CustomizationSurface::Roleplay),
            "deeplore" => Some(CustomizationSurface::Deeplore),
            _ => None,
        })
        .collect::<Vec<_>>();
    if surfaces.is_empty() {
        surfaces = default_surfaces(kind);
    }
    let globs = parsing::list(&parsed.frontmatter, "globs");
    let enabled = !matches!(
        parsing::value(&parsed.frontmatter, "enabled")
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("false" | "no" | "0")
    );
    let relative = relative_path(root, path);
    CustomizationItem {
        id: format!("vault:{}:{relative}", kind_name(kind)),
        kind,
        name,
        description,
        body: parsed.body,
        path: Some(relative),
        scope: CustomizationScope::Vault,
        source: CustomizationSource::Vault,
        surfaces,
        enabled,
        always_apply: parsing::bool_value(&parsed.frontmatter, "alwaysApply")
            || parsing::bool_value(&parsed.frontmatter, "always_apply"),
        globs,
        plugin_id: None,
        read_only: false,
        metadata: BTreeMap::new(),
    }
}

fn format_body(request: &CustomizeSaveRequest, surfaces: &[CustomizationSurface]) -> String {
    let surface_names = surfaces
        .iter()
        .map(|surface| match surface {
            CustomizationSurface::NativeAgent => "native_agent",
            CustomizationSurface::Copilot => "copilot",
            CustomizationSurface::Roleplay => "roleplay",
            CustomizationSurface::Deeplore => "deeplore",
        })
        .collect::<Vec<_>>()
        .join(", ");
    let mut header = format!(
        "---\nname: {}\ndescription: {}\nsurfaces: [{}]\nalwaysApply: {}\n",
        request.name.trim(),
        request.description.trim(),
        surface_names,
        request.always_apply
    );
    if !request.globs.is_empty() {
        header.push_str(&format!("globs: [{}]\n", request.globs.join(", ")));
    }
    if !request.enabled {
        header.push_str("enabled: false\n");
    }
    header.push_str("---\n\n");
    header.push_str(&request.body);
    if !header.ends_with('\n') {
        header.push('\n');
    }
    header
}

fn merge_items(items: Vec<CustomizationItem>) -> Vec<CustomizationItem> {
    let mut merged = BTreeMap::<String, CustomizationItem>::new();
    for item in items {
        let key = format!(
            "{}:{}",
            kind_name(item.kind),
            item.name.to_ascii_lowercase()
        );
        match merged.get(&key) {
            Some(existing) if scope_rank(existing.scope) > scope_rank(item.scope) => {}
            _ => {
                merged.insert(key, item);
            }
        }
    }
    let mut values = merged.into_values().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        kind_name(left.kind)
            .cmp(kind_name(right.kind))
            .then_with(|| left.name.cmp(&right.name))
    });
    values
}

fn scope_rank(scope: CustomizationScope) -> u8 {
    match scope {
        CustomizationScope::Plugin => 0,
        CustomizationScope::Global => 1,
        CustomizationScope::Profile => 2,
        CustomizationScope::Character => 3,
        CustomizationScope::Vault => 4,
    }
}

fn kind_name(kind: CustomizationKind) -> &'static str {
    match kind {
        CustomizationKind::Rule => "rule",
        CustomizationKind::Skill => "skill",
        CustomizationKind::Agent => "agent",
        CustomizationKind::Command => "command",
        CustomizationKind::Hook => "hook",
        CustomizationKind::Mcp => "mcp",
        CustomizationKind::Plugin => "plugin",
    }
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn trust_key(vault_root: Option<&str>) -> String {
    vault_root
        .map(|root| format!("vault:{root}"))
        .unwrap_or_else(|| "native".to_string())
}

fn config_hash(config: &HookConfig) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let serialized = serde_json::to_vec(config).map_err(|error| error.to_string())?;
    Ok(Sha256::digest(serialized)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Config events that a surface can dispatch without a configured command.
pub fn known_events() -> Vec<&'static str> {
    vec![
        "sessionStart",
        "sessionEnd",
        "beforeSubmitPrompt",
        "preToolUse",
        "postToolUse",
        "postToolUseFailure",
        "afterAgentResponse",
        "stop",
        "subagentStart",
        "subagentStop",
        "beforeReadFile",
        "afterFileEdit",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn scans_vault_rules_and_builds_surface_context() {
        let root = std::env::temp_dir().join(format!("tt-customize-{}", uuid::Uuid::new_v4()));
        let rules = root.join(".cursor").join("rules");
        tokio::fs::create_dir_all(&rules).await.unwrap();
        tokio::fs::write(
            rules.join("harbor.mdc"),
            "---\nname: Harbor\ndescription: Tide rules\nalwaysApply: true\n---\n# Harbor\nUse tides.",
        )
        .await
        .unwrap();
        let service = CustomizeService::new(root.join("_store"), Vec::new());
        let snapshot = service
            .snapshot(Some(root.to_str().unwrap()))
            .await
            .unwrap();
        assert_eq!(snapshot.items.len(), 1);
        assert_eq!(snapshot.items[0].name, "Harbor");
        assert!(snapshot.items[0].always_apply);
        let context = service
            .context(
                CustomizationSurface::NativeAgent,
                Some(root.to_str().unwrap()),
            )
            .await
            .unwrap();
        assert_eq!(context.rules.len(), 1);
        let _ = tokio::fs::remove_dir_all(root).await;
    }
}
