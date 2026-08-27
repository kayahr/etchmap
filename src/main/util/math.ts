/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

/**
 * Clamps a value to the specified inclusive range.
 *
 * @param value - Value to clamp.
 * @param min   - Inclusive lower bound.
 * @param max   - Inclusive upper bound.
 * @returns Clamped value.
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * Calculates the Euclidean length of a two-dimensional vector.
 *
 * Unlike {@link Math.hypot}, this function performs no input scaling or special-value handling before squaring the components. Use it only when the input
 * range is known not to cause intermediate overflow, underflow or otherwise invalid results. Omitting these safeguards makes it significantly faster than
 * `Math.hypot` for bounded values.
 *
 * @param x - Horizontal component.
 * @param y - Vertical component.
 * @returns Euclidean vector length.
 */
export function hypot(x: number, y: number): number {
    // oxlint-disable-next-line unicorn/prefer-modern-math-apis -- Math.hypot is much slower in V8 for bounded two-component inputs.
    return Math.sqrt(x ** 2 + y ** 2);
}

/**
 * Returns a positive modulo.
 *
 * @param value   - Dividend.
 * @param divisor - Positive divisor.
 * @returns Remainder in the half-open range from zero to `divisor`.
 */
export function modulo(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}
