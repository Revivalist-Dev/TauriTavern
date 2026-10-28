# Shared frontend controls and accessibility semantics

Features supply names, content, and business state; the browser and shared controls supply shared behavior. New features hook in through these entry points so behavior is not reimplemented locally.

## Plain controls and legacy markup

New actions use `button type="button"`, navigation uses links with an `href`, and fields use native form elements associated with a label. Templates or components supply the name, description, and translation; when the legacy structure is kept, `aria-labelledby` and `aria-describedby` can associate the actual text.

A field name references a span inside the heading that contains only the heading text: the id is `<control id>_label`, the text `data-i18n` goes on the span, icons, links, and buttons sit outside the span, and the heading container stays as it is. When the native label contains only the heading text, associate it directly; otherwise the field references the span with `aria-labelledby`. Code reads names with [`getControlName`](../src/scripts/dom-handlers.js) and `getEditorName`; dynamic instances use `setAriaRelation` to associate the actual node, and `ensureElementId` assigns the ids they need.

Icon help links are named "Docs + object": `aria-label="Docs"` (`data-i18n="[aria-label]Docs"`) and `aria-labelledby="<link id> <heading span id>"`.

[`legacy-controls.js`](../src/scripts/legacy-controls.js) fills in roles, focus, and keyboard activation for legacy controls in one place, while keeping the public entry points of `a11y.js` and `keyboard.js`. Native behavior and author-declared roles take precedence; legacy non-native buttons activate through click, and the keyboard handles only the actual target.

Styling and business state cannot decide control semantics on their own: a grouping container is not a button, and `.disabled` on an item does not mean the actions inside it are unavailable. Existing extensions' DOM, role, and focus conventions are kept according to their actual purpose.

Character card scripts can create controls in a same-origin iframe and then attach them to the host page. The drawer and legacy control adaptation layer recognize these nodes by node type and HTML namespace; attaching them does not change their JavaScript prototype, so `instanceof HTMLElement` from the main window cannot be used to exclude them.

## Paired numeric controls

[`dom-handlers.js`](../src/scripts/dom-handlers.js) manages the existing `.range-block-counter` and `.neo-range-input` number boxes together with the range that `data-for` points at. The number box allows an editable draft, and `change`, Enter, and the mouse wheel submit along the range's existing `input` business path; an invalid value stays in the field for correction, is not written to settings, and does not block leaving the field.

All values are submitted to the business value through the range's `input`, and the number box and Zen slider only project from the range; changing `min/max/step` sends an `input` as well. Formatting and saving remain each API's responsibility.

Restoring saved values (startup, switching presets, applying the model context) follows "final constraints → write value → `input`", and every value is written through `restoreNumericInput`. It accepts only finite numbers, and each API's data layer supplies the defaults: Kobold and NovelAI use their own default tables, a Text Completion preset covers only the fields it provides, and the general reply length and context keep the declared defaults. Values outside the final range are adjusted, and the action entry point uses `showNumericAdjustments` to report them once, grouped by source; when the user tightens the constraints, values are clamped with no notice.

The Zen slider does not write the business value when it is created or refreshed. When the value is not on a step, it shows the real value and takes the nearest step position, and the step value is submitted only after the user drags it.

## Select2

Names and descriptions are written on the native select: its label, `aria-labelledby` or `aria-label`, and `aria-describedby`. [The Select2 patch](../src/scripts/select2-accessibility.js) attaches these relationships, together with the current value, to the element that actually has focus, and routes scripted clicks through the original selection path; trusted activation has already been through mousedown/mouseup, so it is not handled twice. Remove the patch once upstream ships an equivalent fix.

## Sortable lists and control shells

[`sortable-list.js`](../src/scripts/sortable-list.js) provides dragging and move up/move down buttons for a list. DOM order is the only positional fact, and features read and save it in `onReorder`; items added later hook in through the returned `addItem`. `setSortableListEnabled` disables dragging and the sort buttons together.

