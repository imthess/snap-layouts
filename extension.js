'use strict';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { WindowButtonManager } from './windowButtonManager.js';
import { LayoutOverlay } from './layoutOverlay.js';
import { Layouts } from './layouts.js';
import { zoneToRect, snapWindowToRect } from './windowSnapper.js';
import { TilingManager } from './windowTiling.js';
export default class SnapLayoutsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._overlay = null;
        this._activeWindow = null;
        this._activeButtonActor = null;
        this._windowSignals = [];
        this._outsideClickId = null;
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
        const monitorIndex = win.get_monitor();
        const workArea = win.get_work_area_for_monitor(monitorIndex);
        const aspect = workArea.width / workArea.height;
        const enabledIds = new Set(this._settings.get_strv('enabled-layouts'));
        const layouts = Layouts.getLayoutsForAspect(aspect).filter(l => enabledIds.has(l.id));
        if (layouts.length === 0)
            return;
        const overlay = new LayoutOverlay(layouts);
        Main.layoutManager.uiGroup.add_child(overlay);
        const [bx, by] = buttonActor.get_transformed_position();
        const btnRect = { x: bx, y: by, width: buttonActor.width, height: buttonActor.height };
        overlay.positionNear(btnRect, workArea);
        overlay.connect('zone-chosen', (_o, layout, zone) => {
            this._onZoneChosen(win, zone, workArea);
        });

        this._overlay = overlay;
        this._activeWindow = win;
        this._activeButtonActor = buttonActor;

        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        this._outsideClickId = global.stage.connect(
            'captured-event',
            (actor, event) => this._onOutsideClick(event)
        );

        
        
        this._trackWindowLifecycle(win);
    }

    _onOutsideClick(event) {
        if (!this._overlay)
            return Clutter.EVENT_PROPAGATE;
        if (event.type() !== Clutter.EventType.BUTTON_PRESS)
            return Clutter.EVENT_PROPAGATE;

        const [px, py] = event.get_coords();

        if (this._pointInsideActor(this._overlay, px, py))
            return Clutter.EVENT_PROPAGATE; 

        
        
        
        
        
        
        
        
        if (this._activeButtonActor && this._pointInsideActor(this._activeButtonActor, px, py))
            return Clutter.EVENT_PROPAGATE;

        this._hideOverlay();
        return Clutter.EVENT_PROPAGATE; 
    }

    _pointInsideActor(actor, px, py) {
        const [ax, ay] = actor.get_transformed_position();
        const [aw, ah] = actor.get_transformed_size();
        return px >= ax && px <= ax + aw && py >= ay && py <= ay + ah;
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
        if (this._outsideClickId) {
            global.stage.disconnect(this._outsideClickId);
            this._outsideClickId = null;
        }
        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
        this._clearWindowSignals();
        this._activeWindow = null;
        this._activeButtonActor = null;
    }

    _onZoneChosen(win, zone, workArea) {
        this._hideOverlay();

        const gapPx = this._settings.get_int('gap-px');
        const rect = zoneToRect(zone, workArea, gapPx);
        snapWindowToRect(win, rect);
    }
}
