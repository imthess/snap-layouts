'use strict';

import Meta from 'gi://Meta';


export function zoneToRect(zone, workArea, gapPx = 0) {
    const halfGap = gapPx / 2;
    const x = workArea.x + zone.x * workArea.width + (zone.x > 0 ? halfGap : 0);
    const y = workArea.y + zone.y * workArea.height + (zone.y > 0 ? halfGap : 0);
    let w = zone.w * workArea.width;
    let h = zone.h * workArea.height;

    
    
    if (zone.x > 0) w -= halfGap;
    if (zone.x + zone.w < 1) w -= halfGap;
    if (zone.y > 0) h -= halfGap;
    if (zone.y + zone.h < 1) h -= halfGap;

    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(Math.max(50, w)),
        height: Math.round(Math.max(50, h)),
    };
}


export function snapWindowToRect(win, rect) {
    const isMaximized = typeof win.is_maximized === 'function'
        ? win.is_maximized()
        : win.get_maximized() !== 0; 

    if (isMaximized) {
        if (typeof win.is_maximized === 'function')
            win.unmaximize(); 
        else
            win.unmaximize(Meta.MaximizeFlags.BOTH); 
    }
    
    win.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
}
