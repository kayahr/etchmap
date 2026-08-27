/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import "@kayahr/etchmap";

const cathedral = { x: 6.9583, y: 50.9413 };
const element = document.querySelector("kayahr-map")!;
const marker = element.querySelector(".marker") as SVGSVGElement;

// Prevent the map from capturing the pointer so the marker link remains clickable while wheel events still bubble to the map.
marker.addEventListener("pointerdown", event => event.stopPropagation());

element.getComponent().onDraw = (_context, map): void => {
    const position = map.projectPoint(cathedral);
    marker.style.left = `${position.x}px`;
    marker.style.top = `${position.y}px`;
};
