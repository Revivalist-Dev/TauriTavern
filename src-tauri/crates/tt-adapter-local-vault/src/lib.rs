//! Local vault filesystem adapter.
//!
//! A vault is a folder the user explicitly mounted. All paths crossing the IPC
//! boundary are relative to a mount; this crate resolves them, rejects escapes,
//! and performs the filesystem operation. The frontend never supplies absolute
//! source or destination paths except for native import/export dialogs.

mod entries;
mod error;
mod guard;
mod lore;
mod vault;

pub use entries::{VaultEntry, VaultMount, VaultState};
pub use error::VaultError;
pub use lore::{
    LoreActivationEntry, LoreDirectory, LoreEntry, LoreFolder, LoreMigrationReport, LoreReadResult,
    LoreRetrieval, LoreSearchResult, LoreState,
};
pub use vault::LocalVault;
