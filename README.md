# Snap Layouts

A GNOME Shell extension that brings Windows 11-style **Snap Layouts** to GNOME: click a small button near a window's own maximize button to pick a tiling layout, and get **Snap Assist** suggestions and **dynamic tiling resize** on top of it.

## Features

- **Snap Layouts popup** — click the overlay button next to a window's maximize button to choose from several layout templates (50/50, thirds, columns, 4-way grid, and more). The app's own maximize button is left completely untouched.
- **Snap Assist** — after snapping into one zone of a multi-zone layout, the remaining empty zone(s) are highlighted right on screen with your other open windows offered as one-click choices to fill them, just like Windows 11.
- **Dynamic tiling resize** — drag-resize one tiled window and any other window whose edge is touching it resizes to follow, so layouts stay gapless instead of leaving empty space.
- **Draggable, per-app button position** — the overlay button can be dragged to a different spot along the title bar; each app remembers its own position independently.
- **Configurable gap** between tiled windows (defaults to 0 — seamless, edge-to-edge).
- **Aspect-ratio-aware layouts** — layouts that don't make sense on a narrow/portrait monitor simply don't show up there.
- Preferences window for enabling/disabling individual layouts, Snap Assist, the gap size, and per-app clearance overrides (for apps whose own window controls need extra room).

## How it works

**Trigger.** GNOME Shell has no reliable way to intercept a click on a window's own maximize button — that button is drawn by the client application, not Shell, so pointer events over it don't consistently reach Shell's actor tree. Instead, `windowButtonManager.js` draws a small *Shell-owned* button (an `St.Button`) next to it, tracking every window's position/size so the button stays correctly placed through moves, resizes, and maximize/restore. Clicking this button is exactly as reliable as any other Shell UI element, because there's no interception involved.

**Popup.** `layoutOverlay.js` renders the layout-template popup near the button. `layouts.js` defines each template as a list of zones expressed as *fractions* of the work area (`{x, y, w, h}` in `[0,1]`), so the same templates scale to any monitor; templates declare a minimum aspect ratio so, e.g., a 3-column layout doesn't show up on a portrait display. Picking a zone calls into `windowSnapper.js`, which converts the fractional zone into real pixels and calls `move_resize_frame()`.

**Snap Assist.** If the chosen template has more than one zone, `snapAssistOverlay.js` highlights the remaining empty zone(s) at their real on-screen position, each listing your other open windows (filtered by `windowQuery.js`'s shared "is this actually a real, tileable window" logic — dialogs, pickers, and similar transient windows are excluded) as clickable chips. Dismissing on an outside click uses a plain, invisible, full-screen actor placed *behind* everything else — Clutter's normal picking naturally sends a click on a chip to the chip and any other click to that backdrop, which is simpler and more reliable than manually computing click coordinates against a rectangle.

**Dynamic tiling.** `windowTiling.js` tracks every real window's geometry via its own `'size-changed'` signal (not `Meta.Display`'s grab-related signals, which only fire for resizes Mutter itself drives — plenty of real windows, e.g. Wine apps that paint their own border, never go through that path). On a genuine size change, it diffs against the window's last-known rect to see which edge moved, and propagates that to any other tracked window on the same workspace + monitor whose matching edge was touching it — growing or shrinking that neighbor to close the gap rather than sliding it. Resizes the extension itself triggers (via the popup or Snap Assist) are explicitly exempted from this, so snapping a window doesn't drag an unrelated, merely-nearby window along with it.

### Project layout

```tree
snap-layouts@kza/
├── metadata.json           Extension manifest
├── extension.js            Entry point — wires everything together
├── windowButtonManager.js  Draws + tracks the Shell-owned overlay button
├── layoutOverlay.js        The layout-template popup
├── snapAssistOverlay.js    The Snap Assist "fill the rest" panels
├── layouts.js              Layout templates (fractional zone rects)
├── windowSnapper.js        Converts a zone to real pixels + snaps a window
├── windowTiling.js         Dynamic tiling: resizing one window resizes its neighbors
├── windowQuery.js          Shared "what counts as a real tileable window" helpers
├── prefs.js                Preferences window (Adwaita)
├── schemas/                GSettings schema
└── stylesheet.css          Popup/button styling
```

## Requirements

GNOME Shell 45–50.

## Installation

```bash
cp -r snap-layouts@kza ~/.local/share/gnome-shell/extensions/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/snap-layouts@kza/schemas/
gnome-extensions enable snap-layouts@kza
```

Log out and back in to pick it up (GNOME 50 dropped X11/soft-restart; on GNOME ≤ 49 with X11, `Alt+F2` → `r` still works instead).

Open preferences with:

```bash
gnome-extensions prefs snap-layouts@kza
```

## Customizing the icon

The overlay button's icon is `icons/button-icon.svg`. Its color is baked into the SVG's own `fill`/`stroke` (not auto-tinted by the Shell theme), so to recolor it, edit those attributes directly — keep the background transparent (no filled `<rect>`) so it reads well on both light and dark themes. Swap in a different SVG at the same path to change the shape entirely; no rebuild or schema recompile needed, just reload the extension.

## Known limitations

- Dynamic tiling resize only considers windows on the same workspace and the same monitor as the one being resized.
- Snap Assist offers windows from any monitor on the current workspace (not just the one being tiled), matching Windows' own behavior — picking one moves it onto the current monitor.

## License

MIT — see [LICENSE](LICENSE).
