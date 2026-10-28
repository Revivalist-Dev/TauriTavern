use async_trait::async_trait;

use tt_domain::errors::DomainError;
use tt_domain::models::update::{ReleaseInfo, UpdateChannel};

#[async_trait]
pub trait UpdateRepository: Send + Sync {
    /// Fetch the release currently published for the given update channel.
    async fn get_release(&self, channel: UpdateChannel) -> Result<ReleaseInfo, DomainError>;
}
