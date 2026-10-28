# Sync (LAN Sync / TT-Sync v2)

LAN Sync and remote TT-Sync share the v2 dataset, plan, transport, and commit semantics. This document
describes responsibilities and the stable contract; the source is authoritative for actual fields,
parameters, and defaults.

## Architecture and data direction

| Topology | Connection and transport |
| --- | --- |
| LAN Sync | Devices connect over HTTPS; nearby discovery, manual addresses, and pairing links are supported. An upload completes by asking the peer to pull. |
| TT-Sync | Binds a remote service through a server-side invitation link, and supports direct upload and download. |

The application layer owns pairing, preferences, and job orchestration, `tt-adapter-sync` carries the
networking, storage, and the shared transfer engine, and the Tauri host owns commands, events, and
platform capabilities. The layering follows [Backend structure](../BackendStructure.md).

## Data scope and write constraints

- Both topologies use the same `DatasetPolicy`, and the job scope is decided by the user's
  `DatasetSelection`. A new data type belongs in the unified policy; the panel only selects datasets
  and keeps no path rules.
- Sync's own identity, pairing records, and configuration, along with the local platform policy cache,
  are always excluded from the sync scope. Sensitive or heavy data such as user secrets and model
  responses requires an explicit user choice.
- Agent data syncs as ordinary files within the selected scope, with no extra parsing or restriction,
  and existing material is not filtered out because of it.
- When an agent resumes, it validates the local checkpoint and run material of the selected run on
  demand. The Full scope includes the recovery material; the default core history alone is not enough
  to resume. Resume eligibility does not depend on sync job state. Sync provides no cross-device run
  lock and no live snapshot consistency.
- Local sync writes share a mutual-exclusion gate with changes such as extension installation and
  updates, and a conflict fails outright; a job that only sends a peer-pull request does not hold the
  local write permit.
- `Exact` keeps the sync source authoritative; `PreferNewer` protects same-path files on the target
  whose modification time is strictly newer, and it relies on device clocks being roughly in sync. The
  overwrite policy belongs to the logical initiator and applies to manual and automatic sync alike.
- Mirror deletions run at the delete or commit stage according to the plan, and directory cleanup
  happens only inside the corresponding dataset boundary. Symlinks are not supported in the sync
  scope.
- Each file publishes atomically and keeps its modification time; incremental decisions rely on file
  size and modification time. After a failure the files already completed are kept, a retry rescans and
  recomputes the plan, and there is no byte-level bundle resume.
- Whenever local data changes because of a success or a partial failure, the affected runtime caches
  must be refreshed. When a capability, permission, or dataset version requirement is unmet, the job
  fails before any user data is written; the Sync Panel requires bundle and zstd support.

## The TriviumDB database

`extensions.databases` uses the namespace as the unit of sync and commit, keeping or replacing a whole
database rather than merging records. It is absent from the default scope and present in Full; both
sides must support this scope.

`Exact` defers to the source; `PreferNewer` compares the newest modification time in the file group
before maintenance and keeps the target only when the target is strictly newer. Incremental keeps
namespaces unique to the target, and Mirror deletes them.

