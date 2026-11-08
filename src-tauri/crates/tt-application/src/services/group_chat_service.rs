use std::path::Path;
use std::sync::Arc;

use serde_json::{Map, Value, json};

use crate::dto::chat_dto::{
    ChatSearchResultDto, DeleteGroupChatDto, ImportGroupChatDto, RenameGroupChatDto,
    RestoreGroupChatBackupDto,
};
use crate::dto::chat_history_dto::ChatHistoryLocator;
use crate::errors::ApplicationError;
use crate::services::agent_workspace_lifecycle_service::AgentWorkspaceLifecycleService;
use crate::services::chat_file_validation::validate_chat_file_name;
use crate::services::chat_history_coordinator::ChatHistoryCoordinator;
use tt_domain::errors::DomainError;
use tt_ports::repositories::chat_types::{
    ChatMessageSearchHit, ChatMessageSearchQuery, ChatPayloadChunk, ChatPayloadCursor,
    ChatPayloadTail, FindLastMessageQuery, LocatedChatMessage, PinnedGroupChat,
};
use tt_ports::repositories::group_chat_repository::GroupChatRepository;

/// Service for managing group chats (JSONL payloads).
pub struct GroupChatService {
    group_chat_repository: Arc<dyn GroupChatRepository>,
    agent_workspace_lifecycle_service: Arc<AgentWorkspaceLifecycleService>,
    chat_history_coordinator: Arc<ChatHistoryCoordinator>,
}

impl GroupChatService {
    pub fn new(
        group_chat_repository: Arc<dyn GroupChatRepository>,
        agent_workspace_lifecycle_service: Arc<AgentWorkspaceLifecycleService>,
        chat_history_coordinator: Arc<ChatHistoryCoordinator>,
    ) -> Self {
        Self {
            group_chat_repository,
            agent_workspace_lifecycle_service,
            chat_history_coordinator,
        }
    }

    /// List group chat summaries without loading full chat payloads.
    pub async fn list_group_chat_summaries(
        &self,
        chat_ids: Option<&[String]>,
        include_metadata: bool,
    ) -> Result<Vec<ChatSearchResultDto>, ApplicationError> {
        let results = self
            .group_chat_repository
            .list_group_chat_summaries(chat_ids, include_metadata)
            .await?;

        Ok(results.into_iter().map(ChatSearchResultDto::from).collect())
    }

    /// List recent group chat summaries without full summary scan.
    pub async fn list_recent_group_chat_summaries(
        &self,
        chat_ids: Option<&[String]>,
        include_metadata: bool,
        max_entries: usize,
        pinned: &[PinnedGroupChat],
    ) -> Result<Vec<ChatSearchResultDto>, ApplicationError> {
        let results = self
            .group_chat_repository
            .list_recent_group_chat_summaries(chat_ids, include_metadata, max_entries, pinned)
            .await?;

        Ok(results.into_iter().map(ChatSearchResultDto::from).collect())
    }

    /// Search group chats with optional chat ID filtering.
    pub async fn search_group_chats(
        &self,
        query: &str,
        chat_ids: Option<&[String]>,
    ) -> Result<Vec<ChatSearchResultDto>, ApplicationError> {
        let results = self
            .group_chat_repository
            .search_group_chats(query, chat_ids)
            .await?;

        Ok(results.into_iter().map(ChatSearchResultDto::from).collect())
    }

    pub async fn get_group_chat_summary(
        &self,
        chat_id: &str,
        include_metadata: bool,
    ) -> Result<ChatSearchResultDto, ApplicationError> {
        let summary = self
            .group_chat_repository
            .get_group_chat_summary(chat_id, include_metadata)
            .await?;
        Ok(ChatSearchResultDto::from(summary))
    }

    pub async fn get_group_chat_metadata(&self, chat_id: &str) -> Result<Value, ApplicationError> {
        Ok(self
            .group_chat_repository
            .get_group_chat_metadata(chat_id)
            .await?)
    }

    pub async fn get_group_chat_store_json(
        &self,
        chat_id: &str,
        namespace: &str,
        key: &str,
    ) -> Result<Value, ApplicationError> {
        Ok(self
            .group_chat_repository
            .get_group_chat_store_json(chat_id, namespace, key)
            .await?)
    }

