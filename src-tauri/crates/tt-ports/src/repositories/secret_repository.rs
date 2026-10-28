use async_trait::async_trait;

use tt_domain::errors::DomainError;
use tt_domain::models::secret::Secrets;

#[async_trait]
pub trait SecretRepository: Send + Sync {
    /// Persist all secrets
    async fn save(&self, secrets: &Secrets) -> Result<(), DomainError>;

    /// Load all secrets
    async fn load(&self) -> Result<Secrets, DomainError>;

    /// Clear in-memory repository cache to reflect external file changes.
    async fn clear_cache(&self) -> Result<(), DomainError>;

    /// Write a single secret and return the new secret ID
    async fn write_secret(
        &self,
        key: &str,
        value: &str,
        label: &str,
    ) -> Result<String, DomainError>;

    /// Read a single secret (by ID, or the currently active one)
    async fn read_secret(&self, key: &str, id: Option<&str>)
    -> Result<Option<String>, DomainError>;

    /// Delete a single secret (by ID, or the currently active one)
    async fn delete_secret(&self, key: &str, id: Option<&str>) -> Result<(), DomainError>;

    /// Rotate the active secret
    async fn rotate_secret(&self, key: &str, id: &str) -> Result<(), DomainError>;

    /// Rename a secret
    async fn rename_secret(&self, key: &str, id: &str, label: &str) -> Result<(), DomainError>;
}
