/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from "node:test";
import { assertSame } from "@kayahr/assert";
import { isClippedPoint } from "../main/ClippedPoint.ts";

describe("isClippedPoint", () => {
    it("distinguishes projected points with a clipped position", () => {
        assertSame(isClippedPoint({ x: 10, y: 20 }), false);
        assertSame(isClippedPoint({ clippedX: 5, clippedY: 15, x: 10, y: 20 }), true);
    });
});
