/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from "node:test";
import { assertCloseTo, assertEquals, assertInstanceOf, assertSame, assertThrowWithMessage } from "@kayahr/assert";
import { Bounds } from "../main/Bounds.ts";

describe("Bounds", () => {
    describe("constructor", () => {
        it("constructs edge bounds", () => {
            const bounds = new Bounds(10, 20, 30, 40);

            assertEquals({ ...bounds }, { bottom: 40, left: 10, right: 30, top: 20 });
        });

        it("rejects inverted edges", () => {
            assertThrowWithMessage(() => new Bounds(30, 20, 10, 40), RangeError, "Bounds must not be inverted");
        });
    });

    describe("fromViewport", () => {
        it("applies positive margins", () => {
            const bounds = Bounds.fromViewport(100, 80, 10);

            assertInstanceOf(bounds, Bounds);
            assertEquals({ ...bounds }, { bottom: 90, left: -10, right: 110, top: -10 });
        });

        it("applies negative margins", () => {
            const bounds = Bounds.fromViewport(100, 80, -10);

            assertEquals({ ...bounds }, { bottom: 70, left: 10, right: 90, top: 10 });
        });

        it("rejects margins which invert the bounds", () => {
            assertThrowWithMessage(() => Bounds.fromViewport(100, 80, -50), RangeError, "Bounds must not be inverted");
        });
    });

    describe("clipPoint", () => {
        it("keeps points inside positive margins and clips points outside them", () => {
            const bounds = Bounds.fromViewport(100, 80, 10);

            assertEquals(bounds.clipPoint({ x: -5, y: 85 }), { x: -5, y: 85 });
            assertEquals(bounds.clipPoint({ x: -20, y: 40 }), { clippedX: -10, clippedY: 40, x: -20, y: 40 });
        });

        it("clips against negative margins", () => {
            const bounds = Bounds.fromViewport(100, 80, -10);

            assertCloseTo(bounds.clipPoint({ x: 5, y: 75 }), {
                clippedX: 11.42857142857143,
                clippedY: 70,
                x: 5,
                y: 75
            }, 10);
        });

        it("intersects the center ray instead of independently clamping both axes", () => {
            const bounds = Bounds.fromViewport(100, 80);

            assertCloseTo(bounds.clipPoint({ x: 150, y: 50 }), {
                clippedX: 100,
                clippedY: 45,
                x: 150,
                y: 50
            }, 10);
        });
    });

    describe("clipPolygon", () => {
        it("clips a polygon against all viewport edges", () => {
            const bounds = Bounds.fromViewport(100, 80);
            const polygon = [
                { x: -10, y: -10 },
                { x: 110, y: -10 },
                { x: 110, y: 90 },
                { x: -10, y: 90 }
            ];

            assertCloseTo(bounds.clipPolygon(polygon), [
                { x: 0, y: 80 },
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 80 }
            ]);
        });

        it("returns no vertices for a polygon completely outside the bounds", () => {
            const bounds = Bounds.fromViewport(100, 80);

            assertEquals(bounds.clipPolygon([
                { x: -30, y: 20 },
                { x: -20, y: 30 },
                { x: -10, y: 20 }
            ]), []);
        });
    });

    describe("clipPolyline", () => {
        it("clips a polyline into separate visible runs", () => {
            const bounds = Bounds.fromViewport(100, 80);
            const points = [
                { x: -10, y: 20 },
                { x: 50, y: 20 },
                { x: 110, y: 20 },
                { x: 110, y: 60 },
                { x: 50, y: 60 },
                { x: -10, y: 60 }
            ];

            assertEquals(bounds.clipPolyline(points), [
                [ { x: 0, y: 20 }, { x: 50, y: 20 }, { x: 100, y: 20 } ],
                [ { x: 100, y: 60 }, { x: 50, y: 60 }, { x: 0, y: 60 } ]
            ]);
        });

        it("keeps existing points for fully visible segments", () => {
            const bounds = Bounds.fromViewport(100, 80);
            const points = [ { x: 10, y: 20 }, { x: 50, y: 40 }, { x: 90, y: 60 } ];
            const lines = bounds.clipPolyline(points);

            assertEquals(lines, [ points ]);
            assertSame(lines[0][0], points[0]);
            assertSame(lines[0][1], points[1]);
            assertSame(lines[0][2], points[2]);
        });

        it("clips a single point by visibility", () => {
            const bounds = Bounds.fromViewport(100, 80);
            const point = { x: 50, y: 40 };

            assertEquals(bounds.clipPolyline([ point ]), [ [ point ] ]);
            assertEquals(bounds.clipPolyline([ { x: 101, y: 40 } ]), []);
        });
    });

    describe("contains", () => {
        it("checks whether a point is inside the bounds", () => {
            const bounds = new Bounds(10, 20, 30, 40);

            assertSame(bounds.contains({ x: 10, y: 40 }), true);
            assertSame(bounds.contains({ x: 31, y: 40 }), false);
        });
    });

    describe("translated", () => {
        it("creates a translated copy", () => {
            const translated = new Bounds(10, 20, 30, 40).translated(5, -10);

            assertEquals({ ...translated }, { bottom: 30, left: 15, right: 35, top: 10 });
        });
    });
});
