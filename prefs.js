'use strict';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { Layouts } from './layouts.js';
export default class SnapLayoutsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({ title: 'General' });
        window.add(page);

        const behaviorGroup = new Adw.PreferencesGroup({ title: 'Behavior' });
        page.add(behaviorGroup);

        const enabledRow = new Adw.SwitchRow({
            title: 'Enable Snap Layouts',
            subtitle: 'Show the layout popup when clicking the overlay button next to a window\'s maximize button',
        });
        settings.bind('enabled', enabledRow, 'active', 0);
        behaviorGroup.add(enabledRow);

        const gapRow = new Adw.SpinRow({
            title: 'Gap between windows (px)',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 64,
                step_increment: 1,
                page_increment: 4,
            }),
        });
        settings.bind('gap-px', gapRow, 'value', 0);
        behaviorGroup.add(gapRow);

        const hitboxRow = new Adw.SpinRow({
            title: 'Overlay button size (px)',
            subtitle: 'Size of our own layout-popup button drawn next to each window\'s maximize button',
            adjustment: new Gtk.Adjustment({
                lower: 16,
                upper: 64,
                step_increment: 2,
                page_increment: 4,
            }),
        });
        settings.bind('button-hit-size-px', hitboxRow, 'value', 0);
        behaviorGroup.add(hitboxRow);

        const hasCustomPositions = () =>
            Object.keys(settings.get_value('button-position-fractions').deep_unpack()).length > 0;

        const resetPositionRow = new Adw.ActionRow({
            title: 'Button positions',
            subtitle: 'The overlay button can be dragged horizontally along a window\'s title bar. ' +
                'Each app remembers its own dragged position independently.',
        });
        const resetPositionButton = new Gtk.Button({
            label: 'Reset all to default position',
            valign: Gtk.Align.CENTER,
            sensitive: hasCustomPositions(),
        });
        resetPositionButton.connect('clicked', () => {
            settings.set_value('button-position-fractions', new GLib.Variant('a{sd}', { }));
        });
        settings.connect('changed::button-position-fractions', () => {
            resetPositionButton.sensitive = hasCustomPositions();
        });
        resetPositionRow.add_suffix(resetPositionButton);
        behaviorGroup.add(resetPositionRow);

        const layoutsGroup = new Adw.PreferencesGroup({
            title: 'Layout templates',
            description: 'Choose which templates appear in the popup',
        });
        page.add(layoutsGroup);

        const enabledIds = new Set(settings.get_strv('enabled-layouts'));
        for (const layout of Layouts.LAYOUTS) {
            const row = new Adw.SwitchRow({
                title: layout.label,
                active: enabledIds.has(layout.id),
            });
            row.connect('notify::active', () => {
                const current = new Set(settings.get_strv('enabled-layouts'));
                if (row.active)
                    current.add(layout.id);
                else
                    current.delete(layout.id);
                settings.set_strv('enabled-layouts', [...current]);
            });
            layoutsGroup.add(row);
        }

        const clearanceGroup = new Adw.PreferencesGroup({
            title: 'Per-app button clearance',
            description: 'Some apps (VS Code, JetBrains IDEs, browsers with extra ' +
                'toolbar buttons, etc.) draw more than the standard minimize/' +
                'maximize/close cluster, so the overlay button needs extra room ' +
                'to sit clear of them. A few common apps are already handled; add ' +
                'more below as "wmclass=extra_px" pairs, comma-separated — e.g. ' +
                '"code=150, org.gnome.epiphany=70". Find an app\'s WM_CLASS with ' +
                '`wmctrl -lx` (or `xprop WM_CLASS` on X11) while it\'s focused.',
        });
        page.add(clearanceGroup);

        const clearanceRow = new Adw.EntryRow({
            title: 'Overrides',
            text: settings.get_strv('app-extra-clearance-overrides').join(', '),
        });
        clearanceRow.connect('notify::text', () => {
            const pairs = clearanceRow.get_text()
                .split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            settings.set_strv('app-extra-clearance-overrides', pairs);
        });
        clearanceGroup.add(clearanceRow);
    }
}
