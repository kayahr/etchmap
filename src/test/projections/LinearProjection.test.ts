/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from "node:test";
import { assertCloseTo, assertThrowWithMessage } from "@kayahr/assert";
import { LinearProjection } from "../../main/projections/LinearProjection.ts";

describe("LinearProjection", () => {
    describe("constructor", () => {
        it("uses the normalized unit square by default", () => {
            const projection = new LinearProjection();

            assertCloseTo(projection.project({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 }, 10);
            assertCloseTo(projection.unproject({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 }, 10);
        });

        it("rejects invalid edges", () => {
            assertThrowWithMessage(() => new LinearProjection({ bottom: 1, left: 0, right: 0, top: 0 }), RangeError,
                "left and right must be different");
            assertThrowWithMessage(() => new LinearProjection({ bottom: 0, left: 0, right: 1, top: 0 }), RangeError,
                "top and bottom must be different");
            assertThrowWithMessage(() => new LinearProjection({ bottom: 1, left: 0, right: Number.NaN, top: 0 }), RangeError,
                "right must be finite");
        });
    });

    describe("project", () => {
        it("maps arbitrary linear edges in either Y direction", () => {
            const projection = new LinearProjection({ bottom: -50, left: -100, right: 300, top: 150 });

            assertCloseTo(projection.project({ x: -100, y: 150 }), { x: 0, y: 0 }, 10);
            assertCloseTo(projection.project({ x: 300, y: -50 }), { x: 1, y: 1 }, 10);
            assertCloseTo(projection.project({ x: 100, y: 50 }), { x: 0.5, y: 0.5 }, 10);
        });
    });

    describe("unproject", () => {
        it("maps normalized points to the configured linear edges", () => {
            const projection = new LinearProjection({ bottom: -50, left: -100, right: 300, top: 150 });

            assertCloseTo(projection.unproject({ x: 0.25, y: 0.75 }), { x: 0, y: 0 }, 10);
        });
    });
});
