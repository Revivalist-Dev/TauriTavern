use std::collections::BTreeMap;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tt_domain::models::customize::{
    HookConfig, HookEventPayload, HookLogEntry, HookMatcher, HookResult,
};

#[derive(Debug, thiserror::Error)]
pub enum HookError {
    #[error("hook event is not configured: {0}")]
    EventNotConfigured(String),
    #[error("hook command failed to start: {0}")]
    Spawn(String),
    #[error("hook command timed out after {0} seconds")]
    TimedOut(u64),
}

/// Execute every configured hook matching an event and return normalized results.
pub async fn dispatch(
    config: &HookConfig,
    payload: &HookEventPayload,
) -> Result<Vec<HookResult>, HookError> {
    let Some(matchers) = config.hooks.get(&payload.hook_event_name) else {
        return Err(HookError::EventNotConfigured(
            payload.hook_event_name.clone(),
        ));
    };
    let mut results = Vec::new();
    for matcher in matchers {
        if !matcher_matches(matcher, payload) {
            continue;
        }
        results.push(run_one(matcher, payload).await?);
    }
    Ok(results)
}

fn matcher_matches(matcher: &HookMatcher, payload: &HookEventPayload) -> bool {
    let Some(pattern) = matcher.matcher.as_deref() else {
        return true;
    };
    if pattern.trim().is_empty() || pattern.trim() == "*" {
        return true;
    }
    let candidate = payload
        .tool_name
        .as_deref()
        .or(payload.file_path.as_deref())
        .unwrap_or("");
    pattern
        .split('|')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .any(|part| part.eq_ignore_ascii_case(candidate) || candidate.contains(part))
}

async fn run_one(
    matcher: &HookMatcher,
    payload: &HookEventPayload,
) -> Result<HookResult, HookError> {
    let timeout = Duration::from_secs(matcher.timeout_sec.clamp(1, 300));
    let started = Instant::now();
    let mut command = shell_command(&matcher.command);
    command
        .current_dir(if payload.cwd.is_empty() {
            std::env::current_dir().unwrap_or_default()
        } else {
            payload.cwd.clone().into()
        })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("TAURITAVERN_HOOK_EVENT", &payload.hook_event_name)
        .env("TAURITAVERN_HOOK_SURFACE", &payload.surface)
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|error| HookError::Spawn(error.to_string()))?;
    if let Some(mut stdin) = child.stdin.take() {
        let serialized = serde_json::to_vec(payload).unwrap_or_default();
        let _ = stdin.write_all(&serialized).await;
        let _ = stdin.shutdown().await;
    }

    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => return Err(HookError::Spawn(error.to_string())),
        Err(_) => {
            return Err(HookError::TimedOut(matcher.timeout_sec));
        }
    };
    let duration_ms = started.elapsed().as_millis();
    let stdout = bounded(String::from_utf8_lossy(&output.stdout).to_string());
    let stderr = bounded(String::from_utf8_lossy(&output.stderr).to_string());
    let parsed = serde_json::from_str::<Value>(&stdout).ok();
    let permission = parsed
        .as_ref()
        .and_then(|value| value.get("permission"))
        .or_else(|| parsed.as_ref().and_then(|value| value.get("decision")))
        .and_then(Value::as_str)
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| matches!(value.as_str(), "allow" | "deny" | "ask"))
        .unwrap_or_else(|| {
            if output.status.success() {
                "allow".to_string()
            } else {
                "deny".to_string()
            }
        });
    let user_message = parsed
        .as_ref()
        .and_then(|value| {
            value
                .get("userMessage")
                .or_else(|| value.get("user_message"))
        })
        .and_then(Value::as_str)
        .map(str::to_string);
    let agent_message = parsed
        .as_ref()
        .and_then(|value| {
            value
                .get("agentMessage")
                .or_else(|| value.get("agent_message"))
        })
        .and_then(Value::as_str)
        .map(str::to_string);
    let updated_input = parsed
        .as_ref()
        .and_then(|value| {
            value
                .get("updatedInput")
                .or_else(|| value.get("updated_input"))
        })
        .cloned();
    let followup_message = parsed
        .as_ref()
        .and_then(|value| {
            value
                .get("followupMessage")
                .or_else(|| value.get("followup_message"))
        })
        .and_then(Value::as_str)
        .map(str::to_string);
    if !output.status.success() && permission == "allow" && matcher.fail_closed {
        return Ok(HookResult {
            hook_event_name: payload.hook_event_name.clone(),
            matcher: matcher.matcher.clone(),
            exit_code: output.status.code(),
            permission: "deny".to_string(),
            user_message: None,
            agent_message: None,
            updated_input: None,
            followup_message: None,
            stdout,
            stderr,
            duration_ms,
            timed_out: false,
        });
    }
    Ok(HookResult {
        hook_event_name: payload.hook_event_name.clone(),
        matcher: matcher.matcher.clone(),
        exit_code: output.status.code(),
        permission,
        user_message,
        agent_message,
        updated_input,
        followup_message,
        stdout,
        stderr,
        duration_ms,
        timed_out: false,
    })
}

