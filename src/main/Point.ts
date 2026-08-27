/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { clamp, hypot } from "./util/math.ts";

/**
 * Two-dimensional point.
 *
 * Its coordinate system depends on the API accepting or returning it. Source points use the configured projection's coordinate system, while projected
 * points use viewport-relative CSS pixels.
 */
export interface Point {
    /** Horizontal coordinate in the point's applicable coordinate system. */
    readonly x: number;

    /** Vertical coordinate in the point's applicable coordinate system. */
    readonly y: number;
}

/**
 * Returns the Euclidean distance between two points.
 *
 * @param first  - First point.
 * @param second - Second point.
 * @returns Euclidean distance.
 */
export function getDistance(first: Point, second: Point): number {
    return hypot(second.x - first.x, second.y - first.y);
}

/**
 * Returns the midpoint of two points.
 *
 * @param first  - First point.
 * @param second - Second point.
 * @returns Arithmetic midpoint.
 */
export function getMidpoint(first: Point, second: Point): Point {
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

/**
 * Returns whether two points have identical coordinates.
 *
 * @param first  - First point.
 * @param second - Second point.
 * @returns `true` when both coordinates are identical.
 */
export function samePoint(first: Point, second: Point): boolean {
    return first.x === second.x && first.y === second.y;
}

/**
 * Returns the squared distance from a point to a line segment.
 *
 * @param point - Point whose distance to calculate.
 * @param start - Segment start.
 * @param end   - Segment end.
 * @returns Squared shortest Euclidean distance.
 */
export function squaredDistanceToSegment(point: Point, start: Point, end: Point): number {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const squaredLength = deltaX ** 2 + deltaY ** 2;
    if (squaredLength === 0) {
        return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
    }
    const ratio = clamp(((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / squaredLength, 0, 1);
    const projectedX = start.x + ratio * deltaX;
    const projectedY = start.y + ratio * deltaY;
    return (point.x - projectedX) ** 2 + (point.y - projectedY) ** 2;
}
