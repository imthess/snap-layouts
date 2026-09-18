'use strict';

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { WindowButtonManager } from './windowButtonManager.js';
import { LayoutOverlay } from './layoutOverlay.js';
import { SnapAssistZone } from './snapAssistOverlay.js';
import { Layouts } from './layouts.js';
import { zoneToRect, snapWindowToRect } from './windowSnapper.js';
import { TilingManager } from './windowTiling.js';
import { listWorkspaceCompanions } from './windowQuery.js';

export default class SnapLayoutsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._overlay = null;
        this._overlayBackdrop = null;
        this._activeWindow = null;
        this._activeButtonActor = null;
        this._windowSignals = [];

        this._snapAssistPanels = [];
        this._snapAssistBackdrop = null;
        this._snapAssistWindowSignals = [];

        this._appClearanceOverrides = this._parseAppClearanceOverrides();

        this._buttonManager = new WindowButtonManager({
            onButtonClicked: (win, buttonActor) => this._onButtonClicked(win, buttonActor),
            getButtonSize: () => this._settings.get_int('button-hit-size-px'),
            getEnabled: () => this._settings.get_boolean('enabled'),
            getAppClearanceOverrides: () => this._appClearanceOverrides,

            getCustomPositionFraction: win => this._getAppButtonFraction(win),
            onPositionChanged: (win, fraction) => this._setAppButtonFraction(win, fraction),
            iconPath: GLib.build_filenamev([this.path, 'icons', 'button-icon.svg']),
        });
        this._buttonManager.enable();

        this._tilingManager = new TilingManager({
            getGapPx: () => this._settings.get_int('gap-px'),
        });
        this._tilingManager.enable();

        this._settingsSignals = [
            this._settings.connect('changed::app-extra-clearance-overrides', () => {
                this._appClearanceOverrides = this._parseAppClearanceOverrides();
                this._buttonManager?.repositionAll();
            }),
            this._settings.connect('changed::button-hit-size-px', () => {
                this._buttonManager?.repositionAll();
            }),
            this._settings.connect('changed::button-position-fractions', () => {
                this._buttonManager?.repositionAll();
            }),
        ];
    }

    disable() {
        for (const id of this._settingsSignals || [])
            this._settings.disconnect(id);
        this._settingsSignals = [];

        this._buttonManager.disable();
        this._buttonManager = null;

        this._tilingManager?.disable();
        this._tilingManager = null;

        this._hideOverlay();
        this._hideSnapAssist();

        this._settings = null;
    }

    _appKeyFor(win) {
        const wmClass = (win.get_wm_class() || '').trim().toLowerCase();
        return wmClass || null;
    }

    _getAppButtonFraction(win) {
        const key = this._appKeyFor(win);
        if (!key)
            return null;
        const fractions = this._settings.get_value('button-position-fractions').deep_unpack();
        return Object.prototype.hasOwnProperty.call(fractions, key) ? fractions[key] : null;
    }

    _setAppButtonFraction(win, fraction) {
        const key = this._appKeyFor(win);
        if (!key)
            return;
        const fractions = this._settings.get_value('button-position-fractions').deep_unpack();
        fractions[key] = fraction;
        this._settings.set_value('button-position-fractions', new GLib.Variant('a{sd}', fractions));
    }

    _parseAppClearanceOverrides() {
        const raw = this._settings.get_strv('app-extra-clearance-overrides');
        const pairs = [];
        for (const entry of raw) {
            const eq = entry.indexOf('=');
            if (eq < 1)
                continue;
            const key = entry.slice(0, eq).trim().toLowerCase();
            const px = parseInt(entry.slice(eq + 1).trim(), 10);
            if (!key || !Number.isFinite(px))
                continue;
            pairs.push([key, px]);
        }
        return pairs;
    }

    _onButtonClicked(win, buttonActor) {
        if (this._overlay && this._activeWindow === win) {
            this._hideOverlay();
            return;
        }
        this._showOverlay(win, buttonActor);
    }

    _showOverlay(win, buttonActor) {
        this._hideOverlay();
        this._hideSnapAssist();

        const monitorIndex = win.get_monitor();
        const workArea = win.get_work_area_for_monitor(monitorIndex);
        const aspect = workArea.width / workArea.height;

        const enabledIds = new Set(this._settings.get_strv('enabled-layouts'));
        const layouts = Layouts.getLayoutsForAspect(aspect).filter(l => enabledIds.has(l.id));
        if (layouts.length === 0)
            return;

        const backdrop = new St.Widget({
            reactive: true,
            x: 0,
            y: 0,
        });
        backdrop.set_size(global.stage.width, global.stage.height);
        backdrop.connect('button-press-event', () => {
            this._hideOverlay();
            return Clutter.EVENT_STOP;
        });
        Main.layoutManager.uiGroup.add_child(backdrop);
        this._overlayBackdrop = backdrop;

        const overlay = new LayoutOverlay(layouts);
        Main.layoutManager.uiGroup.add_child(overlay);

        const [bx, by] = buttonActor.get_transformed_position();
        const btnRect = { x: bx, y: by, width: buttonActor.width, height: buttonActor.height };
        overlay.positionNear(btnRect, workArea);

        overlay.connect('zone-chosen', (_o, layout, zone) => {
            this._onZoneChosen(win, layout, zone, workArea);
        });

        this._overlay = overlay;
        this._activeWindow = win;
        this._activeButtonActor = buttonActor;

        this._trackWindowLifecycle(win);
    }

    _trackWindowLifecycle(win) {
        this._clearWindowSignals();
        const id = win.connect('unmanaging', () => this._hideOverlay());
        this._windowSignals.push({ win, id });
    }

    _clearWindowSignals() {
        for (const { win, id } of this._windowSignals) {
            try {
                win.disconnect(id);
            } catch (e) {
            }
        }
        this._windowSignals = [];
    }

    _hideOverlay() {
        if (this._overlayBackdrop) {
            this._overlayBackdrop.destroy();
            this._overlayBackdrop = null;
        }
        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
        this._clearWindowSignals();
        this._activeWindow = null;
        this._activeButtonActor = null;
    }

    _onZoneChosen(win, layout, zone, workArea) {
        this._hideOverlay();

        const gapPx = this._settings.get_int('gap-px');
        const rect = zoneToRect(zone, workArea, gapPx);
        if (this._tilingManager)
            this._tilingManager.runWithoutPropagation(() => snapWindowToRect(win, rect));
        else
            snapWindowToRect(win, rect);

        this._maybeShowSnapAssist({
            layout,
            workArea,
            filledZones: [zone],
            placedWindows: [win],
            anchorWindow: win,
        });
    }

    _maybeShowSnapAssist(state) {
        this._hideSnapAssist();

        if (!this._settings.get_boolean('snap-assist-enabled'))
            return;

        const { layout, workArea, filledZones, placedWindows, anchorWindow } = state;
        const remainingZones = layout.zones.filter(z => !filledZones.includes(z));
        if (remainingZones.length === 0)
            return;

        let candidates;
        try {
            candidates = this._getSnapAssistCandidates(anchorWindow, placedWindows);
        } catch (e) {
            return;
        }
        if (candidates.length === 0)
            return;

        const gapPx = this._settings.get_int('gap-px');
        const panels = [];

        const backdrop = new St.Widget({
            reactive: true,
            x: 0,
            y: 0,
        });
        backdrop.set_size(global.stage.width, global.stage.height);
        backdrop.connect('button-press-event', () => {
            this._hideSnapAssist();
            return Clutter.EVENT_STOP;
        });
        Main.layoutManager.uiGroup.add_child(backdrop);
        this._snapAssistBackdrop = backdrop;

        for (const zone of remainingZones) {
            const rect = zoneToRect(zone, workArea, gapPx);
            const panel = new SnapAssistZone(rect, candidates);
            Main.layoutManager.uiGroup.add_child(panel);

            panel.connect('window-chosen', (_p, chosenWin) => {
                const chosenRect = zoneToRect(zone, workArea, gapPx);
                if (this._tilingManager)
                    this._tilingManager.runWithoutPropagation(() => snapWindowToRect(chosenWin, chosenRect));
                else
                    snapWindowToRect(chosenWin, chosenRect);
                this._maybeShowSnapAssist({
                    layout,
                    workArea,
                    filledZones: [...filledZones, zone],
                    placedWindows: [...placedWindows, chosenWin],
                    anchorWindow,
                });
            });

            panels.push(panel);
        }

        this._snapAssistPanels = panels;

        const watched = new Set([anchorWindow, ...candidates]);
        this._snapAssistWindowSignals = [...watched].map(w => ({
            win: w,
            id: w.connect('unmanaging', () => this._hideSnapAssist()),
        }));
    }

    _getSnapAssistCandidates(anchorWindow, excludeWindows) {
        const exclude = new Set(excludeWindows);
        return listWorkspaceCompanions(anchorWindow).filter(w => !exclude.has(w));
    }

    _hideSnapAssist() {
        if (this._snapAssistBackdrop) {
            this._snapAssistBackdrop.destroy();
            this._snapAssistBackdrop = null;
        }
        for (const { win, id } of this._snapAssistWindowSignals) {
            try { win.disconnect(id); } catch (e) {}
        }
        this._snapAssistWindowSignals = [];
        for (const panel of this._snapAssistPanels)
            panel.destroy();
        this._snapAssistPanels = [];
    }
}
