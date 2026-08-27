/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { TileCache, tilePriorityClassSize } from "./TileCache.ts";
import type { NormalizedTileSource } from "./TileSource.ts";
import { assertNotNull } from "./util/assert.ts";
import { clamp, hypot, modulo } from "./util/math.ts";

/** Priority band for the transient current view while an animation has a destination view. */
const transientPriority = tilePriorityClassSize;

/** Priority band for current-view buffer tiles. */
const bufferPriority = tilePriorityClassSize * 2;

/** Camera and viewport state used for drawing tiles. */
interface TileView {
    /** Horizontal camera center in minimum-zoom world pixels. */
    readonly centerX: number;

    /** Vertical camera center in minimum-zoom world pixels. */
    readonly centerY: number;

    /** Viewport height in CSS pixels. */
    readonly height: number;

    /** Optional horizontal destination center used to preload an active camera animation. */
    readonly targetCenterX?: number;

    /** Optional vertical destination center used to preload an active camera animation. */
    readonly targetCenterY?: number;

    /** Optional continuous destination zoom used to preload an active camera animation. */
    readonly targetZoom?: number;

    /** Viewport width in CSS pixels. */
    readonly width: number;

    /** Current continuous camera zoom. */
    readonly zoom: number;
}

/** Tile-aligned area of an integer tile zoom. */
interface TileRange {
    /** Inclusive buffered bottom tile row. */
    readonly bottom: number;

    /** Camera center X expressed in pixels of this integer tile zoom. */
    readonly centerX: number;

    /** Camera center Y expressed in pixels of this integer tile zoom. */
    readonly centerY: number;

    /** Inclusive buffered left tile column, possibly unwrapped. */
    readonly left: number;

    /** Visible bottom edge in pixels of this integer tile zoom. */
    readonly requiredBottom: number;

    /** Visible left edge in pixels of this integer tile zoom. */
    readonly requiredLeft: number;

    /** Visible right edge in pixels of this integer tile zoom. */
    readonly requiredRight: number;

    /** Visible top edge in pixels of this integer tile zoom. */
    readonly requiredTop: number;

    /** Inclusive buffered right tile column, possibly unwrapped. */
    readonly right: number;

    /** Inclusive buffered top tile row. */
    readonly top: number;
}

/** A ready image and its unwrapped tile position. */
interface PositionedTile {
    /** Loaded image ready for synchronous Canvas drawing. */
    readonly image: HTMLImageElement;

    /** Possibly unwrapped tile column. */
    readonly x: number;

    /** Tile row. */
    readonly y: number;

    /** Integer tile zoom. */
    readonly zoom: number;
}

/** Composited viewport-local tile surface. */
interface Mosaic {
    /** Composited viewport-local tile surface. */
    readonly canvas: HTMLCanvasElement;

    /** Horizontal surface origin in pixels of `zoom`. */
    readonly originX: number;

    /** Vertical surface origin in pixels of `zoom`. */
    readonly originY: number;

    /** Integer tile zoom of the surface coordinate system. */
    readonly zoom: number;
}

/** Options used to create a tile renderer. */
interface TileRendererOptions {
    /** Maximum number of ready images retained by the tile cache. */
    readonly cacheSize: number;

    /** Document in which Canvas and image resources are created. */
    readonly document: Document;

    /** Maximum number of concurrent tile image requests. */
    readonly maxConcurrentLoads: number;

    /** Callback requesting a map frame after relevant renderer state changes. */
    readonly onChange: () => void;

    /** Normalized tile source to render. */
    readonly source: Readonly<NormalizedTileSource>;
}

/** Seam-free raster-tile renderer using a buffered viewport-local mosaic. */
export class TileRenderer {
    /** Spare mosaic canvas used for double-buffered composition. */
    #backCanvas: HTMLCanvasElement | null = null;

    /** Loaded tile cache. */
    readonly #cache: TileCache;

    /** Document in which rendering resources are created. */
    readonly #document: Document;

    /** Whether the current mosaic can be improved with newly loaded tiles. */
    #dirty = true;

    /** Current front mosaic. */
    #mosaic: Mosaic | null = null;