fn shell_command(command: &str) -> Command {
    if cfg!(windows) {
        let mut cmd = Command::new("powershell.exe");
        cmd.arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(command);
        cmd
    } else {
        let mut cmd = Command::new("sh");
        cmd.arg("-lc").arg(command);
        cmd
    }
}

fn bounded(value: String) -> String {
    const MAX: usize = 256 * 1024;
    if value.len() <= MAX {
        value
    } else {
        let mut truncated = value;
        truncated.truncate(MAX);
        truncated.push_str("\n[output truncated]");
        truncated
    }
}

pub fn summarize_log(
    event: &str,
    surface: &str,
    command: &str,
    result: &HookResult,
) -> HookLogEntry {
    HookLogEntry {
        id: uuid::Uuid::new_v4().to_string(),
        event: event.to_string(),
        surface: surface.to_string(),
        command: command.to_string(),
        permission: result.permission.clone(),
        exit_code: result.exit_code,
        duration_ms: result.duration_ms,
        timed_out: result.timed_out,
        message: result
            .agent_message
            .clone()
            .or_else(|| result.user_message.clone())
            .or_else(|| {
                if result.stderr.is_empty() {
                    None
                } else {
                    Some(result.stderr.clone())
                }
            }),
        created_at: chrono::Utc::now().timestamp_millis(),
    }
}

pub fn merge_results(
    _event: &str,
    results: Vec<HookResult>,
) -> tt_domain::models::customize::HookDispatchResult {
    let mut allowed = true;
    let mut followup_message = None;
    let mut updated_input = None;
    for result in &results {
        if result.permission == "deny" {
            allowed = false;
        }
        if followup_message.is_none() {
            followup_message = result.followup_message.clone();
        }
        if updated_input.is_none() {
            updated_input = result.updated_input.clone();
        }
    }
    tt_domain::models::customize::HookDispatchResult {
        allowed,
        results,
        followup_message,
        updated_input,
    }
}

/// Build a payload when the caller only has a generic event object. This keeps
/// the JS bridges small and gives every surface the same shape.
pub fn payload_from_value(event: &str, surface: &str, value: Value) -> HookEventPayload {
    let mut payload = HookEventPayload {
        hook_event_name: event.to_string(),
        surface: surface.to_string(),
        metadata: value.clone(),
        ..Default::default()
    };
    if let Some(object) = value.as_object() {
        payload.conversation_id = object
            .get("conversationId")
            .or_else(|| object.get("conversation_id"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        payload.generation_id = object
            .get("generationId")
            .or_else(|| object.get("generation_id"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        payload.prompt = object
            .get("prompt")
            .and_then(Value::as_str)
            .map(str::to_string);
        payload.tool_name = object
            .get("toolName")
            .or_else(|| object.get("tool_name"))
            .and_then(Value::as_str)
            .map(str::to_string);
        payload.tool_input = object
            .get("toolInput")
            .or_else(|| object.get("tool_input"))
            .cloned();
        payload.tool_response = object
            .get("toolResponse")
            .or_else(|| object.get("tool_response"))
            .cloned();
        payload.file_path = object
            .get("filePath")
            .or_else(|| object.get("file_path"))
            .and_then(Value::as_str)
            .map(str::to_string);
        payload.stop_hook_active = object
            .get("stopHookActive")
            .or_else(|| object.get("stop_hook_active"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        payload.workspace_roots = object
            .get("workspaceRoots")
            .or_else(|| object.get("workspace_roots"))
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
    }
    payload
}

pub fn empty_config() -> HookConfig {
    HookConfig {
        version: 1,
        hooks: BTreeMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tt_domain::models::customize::HookMatcher;

    #[tokio::test]
    async fn parses_permission_and_message_from_hook_stdout() {
        let mut hooks = BTreeMap::new();
        hooks.insert(
            "preToolUse".to_string(),
            vec![HookMatcher {
                matcher: Some("Read".to_string()),
                command: "node -e \"process.stdout.write(JSON.stringify({permission:'deny',agentMessage:'Blocked by test'}))\"".to_string(),
                timeout_sec: 10,
                fail_closed: false,
            }],
        );
        let config = HookConfig { version: 1, hooks };
        let payload = HookEventPayload {
            hook_event_name: "preToolUse".to_string(),
            tool_name: Some("Read".to_string()),
            ..Default::default()
        };
        let results = dispatch(&config, &payload).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].permission, "deny");
        assert_eq!(results[0].agent_message.as_deref(), Some("Blocked by test"));
        let merged = merge_results("preToolUse", results);
        assert!(!merged.allowed);
    }
}
