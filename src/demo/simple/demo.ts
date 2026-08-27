/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import "@kayahr/map";

const cathedral = { x: 6.9583, y: 50.9413 };
const element = document.querySelector("kayahr-map")!;
const marker = element.querySelector(".marker") as SVGSVGElement;

element.getComponent().onDraw = (_context, map): void => {
    const position = map.projectPoint(cathedral);
    marker.style.left = `${position.x}px`;
    marker.style.top = `${position.y}px`;
};
