/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from "node:test";
import { assertEquals, assertNull, assertSame, assertThrowWithMessage, assertTrue } from "@kayahr/assert";
import type { Point } from "../main/Point.ts";
import { WebMercatorProjection } from "../main/projections/WebMercatorProjection.ts";
import { type TileSource, normalizeTileSource, osmTileSource, resolveTileURL } from "../main/TileSource.ts";

describe("osmTileSource", () => {
    it("defines the complete frozen OpenStreetMap source", () => {
        assertEquals(osmTileSource, {
            attribution: "© OpenStreetMap contributors",
            attributionURL: "https://www.openstreetmap.org/copyright",
            crossOrigin: "anonymous",
            coverage: { bottom: 1, left: 0, right: 1, top: 0 },
            maxZoom: 19,
            minZoom: 0,
            projection: new WebMercatorProjection(),
            rootColumns: 1,
            rootRows: 1,
            tileHeight: 256,
            tileURL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            tileWidth: 256,
            wrapX: true
        });
        assertTrue(Object.isFrozen(osmTileSource));
        assertTrue(Object.isFrozen(osmTileSource.coverage));
    });
});

describe("normalizeTileSource", () => {
    it("returns the OpenStreetMap source when no custom source is provided", () => {
        assertSame(normalizeTileSource(), osmTileSource);
    });

    it("does not inherit OpenStreetMap metadata for a custom source", () => {
        const customSource = normalizeTileSource({ tileURL: osmTileSource.tileURL });

        assertSame(customSource.attribution, "");
        assertSame(customSource.attributionURL, "");
        assertSame(customSource.wrapX, false);
    });

    it("normalizes custom defaults while preserving an explicit null CORS mode", () => {
        const source = normalizeTileSource({
            attribution: "Example Maps",
            attributionURL: "https://example.com/copyright",
            crossOrigin: null,
            tileURL: "https://example.com/{z}/{x}/{y}.png"
        });

        assertEquals(source, {
            attribution: "Example Maps",
            attributionURL: "https://example.com/copyright",
            crossOrigin: null,
            coverage: { bottom: 1, left: 0, right: 1, top: 0 },
            maxZoom: 19,
            minZoom: 0,
            projection: new WebMercatorProjection(),
            rootColumns: 1,
            rootRows: 1,
            tileHeight: 256,
            tileURL: "https://example.com/{z}/{x}/{y}.png",
            tileWidth: 256,
            wrapX: false
        });
        assertNull(source.crossOrigin);
        assertTrue(Object.isFrozen(source));
    });

    it("validates source geometry, zoom range and URL", () => {
        assertThrowWithMessage(() => normalizeTileSource({ tileURL: "tiles", tileWidth: 0 }), RangeError, "tileWidth must be a positive integer");
        assertThrowWithMessage(() => normalizeTileSource({ tileURL: "tiles", tileHeight: 1.5 }), RangeError, "tileHeight must be a positive integer");
        assertThrowWithMessage(() => normalizeTileSource({ tileURL: "tiles", rootColumns: -1 }), RangeError, "rootColumns must be a positive integer");
        assertThrowWithMessage(() => normalizeTileSource({ tileURL: "tiles", rootRows: 0 }), RangeError, "rootRows must be a positive integer");
        assertThrowWithMessage(() => normalizeTileSource({ tileURL: "tiles", minZoom: -1 }), RangeError, "minZoom must be a non-negative integer");
        assertThrowWithMessage(() => normalizeTileSource({ tileURL: "tiles", maxZoom: 2.5 }), RangeError, "maxZoom must be a non-negative integer");
        assertThrowWithMessage(() => normalizeTileSource({ tileURL: "tiles", minZoom: 3, maxZoom: 2 }), RangeError,
            "minZoom must not be greater than maxZoom");
        assertThrowWithMessage(() => normalizeTileSource({ tileURL: "tiles", tileWidth: Number.MAX_SAFE_INTEGER, rootColumns: 2 }), RangeError,
            "tile world must stay within the safe integer range at maxZoom");
        assertThrowWithMessage(() => normalizeTileSource({ coverage: { bottom: 1, left: Number.NaN, right: 1, top: 0 }, tileURL: "tiles" }), RangeError,
            "coverage.left must be finite");
        assertThrowWithMessage(() => normalizeTileSource({ coverage: { bottom: 1, left: -0.1, right: 1, top: 0 }, tileURL: "tiles" }), RangeError,
            "coverage must stay within the normalized tile world");
        assertThrowWithMessage(() => normalizeTileSource({ coverage: { bottom: 0.5, left: 0, right: 1, top: 0.5 }, tileURL: "tiles" }), RangeError,
            "coverage must have positive width and height");
        assertThrowWithMessage(() => normalizeTileSource({
            coverage: { bottom: 1, left: 0.1, right: 1, top: 0 },
            tileURL: "tiles",
            wrapX: true
        }), RangeError, "horizontally wrapped sources must cover the complete tile-world width");
        assertThrowWithMessage(() => normalizeTileSource({ tileURL: "" }), TypeError, "tileURL must not be empty");
        assertThrowWithMessage(() => normalizeTileSource({ tileURL: "tiles", projection: {} } as TileSource), TypeError,
            "projection must provide project and unproject functions");
        assertThrowWithMessage(() => normalizeTileSource({
            projection: { interpolateLine: true, project: (point: Point) => point, unproject: (point: Point) => point },
            tileURL: "tiles"
        } as unknown as TileSource), TypeError, "projection.interpolateLine must be a function");
    });

    it("preserves a custom projection", () => {
        const projection = {
            project: (point: { x: number; y: number }) => ({ x: point.x / 2, y: point.y / 3 }),
            unproject: (point: { x: number; y: number }) => ({ x: point.x * 2, y: point.y * 3 })
        };

        assertSame(normalizeTileSource({ projection, tileURL: "tiles" }).projection, projection);
    });

    it("normalizes and freezes custom tile coverage", () => {
        const coverage = { bottom: 0.75, left: 0.25, right: 0.75, top: 0.125 };
        const source = normalizeTileSource({ coverage, tileURL: "tiles" });

        assertEquals(source.coverage, coverage);
        assertTrue(Object.isFrozen(source.coverage));
    });

});

describe("resolveTileURL", () => {
    it("resolves every template placeholder and delegates function URLs", () => {
        assertSame(resolveTileURL("/{z}/{x}/{y}/{x}/{z}.png", 4, -2, 3), "/4/-2/3/-2/4.png");

        const calls: number[][] = [];
        const result = resolveTileURL((zoom, x, y) => {
            calls.push([ zoom, x, y ]);
            return `${zoom}:${x}:${y}`;
        }, 5, 7, 9);
        assertSame(result, "5:7:9");
        assertEquals(calls, [ [ 5, 7, 9 ] ]);
    });
});
