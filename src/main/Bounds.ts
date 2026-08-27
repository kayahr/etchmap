/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { clamp } from "./util/math.ts";
import type { ClippedPoint } from "./ClippedPoint.ts";
import { type Point, samePoint } from "./Point.ts";

/** Immutable axis-aligned rectangular bounds. */
export class Bounds {
    /** Inclusive bottom Y coordinate. */
    public readonly bottom: number;

    /** Inclusive left X coordinate. */
    public readonly left: number;

    /** Inclusive right X coordinate. */
    public readonly right: number;

    /** Inclusive top Y coordinate. */
    public readonly top: number;

    /**
     * Creates rectangular bounds from their edges.
     *
     * @param left   - Inclusive left X coordinate.
     * @param top    - Inclusive top Y coordinate.
     * @param right  - Inclusive right X coordinate.
     * @param bottom - Inclusive bottom Y coordinate.
     * @throws {@link !RangeError} When the horizontal or vertical edges are inverted.
     */
    public constructor(left: number, top: number, right: number, bottom: number) {
        if (left > right || top > bottom) {
            throw new RangeError("Bounds must not be inverted");
        }
        this.bottom = bottom;
        this.left = left;
        this.right = right;
        this.top = top;
    }

    /**
     * Creates bounds around a viewport.
     *
     * @param width  - Viewport width in CSS pixels.
     * @param height - Viewport height in CSS pixels.
     * @param margin - Margin added around every viewport edge in CSS pixels. Negative values inset the bounds. Defaults to zero.
     * @returns Bounds around the viewport.
     * @throws {@link !RangeError} When a negative margin collapses either axis.
     */
    public static fromViewport(width: number, height: number, margin = 0): Bounds {
        return new Bounds(-margin, -margin, width + margin, height + margin);
    }

    /**
     * Clips the line from the center of these bounds to a point.
     *
     * @param point - Point in the same coordinate system as these bounds.
     * @returns Original point, enriched with its boundary intersection when it is outside these bounds.
     */
    public clipPoint(point: Point): Point | ClippedPoint {
        if (this.contains(point)) {
            return point;
        }

        const center = {
            x: (this.left + this.right) / 2,
            y: (this.top + this.bottom) / 2
        };
        const delta = { x: point.x - center.x, y: point.y - center.y };
        const horizontalScale = this.#getScaleToBoundary(delta.x, this.left - center.x, this.right - center.x);
        const verticalScale = this.#getScaleToBoundary(delta.y, this.top - center.y, this.bottom - center.y);
        const scale = Math.min(horizontalScale, verticalScale);
        return {
            ...point,
            clippedX: clamp(center.x + delta.x * scale, this.left, this.right),
            clippedY: clamp(center.y + delta.y * scale, this.top, this.bottom)
        };
    }

    /**
     * Clips a polygon to these bounds.
     *
     * @param points - Polygon vertices. An explicit duplicate closing point is not required.
     * @returns Clipped polygon vertices, or an empty array when the polygon does not intersect these bounds.
     */
    public clipPolygon(points: readonly Point[]): Point[] {
        let output = [ ...points ];
        output = this.#clipPolygonEdge(output, point => point.x >= this.left, (start, end) => this.#intersectVertical(start, end, this.left));
        output = this.#clipPolygonEdge(output, point => point.x <= this.right, (start, end) => this.#intersectVertical(start, end, this.right));
        output = this.#clipPolygonEdge(output, point => point.y >= this.top, (start, end) => this.#intersectHorizontal(start, end, this.top));
        return this.#clipPolygonEdge(output, point => point.y <= this.bottom, (start, end) => this.#intersectHorizontal(start, end, this.bottom));
    }

    /**
     * Clips a polyline to these bounds.
     *
     * @param points - Ordered polyline vertices.
     * @returns Separate visible polyline runs in input order, or an empty array when no part is visible.
     */
    public clipPolyline(points: readonly Point[]): Point[][] {
        if (points.length === 1) {
            return this.contains(points[0]) ? [ [ points[0] ] ] : [];
        }
        const result: Point[][] = [];
        let current: Point[] | null = null;
        let start = points[0];
        let startInside = start != null && this.contains(start);
        for (let index = 1; index < points.length; index++) {
            const end = points[index];
            const endInside = this.contains(end);
            if (startInside && endInside) {
                if (current == null || !samePoint(current[current.length - 1], start)) {
                    current = samePoint(start, end) ? [ start ] : [ start, end ];
                    result.push(current);
                } else if (!samePoint(start, end)) {
                    current.push(end);
                }
                start = end;
                startInside = true;
                continue;
            }

            const segment = this.#clipSegment(start, end);
            if (segment == null) {
                current = null;
                start = end;
                startInside = endInside;
                continue;
            }
            if (current != null && samePoint(current[current.length - 1], segment[0])) {
                if (!samePoint(segment[0], segment[1])) {
                    current.push(segment[1]);
                }
            } else {
                current = samePoint(segment[0], segment[1]) ? [ segment[0] ] : [ segment[0], segment[1] ];
                result.push(current);
            }
            start = end;
            startInside = endInside;
        }
        return result;
    }

