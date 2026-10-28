# Host Resource representation and caching contract

This page records the current representation, conditional-request, and platform-delivery contract for TauriTavern's own Host Resource. Ordinary external HTTP/HTTPS resources are not part of this module; the native WebView network stack handles them.

## 1. Scope

The Host Resource Service serves:

- `/css/user.css`
- `/scripts/extensions/third-party/*`
- `/thumbnail`
- `/characters/*`
- `/User Avatars/*`
- `/backgrounds/*`
- `/assets/*`
- `/user/images/*`
- `/user/files/*`

The upstream frontend and third-party extensions can keep using these paths as ordinary browser subresource URLs. The Host Resource Service changes neither URL shape, nor query-parameter meaning, nor character data event semantics.

## 2. Architecture model

The implementation separates four concepts:

```text
Resource        the logical resource a URL points at
Source          the backing file the adapter finally selects and opens
Representation  the bytes + metadata the browser actually observes
Delivery        the response form the current Tauri/Wry/IPC entry point can carry
```

Cache responsibility is split by layer as well: the filesystem is the resource fact, the Rust thumbnail cache is a derived artifact identified by source revision and recipe, the Host Resource Service is the freshness authority for the representation the WebView sees, and the WebView cache only stores opportunistically. A mutation keeps no second revision registry, and correctness does not depend on whether the WebView actually kept a synthetic response.

`tt-ports::HostResourceAssetStore::open` selects the source and opens the file in one step, returning:

- the MIME type, length, mtime, and an opaque source revision;
- a one-shot body reader holding the already-open handle.

That way a local/global extension and an original/generated thumbnail are never re-selected between the metadata and the body read. HEAD or 304 discards the body reader directly without reading the body; after an atomic path replacement, the already-open handle still matches the metadata generated earlier. A body read is hard-bounded by the length seen at open time, and the handle's length and mtime are re-checked afterwards; an external in-place write in the shared data directory, or the Android replace fallback, running concurrently with a read fails fast instead of pairing an old validator with a new body.

HTTP requests and responses use `http` crate types directly. The old string status/header DTOs are gone; Tauri presentation now only does the origin gate, the delivery capability, and response header merging.

## 3. Success and error cache policy

Every current successful response for an unversioned Host Resource uses:

```http
Cache-Control: private, no-cache
ETag: W/"..."
Date: ...
Last-Modified: ...   # when the representation has a reliable file mtime
```

`no-cache` lets the WebView store the response body but requires revalidation before reuse. It is not `no-store`.

The following responses keep using `Cache-Control: no-store`:

- OPTIONS;
- 4xx/5xx;
- 405;
- 416.

No immutable policy is offered today for a data-root-backed mutable Host Resource. Such a resource may be modified by external and symlink writers; a fresh `immutable` hit would bypass Rust entirely and leave the Host Resource unable to see the change. `immutable` suits only genuinely build-time content-hashed resources or content-addressed storage, and is not part of the current Host Resource contract.

## 4. Validators and conditional requests

An ordinary file validator is derived from:

- the source discriminator;
- a high-precision mtime;
- the length;
- the MIME type;
- the representation variant.

The result is stably hashed and marked as a weak ETag. The Host Resource never reads a whole file to compute a strong digest for a metadata request. An mtime in the future is clamped to the response `Date` in the HTTP representation; a file time an HTTP date cannot express gets no `Last-Modified`, and validation still rests on the ETag.

A request is handled in this order:

1. method, path, permission, and file-existence checks;
2. `If-None-Match`, using weak comparison;
3. `If-Modified-Since`, evaluated only when there is no `If-None-Match`;
4. HEAD;
5. `Range` and `If-Range`;
6. the full or range body read, last.

HEAD clears the body at the service's final exit, so neither a success nor an error status carries one; the `Content-Length` still describes the corresponding GET representation.

`If-None-Match: *` and tag lists are supported. A malformed optional conditional header is ignored per HTTP semantics; a malformed or multi-range request still returns 416.

The current file ETag and `Last-Modified` cannot prove strong equality, so a valid `If-Range` never matches: the service ignores `Range` and returns a full 200, which avoids stitching an old partial representation onto a new body.

A 304 carries `Date`, `ETag`, `Cache-Control`, and `Last-Modified` where applicable, and carries no body, `Content-Type`, `Content-Length`, or `Content-Range`.

## 5. Representations per resource

| Resource | Representation identity | Last-Modified | HEAD Content-Length |
| --- | --- | --- | --- |
| user.css | backing file revision + final CSS MIME type | source mtime | exact |
| user-data | kind + backing file revision | source mtime | exact |
| third-party raw | local/global + backing file revision | source mtime | exact |
| `ttCompat=layer` | source revision + transform revision | not sent | omitted |
| thumbnail original | kind + source file revision | source mtime | exact |
| thumbnail generated JPEG | source revision + generator recipe + cached file revision | cached file mtime | exact |

`ttCompat=layer` transforms the body at request time and cannot know the final length before the body is read, so HEAD legitimately omits `Content-Length` rather than using the wrong length of the source CSS.

Thumbnails keep reusing the existing on-disk cache, but a hit no longer depends on the JPEG mtime happening to equal the source mtime. A standard COM marker inside the generated JPEG stores the semantic identity, which binds:

- the source revision formed from source kind, length, high-precision mtime, and MIME type;
- width, height, quality, and resize mode;
- the JPEG/filter/generator schema version.

The identity and the JPEG are one atomic artifact: an old cache entry, or a JPEG produced by upstream SillyTavern or an external process, has no matching COM marker and misses naturally, with no migration branch and no chance of mistaking external bytes for this recipe's output. Encoding runs in parallel outside the lock; the short commit/validation window of a single JPEG serializes. A generation read is bounded by the length seen when the source was opened, and the handle's length and mtime are re-checked after the read; an atomic path replacement still corresponds to the old opened snapshot, while an in-place change fails fast. The generated Host revision uses the same identity, so a change in either the source or the recipe invalidates the on-disk artifact and the ETag together.

