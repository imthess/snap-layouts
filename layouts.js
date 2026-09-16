'use strict';
const LAYOUTS = [
    {
        id: 'split-50-50',
        label: '50 / 50',
        minAspect: 0,
        zones: [
            { x: 0.0, y: 0.0, w: 0.5, h: 1.0 },
            { x: 0.5, y: 0.0, w: 0.5, h: 1.0 },
        ],
    },
    {
        id: 'split-67-33',
        label: '2/3 + 1/3',
        minAspect: 0,
        zones: [
            { x: 0.0, y: 0.0, w: 2 / 3, h: 1.0 },
            { x: 2 / 3, y: 0.0, w: 1 / 3, h: 1.0 },
        ],
    },
    {
        id: 'split-33-67',
        label: '1/3 + 2/3',
        minAspect: 0,
        zones: [
            { x: 0.0, y: 0.0, w: 1 / 3, h: 1.0 },
            { x: 1 / 3, y: 0.0, w: 2 / 3, h: 1.0 },
        ],
    },
    {
        id: 'thirds',
        label: '3 Columns',
        
        minAspect: 1.3,
        zones: [
            { x: 0.0, y: 0.0, w: 1 / 3, h: 1.0 },
            { x: 1 / 3, y: 0.0, w: 1 / 3, h: 1.0 },
            { x: 2 / 3, y: 0.0, w: 1 / 3, h: 1.0 },
        ],
    },
    {
        id: 'grid-4',
        label: '4-Way Grid',
        minAspect: 0,
        zones: [
            { x: 0.0, y: 0.0, w: 0.5, h: 0.5 },
            { x: 0.5, y: 0.0, w: 0.5, h: 0.5 },
            { x: 0.0, y: 0.5, w: 0.5, h: 0.5 },
            { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
        ],
    },
    {
        id: 'split-25-50-25',
        label: 'Side + Center + Side',
        minAspect: 1.5,
        zones: [
            { x: 0.0, y: 0.0, w: 0.25, h: 1.0 },
            { x: 0.25, y: 0.0, w: 0.5, h: 1.0 },
            { x: 0.75, y: 0.0, w: 0.25, h: 1.0 },
        ],
    },
    {
        id: 'main-plus-two-stack',
        label: 'Main + Stack',
        minAspect: 1.3,
        zones: [
            { x: 0.0, y: 0.0, w: 2 / 3, h: 1.0 },
            { x: 2 / 3, y: 0.0, w: 1 / 3, h: 0.5 },
            { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
        ],
    },
];


function getLayoutsForAspect(aspect) {
    return LAYOUTS.filter(l => aspect >= l.minAspect);
}

export var Layouts = {
    LAYOUTS,
    getLayoutsForAspect,
};