`.tt-control-shell` is the visible shell of a native control: the control itself uses `.sr-only` and still takes part in keyboard use, screen readers, and Agent actions; the shell is relatively positioned and draws the inner focus ring. Icon toggles (a checkbox whose associated label carries `.not_focusable`), avatar upload, and list items share this pattern. The legacy adaptation layer does not infer roles or keyboard behavior for the shell; the Agent treats the shell as the visible click surface and dispatches the click to the native control. This rule lives in the in-app-agent's `createInteractionOptions` and changes together with the shell structure.

A list item keeps its existing container, whose first child is the native primary action button (`:scope > .sr-only`, `CONTROL_SHELL_CLASS` in JS), and clicks bubble to the existing item handler. The primary action's name references the item heading, and its description references only short facts such as dates and counts; secondary actions are parallel native buttons read as "action + object" (`title` supplies the action, and `aria-labelledby` references the button itself and the item name). Templates declare the list and listitem roles.

Icons come from Font Awesome 6.7.2, and `content: var(--fa) / ""` keeps the decorative glyph out of the accessible name (older WebKit still shows the glyph); icon pseudo-elements take their font from Font Awesome's font variable instead of inheriting the control's text font, and icon pseudo-elements written in the core follow the same rule. Verify names against the browser's native accessibility tree.

## State and focus across redraws