A business mutation neither deletes nor pre-warms the thumbnail cache. The original file is always opened before the cache; an old artifact from a deleted file is unreachable, and demand after a recreate or overwrite under the same name replaces it in place because the COM identity does not match. Backgrounds, characters, personas, archive import, sync, and external/symlink writers therefore all follow the same freshness condition, and a cache-maintenance failure cannot disguise a successful business mutation as a failure.

The default `/thumbnail` keeps upstream's selection semantics: a generated JPEG first for a static image, with animation and ordinary thumbnails that cannot be generated falling back to original. `/thumbnail?type=bg&...&static=true` is the gallery/folder-only forced static representation: a decodable GIF/WebP/APNG becomes a first-frame JPEG, and a generation failure is reported as an error, never passed off as an animated original posing as a static preview. MP4 brings in no video-decoding dependency, and the frontend preview uses a placeholder; the active background and media playback always read the raw `/backgrounds/*`.

## 6. Platform delivery

Android's `WebResourceResponse` and the current Wry Android adapter do not support 300-399. The Host Resource therefore makes the standard logical decision first and then delivers it per entry point:

| Entry point | Validator hit |
| --- | --- |
| production Wry, non-Android | 304 |
| production Wry, Android | full 200 |
| dev `tt-ext` Wry, non-Android | 304 |
| dev `tt-ext` Wry, Android | full 200 |
| dev IPC -> JavaScript Response, non-Android | 304 |
| dev IPC -> JavaScript Response, Android | full 200 |

204, an empty 200, or a Wry patch must not be used to simulate an Android 304.

The existing second Range workaround for Android background video stays: a non-zero `Range` returns 206 with the matching range headers but streams the whole file, leaving the WebView to apply the Range itself.

Wry's Android custom-protocol responses default to `Cache-Control: no-store`. The local `RustWebViewClient` applies that default only when the response carries no `Cache-Control` in any casing, so the transport does not overwrite the Host Resource's `private, no-cache`, and error responses keep `no-store`.

## 7. Origin and the development scheme

Production `on_web_resource_request` only accepts a canonical Rust-side URI:

```text
tauri://localhost/...
```

Before routing, presentation checks the scheme and the full authority exactly; a relative URI, an external HTTP/HTTPS URI, another host, or an authority carrying a port never reaches the Host Resource Service.

In development, `tt-ext` is a trusted scheme registered separately. Both the production `tauri` protocol and the dev `tt-ext` are delivered by Wry, so they share one delivery capability. A direct `fetch(tt-ext)` keeps `Request.cache` and `Range`; every entry point keeps the `Range`, `If-Range`, `If-None-Match`, and `If-Modified-Since` request semantics the Host Resource uses. `tt-ext` explicitly exposes response headers on cross-origin fetches, so ETag, Range metadata, and trace headers are not filtered out by CORS.

A cross-origin custom-scheme fetch cannot reliably carry the conditional headers that would trigger a CORS preflight, so `If-Range`, `If-None-Match`, and `If-Modified-Since` requests go over IPC instead; an unconditional request and a single `Range` still go through `tt-ext` Wry. When a WebKit Service Worker context cannot fetch a custom scheme directly, the client bridge fetches the same `tt-ext` endpoint from the window context instead and returns the body through a transferable `ArrayBuffer`; ordinary binary resources must not be downgraded to serde JSON over IPC. A conditional-request IPC call uses the generic header wire to reach the same Host Resource Service: on non-Android platforms it proxies the caller's explicit conditional request to a 304 unchanged, and on Android it returns a full 200 under the platform constraint of the release build; IPC does not enable the second Range workaround that belongs to Wry Android alone. 204/205/304 uniformly use a null body in a JavaScript `Response`. The current contract introduces no Service Worker Cache API and does not claim that IPC generates browser cache validators by itself; what dev and release share is the resource representation and the conditional-request contract, while automatic cache storage stays the responsibility of each transport.

## 8. Constraints for continued development

- Do not add the `stat_xxx`/`read_xxx` method matrix back;
- Do not hand-write string status/header DTOs in presentation or a route handler;
- A new derived representation must fold the transform variant into its ETag and must not invent an unknown `Content-Length`;
- Any observable change to the thumbnail recipe or to the single-file cache format must bump the generator schema; the JPEG COM identity and the generated Host revision must keep using the same identity;
- A data-root-backed mutable Host Resource keeps a stable URL plus `private, no-cache` for the long term; the Host Resource Service is the freshness authority for the representation the WebView sees, and that is not a temporary fallback before adopting `immutable`;
- Do not build a mutation revision registry or an `immutable` URL for a mutable Host Resource. The data root admits external/symlink writers; a fresh `immutable` hit would bypass the Host Resource and make an external change undiscoverable;
- A first-party ordinary browser resource must not bypass this service through the Tauri asset protocol, a base64 read command, or the server-thumbnail Blob cache;
- A mutation only establishes the file fact: it neither maintains nor deletes the Rust derived cache, and it does not pre-warm the WebView cache. The representation is refreshed afterwards by real consumer demand on the stable URL, and a request that has to bypass a response the WebView already holds uses `Request.cache = "reload"` rather than a random query pretending to be a revision; the refresh is not part of the commit;
- The frontend keeps only the background preview cache, which has a derivation responsibility of its own; a host background record must bind the current raw ETag and the preview recipe;
- The WebView synthetic response cache is an optimization only and must not become a precondition for business correctness;
- A Wry upgrade must re-audit Android 3xx, header, and cache-control behavior.
