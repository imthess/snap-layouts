'use strict';

import Meta from 'gi://Meta';

export function isTileableWindow(win) {
    if (!win)
        return false;
    if (win.get_window_type() !== Meta.WindowType.NORMAL)
        return false;
    if (typeof win.is_attached_dialog === 'function' && win.is_attached_dialog())
        return false;
    if (win.get_transient_for())
        return false;
    return true;
}

export function listWorkspaceCompanions(win, { sameMonitor = false } = {}) {
    const workspace = win.get_workspace();
    const monitor = win.get_monitor();
    const result = [];

    for (const actor of global.get_window_actors()) {
        const otherWin = actor.meta_window;
        if (!otherWin || otherWin === win)
            continue;
        if (!isTileableWindow(otherWin))
            continue;
        if (otherWin.minimized)
            continue;
        if (workspace && otherWin.get_workspace() !== workspace)
            continue;
        if (sameMonitor && otherWin.get_monitor() !== monitor)
            continue;
        result.push(otherWin);
    }

    return result;
}
