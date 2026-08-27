/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from "node:test";
import { assertCloseTo, assertEquals, assertSame } from "@kayahr/assert";
import { getDistance, getMidpoint, samePoint, squaredDistanceToSegment } from "../main/Point.ts";

describe("getDistance", () => {
    it("calculates Euclidean distance", () => {
        assertSame(getDistance({ x: 1, y: 2 }, { x: 4, y: 6 }), 5);
    });
});

describe("getMidpoint", () => {
    it("calculates the arithmetic midpoint", () => {
        assertEquals(getMidpoint({ x: -2, y: 4 }, { x: 6, y: 10 }), { x: 2, y: 7 });
    });
});

describe("samePoint", () => {
    it("compares both coordinates", () => {
        assertSame(samePoint({ x: 1, y: 2 }, { x: 1, y: 2 }), true);
        assertSame(samePoint({ x: 1, y: 2 }, { x: 2, y: 2 }), false);
        assertSame(samePoint({ x: 1, y: 2 }, { x: 1, y: 3 }), false);
    });
});

describe("squaredDistanceToSegment", () => {
    it("calculates distances beside and beyond a segment", () => {
        assertSame(squaredDistanceToSegment({ x: 2, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 }), 9);
        assertSame(squaredDistanceToSegment({ x: 6, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 }), 13);
    });

    it("handles a zero-length segment", () => {
        assertCloseTo(squaredDistanceToSegment({ x: 4, y: 6 }, { x: 1, y: 2 }, { x: 1, y: 2 }), 25);
    });
});
