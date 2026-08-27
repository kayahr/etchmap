/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import type { Point } from "./Point.ts";

/**
 * A projected point outside the viewport clipping bounds with an additional clipped position.
 *
 * The inherited `x` and `y` coordinates always contain the actual projected position in CSS pixels, regardless of the clipping bounds.
 */
export interface ClippedPoint extends Point {
    /**
     * Horizontal coordinate of the clipped position in CSS pixels.
     *
     * The position is where the line from the viewport center to the actual projected point intersects the clipping bounds, including the margin passed to
     * {@link MapComponent.projectPoint}.
     */
    readonly clippedX: number;

    /**
     * Vertical coordinate of the clipped position in CSS pixels.
     *
     * The position is where the line from the viewport center to the actual projected point intersects the clipping bounds, including the margin passed to
     * {@link MapComponent.projectPoint}.
     */
    readonly clippedY: number;
}

/**
 * Determines whether a projected point has an additional clipped position.
 *
 * @param point - Projected point to inspect.
 * @returns `true` when the point is outside the clipping bounds and provides `clippedX` and `clippedY`.
 */
export function isClippedPoint(point: Point | ClippedPoint): point is ClippedPoint {
    return "clippedX" in point && "clippedY" in point;
}
