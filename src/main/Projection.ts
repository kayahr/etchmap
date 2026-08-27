/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import type { Point } from "./Point.ts";

/**
 * A reversible mapping between source coordinates and normalized tile-world coordinates.
 *
 * For example, the built-in {@link WebMercatorProjection} interprets source X as longitude and source Y as latitude, both in degrees.
 */
export interface Projection {
    /**
     * Optionally interpolates the natural route between two source-coordinate points.
     *
     * Custom projections may omit this method. In that case, path vertices are projected directly and connected with linear segments in projected
     * viewport coordinates, making `natural` interpolation behave like `projected` interpolation.
     *
     * Implementations must accept finite coordinates and a ratio from zero through one, and must return a point with finite coordinates.
     *
     * @param start - Route start in source coordinates.
     * @param end   - Route end in source coordinates.
     * @param ratio - Interpolation ratio between zero for `start` and one for `end`.
     * @returns Interpolated point in source coordinates.
     * @throws Any implementation-defined exception. The built-in implementation throws {@link !RangeError} when `ratio` is not finite.
     */
    interpolateLine?(start: Point, end: Point, ratio: number): Point;

    /**
     * Converts source coordinates into normalized tile-world coordinates.
     *
     * The normalized tile world conventionally spans zero through one on both axes, but coordinates outside that range are allowed so clipping can
     * preserve paths beyond finite tile-world edges.
     * Implementations must return a point with finite coordinates.
     *
     * @param point - Point in source coordinates.
     * @returns Point in normalized tile-world coordinates.
     * @throws Any implementation-defined exception.
     */
    project(point: Point): Point;

    /**
     * Converts normalized tile-world coordinates into source coordinates.
     *
     * Implementations must return a point with finite coordinates.
     *
     * @param point - Point in normalized tile-world coordinates.
     * @returns Point in source coordinates.
     * @throws Any implementation-defined exception.
     */
    unproject(point: Point): Point;
}
