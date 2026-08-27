/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import type { Point } from "../Point.ts";
import type { Projection } from "../Projection.ts";
import { Vector } from "../util/Vector.ts";
import { assertFinite } from "../util/assert.ts";
import { clamp, hypot } from "../util/math.ts";

/** Greatest representable number below one, keeping the Mercator logarithm finite at the geographic poles. */
const maximumMercatorSine = 1 - Number.EPSILON / 2;

/** Squared smallest reliably distinguishable angle between unit vectors because `1 - cos(angle)` approaches half the squared angle. */
const squareAngularPrecision = Number.EPSILON;

/**
 * Web Mercator projection used by OpenStreetMap and compatible tile sources.
 *
 * Longitude is X and latitude is Y, both in degrees. Natural line interpolation follows the deterministic shortest great-circle route. Projection input
 * latitudes are limited just short of the geographic poles so results remain finite; values beyond ordinary Web Mercator tile coverage remain available
 * for correct clipping.
 */
export class WebMercatorProjection implements Projection {
    /**
     * Interpolates the shortest great-circle route between two longitude/latitude points or extrapolates along the same oriented great circle.
     *
     * @param start - Route start with longitude as X and latitude as Y, in degrees.
     * @param end   - Route end with longitude as X and latitude as Y, in degrees.
     * @param ratio - Finite interpolation ratio. Zero returns `start`, one returns `end`, and values outside that range extrapolate beyond either endpoint.
     * @returns Interpolated or extrapolated longitude and latitude in degrees.
     * @throws {@link !RangeError} When `ratio` is not finite.
     */
    public interpolateLine(start: Point, end: Point, ratio: number): Point {
        if (ratio === 0) {
            return start;
        }
        if (ratio === 1) {
            return end;
        }
        assertFinite(ratio, "ratio");
        const startVector = this.#createVector(start);
        const endVector = this.#createVector(end);
        const dot = clamp(startVector.dotProduct(endVector), -1, 1);
        const normal = startVector.crossProduct(endVector);
        const squareCrossLength = normal.squareLength;
        if (squareCrossLength <= squareAngularPrecision && dot >= 0) {
            return this.#createPoint(
                new Vector(
                    startVector.x + (endVector.x - startVector.x) * ratio,
                    startVector.y + (endVector.y - startVector.y) * ratio,
                    startVector.z + (endVector.z - startVector.z) * ratio
                ).normalized()
            );
        }

        let angle: number;
        let tangent: Vector;
        let tangentScale: number;
        if (squareCrossLength <= squareAngularPrecision) {
            angle = Math.PI;
            tangent = startVector.orthogonal();
            tangentScale = 1;
        } else {
            const crossLength = Math.sqrt(squareCrossLength);
            angle = Math.atan2(crossLength, dot);
            tangent = normal.crossProduct(startVector);
            tangentScale = 1 / crossLength;
        }
        const period = 2 * Math.PI / angle;
        const reducedRatio = Math.abs(ratio) < period ? ratio : ratio % period;
        const interpolatedAngle = angle * reducedRatio;
        const startScale = Math.cos(interpolatedAngle);
        tangentScale *= Math.sin(interpolatedAngle);
        return this.#createPoint(new Vector(
            startVector.x * startScale + tangent.x * tangentScale,
            startVector.y * startScale + tangent.y * tangentScale,
            startVector.z * startScale + tangent.z * tangentScale
        ));
    }

    /**
     * Converts longitude and latitude in degrees into normalized Web Mercator tile-world coordinates.
     *
     * @param point - Longitude as X and latitude as Y, in degrees.
     * @returns Point in normalized Web Mercator tile-world coordinates.
     */
    public project(point: Point): Point {
        const latitude = clamp(point.y, -90, 90) * Math.PI / 180;
        const sin = clamp(Math.sin(latitude), -maximumMercatorSine, maximumMercatorSine);
        return {
            x: (point.x + 180) / 360,
            y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
        };
    }

    /**
     * Converts normalized Web Mercator tile-world coordinates into longitude and latitude in degrees.
     *
     * @param point - Point in normalized Web Mercator tile-world coordinates.
     * @returns Longitude as X and latitude as Y, in degrees.
     */
    public unproject(point: Point): Point {
        const mercator = Math.PI * (1 - 2 * point.y);
        return {
            x: point.x * 360 - 180,
            y: Math.atan(Math.sinh(mercator)) * 180 / Math.PI
        };
    }

    /**
     * Converts a unit vector into longitude and latitude in degrees.
     *
     * @param vector - Three-dimensional unit vector.
     * @returns Longitude as X and latitude as Y, in degrees.
     */
    #createPoint(vector: Vector): Point {
        return {
            x: Math.atan2(vector.y, vector.x) * 180 / Math.PI,
            y: Math.atan2(vector.z, hypot(vector.x, vector.y)) * 180 / Math.PI
        };
    }

    /**
     * Converts longitude and latitude in degrees into a unit vector.
     *
     * @param point - Longitude as X and latitude as Y, in degrees.
     * @returns Corresponding three-dimensional unit vector.
     */
    #createVector(point: Point): Vector {
        const longitude = point.x * Math.PI / 180;
        const latitude = point.y * Math.PI / 180;
        const latitudeScale = Math.cos(latitude);
        return new Vector(
            latitudeScale * Math.cos(longitude),
            latitudeScale * Math.sin(longitude),
            Math.sin(latitude)
        );
    }
}