Sync and archiving share a database maintenance lock that spans scanning through publishing. The sender
flushes and then reads the original file; the receiver closes the instance and publishes the whole set
once every file is in. Caller handle lifetimes are in
[Database API](../API/Database.md#maintenance-errors-and-data-migration).

## Independent settings scope

Core settings, the current appearance and theme, the current preset and prompts, the current layout,
and the user persona can be synced independently. The configuration in effect is selected separately
from the preset library and the theme library.

User persona data lives in the avatar PNG, while the selection and the preferences are stored
separately; both belong to one sync item. Old data is converted at startup and on import, and the API
and archive exports keep the upstream full-settings format. Each partition syncs as ordinary files,
and TT-Sync maintains the path rules in one place.

## LAN discovery and trust

Discovery only provides device location and public information; it establishes no trust and triggers
no sync. Nearby devices, manual addresses, and pairing links share one pairing flow, which starts the
local receiving service on demand and is confirmed by the user on the other side; the QR code is a
secondary entry point. Pairing links keep the v2 format, so older LAN v1 devices have to pair again.

The device name, platform, and address are mutable information; device identity and trust are stored
independently. A connection without a pinned certificate can only read public device information;
pairing and data transfer use SPKI certificate pinning. When a paired device changes address, the
stored fingerprint and `DeviceId` must still be verified, and the existing authorization and identity
are kept.

A LAN upload keeps the initiator's overwrite policy, but the actual pull uses the target device's
effective Sync mode; the right to execute Mirror deletions sits with the target. "Request accepted"
and "data synced" are different outcomes.

Local broadcast follows the receiving service's start and stop, and can be discovered independently
when only downloading. A discovery failure neither deletes pairings nor disables still-usable HTTPS
connections; stopping the receiving service does not cancel local download jobs that were already
accepted.

Local addresses fall into three classes by purpose: **available addresses** list every non-loopback
IPv4 address, including VPN and mesh-network addresses; the **default address** is used for pairing
links and prefers the address on the default route of a running broadcast interface, where broadcast
interfaces include virtual bridges and TAP devices; the **return address** is the source address of the
local route to the peer, taken at pairing time.

Nearby discovery uses mDNS / DNS-SD. iOS is restricted from direct multicast and uses the system
Bonjour implementation, which macOS shares; Android, Windows, Linux, and HarmonyOS use the Rust mDNS
implementation. Both backends share the service information and the device directory, and the
discovery backend handles record refresh and expiry.

LAN features are gated by the host's `sync.lan` capability and constrained by Windows network permissions.

## Panel, events, and automatic sync

The panel calls the backend through the host boundary, and Rust performs the transfer and scheduling.
Saved configuration is separate from the edit draft, so a refresh neither submits nor overwrites the
draft; the device cards and the automatic-sync targets share their display data, and a local note does
not change the peer's identity.

Both topologies express job progress and results through `sync:job`. A manual job drives its completion
notice from the report the command returns, while a background job is notified by event, which avoids
duplicate notices. Discovery changes and pairing completion are notified separately, and a
pairing-completion notice may only be published after the record is saved.

Automatic sync only starts uploads while the application process is running, using separately saved
targets, scopes, and modes. A TT-Sync target needs the corresponding write and delete permissions; a
LAN target keeps the peer-pull semantics, so an accepted request is all that can be recorded as sent.
Automatic tasks open no manual progress dialog and force no page refresh.

Starting the receiving service with the application and automatic upload are separate settings;
enabling the receiving service and discovery does not approve pairing for a new device.

## Source entry points

| Responsibility | Entry point |
| --- | --- |
| Pairing and configuration use cases | [LAN service](../../src-tauri/crates/tt-application/src/services/lan_sync_service.rs), [TT-Sync service](../../src-tauri/crates/tt-application/src/services/tt_sync_service.rs) |
| Job and automation scheduling | [Job coordinator](../../src-tauri/crates/tt-application/src/services/sync_job_coordinator.rs), [Automatic sync service](../../src-tauri/crates/tt-application/src/services/sync_automation_service.rs) |
| Job contract | [Shared DTOs and events](../../src-tauri/crates/tt-contracts/src/sync.rs) |
| Networking, storage, and data scope | [Shared sync implementation](../../src-tauri/crates/tt-adapter-sync/src/sync/), [TT-Sync adapter](../../src-tauri/crates/tt-adapter-sync/src/tt_sync/) |
| Discovery protocol and runtime parameters | [LAN discovery](../../src-tauri/crates/tt-adapter-sync/src/sync/lan/peer_discovery.rs) |
| Tauri integration | [Service assembly](../../src-tauri/crates/tauritavern/src/app/composition/services/sync.rs), [Events and approval adapter](../../src-tauri/crates/tauritavern/src/app/composition/adapters/tauri_sync.rs) |
| Frontend interaction | [Panel and controller](../../src/scripts/tauri/setting/sync-app/), [Host adapter](../../src/scripts/tauri/setting/setting-panel/sync-popup.js) |
