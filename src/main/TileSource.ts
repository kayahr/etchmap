/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import type { Projection } from "./Projection.ts";
import { WebMercatorProjection } from "./projections/WebMercatorProjection.ts";
import { assertFinite, assertNonNegativeInteger, assertPositiveInteger } from "./util/assert.ts";

/**
 * Function returning the URL for a tile.
 *
 * @param zoom - Integer tile zoom level.
 * @param x    - Tile column within the zoom-level grid.
 * @param y    - Tile row within the zoom-level grid.
 * @returns Non-empty tile image URL.
 */
export type TileURLFunction = (zoom: number, x: number, y: number) => string;

/**
 * Tile URL template or function.
 *
 * String templates support `{z}` for the integer zoom level, `{x}` for the tile column and `{y}` for the tile row. Every occurrence is replaced. A
 * function receives those same three values and must return a non-empty URL.
 */
export type TileURL = string | TileURLFunction;

/**
 * Cross-origin mode used when loading tile images.
 *
 * `anonymous` omits credentials, `use-credentials` includes them and `null` leaves the image without a `crossorigin` mode. The latter permits loading
 * servers without CORS support but drawing such an image can taint the destination Canvas.
 */
export type TileCrossOrigin = "anonymous" | "use-credentials" | null;

/** Rectangular tile coverage in normalized tile-world coordinates. */
export interface TileCoverage {
    /** Left coverage edge between zero and one. */
    readonly left: number;

    /** Top coverage edge between zero and one. */
    readonly top: number;

    /** Right coverage edge between zero and one. */
    readonly right: number;

    /** Bottom coverage edge between zero and one. */
    readonly bottom: number;
}

/** Configuration of an XYZ raster-tile source. */
export interface TileSource {
    /** Text displayed as source attribution. Empty or omitted text hides the attribution. */
    readonly attribution?: string;

    /** Optional link opened when the attribution is activated. */
    readonly attributionURL?: string;

    /** Cross-origin mode used when loading tile images. Defaults to `anonymous`. */
    readonly crossOrigin?: TileCrossOrigin;

    /**
     * Rectangular part of the normalized tile world for which tiles are available. Defaults to the complete tile world from zero through one on both
     * axes. Edge tiles only need to intersect the coverage and may therefore extend beyond it.
     */
    readonly coverage?: TileCoverage;

    /** Highest available integer tile zoom. Defaults to 19. */
    readonly maxZoom?: number;

    /** Lowest available integer tile zoom. Defaults to zero. */
    readonly minZoom?: number;

    /** Mapping between source coordinates and normalized tile-world coordinates. Defaults to Web Mercator. */
    readonly projection?: Projection;

    /** Number of tile columns at the minimum zoom level. Defaults to one. */
    readonly rootColumns?: number;

    /** Number of tile rows at the minimum zoom level. Defaults to one. */
    readonly rootRows?: number;

    /** Logical height of one tile in CSS pixels. Defaults to 256. */
    readonly tileHeight?: number;

    /** URL template or function used to load a tile. See {@link TileURL} for the supported template variables. */
    readonly tileURL: TileURL;

    /** Logical width of one tile in CSS pixels. Defaults to 256. */
    readonly tileWidth?: number;

    /** Whether the tile grid repeats horizontally. Defaults to false for custom sources. */
    readonly wrapX?: boolean;
}

/** Fully normalized immutable tile-source configuration. */
export interface NormalizedTileSource {
    /** Text displayed as source attribution, or an empty string when hidden. */
    readonly attribution: string;

    /** Attribution link URL, or an empty string when no link is configured. */
    readonly attributionURL: string;

    /** Cross-origin mode used when loading tile images. */
    readonly crossOrigin: TileCrossOrigin;

    /** Rectangular part of the normalized tile world for which tiles are available. */
    readonly coverage: Readonly<TileCoverage>;

    /** Highest available integer tile zoom. */
    readonly maxZoom: number;

    /** Lowest available integer tile zoom. */
    readonly minZoom: number;

    /** Mapping between source coordinates and normalized tile-world coordinates. */
    readonly projection: Readonly<Projection>;

    /** Number of tile columns at the minimum zoom level. */
    readonly rootColumns: number;

    /** Number of tile rows at the minimum zoom level. */
    readonly rootRows: number;

    /** Logical height of one tile in CSS pixels. */
    readonly tileHeight: number;

    /** URL template or function used to load a tile. */
    readonly tileURL: TileURL;

    /** Logical width of one tile in CSS pixels. */
    readonly tileWidth: number;

    /** Whether the tile grid repeats horizontally. */
    readonly wrapX: boolean;
}