ARIA is a projection of existing business state, updated by whoever writes that state: selections and toggles use `aria-pressed`, the current item uses `aria-current` (`"page"` for pagination) and drops it once it is no longer current, and expansion uses `aria-expanded`. State is expressed by state attributes only, and names do not change with state; supplementary descriptions (a tri-state label's include/exclude, or "used in this chat" for a character connection) use `aria-describedby`. A button that opens a preferences dialog does not declare a toggled state.

Replacing a whole list uses `keepFocus(getItems, keyOf, write)`: asynchronous preparation happens outside, `write` removes and inserts synchronously in one pass, controls can be focused as soon as the write returns, and identity keys stay stable for as long as an item exists. It restores only focus that was already inside the list, trying the same item, then the same index, then the nearest item; with no target it returns `false`, and the caller focuses the search or new-item entry point. Plugin synchronous write hooks use `captureFocus`.

A file operation fixes its target (owner identity and file name) when the action starts and never reads the current selection or an array index afterwards. Exported entry points keep the upstream signature: an entry point that takes a character index resolves the avatar synchronously at call time, and the index does not cross an await. Chat items (recent chats, chat history) carry their target in `data-avatar / data-group / data-file`, internal code reads only those attributes, and `file_name` is kept for external DOM consumers.

Navigation functions (`selectCharacterById`, `openGroupById`) focus the destination, and chat loading functions only load; mobile does not focus, and focus does not move while it sits in a visible input or textarea. Navigation progress uses no modal, and navigating from chat history closes the panel first. The blocking overlay for list modification covers file operations only, and the list redraws after it closes.

A character row uses the avatar as its focus key and keeps the external contract of `id` and `data-chid`. Entering or leaving a folder and returning to page 1 combine into a single render intent that `printCharacters` consumes once: it focuses the target explicitly, or the first item when the target is not on this page.

[`initPagination`](../src/scripts/pagination.js) owns the pagination configuration, page-size persistence, semantics, and navigation focus, and the caller renders list content. An in-place redraw keeps the page number, and the caller names the target page when the data changes; `getPageForItem` computes the page an item is on.

## Action selects and non-modal overlays

The More... menus for characters, Personas, and group chats keep a native select. The handler runs the chosen option's action, or waits for `CHARACTER_MANAGEMENT_DROPDOWN`, and resets to the first item only at the end, so an extension's synchronous change listener can still read the chosen option. Native arrow keys are not intercepted.

The advanced definitions, chat history, and group member overlays each have one toggle function that shows and hides them, and closing returns focus to the trigger control only while focus is still inside the overlay. Advanced definitions and chat history are named non-modal `role="dialog"` elements that focus an entry point inside the overlay when opened (chat history on mobile focuses the overlay itself so the keyboard does not appear); the group member overlay is a draggable floating panel whose open button, like that of other floating panels, declares no expanded state.

## API connections

Connect with a secret reads the secret state first, then saves the new input and connects; a failure ends this operation only and does not rewrite or roll back a secret that is already saved. `startStatusLoading` / `stopStatusLoading` manage the busy state, Cancel's visibility (`displayNone`), and focus between Connect and Cancel in one place; `displayOnlineStatus` is the only writer of the status text.

## Drawer

[`drawers.js`](../src/scripts/drawers.js) manages expansion state, ARIA relationships, and change subscriptions.

| Type | State and entry points |
| --- | --- |
| Top-level panel | `.openDrawer` means expanded; `isTopLevelDrawerOpen`, `setTopLevelDrawerOpen`, and `subscribeDrawerState` read, change, and subscribe |
| Inline | The `up/down` state of the icon that actually triggered it carries the logical expansion; `isInlineDrawerOpen` reads it, `toggleInlineDrawer` is for animated clicks, and `setInlineDrawerOpen` is for immediate changes |

Expansion state follows the existing DOM class. The shared implementation accepts extension changes to the class of a recognized drawer and keeps the association between a moved panel and its trigger control. First-party bundles reuse the page's module instance and its state subscriptions.

An Inline drawer's display belongs to the animation, and an immediate change cancels the old animation. `inline-drawer-toggle` keeps the ecosystem's ordering: a click dispatches its notification with `detail.open` before the animation, and an immediate change dispatches a notification without detail after updating display. `utils.toggleDrawer()` stays as the legacy entry point.

## Popup

[`popup.js`](../src/scripts/popup.js) takes a name, or a visible heading inside the popup, through the optional `label: string | HTMLElement` and establishes the ARIA relationships in one place. The `Popup.show.*` helpers use the header they are given automatically.

The main input takes a string or an element inside the popup through `inputLabel` and `inputDescription`, which state the field's purpose and description. A feature that must await a save result reuses the asynchronous `onClosing`: success allows closing, and failure returns `false` and keeps the input; the feature supplies the busy and result text.

A built-in button's keyboard and pointer paths share the click path; text input keeps multiline input, Ctrl+Enter, and the `.result-control` submission rules.

In custom results, `undefined` runs the action only, `null` means cancel, and a number means the matching result. Disabled controls block user actions, an explicit `complete*()` can still close the popup programmatically, and Popup owns the asynchronous `onClosing`, nested focus, and the popup lifecycle.

## Chat input, menus, and message actions

The send button, Enter, and the full-screen editor share `sendTextareaMessage()`. Mutual exclusion for ordinary generation sits at that entry point; Agent guidance submits through a separate branch of the same entry point, and its name is decided from the current draft and the active Run together. While a guidance draft exists, the stop button stays hidden under the existing display rules. The generation status description states only the current phase: it does not treat the end event as success, and it does not announce message text token by token.

[`popup-menu.js`](../src/scripts/popup-menu.js) owns the expansion relationships, focus, and closing of the chat options, extensions, export, and bulk action menus. Panels navigate with Tab; Escape, an outside click, or running an action closes them, and tabbing away does not. Programmatic use goes through the `{ open, close, isOpen }` returned by initialization, which updates display, ARIA, and focus together; return focus to the visible trigger before opening a Popup. Each caller handles Shift+F10 and the menu key for context menus itself, because the WebView does not always emit `contextmenu`. Each caller supplies its feature logic, Popper positioning, and special interactions that keep a menu open.

Message actions share click activation, and the more-actions menu keeps its trigger after it expands. A message instance associates the existing author with the floor text, and renumbering keeps updating that same text; the edit box and the delete selection inherit this context. Confirm, cancel, and delete restore focus for the current action only and do not change the save queue, the autosave semantics, or the ChatSurface residency policy.
