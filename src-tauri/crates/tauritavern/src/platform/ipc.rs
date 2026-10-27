//! WebView transfer budgets. Receivers consume these values without knowing the OS.

pub const COMMIT_FRAME_BYTES: u64 = 4 * 1024 * 1024;
pub const UPLOAD_CHUNK_BYTES: u64 = 4 * 1024 * 1024;
pub const SMALL_ASSET_UPLOAD_CHUNK_BYTES: u64 = 4 * 1024 * 1024;