    pub async fn set_group_chat_store_json(
        &self,
        chat_id: &str,
        namespace: &str,
        key: &str,
        value: Value,
    ) -> Result<(), ApplicationError> {
        self.group_chat_repository
            .set_group_chat_store_json(chat_id, namespace, key, value)
            .await?;
        Ok(())
    }

    pub async fn update_group_chat_store_json(
        &self,
        chat_id: &str,
        namespace: &str,
        key: &str,
        value: Value,
    ) -> Result<(), ApplicationError> {
        self.group_chat_repository
            .update_group_chat_store_json(chat_id, namespace, key, value)
            .await?;
        Ok(())
    }

    pub async fn rename_group_chat_store_key(
        &self,
        chat_id: &str,
        namespace: &str,
        key: &str,
        new_key: &str,
    ) -> Result<(), ApplicationError> {
        self.group_chat_repository
            .rename_group_chat_store_key(chat_id, namespace, key, new_key)
            .await?;
        Ok(())
    }

    pub async fn delete_group_chat_store_json(
        &self,
        chat_id: &str,
        namespace: &str,
        key: &str,
    ) -> Result<(), ApplicationError> {
        self.group_chat_repository
            .delete_group_chat_store_json(chat_id, namespace, key)
            .await?;
        Ok(())
    }

    pub async fn list_group_chat_store_keys(
        &self,
        chat_id: &str,
        namespace: &str,
    ) -> Result<Vec<String>, ApplicationError> {
        Ok(self
            .group_chat_repository
            .list_group_chat_store_keys(chat_id, namespace)
            .await?)
    }

    fn group_workspace_chat_id(group_id: &str) -> String {
        format!("__group__{group_id}")
    }

    fn validate_workspace_namespace(namespace: &str) -> Result<&str, ApplicationError> {
        match namespace {
            "session" | "deeplore" | "rpgraph" => Ok(namespace),
            _ => Err(ApplicationError::ValidationError(format!(
                "Unknown session workspace namespace: {namespace}"
            ))),
        }
    }

