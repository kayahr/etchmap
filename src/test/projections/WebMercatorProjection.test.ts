/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from "node:test";
import { assertCloseTo, assertSame, assertThrowWithMessage, assertTrue } from "@kayahr/assert";
import { WebMercatorProjection } from "../../main/projections/WebMercatorProjection.ts";

describe("WebMercatorProjection", () => {
    const projection = new WebMercatorProjection();

    describe("interpolateLine", () => {
        it("interpolates deterministic shortest great-circle routes", () => {
            const newYork = { x: -74.006, y: 40.7128 };
            const london = { x: -0.1276, y: 51.5072 };

            assertSame(projection.interpolateLine(newYork, london, 0), newYork);
            assertSame(projection.interpolateLine(newYork, london, 1), london);
            assertCloseTo(projection.interpolateLine(newYork, newYork, 0.5), newYork, 10);
            assertCloseTo(projection.interpolateLine(newYork, london, 0.5), { x: -41.2901295161297, y: 52.368381941717466 }, 10);
            assertCloseTo(projection.interpolateLine({ x: 170, y: 0 }, { x: -170, y: 0 }, 0.5), { x: 180, y: 0 }, 10);
            assertCloseTo(projection.interpolateLine({ x: 0, y: 0 }, { x: 180, y: 0 }, 0.5), { x: 90, y: 0 }, 10);
            assertTrue(projection.interpolateLine({ x: 0, y: 0 }, { x: 180, y: 0.00001 }, 0.5).y > 89.999);
        });

        it("extrapolates great-circle routes for every finite ratio", () => {
            const start = { x: 0, y: 0 };
            const end = { x: 90, y: 0 };

            assertCloseTo(projection.interpolateLine(start, end, -1), { x: -90, y: 0 }, 10);
            assertCloseTo(projection.interpolateLine(start, end, 2), { x: 180, y: 0 }, 10);
            const distant = projection.interpolateLine(start, end, Number.MAX_VALUE);
            assertTrue(Number.isFinite(distant.x));
            assertTrue(Number.isFinite(distant.y));
        });

        it("rejects non-finite interpolation ratios", () => {
            assertThrowWithMessage(() => projection.interpolateLine({ x: 0, y: 0 }, { x: 1, y: 1 }, Number.NaN), RangeError,
                "ratio must be finite");
            assertThrowWithMessage(() => projection.interpolateLine({ x: 0, y: 0 }, { x: 1, y: 1 }, Number.POSITIVE_INFINITY), RangeError,
                "ratio must be finite");
        });
    });

    describe("project", () => {
        it("projects longitude and latitude into the normalized tile world", () => {
            assertCloseTo(projection.project({ x: -180, y: 85.0511287798066 }), { x: 0, y: 0 }, 10);
            assertCloseTo(projection.project({ x: 180, y: -85.0511287798066 }), { x: 1, y: 1 }, 10);
        });

        it("projects polar latitudes beyond the finite tile world", () => {
            const northPole = projection.project({ x: 0, y: 90 });
            const southPole = projection.project({ x: 0, y: -90 });

            assertTrue(Number.isFinite(northPole.y));
            assertTrue(northPole.y < 0);
            assertTrue(Number.isFinite(southPole.y));
            assertTrue(southPole.y > 1);
        });
    });

    describe("unproject", () => {
        it("round-trips projected longitude and latitude", () => {
            const points = [
                { x: 0, y: 0 },
                { x: 6.9603, y: 50.9375 },
                { x: -122.5, y: -73.25 },
                { x: 179.999, y: 85.0511287798066 }
            ];

            for (const point of points) {
                assertCloseTo(projection.unproject(projection.project(point)), point, 10);
            }
        });
    });
});
