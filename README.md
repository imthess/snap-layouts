# Snap Layouts for GNOME Shell

An open-source recreation of Windows 11's "Snap Layouts": click a
small button Shell draws near each window's top-right corner, and a
popup lets you pick a tiling template + specific zone to snap into.
Click a zone, the window snaps there immediately, the popup closes —
no extra dialogs.

## Status

Working prototype targeting **GNOME Shell 45–50**. Loads and enables
cleanly (`State: ACTIVE`, confirmed in testing), and the overlay
button + popup + snap flow has been confirmed working end-to-end
against real windows (screenshots reviewed during development).

## Project layout

```text
snap-layouts@kza/
├── metadata.json           Extension manifest (uuid, shell-version, settings-schema)
├── extension.js            Entry point — wires the button manager to the overlay to the snapper
├── windowButtonManager.js  Draws + tracks a Shell-owned button per window
├── layoutOverlay.js        Renders the popup (St/Clutter actors) with clickable zones
├── layouts.js              Pure-data layout templates (fractional zone rects)
├── windowSnapper.js        Converts a zone to real pixels + calls move_resize_frame
├── prefs.js                Preferences window (Adwaita)
├── schemas/
│   └── org.gnome.shell.extensions.snap-layouts.gschema.xml
└── stylesheet.css          Auto-loaded by Shell (see "Anatomy of an Extension" in gjs.guide) — no manual wiring needed
```

## How it works

### 1. The overlay button (`windowButtonManager.js`)

GNOME Shell extensions run inside the Shell process and get real
`Meta.Window` / `Meta.WindowActor` objects — this is why GNOME is the
practical primary target rather than a standalone X11/Wayland daemon
(see "Why not a standalone daemon" below).

Rather than trying to detect a click landing on a window's **own**
maximize button — which turned out not to work reliably in an earlier
version of this project, see "Design history" — this extension draws
its **own** small `St.Button` near each window's top-right (or
top-left, honoring `org.gnome.desktop.wm.preferences button-layout`)
corner, positioned just left of the app's own button cluster. Because
this button is a real Clutter actor that Shell itself owns and
renders, `St.Button`'s `'clicked'` signal fires for it exactly as
reliably as any other button anywhere in the Shell UI — no heuristics
about whether a click "landed" on the right spot.

