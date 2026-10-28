# Media asset contract (current state)

This document records the **already landed** "browser-native media loading contract": how `<video>` / `<audio>` request the user static resource endpoints on desktop and mobile (especially `/backgrounds/*`), and what response semantics the host currently guarantees.

> Implementation: `src-tauri/crates/tt-application/src/services/host_resource_service/user_data.rs`

---

## 1. Scope and conclusions

Goal (public contract):

- Upstream SillyTavern and third-party extensions can use paths such as `/backgrounds/*` as ordinary HTTP resource endpoints (subresource loading plus Range).
- Media files (`video/*` / `audio/*`) must satisfy the browser media pipeline's minimum network contract: **support `Range` (single range) and return `206 + Content-Range`**.

Endpoints involved (served by the Host Resource Service):

- `/backgrounds/*` (image backgrounds and video backgrounds)
- `/assets/*`, `/user/files/*` (which may carry audio, video, or downloadable content)
- and the other user static resources the same implementation covers: `/characters/*`, `/User Avatars/*`, `/user/images/*`

---

## 2. Base endpoint semantics (all platforms)

These endpoints must be loadable by the browser as native subresources (`<img src>` / `<video src>` / CSS `url()`), with identical semantics in dev and prod:

- Only `GET` / `HEAD` / `OPTIONS` are accepted; any other method returns `405`
- A miss returns a real `404` (no fallback to `index.html`)
- `Content-Type` must match the file type (inferred from the extension)
- Successful responses use `Cache-Control: private, no-cache`, a weak ETag, and Last-Modified; for the full representation and conditional-request contract see `docs/CurrentState/HostResourceCaching.md`
- `Accept-Ranges: bytes`
- A symlink inside the data root may point at a file or directory outside it, so the same data set can be shared with SillyTavern.

First-party `<img>`, `<video>`, CSS, and ordinary fetch must use these Host Resource URLs directly.

The background picker's preview does not change the media consumption contract. GIF/WebP/APNG can be shown as the raw animation or, per the setting, as a `static=true` first-frame JPEG; the MP4 picker uses a placeholder image, because no video-decoding dependency is introduced for posters today.

---

## 3. Range contract (single range)

Supported `Range` forms (single range only):

- `Range: bytes=<start>-<end>`
- `Range: bytes=<start>-`
- `Range: bytes=-<suffixLen>`

Response semantics:

- Range satisfied: `206 Partial Content`
  - `Content-Range: bytes <start>-<end>/<total>`
  - `Content-Length: <rangeLen>`
- Illegal or unsatisfiable: `416 Range Not Satisfiable`
  - `Content-Range: bytes */<total>`

Explicitly unsupported:

- Multi-range (for example `bytes=0-1,2-3`) is treated as an illegal Range and returns `416`.

---

## 4. Android WebView differences and the current workaround (video backgrounds)

Symptoms (a historical problem):

- Android's `WebResourceResponse` does not support 3xx, so when a Host Resource validator hits, a full 200 is returned instead of a 304;

- The Android WebView request sequence for `video/mp4` usually contains several Ranges (for example `bytes=0-`, `bytes=131072-`, and a tail Range).
- In Tauri mobile's resource interception chain (`shouldInterceptRequest`), the Android WebView applies the requested Range semantics **again** to the response stream returned by the interception.
- If the host has already seeked and sliced by Range, a Range with a non-zero start triggers a second seek that cannot be satisfied: the result is a `416` or a request cancelled almost immediately, and the `<video>` ends up stuck at `HAVE_NOTHING`, never reaching `loadedmetadata`.

Workaround currently landed (Android + background video + a non-zero Range start only):

- Matching conditions:
  - platform: Android (WebView interception chain)
  - path: `/backgrounds/*`
  - MIME: `video/*`
  - Range: `start != 0`
- Response strategy:
  - return **`206` with a correct `Content-Range` / `Content-Length` (matching the requested range)**
  - but supply the **complete file bytes** as the body, leaving the WebView to apply the Range (skip) on the stream itself before feeding the media pipeline

This keeps the HTTP contract observable to the media pipeline and sidesteps Android WebView's second Range application.

Known cost:

- These requests read the whole file into memory, which can add memory and I/O pressure when a background video is large.

---

## 5. Regression and diagnosis points

Minimal regression probe (desktop and mobile alike):

- `fetch('/backgrounds/<file>.mp4', { headers: { Range: 'bytes=0-1' } })` should return `206` with a `Content-Range`

On Android, also watch for:

- A Range with a non-zero start, such as `Range: bytes=131072-`, should still return `206` with a `Content-Range`
- If a `<video>` stays at `readyState=HAVE_NOTHING` for a long time, check first whether the Range contract has been broken (`206`, `Content-Range`, and whether the request is cancelled almost at once)

When media encoding compatibility has to be confirmed (a decoding-layer problem):

- Use `ffprobe` to check the video codec and the audio channel layout (AAC 5.1 can be a compatibility risk on Android).
