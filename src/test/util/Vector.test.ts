/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from "node:test";
import { assertCloseTo, assertSame } from "@kayahr/assert";
import { Vector } from "../../main/util/Vector.ts";

describe("Vector", () => {
    describe("constructor", () => {
        it("stores all components", () => {
            const vector = new Vector(1, 2, 3);

            assertSame(vector.x, 1);
            assertSame(vector.y, 2);
            assertSame(vector.z, 3);
        });
    });

    describe("crossProduct", () => {
        it("creates the cross product", () => {
            assertCloseTo(Vector.unitX.crossProduct(Vector.unitY), Vector.unitZ);
        });
    });

    describe("dotProduct", () => {
        it("calculates the scalar product", () => {
            assertSame(new Vector(1, 2, 3).dotProduct(new Vector(4, 5, 6)), 32);
        });
    });

    describe("length", () => {
        it("calculates squared and ordinary length", () => {
            const vector = new Vector(2, 3, 6);

            assertSame(vector.squareLength, 49);
            assertSame(vector.length, 7);
        });
    });

    describe("orthogonal", () => {
        it("creates a deterministic normalized perpendicular for every reference-axis branch", () => {
            for (const vector of [ new Vector(1, 1, 0), new Vector(1, 0, 1), new Vector(0, 1, 1) ]) {
                const orthogonal = vector.orthogonal();

                assertCloseTo(orthogonal.length, 1);
                assertCloseTo(orthogonal.dotProduct(vector), 0);
            }
        });
    });

    describe("normalized", () => {
        it("creates a unit-length copy", () => {
            assertCloseTo(new Vector(2, 3, 6).normalized().length, 1);
        });
    });
});