    /** Callback requesting a map frame. */
    readonly #onChange: () => void;

    /** Scratch canvas used to compose complete child groups. */
    #scratchCanvas: HTMLCanvasElement | null = null;

    /** Tile source being rendered. */
    readonly #source: Readonly<NormalizedTileSource>;

    /**
     * Creates a tile renderer.
     *
     * @param options - Renderer options.
     */
    public constructor(options: TileRendererOptions) {
        this.#document = options.document;
        this.#onChange = options.onChange;
        this.#source = options.source;
        this.#cache = new TileCache({
            createImage: () => this.#document.createElement("img"),
            maxConcurrentLoads: options.maxConcurrentLoads,
            maxTiles: options.cacheSize,
            onChange: (zoom, x, y) => this.#handleTileLoad(zoom, x, y),
            onRetry: this.#onChange,
            source: this.#source
        });
    }

    /** Releases cached images and transient rendering surfaces. */
    public dispose(): void {
        this.#cache.dispose();
        this.#mosaic = null;
        this.#backCanvas = null;
        this.#scratchCanvas = null;
    }

    /**
     * Draws the map for the specified view.
     *
     * @param context - Destination Canvas context using CSS-pixel coordinates.
     * @param view    - Current camera and viewport state.
     * @throws {@link !Error} When a required offscreen Canvas cannot provide a 2D context.
     */
    public draw(context: CanvasRenderingContext2D, view: TileView): void {
        const zoom = clamp(Math.round(view.zoom), this.#source.minZoom, this.#source.maxZoom);
        const hasTarget = view.targetZoom != null;
        const range = this.#getRange(view, zoom, hasTarget ? 0 : 1);
        this.#cache.beginFrame();
        if (view.targetZoom != null) {
            const targetZoom = clamp(Math.round(view.targetZoom), this.#source.minZoom, this.#source.maxZoom);
            const targetRange = this.#getRange({
                ...view,
                centerX: view.targetCenterX ?? view.centerX,
                centerY: view.targetCenterY ?? view.centerY,
                zoom: view.targetZoom
            }, targetZoom, 0);
            this.#requestRange(targetZoom, targetRange, 0, 0, true);
        }

        const exactTiles = this.#requestRange(zoom, range, hasTarget ? transientPriority : 0, bufferPriority, true);
        if (this.#mustCompose(range, zoom)) {
            this.#compose(range, zoom, exactTiles);
        }
        this.#cache.endFrame();

        const mosaic = this.#mosaic;
        assertNotNull(mosaic, "tile mosaic");
        const scale = 2 ** (view.zoom - mosaic.zoom);
        const sourceScale = 2 ** (mosaic.zoom - this.#source.minZoom);
        const centerX = view.centerX * sourceScale;
        const centerY = view.centerY * sourceScale;
        const x = view.width / 2 + (mosaic.originX - centerX) * scale;
        const y = view.height / 2 + (mosaic.originY - centerY) * scale;
        context.drawImage(mosaic.canvas, x, y, mosaic.canvas.width * scale, mosaic.canvas.height * scale);
    }

    /**
     * Composes a new front mosaic.
     *
     * @param range      - Buffered tile range covered by the mosaic.
     * @param zoom       - Integer tile zoom of the mosaic coordinate system.
     * @param exactTiles - Ready exact tiles to draw over fallback content.
     * @throws {@link !Error} When the offscreen mosaic Canvas cannot provide a 2D context.
     */
    #compose(range: TileRange, zoom: number, exactTiles: readonly PositionedTile[]): void {
        const width = Math.max(0, range.right - range.left + 1) * this.#source.tileWidth;
        const height = Math.max(0, range.bottom - range.top + 1) * this.#source.tileHeight;
        const canvas = this.#backCanvas ?? this.#document.createElement("canvas");
        if (canvas.width !== width) {
            canvas.width = width;
        }
        if (canvas.height !== height) {
            canvas.height = height;
        }
        const context = canvas.getContext("2d");
        if (context == null) {
            throw new Error("Unable to create tile mosaic Canvas context");
        }
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, width, height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        const originX = range.left * this.#source.tileWidth;
        const originY = range.top * this.#source.tileHeight;
        const sourceScale = 2 ** (zoom - this.#source.minZoom);
        const worldWidth = this.#source.rootColumns * this.#source.tileWidth * sourceScale;
        const worldHeight = this.#source.rootRows * this.#source.tileHeight * sourceScale;
        const coverage = this.#source.coverage;
        const coverageLeft = this.#source.wrapX ? originX : coverage.left * worldWidth;
        const coverageWidth = this.#source.wrapX ? width : (coverage.right - coverage.left) * worldWidth;
        const clipsCoverage = coverage.left !== 0 || coverage.top !== 0 || coverage.right !== 1 || coverage.bottom !== 1;
        if (clipsCoverage) {
            context.save();
            context.beginPath();
            context.rect(
                coverageLeft - originX,
                coverage.top * worldHeight - originY,
                coverageWidth,
                (coverage.bottom - coverage.top) * worldHeight
            );
            context.clip();
        }
        this.#drawAncestors(context, range, zoom, originX, originY, exactTiles);
        this.#drawChildGroups(context, range, zoom, originX, originY, exactTiles);

        const previous = this.#mosaic;
        if (previous != null && previous.canvas.width > 0 && previous.canvas.height > 0) {
            const scale = 2 ** (zoom - previous.zoom);
            const previousX = previous.originX * scale - originX;
            const previousY = previous.originY * scale - originY;
            const previousWidth = previous.canvas.width * scale;
            const previousHeight = previous.canvas.height * scale;
            if (previousX < width && previousY < height && previousX + previousWidth > 0 && previousY + previousHeight > 0) {
                context.drawImage(previous.canvas, previousX, previousY, previousWidth, previousHeight);
            }
        }

        for (const tile of exactTiles) {
            context.drawImage(
                tile.image,
                tile.x * this.#source.tileWidth - originX,
                tile.y * this.#source.tileHeight - originY,
                this.#source.tileWidth,
                this.#source.tileHeight
            );
        }
        if (clipsCoverage) {
            context.restore();
        }

        this.#mosaic = {
            canvas,
            originX,
            originY,
            zoom
        };
        this.#backCanvas = previous?.canvas ?? null;
        this.#dirty = false;
    }

    /**
     * Draws cached ancestor tiles from coarse to fine.
     *
     * @param context    - Offscreen mosaic context.
     * @param range      - Tile range covered by the mosaic.
     * @param zoom       - Integer mosaic zoom.
     * @param originX    - Horizontal mosaic origin in pixels of `zoom`.
     * @param originY    - Vertical mosaic origin in pixels of `zoom`.
     * @param exactTiles - Ready exact tiles which do not need fallback content.
     */
    #drawAncestors(
        context: CanvasRenderingContext2D,
        range: TileRange,
        zoom: number,
        originX: number,
        originY: number,
        exactTiles: readonly PositionedTile[]
    ): void {
        const exactKeys = new Set(exactTiles.map(tile => `${tile.x}/${tile.y}`));
        const ancestors = new Map<string, PositionedTile>();
        for (let y = range.top; y <= range.bottom; y++) {
            for (let x = range.left; x <= range.right; x++) {
                if (exactKeys.has(`${x}/${y}`)) {
                    continue;
                }
                const protect = this.#isTileVisible(x, y, range);
                for (let ancestorZoom = zoom - 1; ancestorZoom >= this.#source.minZoom; ancestorZoom--) {
                    const divisor = 2 ** (zoom - ancestorZoom);
                    const ancestorX = Math.floor(x / divisor);
                    const ancestorY = Math.floor(y / divisor);
                    const image = this.#cache.peek(ancestorZoom, ancestorX, ancestorY, protect);
                    if (image != null) {
                        ancestors.set(`${ancestorZoom}/${ancestorX}/${ancestorY}`, { image, x: ancestorX, y: ancestorY, zoom: ancestorZoom });
                        break;
                    }
                }
            }
        }
        for (const tile of [ ...ancestors.values() ].sort((first, second) => first.zoom - second.zoom)) {
            const scale = 2 ** (zoom - tile.zoom);
            context.drawImage(
                tile.image,
                tile.x * this.#source.tileWidth * scale - originX,
                tile.y * this.#source.tileHeight * scale - originY,
                this.#source.tileWidth * scale,
                this.#source.tileHeight * scale
            );
        }
    }

    /**
     * Draws complete cached 2 by 2 child groups as single downscaled images.
     *
     * @param context    - Offscreen mosaic context.
     * @param range      - Tile range covered by the mosaic.
     * @param zoom       - Integer mosaic zoom.
     * @param originX    - Horizontal mosaic origin in pixels of `zoom`.
     * @param originY    - Vertical mosaic origin in pixels of `zoom`.
     * @param exactTiles - Ready exact tiles which do not need fallback content.
     * @throws {@link !Error} When the child-group scratch Canvas cannot provide a 2D context.
     */
    #drawChildGroups(
        context: CanvasRenderingContext2D,
        range: TileRange,
        zoom: number,
        originX: number,
        originY: number,
        exactTiles: readonly PositionedTile[]
    ): void {
        if (zoom >= this.#source.maxZoom) {
            return;
        }
        const exactKeys = new Set(exactTiles.map(tile => `${tile.x}/${tile.y}`));
        let scratch: HTMLCanvasElement | null = null;
        let scratchContext: CanvasRenderingContext2D | null = null;
        for (let y = range.top; y <= range.bottom; y++) {
            for (let x = range.left; x <= range.right; x++) {
                if (exactKeys.has(`${x}/${y}`)) {
                    continue;
                }
                const protect = this.#isTileVisible(x, y, range);
                const children = [
                    this.#cache.peek(zoom + 1, x * 2, y * 2, false),
                    this.#cache.peek(zoom + 1, x * 2 + 1, y * 2, false),
                    this.#cache.peek(zoom + 1, x * 2, y * 2 + 1, false),
                    this.#cache.peek(zoom + 1, x * 2 + 1, y * 2 + 1, false)
                ];
                if (children.some(image => image == null)) {
                    continue;
                }
                if (protect) {
                    this.#cache.peek(zoom + 1, x * 2, y * 2, true);
                    this.#cache.peek(zoom + 1, x * 2 + 1, y * 2, true);
                    this.#cache.peek(zoom + 1, x * 2, y * 2 + 1, true);
                    this.#cache.peek(zoom + 1, x * 2 + 1, y * 2 + 1, true);
                }
                scratch ??= this.#getScratchCanvas();
                scratchContext ??= scratch.getContext("2d");
                if (scratchContext == null) {
                    throw new Error("Unable to create child tile Canvas context");
                }
                scratchContext.setTransform(1, 0, 0, 1, 0, 0);
                scratchContext.clearRect(0, 0, scratch.width, scratch.height);
                for (let index = 0; index < children.length; index++) {
                    const image = children[index];
                    assertNotNull(image, "child tile image");
                    scratchContext.drawImage(
                        image,
                        index % 2 * this.#source.tileWidth,
                        Math.floor(index / 2) * this.#source.tileHeight,
                        this.#source.tileWidth,
                        this.#source.tileHeight
                    );
                }
                context.drawImage(
                    scratch,
                    x * this.#source.tileWidth - originX,
                    y * this.#source.tileHeight - originY,
                    this.#source.tileWidth,
                    this.#source.tileHeight
                );
            }
        }
    }

    /**
     * Returns the reusable child-group scratch Canvas at the required size.
     *
     * @returns Scratch Canvas sized to two by two logical tiles.
     */
    #getScratchCanvas(): HTMLCanvasElement {
        const canvas = this.#scratchCanvas ?? this.#document.createElement("canvas");
        canvas.width = this.#source.tileWidth * 2;
        canvas.height = this.#source.tileHeight * 2;
        this.#scratchCanvas = canvas;
        return canvas;
    }

    /**
     * Calculates the tile range needed for a view.
     *
     * @param view   - Camera and viewport state.
     * @param zoom   - Integer tile zoom for which to calculate the range.
     * @param buffer - Number of additional tile rows and columns around the visible range.
     * @returns Buffered tile range and exact visible pixel bounds at `zoom`.
     */
    #getRange(view: TileView, zoom: number, buffer: number): TileRange {
        const sourceScale = 2 ** (zoom - this.#source.minZoom);
        const displayScale = 2 ** (view.zoom - zoom);
        const centerX = view.centerX * sourceScale;
        const centerY = view.centerY * sourceScale;
        const worldWidth = this.#source.rootColumns * this.#source.tileWidth * sourceScale;
        const worldHeight = this.#source.rootRows * this.#source.tileHeight * sourceScale;
        const coverage = this.#source.coverage;
        const coverageLeft = coverage.left * worldWidth;
        const coverageRight = coverage.right * worldWidth;
        const coverageTop = coverage.top * worldHeight;
        const coverageBottom = coverage.bottom * worldHeight;
        const visibleLeft = centerX - view.width / (2 * displayScale);
        const visibleRight = centerX + view.width / (2 * displayScale);
        const visibleTop = centerY - view.height / (2 * displayScale);
        const visibleBottom = centerY + view.height / (2 * displayScale);
        const requiredLeft = this.#source.wrapX ? visibleLeft : clamp(visibleLeft, coverageLeft, coverageRight);
        const requiredRight = this.#source.wrapX ? visibleRight : clamp(visibleRight, coverageLeft, coverageRight);
        const requiredTop = clamp(visibleTop, coverageTop, coverageBottom);
        const requiredBottom = clamp(visibleBottom, coverageTop, coverageBottom);
        const columns = this.#source.rootColumns * sourceScale;
        const rows = this.#source.rootRows * sourceScale;
        const coverageLeftColumn = Math.floor(coverage.left * columns);
        const coverageRightColumn = Math.ceil(coverage.right * columns) - 1;
        const coverageTopRow = Math.floor(coverage.top * rows);
        const coverageBottomRow = Math.ceil(coverage.bottom * rows) - 1;
        let left = Math.floor(requiredLeft / this.#source.tileWidth) - buffer;
        let right = Math.ceil(requiredRight / this.#source.tileWidth) - 1 + buffer;
        let top = Math.floor(requiredTop / this.#source.tileHeight) - buffer;
        let bottom = Math.ceil(requiredBottom / this.#source.tileHeight) - 1 + buffer;
        if (!this.#source.wrapX) {
            left = clamp(left, coverageLeftColumn, coverageRightColumn);
            right = clamp(right, coverageLeftColumn, coverageRightColumn);
        }
        top = clamp(top, coverageTopRow, coverageBottomRow);
        bottom = clamp(bottom, coverageTopRow, coverageBottomRow);
        return { bottom, centerX, centerY, left, requiredBottom, requiredLeft, requiredRight, requiredTop, right, top };
    }

    /**
     * Handles a loaded image only when it can improve the current mosaic.
     *
     * @param zoom - Integer zoom of the loaded tile.
     * @param x    - Canonical column of the loaded tile.
     * @param y    - Row of the loaded tile.
     */
    #handleTileLoad(zoom: number, x: number, y: number): void {
        const mosaic = this.#mosaic;
        if (mosaic == null || this.#tileIntersectsMosaic(zoom, x, y, mosaic)) {
            this.#dirty = true;
            this.#onChange();
        }
    }

    /**
     * Returns whether a tile in the current range intersects the visible viewport.
     *
     * @param x     - Possibly unwrapped tile column.
     * @param y     - Tile row.
     * @param range - Tile range containing exact visible pixel bounds.
     * @returns `true` when the tile intersects the visible viewport.
     */
    #isTileVisible(x: number, y: number, range: TileRange): boolean {
        const visibleLeft = Math.floor(range.requiredLeft / this.#source.tileWidth);
        const visibleRight = Math.ceil(range.requiredRight / this.#source.tileWidth) - 1;
        const visibleTop = Math.floor(range.requiredTop / this.#source.tileHeight);
        const visibleBottom = Math.ceil(range.requiredBottom / this.#source.tileHeight) - 1;
        return x >= visibleLeft && x <= visibleRight && y >= visibleTop && y <= visibleBottom;
    }

    /**
     * Returns whether a new mosaic must be composed.
     *
     * @param range - Required current-view tile range.
     * @param zoom  - Required integer tile zoom.
     * @returns `true` when content changed or the current mosaic cannot cover the view.
     */
    #mustCompose(range: TileRange, zoom: number): boolean {
        const mosaic = this.#mosaic;
        if (this.#dirty || mosaic == null || mosaic.zoom !== zoom) {
            return true;
        }
        return range.requiredLeft < mosaic.originX
            || range.requiredTop < mosaic.originY
            || range.requiredRight > mosaic.originX + mosaic.canvas.width
            || range.requiredBottom > mosaic.originY + mosaic.canvas.height;
    }

    /**
     * Requests a tile range and returns images which are already ready.
     *
     * @param zoom            - Integer tile zoom.
     * @param range           - Buffered tile range to request.
     * @param visiblePriority - Base priority for visible tiles.
     * @param bufferPriority  - Base priority for buffered tiles outside the viewport.
     * @param protectVisible  - Whether ready visible tiles are protected from eviction during this frame.
     * @returns Ready positioned tiles.
     */
    #requestRange(
        zoom: number,
        range: TileRange,
        visiblePriority: number,
        bufferPriority: number,
        protectVisible: boolean
    ): PositionedTile[] {
        const readyTiles: PositionedTile[] = [];
        for (let y = range.top; y <= range.bottom; y++) {
            for (let x = range.left; x <= range.right; x++) {
                const isVisible = this.#isTileVisible(x, y, range);
                const dx = (x + 0.5) * this.#source.tileWidth - range.centerX;
                const dy = (y + 0.5) * this.#source.tileHeight - range.centerY;
                const distance = hypot(dx / this.#source.tileWidth, dy / this.#source.tileHeight);
                const priority = (isVisible ? visiblePriority : bufferPriority) + distance;
                const image = this.#cache.request(zoom, x, y, priority, protectVisible && isVisible);
                if (image != null) {
                    readyTiles.push({ image, x, y, zoom });
                }
            }
        }
        return readyTiles;
    }

    /**
     * Returns whether a loaded tile can contribute to the current mosaic.
     *
     * @param zoom   - Integer zoom of the loaded tile.
     * @param x      - Canonical column of the loaded tile.
     * @param y      - Row of the loaded tile.
     * @param mosaic - Current mosaic to test.
     * @returns `true` when the tile can supply exact, ancestor or complete child-group content within the mosaic.
     */
    #tileIntersectsMosaic(zoom: number, x: number, y: number, mosaic: Mosaic): boolean {
        if (zoom > mosaic.zoom + 1) {
            return false;
        }
        if (zoom === mosaic.zoom + 1) {
            const baseX = Math.floor(x / 2) * 2;
            const baseY = Math.floor(y / 2) * 2;
            const children = [
                this.#cache.peek(zoom, baseX, baseY, false),
                this.#cache.peek(zoom, baseX + 1, baseY, false),
                this.#cache.peek(zoom, baseX, baseY + 1, false),
                this.#cache.peek(zoom, baseX + 1, baseY + 1, false)
            ];
            return children.every(image => image != null)
                && this.#tileIntersectsMosaic(mosaic.zoom, Math.floor(x / 2), Math.floor(y / 2), mosaic);
        }

        const scale = 2 ** (mosaic.zoom - zoom);
        const left = mosaic.originX / this.#source.tileWidth;
        const right = left + mosaic.canvas.width / this.#source.tileWidth - 1;
        const top = mosaic.originY / this.#source.tileHeight;
        const bottom = top + mosaic.canvas.height / this.#source.tileHeight - 1;
        const columns = this.#source.rootColumns * 2 ** (mosaic.zoom - this.#source.minZoom);
        for (let tileY = top; tileY <= bottom; tileY++) {
            if (Math.floor(tileY / scale) !== y) {
                continue;
            }
            for (let tileX = left; tileX <= right; tileX++) {
                const canonicalX = this.#source.wrapX ? modulo(tileX, columns) : tileX;
                if (Math.floor(canonicalX / scale) === x) {
                    return true;
                }
            }
        }
        return false;
    }
}
