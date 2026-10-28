# `window.__TAURITAVERN__.api.layout` — content viewport

In the Windows desktop build the content viewport is the WebView2 client area; there is no system bar or keyboard avoidance to subtract. Extensions can lay out by ordinary browser rules, with no need to detect the host or handle insets.

```css
.my-panel {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
}
.my-panel-content {
    flex: 1;
    min-height: 0;
    overflow: auto;
}
```

`100vh`, `100dvh`, `window.innerHeight`, `position: fixed`, `<dialog>` and iframes all use their normal browser coordinate space. `--doc-height` is a static CSS alias: `100dvh` where supported, `100vh` otherwise.

## Reading and subscribing

```js
const layout = window.__TAURITAVERN__.api.layout;
const snapshot = layout.snapshot();
const unsubscribe = await layout.subscribe(snapshot => {
    console.log(snapshot.viewport.width, snapshot.viewport.height);
});
await unsubscribe();
```

The host reports `abiVersion: 2`; layout snapshots carry `version: 2`, with lengths in CSS px:

- `timestampMs`: when the snapshot was read.
- `viewport`: the visual viewport's `{ left, top, width, height, right, bottom }`; falls back to the layout viewport when the VisualViewport API is unavailable.
- `safeFrame`: the same as `viewport`.
- `safeInsets`: `{ top: 0, right: 0, bottom: 0, left: 0 }`.
- `ime`: `{ bottom: 0, viewportBottomInset: 0, keyboardOffset: 0 }`.

`safeInsets` and `ime` describe the parts of the viewport the page still has to avoid for itself; the host has already consumed all of them, so they are zero. A subscription delivers one snapshot immediately, then coalesces window resize and visual viewport resize/scroll events per frame. Listeners are removed when the last subscription is cancelled.

## Capture

`await layout.capture()` returns an `image/png` Blob of the current content viewport, part of the Project Contract used by first-party code. The image's top-left corner maps to content viewport `(0, 0)` and its width maps to `window.innerWidth`; the resolution is platform-defined, so callers convert CSS coordinates by dividing the image width by the viewport width. System bars are not in the image, and the host neither scrolls the page nor stitches in content from outside the viewport.

The caller is responsible for waiting for a repaint; the native interface only reads pixels. On Windows it takes a window screenshot and crops it to the content viewport. Failures reject the Promise directly; the Web Host rejects with `Unsupported`.

## Legacy contract

- `ime.activeSurface` and `ime.kind` have been removed.
- `--tt-inset-*` remains as an alias for `env(safe-area-inset-*, 0px)`; `--tt-viewport-bottom-inset` is an alias for `--tt-inset-bottom`.
- `--tt-ime-bottom` and `--tt-base-viewport-height` have been removed.
- The `data-tt-mobile-surface` attribute and `SURFACE`/`applySurface()` in `layout-kit.js` have no layout effect and are kept only for existing callers.
- `getLayoutApi()`, `waitForHostReady()` and `subscribeLayout()` in `layout-kit.js` remain available.

Extensions that use the old keyboard offset, spacers or safe-area compensation should delete that code and lay out directly against the content viewport.
