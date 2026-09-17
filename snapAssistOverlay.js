'use strict';

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

const PADDING = 14;
const HINT_HEIGHT = 22;
const CHIP_WIDTH = 104;
const CHIP_HEIGHT = 84;
const CHIP_SPACING = 8;
const CHIP_ICON_SIZE = 40;
const TITLE_MAX_CHARS = 20;

export const SnapAssistZone = GObject.registerClass(
    {
        Signals: {
            'window-chosen': { param_types: [GObject.TYPE_JSOBJECT] },
        },
    },
    class SnapAssistZone extends St.Widget {
        _init(rect, candidates) {
            super._init({
                style_class: 'snap-layouts-assist-zone',
                layout_manager: new Clutter.FixedLayout(),
                reactive: true,
                x: Math.round(rect.x),
                y: Math.round(rect.y),
            });
            this.set_size(Math.round(rect.width), Math.round(rect.height));

            const hint = new St.Label({
                style_class: 'snap-layouts-assist-hint',
                text: 'Choose a window for this space',
            });
            hint.set_position(PADDING, PADDING);
            this.add_child(hint);

            const gridTop = PADDING + HINT_HEIGHT + CHIP_SPACING;
            const availableWidth = Math.max(CHIP_WIDTH, Math.round(rect.width) - PADDING * 2);
            const columns = Math.max(1, Math.floor(
                (availableWidth + CHIP_SPACING) / (CHIP_WIDTH + CHIP_SPACING)
            ));

            const tracker = Shell.WindowTracker.get_default();

            candidates.forEach((win, index) => {
                const col = index % columns;
                const row = Math.floor(index / columns);
                const cx = PADDING + col * (CHIP_WIDTH + CHIP_SPACING);
                const cy = gridTop + row * (CHIP_HEIGHT + CHIP_SPACING);

                const chip = new St.Button({
                    style_class: 'snap-layouts-assist-chip',
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                });
                chip.set_position(cx, cy);
                chip.set_size(CHIP_WIDTH, CHIP_HEIGHT);

                const chipBox = new St.BoxLayout({
                    vertical: true,
                    x_align: Clutter.ActorAlign.CENTER,
                });

                const app = tracker.get_window_app(win);
                if (app) {
                    try {
                        const icon = app.create_icon_texture(CHIP_ICON_SIZE);
                        if (icon)
                            chipBox.add_child(icon);
                    } catch (e) {
                    }
                }

                const title = (win.get_title && win.get_title()) || '';
                const shortTitle = title.length > TITLE_MAX_CHARS
                    ? `${title.slice(0, TITLE_MAX_CHARS - 1)}\u2026`
                    : title;
                chipBox.add_child(new St.Label({
                    style_class: 'snap-layouts-assist-chip-label',
                    text: shortTitle,
                }));

                chip.set_child(chipBox);
                chip.connect('clicked', () => this.emit('window-chosen', win));

                this.add_child(chip);
            });
        }
    }
);
