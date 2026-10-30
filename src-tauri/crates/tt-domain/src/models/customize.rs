use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A place a customization can be defined.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomizationScope {
    Plugin,
    Global,
    Profile,
    Character,
    Vault,
}

impl Default for CustomizationScope {
    fn default() -> Self {
        Self::Global
    }
}

/// An agent surface that can consume a customization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomizationSurface {
    NativeAgent,
    Copilot,
    Roleplay,
    Deeplore,
}

impl Default for CustomizationSurface {
    fn default() -> Self {
        Self::NativeAgent
    }
}

/// The storage class a customization came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomizationSource {
    Native,
    Vault,
    Plugin,
}

impl Default for CustomizationSource {
    fn default() -> Self {
        Self::Native
    }
}

/// The kinds of resources shown in the Customize panel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomizationKind {
    Rule,
    Skill,
    Agent,
    Command,
    Hook,
    Mcp,
    Plugin,
}

/// A single customization entry. The body is Markdown for rules, skills, agents,
/// and commands, and JSON for MCP presets and plugin manifests.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomizationItem {
    pub id: String,
    pub kind: CustomizationKind,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub scope: CustomizationScope,
    #[serde(default)]
    pub source: CustomizationSource,
    #[serde(default = "default_surfaces")]
    pub surfaces: Vec<CustomizationSurface>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub always_apply: bool,
    #[serde(default)]
    pub globs: Vec<String>,
    #[serde(default)]
    pub plugin_id: Option<String>,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
}

fn default_true() -> bool {
    true
}

fn default_surfaces() -> Vec<CustomizationSurface> {
    vec![CustomizationSurface::NativeAgent]
}

impl CustomizationItem {
    pub fn applies_to(&self, surface: CustomizationSurface) -> bool {
        self.enabled && self.surfaces.contains(&surface)
    }
}

/// Validation or scan warnings returned with a snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomizeWarning {
    pub path: String,
    pub message: String,
}

/// The registry snapshot consumed by the UI and prompt builders.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomizeSnapshot {
    #[serde(default)]
    pub items: Vec<CustomizationItem>,
    #[serde(default)]
    pub warnings: Vec<CustomizeWarning>,
    #[serde(default)]
    pub hook_config: Option<HookConfig>,
    #[serde(default)]
    pub hook_trusted: bool,
}

/// The prompt-ready view of the registry for one run.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomizeContext {
    #[serde(default)]
    pub rules: Vec<CustomizationItem>,
    #[serde(default)]
    pub skills: Vec<CustomizationItem>,
    #[serde(default)]
    pub agents: Vec<CustomizationItem>,
    #[serde(default)]
    pub commands: Vec<CustomizationItem>,
}

/// A Cursor-compatible hook configuration file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookConfig {
    #[serde(default = "default_hook_version")]
    pub version: u32,
    #[serde(default)]
    pub hooks: BTreeMap<String, Vec<HookMatcher>>,
}

fn default_hook_version() -> u32 {
    1
}

/// One command matcher in a hook event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookMatcher {
    #[serde(default)]
    pub matcher: Option<String>,
    pub command: String,
    #[serde(default = "default_hook_timeout")]
    pub timeout_sec: u64,
    #[serde(default)]
    pub fail_closed: bool,
}

fn default_hook_timeout() -> u64 {
    30
}

/// The payload passed to a hook command on stdin.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEventPayload {
    pub hook_event_name: String,
    #[serde(default)]
    pub conversation_id: String,
    #[serde(default)]
    pub generation_id: String,
    #[serde(default)]
    pub surface: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub workspace_roots: Vec<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,
    #[serde(default)]
    pub tool_response: Option<serde_json::Value>,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub stop_hook_active: bool,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

/// The normalized result of one hook command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookResult {
    pub hook_event_name: String,
    pub matcher: Option<String>,
    pub exit_code: Option<i32>,
    pub permission: String,
    pub user_message: Option<String>,
    pub agent_message: Option<String>,
    pub updated_input: Option<serde_json::Value>,
    pub followup_message: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
    pub timed_out: bool,
}

impl HookResult {
    pub fn is_allowed(&self) -> bool {
        self.permission != "deny"
    }

    pub fn is_blocking(&self) -> bool {
        self.permission == "deny" || self.followup_message.is_some()
    }
}

/// A hook execution log entry persisted for the Customize panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookLogEntry {
    pub id: String,
    pub event: String,
    pub surface: String,
    pub command: String,
    pub permission: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub timed_out: bool,
    pub message: Option<String>,
    pub created_at: i64,
}

/// Request used to save a customization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomizeSaveRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub kind: CustomizationKind,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub scope: CustomizationScope,
    #[serde(default)]
    pub surfaces: Vec<CustomizationSurface>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub always_apply: bool,
    #[serde(default)]
    pub globs: Vec<String>,
    #[serde(default)]
    pub vault_root: Option<String>,
}

/// Request for a hook test or invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookRunRequest {
    pub event: String,
    #[serde(default = "default_hook_surface")]
    pub surface: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default)]
    pub vault_root: Option<String>,
    #[serde(default)]
    pub test: bool,
}

fn default_hook_surface() -> String {
    "native_agent".to_string()
}

/// The aggregate hook outcome for an event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookDispatchResult {
    pub allowed: bool,
    pub results: Vec<HookResult>,
    pub followup_message: Option<String>,
    pub updated_input: Option<serde_json::Value>,
}

impl HookDispatchResult {
    pub fn allow() -> Self {
        Self {
            allowed: true,
            results: Vec::new(),
            followup_message: None,
            updated_input: None,
        }
    }
}
