/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { MapElement } from "./MapElement.ts";

export { type ClippedPoint, isClippedPoint } from "./ClippedPoint.ts";
export {
    type FitPointsOptions,
    type MapDrawCallback,
    MapComponent,
    type MapOptions,
    type PathProjectionOptions,
    type PointProjectionOptions,
    type ViewportOptions
} from "./MapComponent.ts";
export { MapElement } from "./MapElement.ts";
export type { MapPointerEvent } from "./MapPointerEvent.ts";
export type { MapWheelEvent } from "./MapWheelEvent.ts";
export type { PathInterpolation } from "./PathInterpolation.ts";
export type { Point } from "./Point.ts";
export type { Projection } from "./Projection.ts";
export { LinearProjection, type LinearProjectionEdges } from "./projections/LinearProjection.ts";
export { WebMercatorProjection } from "./projections/WebMercatorProjection.ts";
export {
    osmTileSource,
    type TileCrossOrigin,
    type TileCoverage,
    type TileSource,
    type TileURL,
    type TileURLFunction
} from "./TileSource.ts";

customElements.define("kayahr-map", MapElement);

declare global {
    /** Browser element-name mapping augmented with the registered map custom element. */
    interface HTMLElementTagNameMap {
        /** Interactive raster-tile map custom element. */
        "kayahr-map": MapElement;
    }
}
