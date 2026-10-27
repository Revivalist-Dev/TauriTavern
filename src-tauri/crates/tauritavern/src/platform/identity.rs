//! Compile-target facts shared by native composition and the main WebView.

use tt_contracts::host::{HostIdentity, HostKind, HostPlatform};

const PLATFORM: HostPlatform = HostPlatform::Windows;
const KIND: HostKind = HostKind::Desktop;

pub const HOST_IDENTITY: HostIdentity = HostIdentity {
    platform: PLATFORM,
    kind: KIND,
};

pub fn initialization_script() -> String {
    let identity = serde_json::to_string(&HOST_IDENTITY).expect("host identity is serializable");
    format!(
        "if (window === window.top && !window.__TAURITAVERN_HOST__) {{ \
         Object.defineProperty(window, '__TAURITAVERN_HOST__', {{ value: Object.freeze({identity}) }}); \
         }}"
    )
}
