'use strict';

import { isTileableWindow } from './windowQuery.js';

const EDGE_TOLERANCE_PX = 40;

const MIN_SIZE_PX = 50;

export class TilingManager {
    constructor({ getGapPx } = {}) {
        this._getGapPx = getGapPx || (() => 0);

        this._tracked = new Map();

        this._applyingProgrammatic = false;

        this._displaySignals = [];
    }

    enable() {
        for (const actor of global.get_window_actors()) {
            if (actor.meta_window)
                this._maybeTrack(actor.meta_window);
        }

        this._displaySignals.push({
            obj: global.window_manager,
            id: global.window_manager.connect('map', (_wm, actor) => {
                if (actor.meta_window)
                    this._maybeTrack(actor.meta_window);
            }),
        });
    }

    disable() {
        for (const { obj, id } of this._displaySignals) {
            try { obj.disconnect(id); } catch (e) {}
        }
        this._displaySignals = [];

        for (const win of [...this._tracked.keys()])
            this._untrack(win);
        this._tracked.clear();
    }

    _maybeTrack(win) {
        if (!win || this._tracked.has(win))
            return;
        if (!isTileableWindow(win))
            return;

        const rect = this._currentRect(win);
        if (!rect)
            return;

        const sizeChangedId = win.connect('size-changed',
            () => this._onWindowSizeChanged(win));
        const unmanagingId = win.connect('unmanaging',
            () => this._untrack(win));

        this._tracked.set(win, {
            rect,
            maximized: this._isMaximized(win),

            settled: false,
            sizeChangedId,
            unmanagingId,
        });
    }

    _untrack(win) {
        const entry = this._tracked.get(win);
        if (!entry)
            return;
        try { win.disconnect(entry.sizeChangedId); } catch (e) {}
        try { win.disconnect(entry.unmanagingId); } catch (e) {}
        this._tracked.delete(win);
    }

    _currentRect(win) {
        const r = win.get_frame_rect();
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    }

    _isMaximized(win) {
        return typeof win.is_maximized === 'function'
            ? win.is_maximized()
            : win.get_maximized() !== 0;
    }

    _liveNeighborRects(win) {
        const workspace = win.get_workspace();
        const monitor = win.get_monitor();
        const others = new Map();

        for (const otherWin of this._tracked.keys()) {
            if (otherWin === win)
                continue;
            if (otherWin.minimized)
                continue;
            if (workspace && otherWin.get_workspace() !== workspace)
                continue;
            if (otherWin.get_monitor() !== monitor)
                continue;
            const rect = this._currentRect(otherWin);
            if (rect)
                others.set(otherWin, rect);
        }

        return others;
    }

    _onWindowSizeChanged(win) {
        const entry = this._tracked.get(win);
        if (!entry)
            return;

        const newRect = this._currentRect(win);
        if (!newRect)
            return;

        const oldRect = entry.rect;
        const wasMaximized = entry.maximized;
        const isMaximized = this._isMaximized(win);
        const wasSettled = entry.settled;

        entry.rect = newRect;
        entry.maximized = isMaximized;
        entry.settled = true;

        if (this._applyingProgrammatic)
            return;

        if (!wasSettled)
            return;

        if (wasMaximized || isMaximized)
            return;

        const others = this._liveNeighborRects(win);
        this._propagateResize(oldRect, newRect, others);
    }

    _propagateResize(oldRect, newRect, others) {
        const tolerance = EDGE_TOLERANCE_PX + this._getGapPx();

        const oldLeft = oldRect.x;
        const oldRight = oldRect.x + oldRect.width;
        const oldTop = oldRect.y;
        const oldBottom = oldRect.y + oldRect.height;
        const newLeft = newRect.x;
        const newRight = newRect.x + newRect.width;
        const newTop = newRect.y;
        const newBottom = newRect.y + newRect.height;

        const leftMoved = newLeft !== oldLeft;
        const rightMoved = newRight !== oldRight;
        const topMoved = newTop !== oldTop;
        const bottomMoved = newBottom !== oldBottom;

        if (!leftMoved && !rightMoved && !topMoved && !bottomMoved)
            return;

        this._applyingProgrammatic = true;
        try {
            for (const [otherWin, otherRect] of others) {
                if (this._isMaximized(otherWin))
                    continue;

                let x = otherRect.x;
                let y = otherRect.y;
                let width = otherRect.width;
                let height = otherRect.height;
                let changed = false;

                if (rightMoved && this._closeTo(otherRect.x, oldRight, tolerance)) {
                    const rightEdge = otherRect.x + otherRect.width;
                    x = newRight;
                    width = rightEdge - x;
                    changed = true;
                }

                if (leftMoved && this._closeTo(otherRect.x + otherRect.width, oldLeft, tolerance)) {
                    width = newLeft - otherRect.x;
                    changed = true;
                }

                if (bottomMoved && this._closeTo(otherRect.y, oldBottom, tolerance)) {
                    const bottomEdge = otherRect.y + otherRect.height;
                    y = newBottom;
                    height = bottomEdge - y;
                    changed = true;
                }

                if (topMoved && this._closeTo(otherRect.y + otherRect.height, oldTop, tolerance)) {
                    height = newTop - otherRect.y;
                    changed = true;
                }

                if (!changed)
                    continue;

                width = Math.max(MIN_SIZE_PX, Math.round(width));
                height = Math.max(MIN_SIZE_PX, Math.round(height));
                x = Math.round(x);
                y = Math.round(y);

                otherWin.move_resize_frame(true, x, y, width, height);
            }
        } finally {
            this._applyingProgrammatic = false;
        }
    }

    _closeTo(a, b, tolerance) {
        return Math.abs(a - b) <= tolerance;
    }
}
