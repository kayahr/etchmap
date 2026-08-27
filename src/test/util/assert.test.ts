/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from "node:test";
import { assertSame, assertThrowWithMessage } from "@kayahr/assert";
import { assertFinite, assertNonNegativeInteger, assertNotNull, assertPositiveInteger } from "../../main/util/assert.ts";

describe("assertFinite", () => {
    it("accepts finite numbers", () => {
        assertFinite(12.5, "value");
    });

    it("rejects non-finite numbers", () => {
        assertThrowWithMessage(() => assertFinite(Number.NaN, "value"), RangeError, "value must be finite");
    });
});

describe("assertNotNull", () => {
    it("accepts and narrows values which are not nullish", () => {
        const value = 0 as number | null;

        assertNotNull(value, "value");

        const narrowed: number = value;
        assertSame(narrowed, 0);
    });

    it("rejects null and undefined", () => {
        assertThrowWithMessage(() => assertNotNull(null, "value"), TypeError, "value must not be null or undefined");
        assertThrowWithMessage(() => assertNotNull(undefined, "value"), TypeError, "value must not be null or undefined");
    });
});

describe("assertNonNegativeInteger", () => {
    it("accepts non-negative integers", () => {
        assertNonNegativeInteger(0, "value");
    });

    it("rejects negative and fractional numbers", () => {
        assertThrowWithMessage(() => assertNonNegativeInteger(-1, "value"), RangeError, "value must be a non-negative integer");
        assertThrowWithMessage(() => assertNonNegativeInteger(1.5, "value"), RangeError, "value must be a non-negative integer");
    });
});

describe("assertPositiveInteger", () => {
    it("accepts positive integers", () => {
        assertPositiveInteger(1, "value");
    });

    it("rejects non-positive and fractional numbers", () => {
        assertThrowWithMessage(() => assertPositiveInteger(0, "value"), RangeError, "value must be a positive integer");
        assertThrowWithMessage(() => assertPositiveInteger(1.5, "value"), RangeError, "value must be a positive integer");
    });
});
