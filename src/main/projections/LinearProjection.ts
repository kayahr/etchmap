/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import type { Point } from "../Point.ts";
import type { Projection } from "../Projection.ts";
import { assertFinite } from "../util/assert.ts";

/** Source-coordinate values at the four edges of a linear map. */
export interface LinearProjectionEdges {
    /** Source X coordinate at the left edge. */
    readonly left: number;

    /** Source Y coordinate at the top edge. */
    readonly top: number;

    /** Source X coordinate at the right edge. */
    readonly right: number;

    /** Source Y coordinate at the bottom edge. */
    readonly bottom: number;
}

/** Linear projection between arbitrary source coordinates and the normalized tile world. */
export class LinearProjection implements Projection {
    /** Source-coordinate height of the tile world. */
    readonly #height: number;

    /** Source X coordinate at the left edge. */
    readonly #left: number;

    /** Source Y coordinate at the top edge. */
    readonly #top: number;

    /** Source-coordinate width of the tile world. */
    readonly #width: number;

    /**
     * Creates a linear projection.
     *
     * @param edges - Optional source-coordinate values at the map edges. Defaults to the unit square with `left` and `top` at zero and `right` and
     *                `bottom` at one. Reversing `top` and `bottom` supports coordinate systems whose Y axis points upward.
     * @throws {@link !RangeError} When an edge coordinate is not finite or an axis has zero size.
     */
    public constructor(edges: LinearProjectionEdges = { bottom: 1, left: 0, right: 1, top: 0 }) {
        const { bottom, left, right, top } = edges;
        assertFinite(bottom, "bottom");
        assertFinite(left, "left");
        assertFinite(right, "right");
        assertFinite(top, "top");
        if (left === right) {
            throw new RangeError("left and right must be different");
        }
        if (top === bottom) {
            throw new RangeError("top and bottom must be different");
        }
        this.#height = bottom - top;
        this.#left = left;
        this.#top = top;
        this.#width = right - left;
    }

    /**
     * Converts source coordinates into normalized tile-world coordinates.
     *
     * @param point - Point in source coordinates.
     * @returns Point in normalized tile-world coordinates.
     */
    public project(point: Point): Point {
        return {
            x: (point.x - this.#left) / this.#width,
            y: (point.y - this.#top) / this.#height
        };
    }

    /**
     * Converts normalized tile-world coordinates into source coordinates.
     *
     * @param point - Point in normalized tile-world coordinates.
     * @returns Point in source coordinates.
     */
    public unproject(point: Point): Point {
        return {
            x: this.#left + point.x * this.#width,
            y: this.#top + point.y * this.#height
        };
    }
}
