/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

/**
 * Interpolation method used for path edges before projecting them into the viewport.
 *
 * `natural` delegates edge interpolation to the tile source projection when supported. `projected` connects the supplied vertices directly in the
 * projected map plane.
 */
export type PathInterpolation = "natural" | "projected";