    /**
     * Returns whether a point is inside these bounds.
     *
     * @param point - Point to test.
     * @returns `true` when the point is inside or on an edge.
     */
    public contains(point: Point): boolean {
        return point.x >= this.left && point.x <= this.right && point.y >= this.top && point.y <= this.bottom;
    }

    /**
     * Creates a translated copy of these bounds.
     *
     * @param x - Horizontal translation.
     * @param y - Vertical translation. Defaults to zero.
     * @returns Translated bounds.
     */
    public translated(x: number, y = 0): Bounds {
        return new Bounds(this.left + x, this.top + y, this.right + x, this.bottom + y);
    }

    /**
     * Clips a polygon against one boundary.
     *
     * @param points    - Polygon vertices to clip.
     * @param inside    - Predicate deciding whether a vertex is inside the boundary.
     * @param intersect - Function calculating a segment intersection with the boundary.
     * @returns Polygon vertices after clipping against the boundary.
     */
    #clipPolygonEdge(
        points: readonly Point[],
        inside: (point: Point) => boolean,
        intersect: (start: Point, end: Point) => Point
    ): Point[] {
        if (points.length === 0) {
            return [];
        }
        const output: Point[] = [];
        let start = points[points.length - 1];
        let startInside = inside(start);
        for (const end of points) {
            const endInside = inside(end);
            if (endInside !== startInside) {
                output.push(intersect(start, end));
            }
            if (endInside) {
                output.push(end);
            }
            start = end;
            startInside = endInside;
        }
        return output;
    }

    /**
     * Clips one line segment to these bounds using the Liang-Barsky algorithm.
     *
     * @param start - Segment start.
     * @param end   - Segment end.
     * @returns Visible segment endpoints, or `null` when the segment is outside these bounds.
     */
    #clipSegment(start: Point, end: Point): readonly [ Point, Point ] | null {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        let minimum = 0;
        let maximum = 1;

        if (dx === 0) {
            if (start.x < this.left || start.x > this.right) {
                return null;
            }
        } else {
            const first = (this.left - start.x) / dx;
            const second = (this.right - start.x) / dx;
            minimum = Math.max(minimum, Math.min(first, second));
            maximum = Math.min(maximum, Math.max(first, second));
            if (minimum > maximum) {
                return null;
            }
        }

        if (dy === 0) {
            if (start.y < this.top || start.y > this.bottom) {
                return null;
            }
        } else {
            const first = (this.top - start.y) / dy;
            const second = (this.bottom - start.y) / dy;
            minimum = Math.max(minimum, Math.min(first, second));
            maximum = Math.min(maximum, Math.max(first, second));
            if (minimum > maximum) {
                return null;
            }
        }

        return [
            minimum === 0 ? start : { x: start.x + minimum * dx, y: start.y + minimum * dy },
            maximum === 1 ? end : { x: start.x + maximum * dx, y: start.y + maximum * dy }
        ];
    }

    /**
     * Returns the scale at which a directional axis reaches its corresponding boundary.
     *
     * @param delta            - Signed directional axis distance.
     * @param negativeBoundary - Signed distance to the negative boundary.
     * @param positiveBoundary - Signed distance to the positive boundary.
     * @returns Non-negative directional scale, or positive infinity for a zero delta.
     */
    #getScaleToBoundary(delta: number, negativeBoundary: number, positiveBoundary: number): number {
        if (delta > 0) {
            return positiveBoundary / delta;
        }
        if (delta < 0) {
            return negativeBoundary / delta;
        }
        return Number.POSITIVE_INFINITY;
    }

    /**
     * Returns the intersection of a segment and a horizontal line.
     *
     * @param start - Segment start.
     * @param end   - Segment end.
     * @param y     - Horizontal-line Y coordinate.
     * @returns Intersection point.
     */
    #intersectHorizontal(start: Point, end: Point, y: number): Point {
        const ratio = (y - start.y) / (end.y - start.y);
        return { x: start.x + (end.x - start.x) * ratio, y };
    }

    /**
     * Returns the intersection of a segment and a vertical line.
     *
     * @param start - Segment start.
     * @param end   - Segment end.
     * @param x     - Vertical-line X coordinate.
     * @returns Intersection point.
     */
    #intersectVertical(start: Point, end: Point, x: number): Point {
        const ratio = (x - start.x) / (end.x - start.x);
        return { x, y: start.y + (end.y - start.y) * ratio };
    }
}
