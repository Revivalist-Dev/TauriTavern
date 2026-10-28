# Custom Endpoint Access

## Boundaries

`custom_url` and `reverse_proxy` are required SillyTavern compatibility features, and they are also
the network egress that third-party extensions running inside the WebView can control. TauriTavern
requires a one-off native Rust dialog authorization for every user-configured endpoint; the public
internet, the local network, loopback, LAN hostnames, and the fake IPs that proxy software hands out
all follow the same rule. Built-in provider endpoints need no authorization.

This mechanism does not identify the extension. An extension can trigger the dialog, but it cannot
confirm on the user's behalf; once the user authorizes, any code in the same WebView can use that
endpoint. A finer WebView/native capability boundary is designed separately.

## Authorization and transport

- Reuses `parse_user_http_endpoint` to normalize the URL, and rejects anything that is not HTTP(S),
  along with userinfo, query, and fragment components.
- A grant stores the normalized endpoint string, covering scheme, host, port, and base path exactly.
- The three Rust commands — status, non-streaming generate, and streaming start — share one native
  authorization gate, so compatible routes and extension requests need no separate pre-check.
- The HTTP pool checks the grant independently on every user-endpoint request, so a call that
  bypasses the command gate fails closed.
- Explicit loopback, RFC1918, and IPv6 ULA addresses, plus `localhost`, are forced to Direct; every
  other endpoint follows the Request Proxy setting.
- DNS results take no part in authorization or transport classification, so a LAN hostname or a fake
  IP is never misjudged by the address it resolves to.
- Redirects are capped at 5 and must be same-origin.

The Rust host composes the security copy and the normalized endpoint for the native dialog; the
WebView supplies only a locale, never the displayed copy or the confirmation result. A user
cancellation is an ordinary cancellation state and is not wrapped up as a connection error.

## Persistence

A grant is a JSON string array, stored at:

```text
<app_root>/security/user-endpoint-grants.json
```

It does not follow `data_root`, data backups, or import migration. A missing or unreadable file boots
with empty grants. A native confirmation authorizes the current session immediately and then persists
atomically; a write failure only records a warning, the current connection continues, and the user
has to confirm again after a restart.

The old `local-endpoint-grants.json` is neither read nor migrated.

The iOS system Local Network permission is independent of this grant. When Android moves to a target
SDK that requires `ACCESS_LOCAL_NETWORK`, that platform permission must be wired up separately as
well.