/** Fully normalized default OpenStreetMap raster-tile source. */
const normalizedOSMTileSource: Readonly<NormalizedTileSource> = Object.freeze({
    attribution: "© OpenStreetMap contributors",
    attributionURL: "https://www.openstreetmap.org/copyright",
    crossOrigin: "anonymous",
    coverage: Object.freeze({ bottom: 1, left: 0, right: 1, top: 0 }),
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

/** Default OpenStreetMap raster-tile source. */
export const osmTileSource: Readonly<TileSource> = normalizedOSMTileSource;

/**
 * Normalizes and validates a tile source.
 *
 * @param source - Custom source to normalize, or `undefined` to select the default OpenStreetMap source.
 * @returns Normalized immutable source.
 * @throws {@link !RangeError} When tile geometry, coverage or zoom limits are invalid or exceed safe integer coordinates.
 * @throws {@link !TypeError} When the URL or projection is invalid.
 */
export function normalizeTileSource(source?: TileSource): Readonly<NormalizedTileSource> {
    if (source == null) {
        return normalizedOSMTileSource;
    }

    const tileWidth = source.tileWidth ?? 256;
    const tileHeight = source.tileHeight ?? 256;
    const rootColumns = source.rootColumns ?? 1;
    const rootRows = source.rootRows ?? 1;
    const minZoom = source.minZoom ?? 0;
    const maxZoom = source.maxZoom ?? 19;
    const crossOrigin = source.crossOrigin === undefined ? "anonymous" : source.crossOrigin;
    const coverage = source.coverage ?? { bottom: 1, left: 0, right: 1, top: 0 };
    const projection = source.projection ?? new WebMercatorProjection();

    assertPositiveInteger(tileWidth, "tileWidth");
    assertPositiveInteger(tileHeight, "tileHeight");
    assertPositiveInteger(rootColumns, "rootColumns");
    assertPositiveInteger(rootRows, "rootRows");
    assertNonNegativeInteger(minZoom, "minZoom");
    assertNonNegativeInteger(maxZoom, "maxZoom");
    assertFinite(coverage.bottom, "coverage.bottom");
    assertFinite(coverage.left, "coverage.left");
    assertFinite(coverage.right, "coverage.right");
    assertFinite(coverage.top, "coverage.top");
    if (minZoom > maxZoom) {
        throw new RangeError("minZoom must not be greater than maxZoom");
    }
    if (rootColumns * tileWidth * 2 ** (maxZoom - minZoom) > Number.MAX_SAFE_INTEGER
        || rootRows * tileHeight * 2 ** (maxZoom - minZoom) > Number.MAX_SAFE_INTEGER) {
        throw new RangeError("tile world must stay within the safe integer range at maxZoom");
    }
    if (coverage.left < 0 || coverage.top < 0 || coverage.right > 1 || coverage.bottom > 1) {
        throw new RangeError("coverage must stay within the normalized tile world");
    }
    if (coverage.left >= coverage.right || coverage.top >= coverage.bottom) {
        throw new RangeError("coverage must have positive width and height");
    }
    if (typeof source.tileURL === "string" && source.tileURL.length === 0) {
        throw new TypeError("tileURL must not be empty");
    }
    if (projection == null || typeof projection.project !== "function" || typeof projection.unproject !== "function") {
        throw new TypeError("projection must provide project and unproject functions");
    }
    if (projection.interpolateLine != null && typeof projection.interpolateLine !== "function") {
        throw new TypeError("projection.interpolateLine must be a function");
    }
    if (source.wrapX === true && (coverage.left !== 0 || coverage.right !== 1)) {
        throw new RangeError("horizontally wrapped sources must cover the complete tile-world width");
    }

    return Object.freeze({
        attribution: source.attribution ?? "",
        attributionURL: source.attributionURL ?? "",
        crossOrigin,
        coverage: Object.freeze({ ...coverage }),
        maxZoom,
        minZoom,
        projection,
        rootColumns,
        rootRows,
        tileHeight,
        tileURL: source.tileURL,
        tileWidth,
        wrapX: source.wrapX ?? false
    });
}

/**
 * Resolves a tile URL.
 *
 * @param tileURL - URL template or function.
 * @param zoom    - Tile zoom.
 * @param x       - Tile column.
 * @param y       - Tile row.
 * @returns Resolved URL.
 * @throws Any exception raised by a functional `tileURL` implementation.
 * @throws {@link !TypeError} When a URL function does not return a non-empty string.
 */
export function resolveTileURL(tileURL: TileURL, zoom: number, x: number, y: number): string {
    if (typeof tileURL === "function") {
        const url = tileURL(zoom, x, y);
        if (typeof url !== "string" || url.length === 0) {
            throw new TypeError("tileURL function must return a non-empty string");
        }
        return url;
    }
    return tileURL
        .replaceAll("{z}", String(zoom))
        .replaceAll("{x}", String(x))
        .replaceAll("{y}", String(y));
}