    async fn read_optional_store_json(
        &self,
        chat_id: &str,
        namespace: &str,
        key: &str,
    ) -> Result<Option<Value>, ApplicationError> {
        match self
            .get_group_chat_store_json(chat_id, namespace, key)
            .await
        {
            Ok(value) => Ok(Some(value)),
            Err(ApplicationError::NotFound(_)) => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn merge_lore_values(group: &Value, session: &Value) -> Value {
        let mut merged = group.as_object().cloned().unwrap_or_default();
        let Some(session_object) = session.as_object() else {
            return Value::Object(merged);
        };

        for (key, session_value) in session_object {
            if key == "deeplore_context" {
                let mut context = merged
                    .get(key)
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                if let Some(session_context) = session_value.as_object() {
                    for (context_key, context_value) in session_context {
                        context.insert(context_key.clone(), context_value.clone());
                    }
                }
                merged.insert(key.clone(), Value::Object(context));
            } else {
                merged.insert(key.clone(), session_value.clone());
            }
        }

        Value::Object(merged)
    }

    fn lore_patch(metadata: &Map<String, Value>, group_lore: &Value) -> Value {
        let mut patch = Map::new();
        for key in ["deeplore_pins", "deeplore_blocks", "deeplore_folder_filter"] {
            let metadata_value = metadata.get(key);
            let group_value = group_lore.get(key);
            if metadata_value.is_some() && metadata_value != group_value {
                if let Some(value) = metadata_value {
                    patch.insert(key.to_string(), value.clone());
                }
            }
        }

        let metadata_context = metadata
            .get("deeplore_context")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let group_context = group_lore
            .get("deeplore_context")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let mut context_patch = Map::new();
        for (key, value) in metadata_context {
            if group_context.get(&key) != Some(&value) {
                context_patch.insert(key, value);
            }
        }
        if !context_patch.is_empty() {
            patch.insert("deeplore_context".to_string(), Value::Object(context_patch));
        }
        Value::Object(patch)
    }

    /// Hydrate a group chat header from the group and session workspace files.
    pub async fn prepare_group_session_metadata(
        &self,
        group_id: &str,
        chat_id: &str,
        metadata: Value,
    ) -> Result<Value, ApplicationError> {
        validate_chat_file_name(chat_id, "Group chat id")?;
        let group_chat_id = Self::group_workspace_chat_id(group_id);
        let group_lore = self
            .read_optional_store_json(&group_chat_id, "deeplore", "overrides")
            .await?
            .unwrap_or_else(|| json!({}));
        let mut session_lore = self
            .read_optional_store_json(chat_id, "deeplore", "overrides")
            .await?;

        let mut metadata_object = metadata.as_object().cloned().unwrap_or_default();
        let mut session_workflow = self
            .read_optional_store_json(chat_id, "rpgraph", "active-workflow")
            .await?;
        if session_workflow.is_none() {
            if let Some(legacy) = metadata_object.get("rpgraph_session") {
                self.set_group_chat_store_json(
                    chat_id,
                    "rpgraph",
                    "active-workflow",
                    legacy.clone(),
                )
                .await?;
                session_workflow = Some(legacy.clone());
            }
        }

        if session_lore.is_none() {
            let migrated = Self::lore_patch(&metadata_object, &group_lore);
            if migrated.as_object().is_some_and(|value| !value.is_empty()) {
                self.set_group_chat_store_json(chat_id, "deeplore", "overrides", migrated.clone())
                    .await?;
                session_lore = Some(migrated);
            }
        }

        let effective_lore =
            Self::merge_lore_values(&group_lore, session_lore.as_ref().unwrap_or(&Value::Null));
        let effective_object = effective_lore.as_object().cloned().unwrap_or_default();
        for key in [
            "deeplore_context",
            "deeplore_pins",
            "deeplore_blocks",
            "deeplore_folder_filter",
        ] {
            if let Some(value) = effective_object.get(key) {
                metadata_object.insert(key.to_string(), value.clone());
            } else {
                metadata_object.remove(key);
            }
        }
        metadata_object.insert(
            "tauritavern_session".to_string(),
            json!({
                "schemaVersion": 1,
                "groupId": group_id,
                "chatId": chat_id,
            }),
        );
        if let Some(workflow) = session_workflow {
            metadata_object.insert("rpgraph_session".to_string(), workflow);
        }
        self.set_group_chat_store_json(
            chat_id,
            "session",
            "meta",
            json!({
                "schemaVersion": 1,
                "groupId": group_id,
                "chatId": chat_id,
            }),
        )
        .await?;
        Ok(Value::Object(metadata_object))
    }

    /// Persist only the fields that differ from the group defaults.
    pub async fn sync_group_session_metadata(
        &self,
        group_id: &str,
        chat_id: &str,
        metadata: Value,
    ) -> Result<(), ApplicationError> {
        validate_chat_file_name(chat_id, "Group chat id")?;
        let group_chat_id = Self::group_workspace_chat_id(group_id);
        let group_lore = self
            .read_optional_store_json(&group_chat_id, "deeplore", "overrides")
            .await?
            .unwrap_or_else(|| json!({}));
        let metadata_object = metadata.as_object().cloned().unwrap_or_default();
        let patch = Self::lore_patch(&metadata_object, &group_lore);

        self.set_group_chat_store_json(chat_id, "deeplore", "overrides", patch)
            .await?;
        if let Some(workflow) = metadata_object.get("rpgraph_session") {
            self.set_group_chat_store_json(chat_id, "rpgraph", "active-workflow", workflow.clone())
                .await?;
        }
        self.set_group_chat_store_json(
            chat_id,
            "session",
            "meta",
            json!({
                "schemaVersion": 1,
                "groupId": group_id,
                "chatId": chat_id,
            }),
        )
        .await?;
        Ok(())
    }

    /// Return the group and session workspace documents for the UI.
    pub async fn get_group_session_workspace(
        &self,
        group_id: &str,
        chat_id: &str,
    ) -> Result<Value, ApplicationError> {
        let group_chat_id = Self::group_workspace_chat_id(group_id);
        let group_lore = self
            .read_optional_store_json(&group_chat_id, "deeplore", "overrides")
            .await?
            .unwrap_or_else(|| json!({}));
        let session_lore = self
            .read_optional_store_json(chat_id, "deeplore", "overrides")
            .await?
            .unwrap_or_else(|| json!({}));
        let group_workflow = self
            .read_optional_store_json(&group_chat_id, "rpgraph", "default-workflow")
            .await?
            .unwrap_or(Value::Null);
        let session_workflow = self
            .read_optional_store_json(chat_id, "rpgraph", "active-workflow")
            .await?
            .unwrap_or(Value::Null);
        let hooks = self
            .read_optional_store_json(chat_id, "rpgraph", "hooks")
            .await?
            .unwrap_or(Value::Null);
        let rpgraph_session = self
            .read_optional_store_json(chat_id, "rpgraph", "session")
            .await?
            .unwrap_or(Value::Null);
        let session_meta = self
            .read_optional_store_json(chat_id, "session", "meta")
            .await?
            .unwrap_or(Value::Null);

        Ok(json!({
            "groupId": group_id,
            "chatId": chat_id,
            "group": {
                "lore": group_lore,
                "workflow": group_workflow,
            },
            "session": {
                "meta": session_meta,
                "lore": session_lore,
                "workflow": session_workflow,
                "hooks": hooks,
                "rpgraph": rpgraph_session,
            },
            "effective": {
                "lore": Self::merge_lore_values(&group_lore, &session_lore),
                "workflow": if session_workflow.is_null() { group_workflow } else { session_workflow },
            },
        }))
    }

    /// Read the group-level workspace tree.
    pub async fn get_group_workspace(&self, group_id: &str) -> Result<Value, ApplicationError> {
        let group_chat_id = Self::group_workspace_chat_id(group_id);
        let lore = self
            .read_optional_store_json(&group_chat_id, "deeplore", "overrides")
            .await?
            .unwrap_or_else(|| json!({}));
        let workflow = self
            .read_optional_store_json(&group_chat_id, "rpgraph", "default-workflow")
            .await?
            .unwrap_or(Value::Null);
        Ok(json!({
            "groupId": group_id,
            "lore": lore,
            "workflow": workflow,
        }))
    }

    fn validate_workspace_value(value: &Value) -> Result<(), ApplicationError> {
        const MAX_WORKSPACE_JSON_BYTES: usize = 8 * 1024 * 1024;
        let size = serde_json::to_vec(value)
            .map_err(|error| ApplicationError::ValidationError(error.to_string()))?
            .len();
        if size > MAX_WORKSPACE_JSON_BYTES {
            return Err(ApplicationError::ValidationError(format!(
                "Session workspace entry exceeds the {} byte limit",
                MAX_WORKSPACE_JSON_BYTES
            )));
        }
        if contains_secret_key(value) {
            return Err(ApplicationError::ValidationError(
                "Session workspace entries cannot contain API keys, tokens, passwords, or secrets."
                    .to_string(),
            ));
        }
        Ok(())
    }

    pub async fn write_session_workspace_entry(
        &self,
        chat_id: &str,
        namespace: &str,
        key: &str,
        value: Value,
    ) -> Result<(), ApplicationError> {
        Self::validate_workspace_namespace(namespace)?;
        Self::validate_workspace_value(&value)?;
        self.set_group_chat_store_json(chat_id, namespace, key, value)
            .await
    }

    pub async fn delete_session_workspace_entry(
        &self,
        chat_id: &str,
        namespace: &str,
        key: &str,
    ) -> Result<(), ApplicationError> {
        Self::validate_workspace_namespace(namespace)?;
        self.delete_group_chat_store_json(chat_id, namespace, key)
            .await
    }

    pub async fn write_group_workspace_entry(
        &self,
        group_id: &str,
        namespace: &str,
        key: &str,
        value: Value,
    ) -> Result<(), ApplicationError> {
        Self::validate_workspace_namespace(namespace)?;
        Self::validate_workspace_value(&value)?;
        let group_chat_id = Self::group_workspace_chat_id(group_id);
        self.set_group_chat_store_json(&group_chat_id, namespace, key, value)
            .await
    }

    pub async fn delete_group_workspace_entry(
        &self,
        group_id: &str,
        namespace: &str,
        key: &str,
    ) -> Result<(), ApplicationError> {
        Self::validate_workspace_namespace(namespace)?;
        let group_chat_id = Self::group_workspace_chat_id(group_id);
        self.delete_group_chat_store_json(&group_chat_id, namespace, key)
            .await
    }

    pub async fn find_last_group_chat_message(
        &self,
        chat_id: &str,
        query: FindLastMessageQuery,
    ) -> Result<Option<LocatedChatMessage>, ApplicationError> {
        Ok(self
            .group_chat_repository
            .find_last_group_chat_message(chat_id, query)
            .await?)
    }

    pub async fn search_group_chat_messages(
        &self,
        chat_id: &str,
        query: ChatMessageSearchQuery,
    ) -> Result<Vec<ChatMessageSearchHit>, ApplicationError> {
        Ok(self
            .group_chat_repository
            .search_group_chat_messages(chat_id, query)
            .await?)
    }

    /// Clear the group chat cache.
    pub async fn clear_cache(&self) -> Result<(), DomainError> {
        self.group_chat_repository.clear_cache().await
    }

    /// Get the absolute path to a group chat payload file.
    pub async fn get_group_chat_payload_path(
        &self,
        chat_id: &str,
    ) -> Result<String, ApplicationError> {
        if chat_id.trim().is_empty() {
            return Err(ApplicationError::ValidationError(
                "Group chat id cannot be empty".to_string(),
            ));
        }

        let path = self
            .group_chat_repository
            .get_group_chat_payload_path(chat_id)
            .await?;
        Ok(path.to_string_lossy().to_string())
    }

    /// Get the tail window for a group chat JSONL payload.
    pub async fn get_group_chat_payload_tail_lines(
        &self,
        chat_id: &str,
        max_lines: usize,
    ) -> Result<ChatPayloadTail, ApplicationError> {
        self.group_chat_repository
            .get_group_chat_payload_tail_lines(chat_id, max_lines)
            .await
            .map_err(Into::into)
    }

    /// Get JSONL lines before the current group chat window cursor.
    pub async fn get_group_chat_payload_before_lines(
        &self,
        chat_id: &str,
        cursor: ChatPayloadCursor,
        max_lines: usize,
    ) -> Result<ChatPayloadChunk, ApplicationError> {
        self.group_chat_repository
            .get_group_chat_payload_before_lines(chat_id, cursor, max_lines)
            .await
            .map_err(Into::into)
    }

    /// Get multiple windows of JSONL lines before the current group chat window cursor.
    ///
    /// This is equivalent to calling `get_group_chat_payload_before_lines` repeatedly, but returns
    /// multiple pages in one IPC round-trip.
    pub async fn get_group_chat_payload_before_pages_lines(
        &self,
        chat_id: &str,
        cursor: ChatPayloadCursor,
        max_lines: usize,
        max_pages: usize,
    ) -> Result<Vec<ChatPayloadChunk>, ApplicationError> {
        if max_lines == 0 || max_pages == 0 {
            return Err(ApplicationError::ValidationError(
                "max_lines and max_pages must be greater than 0".to_string(),
            ));
        }

        let mut pages = Vec::with_capacity(max_pages);
        let mut next_cursor = cursor;

        for _ in 0..max_pages {
            let page = self
                .group_chat_repository
                .get_group_chat_payload_before_lines(chat_id, next_cursor, max_lines)
                .await?;

            next_cursor = page.cursor;
            let done = page.lines.is_empty() || !page.has_more_before;
            pages.push(page);

            if done {
                break;
            }
        }

        Ok(pages)
    }

    /// Delete a group chat payload file.
    pub async fn delete_group_chat(&self, dto: DeleteGroupChatDto) -> Result<(), ApplicationError> {
        validate_chat_file_name(&dto.id, "Group chat id")?;
        let _run_guard = self
            .agent_workspace_lifecycle_service
            .lock_run_lifecycle()
            .await;

        let target = AgentWorkspaceLifecycleService::group_target(&dto.id)?;
        self.agent_workspace_lifecycle_service
            .ensure_chat_workspace_inactive(&target)
            .await?;

        self.group_chat_repository
            .delete_group_chat_payload(&dto.id)
            .await?;
        self.group_chat_repository
            .delete_group_chat_store(&dto.id)
            .await?;
        self.chat_history_coordinator
            .invalidate(&group_locator(&dto.id))
            .await;
        self.agent_workspace_lifecycle_service
            .delete_chat_workspace_locked(&target)
            .await?;
        Ok(())
    }

    /// Rename a group chat payload file.
    pub async fn rename_group_chat(
        &self,
        dto: RenameGroupChatDto,
    ) -> Result<String, ApplicationError> {
        validate_chat_file_name(&dto.old_file_name, "Old group chat file name")?;
        validate_chat_file_name(&dto.new_file_name, "New group chat file name")?;

        let committed_file_name = self
            .group_chat_repository
            .rename_group_chat_payload(&dto.old_file_name, &dto.new_file_name)
            .await?;
        self.group_chat_repository
            .rename_group_chat_store(&dto.old_file_name, &committed_file_name)
            .await?;
        self.chat_history_coordinator
            .invalidate(&group_locator(&dto.old_file_name))
            .await;
        self.chat_history_coordinator
            .invalidate(&group_locator(&committed_file_name))
            .await;
        Ok(committed_file_name)
    }

    /// Import a group chat payload and return the created chat id.
    pub async fn import_group_chat(
        &self,
        dto: ImportGroupChatDto,
    ) -> Result<String, ApplicationError> {
        self.group_chat_repository
            .import_group_chat_payload(Path::new(&dto.file_path))
            .await
            .map_err(Into::into)
    }

    /// Restore a group chat directly from a history backup.
    pub async fn restore_group_chat_backup(
        &self,
        dto: RestoreGroupChatBackupDto,
    ) -> Result<String, ApplicationError> {
        if dto.backup_name.trim().is_empty() {
            return Err(ApplicationError::ValidationError(
                "Backup file name cannot be empty".to_string(),
            ));
        }

        self.group_chat_repository
            .restore_group_chat_backup(&dto.backup_name)
            .await
            .map_err(Into::into)
    }
}

fn contains_secret_key(value: &Value) -> bool {
    fn is_secret_key(key: &str) -> bool {
        let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
        matches!(
            normalized.as_str(),
            "apikey"
                | "secret"
                | "clientsecret"
                | "password"
                | "accesstoken"
                | "refreshtoken"
                | "authtoken"
                | "bearertoken"
        ) || normalized.ends_with("apikey")
            || normalized.ends_with("secret")
            || normalized.ends_with("password")
    }

    match value {
        Value::Object(object) => object
            .iter()
            .any(|(key, child)| is_secret_key(key) || contains_secret_key(child)),
        Value::Array(items) => items.iter().any(contains_secret_key),
        _ => false,
    }
}

fn group_locator(chat_id: &str) -> ChatHistoryLocator {
    ChatHistoryLocator::Group {
        chat_id: chat_id.to_string(),
    }
}

#[cfg(test)]
mod session_workspace_tests {
    use super::GroupChatService;
    use serde_json::json;

    #[test]
    fn merge_lore_overlays_group_context_and_session_arrays() {
        let group = json!({
            "deeplore_context": { "tone": "noir", "pace": "slow" },
            "deeplore_pins": ["group-pin"],
        });
        let session = json!({
            "deeplore_context": { "pace": "fast" },
            "deeplore_pins": ["session-pin"],
        });
        let merged = GroupChatService::merge_lore_values(&group, &session);
        assert_eq!(merged["deeplore_context"]["tone"], "noir");
        assert_eq!(merged["deeplore_context"]["pace"], "fast");
        assert_eq!(merged["deeplore_pins"], json!(["session-pin"]));
    }

    #[test]
    fn lore_patch_keeps_only_session_differences() {
        let group = json!({
            "deeplore_context": { "tone": "noir", "pace": "slow" },
            "deeplore_pins": ["group-pin"],
        });
        let metadata = json!({
            "deeplore_context": { "tone": "noir", "pace": "fast" },
            "deeplore_pins": ["session-pin"],
        })
        .as_object()
        .cloned()
        .unwrap();
        let patch = GroupChatService::lore_patch(&metadata, &group);
        assert_eq!(patch["deeplore_context"]["pace"], "fast");
        assert_eq!(patch["deeplore_context"].get("tone"), None);
        assert_eq!(patch["deeplore_pins"], json!(["session-pin"]));
    }

    #[test]
    fn inherited_values_produce_an_empty_patch() {
        let group = json!({
            "deeplore_context": { "tone": "noir" },
            "deeplore_blocks": ["blocked"],
        });
        let metadata = json!({
            "deeplore_context": { "tone": "noir" },
            "deeplore_blocks": ["blocked"],
        })
        .as_object()
        .cloned()
        .unwrap();
        let patch = GroupChatService::lore_patch(&metadata, &group);
        assert_eq!(patch, json!({}));
    }

    #[test]
    fn workspace_entries_reject_secret_fields() {
        assert!(
            GroupChatService::validate_workspace_value(&json!({
                "provider": { "apiKey": "sk-test" }
            }))
            .is_err()
        );
        assert!(
            GroupChatService::validate_workspace_value(&json!({
                "hooks": [{ "event": "before_turn" }]
            }))
            .is_ok()
        );
    }
}
