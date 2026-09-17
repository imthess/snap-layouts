'use strict';

import Meta from 'gi://Meta';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

const BUTTON_SIZE_DEFAULT = 34;

const BUTTON_OFFSET_FROM_EDGE_Y = 8;
const BUTTON_OFFSET_FROM_EDGE_X = 8;

const NATIVE_BUTTON_WIDTH_ESTIMATE = 42;
const NATIVE_BUTTON_COUNT_ESTIMATE = 3;
const NATIVE_CLUSTER_CLEARANCE =
    NATIVE_BUTTON_WIDTH_ESTIMATE * NATIVE_BUTTON_COUNT_ESTIMATE;

const DEFAULT_APP_EXTRA_CLEARANCE_PX = new Map([
    ['code', 130],
    ['jetbrains', 90],
]);

const DRAG_THRESHOLD_PX = 4;

export class WindowButtonManager {
    constructor({
        onButtonClicked,
        getEnabled,
        getButtonSize,
        getAppClearanceOverrides,
        getCustomPositionFraction,
        onPositionChanged,
        iconPath,
    }) {
        this._onButtonClicked = onButtonClicked;
        this._getEnabled = getEnabled || (() => true);
        this._getButtonSize = getButtonSize || (() => BUTTON_SIZE_DEFAULT);
        this._getAppClearanceOverrides = getAppClearanceOverrides || (() => []);
        this._getCustomPositionFraction = getCustomPositionFraction || (() => null);
        this._onPositionChanged = onPositionChanged || null;

        this._entries = new Map();

        this._displaySignals = [];
        this._workspaceSignals = [];

        this._dragState = null;
        this._dragCaptureId = null;

        this._suppressNextClick = false;

        this._buttonIcon = null;
        if (iconPath) {
            try {
                this._buttonIcon = Gio.icon_new_for_string(iconPath);
            } catch (e) {
                this._buttonIcon = null;
            }
        }

        this._wmPrefsSettings = null;
        try {
            this._wmPrefsSettings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.wm.preferences',
            });
        } catch (e) {
            this._wmPrefsSettings = null;
        }
    }

    enable() {
        const actors = global.get_window_actors();
        for (const actor of actors) {
            if (actor.meta_window)
                this._maybeTrackWindow(actor.meta_window);
        }

        this._displaySignals.push({
            obj: global.display,
            id: global.display.connect('window-created', (_d, win) => {
                this._maybeTrackWindow(win);
            }),
        });

        this._displaySignals.push({
            obj: global.display,
            id: global.display.connect('restacked', () => {
                this._syncStackingOrder();
            }),
        });

        const wsManager = global.workspace_manager;
        this._workspaceSignals.push({
            obj: wsManager,
            id: wsManager.connect('active-workspace-changed', () => {
                this._refreshAllVisibility();
            }),
        });
    }

    disable() {
        this._cancelDrag();

        for (const { obj, id } of this._displaySignals) {
            try { obj.disconnect(id); } catch (e) {}
        }
        this._displaySignals = [];

        for (const { obj, id } of this._workspaceSignals) {
            try { obj.disconnect(id); } catch (e) {}
        }
        this._workspaceSignals = [];

        for (const win of [...this._entries.keys()])
            this._untrackWindow(win);
        this._entries.clear();
    }

    _maybeTrackWindow(win) {
        if (!win || this._entries.has(win))
            return;
        if (win.get_window_type() !== Meta.WindowType.NORMAL)
            return;

        const button = new St.Button({
            style_class: 'snap-layouts-overlay-button',
            reactive: true,
            can_focus: false,
            track_hover: true,
            width: this._getButtonSize(),
            height: this._getButtonSize(),
        });

        const icon = new St.Icon({
            style_class: 'snap-layouts-button-icon',
            icon_size: Math.round(this._getButtonSize() * 0.62),
        });
        if (this._buttonIcon)
            icon.set_gicon(this._buttonIcon);
        button.set_child(icon);

        button.connect('clicked', () => {
            if (!this._getEnabled())
                return;

            if (this._suppressNextClick) {
                this._suppressNextClick = false;
                return;
            }
            this._onButtonClicked(win, button);
        });

        button.connect('button-press-event', (actor, event) => {
            return this._onButtonPress(win, actor, event);
        });

        global.window_group.add_child(button);

        const signalIds = [];
        const track = (obj, sig, handler) => {
            signalIds.push({ obj, id: obj.connect(sig, handler) });
        };

        track(win, 'position-changed', () => this._repositionButton(win));
        track(win, 'size-changed', () => this._repositionButton(win));
        track(win, 'workspace-changed', () => this._refreshVisibility(win));
        track(win, 'notify::minimized', () => this._refreshVisibility(win));
        track(win, 'notify::fullscreen', () => this._refreshVisibility(win));
        track(win, 'unmanaging', () => this._untrackWindow(win));

        this._entries.set(win, { button, signalIds });

        this._repositionButton(win);
        this._refreshVisibility(win);
        this._syncStackingOrder();
    }

    _untrackWindow(win) {
        const entry = this._entries.get(win);
        if (!entry)
            return;

        if (this._dragState && this._dragState.win === win)
            this._cancelDrag();

        for (const { obj, id } of entry.signalIds) {
            try { obj.disconnect(id); } catch (e) {}
        }

        entry.button.destroy();
        this._entries.delete(win);
    }

    _repositionButton(win) {
        const entry = this._entries.get(win);
        if (!entry)
            return;

        const frameRect = win.get_frame_rect();
        if (!frameRect)
            return;

        const y = frameRect.y + BUTTON_OFFSET_FROM_EDGE_Y;
        const x = this._computeButtonX(win, frameRect);

        entry.button.set_position(Math.round(x), Math.round(y));
    }

    _computeButtonX(win, frameRect) {
        const customFraction = this._getCustomPositionFraction(win);
        if (typeof customFraction === 'number' && Number.isFinite(customFraction)) {
            const bounds = this._getDragBounds(frameRect);
            return bounds.min + customFraction * (bounds.max - bounds.min);
        }

        const size = this._getButtonSize();
        const onRightSide = this._isMaximizeOnRight();
        const clearance = NATIVE_CLUSTER_CLEARANCE + this._getExtraClearance(win);

        if (onRightSide) {
            return frameRect.x + frameRect.width - BUTTON_OFFSET_FROM_EDGE_X -
                clearance - size;
        }
        return frameRect.x + BUTTON_OFFSET_FROM_EDGE_X + clearance;
    }

    _getDragBounds(frameRect) {
        const size = this._getButtonSize();
        const min = frameRect.x + BUTTON_OFFSET_FROM_EDGE_X;
        const max = frameRect.x + frameRect.width - BUTTON_OFFSET_FROM_EDGE_X - size;
        if (max < min) {
            const mid = frameRect.x + (frameRect.width - size) / 2;
            return { min: mid, max: mid };
        }
        return { min, max };
    }

    _onButtonPress(win, actor, event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        if (this._dragState)
            this._cancelDrag();

        const frameRect = win.get_frame_rect();
        if (!frameRect)
            return Clutter.EVENT_PROPAGATE;

        const [startPointerX] = global.get_pointer();

        this._dragState = {
            win,
            actor,
            startPointerX,
            startActorX: actor.x,
            moved: false,
            bounds: this._getDragBounds(frameRect),
        };

        this._dragCaptureId = global.stage.connect(
            'captured-event',
            (_actor, ev) => this._onDragEvent(ev)
        );

        return Clutter.EVENT_PROPAGATE;
    }

    _onDragEvent(event) {
        if (!this._dragState)
            return Clutter.EVENT_PROPAGATE;

        const type = event.type();
        if (type === Clutter.EventType.MOTION) {
            const [pointerX, , mask] = global.get_pointer();

            if ((mask & Clutter.ModifierType.BUTTON1_MASK) === 0) {
                this._finishDrag();
                return Clutter.EVENT_PROPAGATE;
            }

            const dx = pointerX - this._dragState.startPointerX;

            if (!this._dragState.moved && Math.abs(dx) >= DRAG_THRESHOLD_PX) {
                this._dragState.moved = true;
                this._forceDragVisual(this._dragState.actor);
            }

            if (this._dragState.moved) {
                const { bounds } = this._dragState;
                const newX = Math.min(bounds.max, Math.max(bounds.min,
                    this._dragState.startActorX + dx));
                this._dragState.actor.set_position(Math.round(newX), this._dragState.actor.y);
            }
        } else if (type === Clutter.EventType.BUTTON_RELEASE) {
            this._finishDrag();
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _forceDragVisual(actor) {
        actor.track_hover = false;
        actor.add_style_pseudo_class('hover');
    }

    _finishDrag() {
        const drag = this._dragState;
        this._dragState = null;
        this._releaseDragTracking(drag && drag.actor);

        if (!drag || !drag.moved)
            return;

        this._suppressNextClick = true;

        const { bounds, actor } = drag;
        const range = bounds.max - bounds.min;
        const fraction = range > 0 ? (actor.x - bounds.min) / range : 0;

        if (this._onPositionChanged)
            this._onPositionChanged(drag.win, Math.min(1, Math.max(0, fraction)));
    }

    _cancelDrag() {
        const actor = this._dragState && this._dragState.actor;
        this._dragState = null;
        this._releaseDragTracking(actor);
    }

    _releaseDragTracking(actor) {
        if (this._dragCaptureId) {
            global.stage.disconnect(this._dragCaptureId);
            this._dragCaptureId = null;
        }

        if (actor && actor.track_hover === false) {
            try { actor.remove_style_pseudo_class('hover'); } catch (e) {}
            actor.track_hover = true;
        }

        if (actor && typeof actor.sync_hover === 'function') {
            try { actor.sync_hover(); } catch (e) {}
        }
    }

    _getExtraClearance(win) {
        const wmClass = (win.get_wm_class() || '').toLowerCase();
        if (!wmClass)
            return 0;

        for (const [key, px] of this._getAppClearanceOverrides()) {
            if (key && wmClass.includes(key))
                return px;
        }
        for (const [key, px] of DEFAULT_APP_EXTRA_CLEARANCE_PX) {
            if (wmClass.includes(key))
                return px;
        }
        return 0;
    }

    _refreshVisibility(win) {
        const entry = this._entries.get(win);
        if (!entry)
            return;

        const activeWs = global.workspace_manager.get_active_workspace();
        const onActiveWorkspace = win.located_on_workspace(activeWs);
        const visible =
            onActiveWorkspace &&
            !win.minimized &&
            !win.is_fullscreen() &&
            win.can_maximize();

        entry.button.visible = visible;
        if (visible)
            this._repositionButton(win);
    }

    _refreshAllVisibility() {
        for (const win of this._entries.keys())
            this._refreshVisibility(win);
    }

    repositionAll() {
        for (const win of this._entries.keys())
            this._repositionButton(win);
    }

    _syncStackingOrder() {
        const actors = global.get_window_actors();
        for (const actor of actors) {
            const win = actor.meta_window;
            if (!win)
                continue;
            const entry = this._entries.get(win);
            if (!entry)
                continue;
            global.window_group.set_child_above_sibling(entry.button, actor);
        }
    }

    _isMaximizeOnRight() {
        if (!this._wmPrefsSettings)
            return true;
        try {
            const layout = this._wmPrefsSettings.get_string('button-layout') || ':minimize,maximize,close';
            const rightSide = layout.split(':')[1] || '';
            return rightSide.includes('maximize');
        } catch (e) {
            return true;
        }
    }
}
