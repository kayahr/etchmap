/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

/**
 * Asserts that a number is finite.
 *
 * @param value - Value to validate.
 * @param name  - Name used in an exception message.
 * @throws {@link !RangeError} When `value` is not finite.
 */
export function assertFinite(value: number, name: string): void {
    if (!Number.isFinite(value)) {
        throw new RangeError(`${name} must be finite`);
    }
}

/**
 * Asserts that a value is neither `null` nor `undefined`.
 *
 * @template T - Value type to narrow.
 * @param value - Value to validate.
 * @param name  - Name used in an exception message.
 * @throws {@link !TypeError} When `value` is `null` or `undefined`.
 */
export function assertNotNull<T>(value: T, name: string): asserts value is NonNullable<T> {
    if (value == null) {
        throw new TypeError(`${name} must not be null or undefined`);
    }
}

/**
 * Asserts that a number is a non-negative integer.
 *
 * @param value - Value to validate.
 * @param name  - Name used in an exception message.
 * @throws {@link !RangeError} When `value` is not a non-negative integer.
 */
export function assertNonNegativeInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative integer`);
    }
}

/**
 * Asserts that a number is a positive integer.
 *
 * @param value - Value to validate.
 * @param name  - Name used in an exception message.
 * @throws {@link !RangeError} When `value` is not a positive integer.
 */
export function assertPositiveInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive integer`);
    }
}