The button's icon is a small bundled SVG (`icons/button-icon.svg`)
loaded via `Gio.icon_new_for_string()` and shown through a plain
`St.Icon`. It's built this way rather than via a named icon-theme icon
(avoids depending on the user's icon theme having a suitable icon) or
a hand-drawn Cairo path (avoids a genuine ambiguity in GJS's Cairo
binding method-name casing that surfaced during development and
wasn't worth risking a rendering bug over). Bundling our own file
means it renders identically everywhere regardless of icon theme.

For every normal window, `WindowButtonManager`:

- creates the button on window-map (`global.display`'s
  `'window-created'` signal, plus an initial pass over
  `global.get_window_actors()` for windows that already existed when
  the extension was enabled),
- repositions it on the window's `'position-changed'` /
  `'size-changed'` signals,
- hides it when the window is minimized (`'notify::minimized'`),
  fullscreen (`'notify::fullscreen'`), or on a different workspace
  (`'workspace-changed'` on the window, plus
  `'active-workspace-changed'` on the workspace manager to catch
  switching *to* the window's workspace),
- destroys it on `'unmanaging'`.

The **trade-off**, discussed directly with the project owner before
building this: it's a second button sitting near/over the app's own
maximize button, not a replacement for it. The app's real button is
untouched and still maximizes normally if clicked directly.

#### Dragging the button

The button can be repositioned horizontally by clicking and holding it,
dragging along the title bar, and releasing. A press starts tracking a
possible drag (`_onButtonPress`); once the pointer has moved past a
small threshold (4px, to ignore hand jitter on a plain click) the
button follows the pointer, clamped to stay fully inside the title bar
(`_getDragBounds`, `_onDragEvent`). Only the `x` coordinate ever
changes — the button never leaves its fixed vertical offset from the
top edge, and the window itself and its native title-bar controls are
never touched. Tracking uses a capture-phase listener on the stage
(the same technique `extension.js` uses for outside-click detection)
rather than a `global.stage.grab()` — a grab was tried and reverted
because Clutter's own docs say a grab bypasses the capture phase
entirely, which is exactly what stopped the release event from
reaching the listener that dismisses it, leaving the grab permanently
active and routing every later click anywhere on screen to that one
button. Clutter's guidance is that captured-event is the preferred
tool for exactly this and a grab "should only be used as a last
resort", so this doesn't use one.

Each motion re-queries the pointer live via `global.get_pointer()`
rather than trusting only the coordinates queued on the event —
GNOME Shell compresses pointer motion for its own (Shell-side) actors
down to the display's refresh rate (a documented Mutter/Clutter
platform characteristic, not something specific to this code), so a
queued event's own coordinates can already be a frame or more stale
by the time it's processed; re-querying keeps the button as close to
the live cursor as a custom Shell actor can get. The same live query
also doubles as a self-healing check: if the primary mouse button
isn't actually held down anymore (`Clutter.ModifierType.BUTTON1_MASK`
unset) but we never saw the release, that's treated as the drag
ending right there rather than continuing to chase the pointer
indefinitely. `_onButtonPress` also tears down any leftover drag state
before starting a new one. Once a press actually turns into a drag,
`_forceDragVisual()` takes explicit control of the button's `:hover`
look (turns off `track_hover`, forces the pseudo-class on) rather than
depending on St's organic hover tracking — which infers `:hover` from
the pointer's instantaneous position relative to the button, and could
get out of sync mid-drag given the same per-frame trailing described
above. `_releaseDragTracking()` hands control back and calls
`sync_hover()` on drag end/cancel, so the button's `:hover` state
always ends up matching the pointer's real final position rather than
getting stuck.

On release, if the button actually moved, its position is stored as a
0..1 fraction of the title bar's draggable width, keyed by the
window's WM_CLASS in the `button-position-fractions` dictionary
setting, and a flag suppresses the `'clicked'` signal that would
otherwise immediately reopen the popup. That fraction — not a raw
pixel offset — is what's persisted and re-applied on every subsequent
reposition, including window resizes and maximize/restore, so the
button keeps its relative spot in the title bar rather than drifting
off an edge or overlapping the window controls. Being keyed per app
means dragging the button on one application's window only ever moves
the button on *that* application's other windows — a different app
keeps its own independent position (or the automatic placement, if it
has never been dragged). The preferences window has a "Reset all to
default position" button that clears every app's custom position and
falls back to the original automatic corner placement everywhere.

### 2. The popup (`layoutOverlay.js`)

An `St.BoxLayout` added to `Main.layoutManager.uiGroup`, containing one
card per layout template, each showing a small preview of its zones as
mini rectangles. Clicking a zone emits `zone-chosen` with both the
template and the specific zone clicked, snaps the window there
immediately, and the popup closes. `extension.js` also closes the
popup if the user clicks anywhere outside it
(`captured-event::button` on the stage, checked against the popup's
own allocated box — a reliable use of that signal, since it only needs
to see clicks relative to a Shell-owned actor's bounds, not detect
clicks landing on someone else's surface).

### 3. Layout templates (`layouts.js`)

Plain data — no rendering logic. Each template is a list of zones as
**fractions of the work area** (`{x, y, w, h}` in `[0,1]`), so the same
templates scale to any monitor. Templates declare a `minAspect` so,
e.g., the 3-column layout doesn't show up on a portrait monitor.

Ships with: 50/50, 2/3+1/3, 1/3+2/3, 4-way grid, 3 columns,
side+center+side, and main+stack — matching the tiling-template set
from Windows 11's own Snap Layouts (that feature also offers a plain
"Maximize" tile, but since clicking the app's own maximize button
still maximizes normally — untouched by this extension — a dedicated
maximize zone in the popup would just be a redundant second way to do
the same thing, so it isn't included here).

### 4. Snapping (`windowSnapper.js`)

`zoneToRect()` converts a fractional zone + work area + gap preference
into a pixel rect. `snapWindowToRect()` un-maximizes if needed (Mutter
ignores resize requests on maximized windows) then calls
`win.move_resize_frame(true, x, y, w, h)`.

### 5. Dynamic tiling resize (`windowTiling.js`)

`TilingManager` tracks every normal window from the moment it's mapped
(or from `enable()`, for ones that already existed) — no registry of
"windows the popup snapped" and no dependency on `Meta.Display`'s
`grab-op-begin`/`grab-op-end` signals. An earlier version tried
grab-op detection and it silently never worked: those signals only
fire for a resize *Mutter itself* is driving (dragging Mutter's own
resize border), and plenty of real windows never go through that path
— an app handling its own client-side-decoration edge-drag, or a Wine
application (which by default paints its own border and resizes by
sending geometry requests straight to X11 rather than asking Mutter to
run an interactive grab) being exactly the case that motivated this
rewrite.

Instead, every tracked window's own `'size-changed'` signal is the
trigger — it fires for *any* geometry change regardless of what caused
it, so grab-op, a client's own border-drag, a keyboard resize, and
anything else are all covered uniformly. Each tracked window keeps its
last-known frame rect; on `'size-changed'`, the new rect is diffed
against that last-known one to see which edge(s) actually moved, and
that gets propagated to any other tracked window on the *same
workspace and monitor* whose matching edge was touching the moved one
in the *previous* state (within a small tolerance that absorbs the
configured gap) — that neighbor's touching edge follows, while its
opposite edge stays put, so it grows/shrinks rather than sliding. The
tracked rect is refreshed after every event (even ones that don't
propagate) so the next diff always has accurate history. A
maximize/unmaximize transition is deliberately excluded from
propagating (it's a big geometry jump that isn't a resize drag), and a
re-entrancy guard stops our own programmatic resize of a neighbor from
being misread as that neighbor's own resize. Adjacency — not snap
history — is the only thing that matters, and restricting it to the
same workspace + monitor is what keeps this from reaching across
monitors or workspaces to touch something unrelated.

Two more guards exist specifically because tracking "every window"
is dangerous if taken too literally. First, `_isTileable()` excludes
anything that isn't a plain top-level application window — file/save
pickers, alert boxes, print dialogs — even on a toolkit that happens
to report one as `WindowType.NORMAL` instead of `DIALOG` (some
portal-backed file choosers do); `get_transient_for()` is checked
independently of window type for exactly that reason. Second, new
windows are picked up via `global.window_manager`'s `'map'` signal
rather than `Meta.Display`'s `'window-created'`, and a tracked
window's very first `'size-changed'` is never propagated — it only
records where the window settled. Both exist because a brand-new
window's own initial layout pass (completely ordinary, not a user
resize) could otherwise get misread as a huge resize and shove an
unrelated, already-in-place neighbor around — concretely, this is
what let a file-picker dialog opening nearby visibly shrink the real
window it was opened over.

## Installation (development)

```bash
# Clone/copy into the GNOME extensions directory
cp -r snap-layouts@kza ~/.local/share/gnome-shell/extensions/

# Compile the settings schema
glib-compile-schemas ~/.local/share/gnome-shell/extensions/snap-layouts@kza/schemas/

# Reload Shell to pick up the new extension.
# GNOME Shell 50 removed X11 support entirely, so Wayland is the only
# session type — you can't soft-restart Shell (no more Alt+F2 -> r).
# Log out and back in instead.
#
# (If you're on GNOME <= 49 with an X11 session, Alt+F2 -> r still works.)

gnome-extensions enable snap-layouts@kza
```

Open preferences with:

```bash
gnome-extensions prefs snap-layouts@kza
```

## Development / testing

Test inside an isolated Shell instance so a bug can't wedge your main
session.

**GNOME 49+ (including GNOME 50):** the old `--nested` mode was
removed since X11 is disabled by default. Use the devkit instead (you
may need `sudo apt install mutter-devkit` first):

```bash
dbus-run-session gnome-shell --devkit --wayland
```

**GNOME <= 48:**

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

Watch logs live with:

```bash
journalctl -f -o cat GNOME_SHELL_EXTENSION_UUID=snap-layouts@kza
# broader net if the above returns nothing (e.g. right after a crash
# that predates when you started following):
journalctl -b 0 | grep -i "snap-layouts"
```

## GNOME version notes

- **GNOME 49 removed `Meta.Window.get_maximized()`** and dropped the
  `Meta.MaximizeFlags` argument from `maximize()`/`unmaximize()`, in
  favor of `is_maximized()` and no-arg `maximize()`/`unmaximize()`.
  `windowSnapper.js` checks for `is_maximized` at runtime and uses
  whichever API is present, so the same file works on both sides of
  that change.
- **GNOME 50 removed X11 support** entirely — Shell can't be
  soft-restarted (`Alt+F2 → r`), and nested test sessions (`--nested`)
  were replaced by the devkit (`--devkit`), as of GNOME 49.

## Design history — why an overlay button instead of click interception

Two earlier approaches were tried and abandoned, in order:

1. **Hover the app's own maximize button, wait, show popup.**
   Abandoned because there's no reliable way to detect *hovering* a
   button drawn by another process — pointer-motion events over a
   client's own surface don't reliably reach Shell's Clutter actor
   tree.
2. **Left-click the app's own maximize button, intercept it before
   Mutter's default maximize runs, show popup instead.** This used
   `global.stage`'s `captured-event::button` signal — real,
   Shell-precedented API — but in testing, clicking the maximize
   button just maximized the window normally; the click never reached
   our handler. The click lands on the client app's own surface, and
   Shell's capture-phase actor events don't reliably see input that
   the client itself is the primary recipient of.

The **overlay button** approach sidesteps this entirely: instead of
trying to intercept a click on something we don't own, we draw
something we *do* own, right next to it. A Shell-owned `St.Button`'s
click signal is exactly as reliable as any other button in the Shell
UI, because there's no interception involved at all — and this has
since been confirmed working in real testing.

The popup itself also went through a simplification: an earlier
version included "Maximize"/"Fullscreen" tiles in the popup and, after
any tiling snap, a follow-up "pick another window to fill the rest of
the layout" prompt. Both were removed — the maximize/fullscreen tiles
were redundant with the app's own untouched maximize button, and the
fill-prompt added a second dialog (with a "no other windows" empty
state) after every snap, which worked but didn't match the simpler,
single-click Windows 11 flow this extension is going for.

## Known limitations

- **Two buttons near each other.** This is the direct trade-off of the
  overlay-button approach — our button sits next to, not in place of,
  the app's real maximize button. Both are independently clickable
  and do different things.
- **Button position is still an approximation** for exactly where
  "next to the app's buttons" lands, since we can't query a CSD app
  for its exact button-cluster width. `button-hit-size-px` in prefs
  adjusts our button's own size; if it visually overlaps an app's
  button on a specific theme, that's a cosmetic-only issue (doesn't
  affect whether clicks work).
