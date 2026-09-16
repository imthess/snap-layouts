'use strict';

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

const CARD_WIDTH = 140;
const CARD_HEIGHT = 90;
const CARD_PADDING = 10;
const ZONE_GAP_PX = 3;
const OVERLAY_MARGIN = 10; 

export const LayoutOverlay = GObject.registerClass(
    {
        Signals: {
            'zone-chosen': { param_types: [GObject.TYPE_JSOBJECT, GObject.TYPE_JSOBJECT] },
        },
    },
    class LayoutOverlay extends St.BoxLayout {
        _init(layouts) {
            super._init({
                style_class: 'snap-layouts-overlay',
                vertical: false,
                reactive: true,
            });

            this._layouts = layouts;
            this._buildCards();
        }

        _buildCards() {
            for (const layout of this._layouts) {
                const card = new St.Widget({
                    style_class: 'snap-layouts-card',
                    layout_manager: new Clutter.FixedLayout(),
                    width: CARD_WIDTH,
                    height: CARD_HEIGHT,
                    reactive: true,
                });

                const innerW = CARD_WIDTH - CARD_PADDING * 2;
                const innerH = CARD_HEIGHT - CARD_PADDING * 2 - 16; 

                for (const zone of layout.zones) {
                    const zoneActor = new St.Button({
                        style_class: 'snap-layouts-zone',
                        reactive: true,
                        can_focus: true,
                        track_hover: true,
                    });

                    const zx = CARD_PADDING + zone.x * innerW + ZONE_GAP_PX / 2;
                    const zy = CARD_PADDING + zone.y * innerH + ZONE_GAP_PX / 2;
                    const zw = zone.w * innerW - ZONE_GAP_PX;
                    const zh = zone.h * innerH - ZONE_GAP_PX;

                    zoneActor.set_position(zx, zy);
                    zoneActor.set_size(Math.max(4, zw), Math.max(4, zh));

                    zoneActor.connect('clicked', () => {
                        this.emit('zone-chosen', layout, zone);
                    });

                    card.add_child(zoneActor);
                }

                const label = new St.Label({
                    style_class: 'snap-layouts-card-label',
                    text: layout.label,
                    y: CARD_HEIGHT - 16,
                });
                label.set_position(CARD_PADDING, CARD_HEIGHT - 16);
                card.add_child(label);

                this.add_child(card);
            }
        }
        positionNear(buttonRect, workArea) {
            let x = buttonRect.x + buttonRect.width / 2 - this.width / 2;
            let y = buttonRect.y + buttonRect.height + OVERLAY_MARGIN;

            const maxX = workArea.x + workArea.width - this.width - 4;
            const minX = workArea.x + 4;
            x = Math.max(minX, Math.min(x, maxX));

            
            if (y + this.height > workArea.y + workArea.height) {
                y = buttonRect.y - this.height - OVERLAY_MARGIN;
            }

            this.set_position(Math.round(x), Math.round(y));
        }
    }
);
