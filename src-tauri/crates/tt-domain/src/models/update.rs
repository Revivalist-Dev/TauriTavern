use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Canary,
}

/// Core GitHub Release fields that the updater cares about.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseInfo {
    /// Release tag, for example "v2.1.1" or "Canary".
    pub tag_name: String,
    /// Semantic version of a Stable release; Canary is identified by source_revision instead.
    pub version: Option<String>,
    /// Commit SHA the Canary tag points at; Stable releases leave this unset.
    pub source_revision: Option<String>,
    /// Release title.
    pub name: String,
    /// Release body (the Markdown changelog).
    pub body: String,
    /// URL of the GitHub Release page.
    pub html_url: String,
    /// Whether this release is a pre-release.
    pub prerelease: bool,
    /// Publication time (ISO 8601).
    pub published_at: String,
}

/// Outcome of an update check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    /// Whether an update is available.
    pub has_update: bool,
    /// Currently installed version.
    pub current_version: String,
    /// Channel used for this check.
    pub channel: UpdateChannel,
    /// Stable release identity, used to de-duplicate the startup prompt.
    pub release_token: Option<String>,
    /// Release information for the newest version; only set when has_update is true.
    pub latest_release: Option<ReleaseInfo>,
}