- **Some apps have no maximize button at all** (custom minimal
  chrome) — `win.can_maximize()` returning true doesn't guarantee a
  visible app-drawn button exists nearby; our own button still shows
  up regardless, since it doesn't depend on the app's button existing.
- **X11 vs Wayland**: `move_resize_frame` and `get_frame_rect` are
  compositor-level Mutter APIs and behave the same on both backends
  when driven from inside the Shell process — this is the main reason
  a GNOME Shell extension sidesteps the X11/Wayland fragmentation that
  a standalone daemon would hit.
- **Dynamic tiling resize is scoped to the same workspace + monitor.**
  Adjacency is computed live from geometry (see above), so it applies
  to any two touching windows regardless of how they got there — but
  only within a single workspace and monitor. A window on a different
  workspace or a different monitor is never pulled in even if its
  coordinates would otherwise line up.

## Porting beyond GNOME

`layouts.js` and `windowSnapper.js`'s `zoneToRect()` are intentionally
UI-toolkit-agnostic (pure math over plain objects) so they can be
reused outside GJS. What has to be reimplemented per desktop:

| Piece | GNOME (this repo) | KDE Plasma (KWin) | Generic X11/Wayland |
| --- | --- | --- | --- |
| Overlay button + window tracking | `windowButtonManager.js` (GJS + Mutter) | KWin scripting API (`KWin.readConfig`, window rects via KWin JS bindings) | A wlroots-layer-shell surface per window on wlroots compositors, or an X11 override-redirect window tracked to each app window |
| Popup rendering | `layoutOverlay.js` (St/Clutter) | QML overlay via `PlasmaCore`/`Kirigami`, or a KWin effect | Same layer-shell/override-redirect mechanism as above |
| Window move/resize | `Meta.Window.move_resize_frame()` | KWin script `client.frameGeometry = ...` | `_NET_MOVERESIZE_WINDOW` (X11) — no equivalent Wayland-wide protocol exists; each compositor needs its own integration |

