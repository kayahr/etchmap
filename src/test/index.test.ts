/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import "./dom.ts";
import { describe, it } from "node:test";
import { assertAssignable, assertEquals, assertSame } from "@kayahr/assert";
import { type ClippedPoint, isClippedPoint } from "../main/ClippedPoint.ts";
import {
    MapComponent,
    type MapDrawCallback,
    type MapOptions,
    type PathProjectionOptions,
    type PointProjectionOptions,
    type ViewportOptions
} from "../main/MapComponent.ts";
import { MapElement } from "../main/MapElement.ts";
import type { MapPointerEvent } from "../main/MapPointerEvent.ts";
import type { MapWheelEvent } from "../main/MapWheelEvent.ts";
import type { PathInterpolation } from "../main/PathInterpolation.ts";
import type { Point } from "../main/Point.ts";
import type { Projection } from "../main/Projection.ts";
import { LinearProjection, type LinearProjectionEdges } from "../main/projections/LinearProjection.ts";
import { WebMercatorProjection } from "../main/projections/WebMercatorProjection.ts";
import { osmTileSource } from "../main/TileSource.ts";
import type * as Exported from "../main/index.ts";

const exports = await import("../main/index.ts");

describe("index", () => {
    it("exports the component and element and registers its custom element", () => {
        assertEquals({ ...exports }, { LinearProjection, MapComponent, MapElement, WebMercatorProjection, isClippedPoint, osmTileSource });
        assertSame(customElements.get("kayahr-map"), MapElement);
        assertAssignable<ClippedPoint, Exported.ClippedPoint>();
        assertAssignable<LinearProjectionEdges, Exported.LinearProjectionEdges>();
        assertAssignable<MapDrawCallback, Exported.MapDrawCallback>();
        assertAssignable<MapOptions, Exported.MapOptions>();
        assertAssignable<MapPointerEvent, Exported.MapPointerEvent>();
        assertAssignable<MapPointerEvent, HTMLElementEventMap["map-pointerdown"]>();
        assertAssignable<MapWheelEvent, Exported.MapWheelEvent>();
        assertAssignable<MapWheelEvent, HTMLElementEventMap["map-wheel"]>();
        assertAssignable<PathInterpolation, Exported.PathInterpolation>();
        assertAssignable<PathProjectionOptions, Exported.PathProjectionOptions>();
        assertAssignable<Point, Exported.Point>();
        assertAssignable<PointProjectionOptions, Exported.PointProjectionOptions>();
        assertAssignable<Projection, Exported.Projection>();
        assertAssignable<ViewportOptions, Exported.ViewportOptions>();
        assertAssignable<MapComponent, ReturnType<MapElement["getComponent"]>>();
        assertAssignable<MapElement, HTMLElementTagNameMap["kayahr-map"]>();
    });
});