### Why not a single standalone X11/Wayland daemon

This is worth stating plainly since it affects the "broader Linux
goal": on **X11**, a standalone daemon *can* work reasonably well —
`_NET_WM_MOVERESIZE`/`XQueryPointer` plus reading `_NET_FRAME_EXTENTS`
gets you most of the way, and there's prior art (e.g. window-snapping
tools built on `python-xlib`/`wmctrl`). On **Wayland**, there is
deliberately no protocol that lets an arbitrary external process query
another app's window geometry, let alone draw a tracked overlay over
it — that capability is scoped to compositors themselves for
security/isolation reasons. So a "universal" daemon would in practice
degrade to X11-only, or need a compositor-specific privileged
extension per Wayland compositor (GNOME → Shell extension, KDE → KWin
script, wlroots-based → a layer-shell client with compositor-specific
IPC). The architecture above already reflects that split rather than
pretending a single binary can cover it.

## Roadmap ideas (not yet implemented)

- Keyboard-only flow (e.g. a shortcut that opens the popup for the
  focused window without needing the mouse over any button at all).
- Remembering per-app preferred layouts.
- Multi-monitor zone templates (spanning two monitors as one grid).
- A KWin script for KDE Plasma, sharing `layouts.js`'s zone data via a
  small JSON export.

## License

MIT — see LICENSE.
