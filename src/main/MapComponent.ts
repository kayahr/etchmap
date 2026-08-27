/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { Bounds } from "./Bounds.ts";
import type { ClippedPoint } from "./ClippedPoint.ts";
import type { PathInterpolation } from "./PathInterpolation.ts";
import type { Point } from "./Point.ts";
import { MapCamera } from "./MapCamera.ts";
import type { MapElement } from "./MapElement.ts";
import { MapInteraction } from "./MapInteraction.ts";
import { TileRenderer } from "./TileRenderer.ts";
import { type NormalizedTileSource, type TileSource, normalizeTileSource } from "./TileSource.ts";
import { assertFinite, assertPositiveInteger } from "./util/assert.ts";

/** Component to bind to the map element currently being created. */
let componentForNewElement: MapComponent | null = null;

/** Element to bind to the map component currently being created. */
let elementForNewComponent: MapElement | null = null;

/**
 * Returns and clears the map component intended for a new map element.
 *
 * @returns Pending map component, or `null` when the element must create one itself.
 */
export function takeMapComponentForNewElement(): MapComponent | null {
    const component = componentForNewElement;
    componentForNewElement = null;
    return component;
}

/**
 * Returns and clears the map element intended for a new map component.
 *
 * @returns Pending map element, or `null` when the component must create one itself.
 */
function takeMapElementForNewComponent(): MapElement | null {
    const element = elementForNewComponent;
    elementForNewComponent = null;
    return element;
}

/**
 * Creates the fixed map component belonging to the specified map element.
 *
 * @param element - Map element for which to create the component.
 * @returns Created map component.
 * @throws Any exception raised while creating the component.
 * @throws {@link !Error} When another element-to-component construction is already active.
 */
export function createMapComponentForElement(element: MapElement): MapComponent {
    if (elementForNewComponent != null) {
        throw new Error("A map component is already being created for an element");
    }
    elementForNewComponent = element;
    try {
        return new MapComponent();
    } finally {
        elementForNewComponent = null;
    }
}

/**
 * Creates the fixed map element belonging to the specified map component.
 *
 * @param component - Map component for which to create the element.
 * @returns Created map element.
 * @throws Any exception raised while creating the custom element.
 * @throws {@link !Error} When another component-to-element construction is already active.
 */
function createMapElementForComponent(component: MapComponent): MapElement {
    if (componentForNewElement != null) {
        throw new Error("A map element is already being created for a component");
    }
    componentForNewElement = component;
    try {
        return document.createElement("kayahr-map");
    } finally {
        componentForNewElement = null;
    }
}

/** Symbol-keyed lifecycle method which connects a map component to its element and document. */
export const connectMapComponent = Symbol("connectMapComponent");

/** Symbol-keyed lifecycle method which disconnects a map component from its element and document. */
export const disconnectMapComponent = Symbol("disconnectMapComponent");

/** Shadow-DOM stylesheet shared by every map component. No template string used here for better minimization. */
const styles =
    ":host{" +
        "display:block;" +
        "position:relative;" +
        "overflow:hidden;" +
        "touch-action:none" +
    "}" +
    "canvas,.layers{" +
        "position:absolute;" +
        "inset:0;" +
        "width:100%;" +
        "height:100%" +
    "}" +
    "canvas{" +
        "display:block;" +
        "z-index:0;" +
        "cursor:grab;" +
        "touch-action:none;" +
        "user-select:none;" +
        "writing-mode:horizontal-tb" +
    "}" +
    "canvas:active{" +
        "cursor:grabbing" +
    "}" +
    ".layers{" +
        "z-index:1;" +
        "pointer-events:none" +
    "}" +
    ".attribution{" +
        "position:absolute;" +
        "right:0;" +
        "bottom:0;" +
        "padding:0.125rem 0.25rem;" +
        "color:#222;" +
        "background:rgb(255 255 255 / 80%);" +
        "font:11px/1.2 sans-serif;" +
        "pointer-events:auto" +
    "}" +
    ".attribution:empty{" +
        "display:none" +
    "}" +
    "::slotted(*){" +
        "position:absolute;" +
        "pointer-events:auto" +
    "}";

/** Options used when creating a map component. */
export interface MapOptions {
    /** Maximum positive integer number of ready tile images retained in memory. Defaults to 512. */
    readonly cacheSize?: number;

    /** Initial center in source coordinates. Defaults to the center of the projected tile world. */
    readonly center?: Point;

    /**
     * Whether to raise the effective minimum zoom until the tile coverage fills the viewport. Defaults to `true`.
     *
     * Disable this to permit unused space around a map when it is displayed smaller than the viewport. Horizontal size does not constrain wrapping
     * sources because their worlds repeat.
     */
    readonly coverViewport?: boolean;

    /** Maximum positive integer number of tile images loaded concurrently. Defaults to eight. */
    readonly maxConcurrentLoads?: number;

    /**
     * Maximum continuous view zoom. Defaults to {@link TileSource.maxZoom}.
     *
     * This is independent of native tile LOD. Values above the source maximum keep scaling its maximum-level tiles up.
     */
    readonly maxZoom?: number;

    /**
     * Minimum continuous view zoom. Defaults to {@link TileSource.minZoom}.
     *
     * This is independent of native tile LOD. Values below the source minimum keep scaling its minimum-level tiles down.
     */
    readonly minZoom?: number;

    /** Raster-tile source. Omit to use the default OpenStreetMap source. */
    readonly source?: TileSource;

    /**
     * Initial continuous view zoom.
     *
     * At a zoom equal to {@link TileSource.minZoom}, one source-tile pixel occupies one CSS pixel. Increasing the zoom by one doubles displayed width
     * and height; decreasing it by one halves both dimensions. Fractional and negative values are supported. Native tile selection remains clamped to
     * the source LOD range independently.
     *
     * When omitted, the initial zoom is one level above the effective minimum after the viewport size is known, limited by `maxZoom`.
     */
    readonly zoom?: number;
}

/** Options used when projecting or clipping geometry against the map viewport. */
export interface ViewportOptions {
    /** Additional viewport margin in CSS pixels. Positive values expand the bounds and negative values move them into the viewport. Defaults to zero. */
    readonly margin?: number;
}

/** Options used when projecting a point against the map viewport. */
export interface PointProjectionOptions extends ViewportOptions {
    /**
     * Whether to return every visible horizontal world copy instead of one nearest potentially clipped copy.
     *
     * Defaults to `false`. This option only has an effect for horizontally wrapping tile sources.
     */
    readonly wrapCopies?: boolean;
}

/** Options used when projecting and clipping paths against the map viewport. */
export interface PathProjectionOptions extends ViewportOptions {
    /** Edge interpolation mode. `natural` uses the source projection's path geometry and is the default. */
    readonly interpolation?: PathInterpolation;
}

/**
 * Callback invoked after the map has been drawn.
 *
 * @param context - Canvas context configured to use CSS pixel coordinates.
 * @param map     - Map component being drawn.
 * @returns `true` to request another frame. `false` and `void` stop the callback animation and are the default.
 * @throws Any exception raised by the callback propagates from the animation frame after the Canvas state has been restored.
 */
export type MapDrawCallback = (context: CanvasRenderingContext2D, map: MapComponent) => true | false | void;

/** Options for fitting source-coordinate points into the map viewport. */
export interface FitPointsOptions {
    /** Whether to animate the camera transition. Defaults to `false`. */
    readonly animated?: boolean;

    /**
     * Non-negative inset from every viewport edge in CSS pixels.
     *
     * Defaults to five percent of the shorter viewport dimension.
     */
    readonly margin?: number;

    /** Maximum zoom used for this fit operation. Defaults to the map's current maximum zoom. */
    readonly maxZoom?: number;
}

/**
 * Standalone interactive raster-tile map component which owns its corresponding custom element.
 *
 * The component provides the programmatic map API. It owns a continuous camera, DPR-aware Canvas, interaction controller, tile cache and renderer, and
 * exactly one {@link MapElement}. Add the element returned by {@link getElement} to the document to display the map.
 */
export class MapComponent {
    /** ID of the scheduled animation frame, or null when no redraw is scheduled. */
    #animationFrame: number | null = null;

    /** Window in which the current animation frame was scheduled. */
    #animationFrameView: Window | null = null;

    /** Link displaying the current tile-source attribution. */
    readonly #attribution: HTMLAnchorElement;

    /** Maximum number of ready tile images retained in memory. */
    #cacheSize: number;

    /** Camera shared by rendering, interaction and projection helpers. */
    readonly #camera: MapCamera;

    /** Canvas used to draw the map. */
    readonly #canvas: HTMLCanvasElement;

    /** Whether the component is currently connected to the document. */
    #connected = false;

    /** Whether the minimum zoom is raised as needed to cover the viewport. */
    #coverViewport: boolean;

    /** Whether the drawing callback requested another frame. */
    #continuousDraw = false;

    /** Logical Canvas height in CSS pixel units. */
    #cssHeight = 0;

    /** Logical Canvas width in CSS pixel units. */
    #cssWidth = 0;

    /** Drawing context of the map canvas. */
    readonly #context: CanvasRenderingContext2D;

    /** Custom element owned by this component. */
    readonly #element: MapElement;

    /** Whether the current Canvas contents are invalid. */
    #invalid = false;

    /** Pointer and wheel interaction controller. */
    readonly #interaction: MapInteraction;

    /** Container hosting slotted overlays and built-in map controls. */
    readonly #layers: HTMLDivElement;

    /** Maximum number of concurrent tile loads. */
    readonly #maxConcurrentLoads: number;

    /** Configured maximum view zoom, or `null` to follow the tile source maximum. */
    #maxZoom: number | null;

    /** Configured minimum view zoom, or `null` to follow the tile source minimum. */
    #minZoom: number | null;

    /** Callback invoked after drawing the map. */
    #onDraw: MapDrawCallback | null = null;

    /** Number of device pixels per CSS pixel. */
    #pixelRatio: number;

    /** Observer used to keep the Canvas backing store in sync with its displayed size. */
    readonly #resizeObserver: ResizeObserver;

    /** Normalized tile source. */
    #source: Readonly<NormalizedTileSource>;

    /** Current tile renderer and image cache. */
    #tileRenderer: TileRenderer;

    /**
     * Creates a new map component with its own map element.
     *
     * @param options - Initial map options.
     * @throws Any exception raised by the configured projection while establishing the initial center.
     * @throws {@link !Error} When the browser cannot provide a 2D Canvas context or hybrid construction violates the one-to-one component/element
     * relationship.
     * @throws {@link !RangeError} When cache capacity, load concurrency, source geometry, coverage, zoom limits or zoom are invalid.
     * @throws {@link !TypeError} When the tile source is malformed.
     */
    public constructor(options: MapOptions = {}) {
        const cacheSize = options.cacheSize ?? 512;
        assertPositiveInteger(cacheSize, "cacheSize");
        this.#cacheSize = cacheSize;
        this.#coverViewport = options.coverViewport ?? true;
        const maxConcurrentLoads = options.maxConcurrentLoads ?? 8;
        assertPositiveInteger(maxConcurrentLoads, "maxConcurrentLoads");
        this.#maxConcurrentLoads = maxConcurrentLoads;
        this.#maxZoom = options.maxZoom ?? null;
        this.#minZoom = options.minZoom ?? null;
        this.#source = normalizeTileSource(options.source);
        this.#camera = new MapCamera(this.#source, options.center ?? this.#coverageCenter, options.zoom ?? null, this.#minZoom ?? this.#source.minZoom,
            this.#maxZoom ?? this.#source.maxZoom, this.#coverViewport);

        this.#element = takeMapElementForNewComponent() ?? createMapElementForComponent(this);
        this.#pixelRatio = this.#element.ownerDocument.defaultView?.devicePixelRatio ?? 1;
        const ownerDocument = this.#element.ownerDocument;
        const shadow = this.#element.attachShadow({ mode: "open" });

        this.#canvas = ownerDocument.createElement("canvas");
        this.#canvas.width = 0;
        this.#canvas.height = 0;
        const context = this.#canvas.getContext("2d");
        if (context == null) {
            throw new Error("Unable to create 2D Canvas context");
        }
        this.#context = context;

        this.#layers = ownerDocument.createElement("div");
        this.#layers.className = "layers";
        this.#layers.append(ownerDocument.createElement("slot"));

        this.#attribution = ownerDocument.createElement("a");
        this.#attribution.className = "attribution";
        this.#attribution.setAttribute("part", "attribution");
        this.#attribution.rel = "noopener noreferrer";
        this.#attribution.target = "_blank";
        this.#layers.append(this.#attribution);

        const style = ownerDocument.createElement("style");
        style.textContent = styles;
        shadow.append(this.#canvas, this.#layers, style);

        this.#tileRenderer = this.#createTileRenderer();
        this.#interaction = new MapInteraction(
            this.#element,
            this.#canvas,
            this.#camera,
            () => ({ x: this.#cssWidth, y: this.#cssHeight }),
            () => this.invalidate(),
            event => this.#element.dispatchEvent(event)
        );
        this.#updateAttribution();

        this.#resizeObserver = new ResizeObserver(entries => {
            const entry = entries[0];
            if (entry != null) {
                const deviceSize = entry.devicePixelContentBoxSize?.[0];
                this.#resize(entry.contentRect.width, entry.contentRect.height, deviceSize?.inlineSize, deviceSize?.blockSize);
            }
        });
    }

    /**
     * Maximum number of ready tile images retained in memory.
     *
     * @returns Positive tile-cache capacity.
     */
    public get cacheSize(): number {
        return this.#cacheSize;
    }

    /**
     * Changes the tile-cache limit and starts with a fresh cache.
     *
     * @param cacheSize - Positive integer number of ready tile images to retain.
     * @throws {@link !RangeError} When `cacheSize` is not a positive integer.
     */
    public set cacheSize(cacheSize: number) {
        assertPositiveInteger(cacheSize, "cacheSize");
        if (cacheSize !== this.#cacheSize) {
            this.#cacheSize = cacheSize;
            this.#replaceTileRenderer();
        }
    }

    /**
     * Current center in source coordinates.
     *
     * @returns Center interpreted by the current tile source projection.
     * @throws Any exception raised by the configured inverse projection.
     */
    public get center(): Point {
        return this.#camera.sourceCenter;
    }

    /**
     * Changes the center in source coordinates immediately and stops active camera motion.
     *
     * @param center - New center interpreted by the current tile source projection, or `null` to use the center of its tile coverage.
     * @throws Any exception raised by the configured projection.
     */
    public set center(center: Point | null) {
        this.#interaction.stop();
        this.#camera.setCenter(center ?? this.#coverageCenter);
        this.invalidate();
    }

    /**
     * Whether the effective minimum zoom is raised until the tile coverage fills the viewport.
     *
     * @returns `true` while viewport coverage constrains the minimum zoom.
     */
    public get coverViewport(): boolean {
        return this.#coverViewport;
    }

    /**
     * Enables or disables the viewport-cover zoom constraint.
     *
     * @param coverViewport - Whether tile coverage must fill the viewport.
     */
    public set coverViewport(coverViewport: boolean) {
        if (coverViewport !== this.#coverViewport) {
            this.#interaction.stop();
            this.#camera.setZoomConstraints(this.minZoom, this.maxZoom, coverViewport);
            this.#coverViewport = coverViewport;
            this.invalidate();
        }
    }

    /**
     * Current device pixel ratio used for drawing.
     *
     * @returns Number of Canvas device pixels per exposed CSS pixel.
     */
    public get devicePixelRatio(): number {
        return this.#pixelRatio;
    }

    /**
     * Logical map width in CSS pixels.
     *
     * @returns Width used by the drawing context and projection helpers.
     */
    public get width(): number {
        return this.#cssWidth;
    }

    /**
     * Logical map height in CSS pixels.
     *
     * @returns Height used by the drawing context and projection helpers.
     */
    public get height(): number {
        return this.#cssHeight;
    }

    /**
     * Maximum continuous view zoom.
     *
     * @returns Explicit map maximum, or the current source maximum when no override is configured.
     */
    public get maxZoom(): number {
        return this.#maxZoom ?? this.#source.maxZoom;
    }

    /**
     * Changes the maximum continuous view zoom.
     *
     * @param maxZoom - New map maximum, or `null` to follow the current tile source maximum.
     * @throws {@link !RangeError} When the resolved range is not finite or its minimum is greater than its maximum.
     */
    public set maxZoom(maxZoom: number | null) {
        this.setZoomRange(this.#minZoom, maxZoom);
    }

    /**
     * Minimum continuous view zoom before applying the optional viewport-cover constraint.
     *
     * @returns Explicit map minimum, or the current source minimum when no override is configured.
     */
    public get minZoom(): number {
        return this.#minZoom ?? this.#source.minZoom;
    }

    /**
     * Changes the minimum continuous view zoom.
     *
     * @param minZoom - New map minimum, or `null` to follow the current tile source minimum.
     * @throws {@link !RangeError} When the resolved range is not finite or its minimum is greater than its maximum.
     */
    public set minZoom(minZoom: number | null) {
        this.setZoomRange(minZoom, this.#maxZoom);
    }

    /**
     * Native map height in device pixels.
     *
     * @returns Canvas backing-store height.
     */
    public get nativeHeight(): number {
        return this.#canvas.height;
    }

    /**
     * Native map width in device pixels.
     *
     * @returns Canvas backing-store width.
     */
    public get nativeWidth(): number {
        return this.#canvas.width;
    }

    /**
     * Callback invoked synchronously after drawing the map.
     *
     * @returns Current callback, or `null` when no custom drawing is configured.
     */
    public get onDraw(): MapDrawCallback | null {
        return this.#onDraw;
    }

    /**
     * Sets the callback invoked after drawing the map.
     *
     * Changing the callback invalidates the current map contents.
     *
     * @param onDraw - Callback to invoke after each produced map frame, or `null` to remove it.
     */
    public set onDraw(onDraw: MapDrawCallback | null) {
        if (this.#onDraw !== onDraw) {
            this.#onDraw = onDraw;
            this.invalidate();
        }
    }

    /**
     * Current normalized tile source.
     *
     * @returns Immutable tile-source view with every optional setting resolved.
     */
    public get source(): Readonly<TileSource> {
        return this.#source;
    }

    /**
     * Changes the tile source immediately, resets the tile cache and stops active camera motion.
     *
     * @param source - New tile source, or `undefined` to restore the default OpenStreetMap source.
     * @throws Any exception raised while converting the retained center through a configured projection.
     * @throws {@link !RangeError} When tile geometry, coverage or zoom limits are invalid or exceed safe integer coordinates.
     * @throws {@link !TypeError} When the URL or projection is invalid.
     */
    public set source(source: TileSource | undefined) {
        const normalized = normalizeTileSource(source);
        if (normalized === this.#source) {
            return;
        }
        this.#interaction.stop();
        this.#camera.setSource(normalized, this.#minZoom ?? normalized.minZoom, this.#maxZoom ?? normalized.maxZoom);
        this.#source = normalized;
        this.#resetCanvasBackingStore();
        this.#replaceTileRenderer();
        this.#updateAttribution();
    }

    /**
     * Changes both continuous view-zoom limits atomically.
     *
     * Map limits are independent of native tile LOD and may extend beyond the current source limits. Passing `null` for a limit makes it follow the
     * corresponding current tile-source limit.
     *
     * @param minZoom - New map minimum, or `null` to follow the source minimum.
     * @param maxZoom - New map maximum, or `null` to follow the source maximum.
     * @throws {@link !RangeError} When the resolved range is not finite or its minimum is greater than its maximum.
     */
    public setZoomRange(minZoom: number | null, maxZoom: number | null): void {
        const resolvedMinZoom = minZoom ?? this.#source.minZoom;
        const resolvedMaxZoom = maxZoom ?? this.#source.maxZoom;
        this.#interaction.stop();
        this.#camera.setZoomConstraints(resolvedMinZoom, resolvedMaxZoom, this.#coverViewport);
        this.#minZoom = minZoom;
        this.#maxZoom = maxZoom;
        this.invalidate();
    }

    /**
     * Current continuous zoom level.
     *
     * @returns Zoom clamped to the current map and viewport limits.
     */
    public get zoom(): number {
        return this.#camera.zoom;
    }

    /**
     * Changes the continuous zoom immediately around the viewport center and stops active camera motion.
     *
     * @param zoom - New continuous zoom level, or `null` to restore the automatic initial zoom.
     * @throws {@link !RangeError} When `zoom` is not finite.
     */
    public set zoom(zoom: number | null) {
        this.#interaction.stop();
        this.#camera.setZoom(zoom);
        this.invalidate();
    }

    /**
     * Centers and zooms the map so all specified source-coordinate points fit into the viewport.
     *
     * The fit uses the shortest horizontal span for a wrapping source. Existing map, source and viewport zoom constraints remain in effect, so
     * sufficiently restrictive constraints can prevent the complete requested area or margin from becoming visible.
     *
     * @param points  - Non-empty collection of points interpreted by the current tile-source projection.
     * @param options - Optional animation, viewport margin and operation-specific maximum zoom.
     * @throws Any exception raised by the configured projection.
     * @throws {@link !RangeError} When no points are supplied, the viewport has no area, the margin is negative, non-finite or leaves no usable area,
     * or `maxZoom` is not finite.
     */
    public fitPoints(points: readonly Point[], { animated = false, margin, maxZoom }: FitPointsOptions = {}): void {
        if (points.length === 0) {
            throw new RangeError("points must not be empty");
        }
        if (this.#cssWidth <= 0 || this.#cssHeight <= 0) {
            throw new RangeError("viewport width and height must be positive");
        }
        const resolvedMargin = margin ?? Math.min(this.#cssWidth, this.#cssHeight) * 0.05;
        assertFinite(resolvedMargin, "margin");
        if (resolvedMargin < 0) {
            throw new RangeError("margin must not be negative");
        }
        if (resolvedMargin * 2 >= this.#cssWidth || resolvedMargin * 2 >= this.#cssHeight) {
            throw new RangeError("margin must be less than half the viewport width and height");
        }
        const resolvedMaxZoom = maxZoom ?? this.maxZoom;
        assertFinite(resolvedMaxZoom, "maxZoom");
        const targetView = this.#camera.getFittedView(points, resolvedMargin, resolvedMaxZoom);
        if (animated) {
            this.#interaction.transitionTo(targetView);
        } else {
            this.#interaction.stop();
            this.#camera.setWorldView(targetView.centerX, targetView.centerY, targetView.zoom);
            this.invalidate();
        }
    }

    /**
     * Connects this component to the document.
     *
     * @internal
     */
    public [connectMapComponent](): void {
        if (this.#connected) {
            return;
        }
        this.#connected = true;
        this.#interaction.connect();

        try {
            this.#resizeObserver.observe(this.#canvas, { box: "device-pixel-content-box" });
        } catch {
            this.#resizeObserver.observe(this.#canvas);
        }

        const bounds = this.#canvas.getBoundingClientRect();
        this.#resize(bounds.width, bounds.height);
    }

    /**
     * Disconnects this component from the document.
     *
     * @internal
     */
    public [disconnectMapComponent](): void {
        if (!this.#connected) {
            return;
        }
        this.#connected = false;
        this.#resizeObserver.disconnect();
        this.#interaction.disconnect();
        this.#cancelScheduledDraw();
    }

    /**
     * Returns the custom element owned by this component.
     *
     * @returns Fixed map element belonging exclusively to this component.
     */
    public getElement(): MapElement {
        return this.#element;
    }

    /**
     * Invalidates the current map contents and schedules a redraw for the next animation frame.
     *
     * Repeated invalidations before the scheduled frame are combined into a single redraw.
     */
    public invalidate(): void {
        this.#invalid = true;
        this.#requestFrame();
    }

    /**
     * Projects one source-coordinate point and provides a clipped viewport-edge position when it is outside.
     *
     * @param position - Point in source coordinates.
     * @param options  - Viewport margin with horizontal world-copy expansion disabled.
     * @returns Nearest projected point, enriched with a clipped position when it is outside the margin-adjusted viewport bounds.
     * @throws Any exception raised by the configured projection.
     * @throws {@link !RangeError} When the margin is not finite or a negative margin collapses the viewport.
     */
    public projectPoint(position: Point, options?: PointProjectionOptions & { readonly wrapCopies?: false }): Point | ClippedPoint;

    /**
     * Projects every visible horizontal world copy of a source-coordinate point without clipping.
     *
     * @param position - Point in source coordinates.
     * @param options  - Viewport options with horizontal world-copy expansion enabled.
     * @returns Visible projected copies in viewport-relative CSS pixels.
     * @throws Any exception raised by the configured projection.
     * @throws {@link !RangeError} When the margin is not finite or a negative margin collapses the viewport.
     */
    public projectPoint(position: Point, options: PointProjectionOptions & { readonly wrapCopies: true }): Point[];

    /**
     * Projects either one nearest or every visible horizontal world copy of a source-coordinate point.
     *
     * @param position - Point in source coordinates.
     * @param options  - Point projection options.
     * @returns Nearest potentially clipped point or all visible copies, according to `options.wrapCopies`.
     * @throws Any exception raised by the configured projection.
     * @throws {@link !RangeError} When the margin is not finite or a negative margin collapses the viewport.
     */
    public projectPoint(position: Point, options: PointProjectionOptions): Point | ClippedPoint | Point[];

    /**
     * Projects one or all visible copies of a source-coordinate point.
     *
     * @param position - Point in source coordinates.
     * @param options  - Point projection options. Defaults to no margin and a single potentially clipped copy.
     * @returns Nearest potentially clipped point or all visible copies, according to `options.wrapCopies`.
     * @throws Any exception raised by the configured projection.
     * @throws {@link !RangeError} When the margin is not finite or a negative margin collapses the viewport.
     */
    public projectPoint(position: Point, { margin = 0, wrapCopies = false }: PointProjectionOptions = {}): Point | ClippedPoint | Point[] {
        assertFinite(margin, "margin");
        const bounds = Bounds.fromViewport(this.#cssWidth, this.#cssHeight, margin);
        const point = this.#camera.project(position);
        return wrapCopies
            ? this.#getWrappedPointCopies(point, this.#camera.intersectWorldBounds(bounds))
            : bounds.clipPoint(point);
    }

    /**
     * Projects every visible horizontal world copy of a polygon and clips them to the viewport.
     *
     * @param points  - Polygon vertices in source coordinates. An explicit duplicate closing point is optional.
     * @param options - Path interpolation and clipping-margin options. Natural edge interpolation is the default.
     * @returns Visible clipped polygons in viewport-relative CSS pixels, one array per horizontal world copy.
     * @throws Any exception raised by the configured projection or natural-line interpolator.
     * @throws {@link !RangeError} When the margin is not finite or a negative margin collapses the viewport.
     */
    public projectPolygon(points: readonly Point[], { margin = 0, interpolation = "natural" }: PathProjectionOptions = {}): Point[][] {
        assertFinite(margin, "margin");
        const bounds = this.#camera.intersectWorldBounds(Bounds.fromViewport(this.#cssWidth, this.#cssHeight, margin));
        const path = this.#camera.projectPath(points, {
            bounds,
            closed: true,
            interpolation
        });
        return this.#getWrappedPathOffsets(path, bounds).map(offset => {
            const polygon = (offset === 0 ? bounds : bounds.translated(-offset)).clipPolygon(path);
            return offset === 0 ? polygon : this.#translatePath(polygon, offset);
        }).filter(copy => copy.length > 0);
    }

    /**
     * Projects every visible horizontal world copy of a polyline and clips it to the viewport.
     *
     * @param points  - Ordered polyline vertices in source coordinates.
     * @param options - Path interpolation and clipping-margin options. Natural edge interpolation is the default.
     * @returns Separate visible clipped polyline runs in viewport-relative CSS pixels across all visible horizontal world copies.
     * @throws Any exception raised by the configured projection or natural-line interpolator.
     * @throws {@link !RangeError} When the margin is not finite or a negative margin collapses the viewport.
     */
    public projectPolyline(points: readonly Point[], { margin = 0, interpolation = "natural" }: PathProjectionOptions = {}): Point[][] {
        assertFinite(margin, "margin");
        const bounds = this.#camera.intersectWorldBounds(Bounds.fromViewport(this.#cssWidth, this.#cssHeight, margin));
        const path = this.#camera.projectPath(points, {
            bounds,
            interpolation
        });
        return this.#getWrappedPathOffsets(path, bounds).flatMap(offset => {
            const lines = (offset === 0 ? bounds : bounds.translated(-offset)).clipPolyline(path);
            return offset === 0 ? lines : lines.map(line => this.#translatePath(line, offset));
        });
    }

    /**
     * Converts a viewport-relative CSS-pixel position into source coordinates.
     *
     * @param position - Viewport-relative position in CSS pixels.
     * @returns Corresponding point interpreted by the current tile source projection.
     * @throws Any exception raised by the configured inverse projection.
     */
    public unproject(position: Point): Point {
        return this.#camera.unproject(position);
    }

    /**
     * Sets the source-coordinate center and zoom atomically and stops active camera motion.
     *
     * @param center - New center interpreted by the current tile source projection, or `null` to use the center of its tile coverage.
     * @param zoom   - New continuous zoom level, clamped to the current source and viewport limits.
     * @throws Any exception raised by the configured projection.
     * @throws {@link !RangeError} When `zoom` is not finite.
     */
    public setView(center: Point | null, zoom: number): void {
        this.#interaction.stop();
        this.#camera.setView(center ?? this.#coverageCenter, zoom);
        this.invalidate();
    }

    /**
     * Center of the current tile coverage in source coordinates.
     *
     * @returns Source-coordinate center calculated by the current projection.
     * @throws Any exception raised by the configured inverse projection.
     */
    get #coverageCenter(): Point {
        const coverage = this.#source.coverage;
        return this.#source.projection.unproject({
            x: (coverage.left + coverage.right) / 2,
            y: (coverage.top + coverage.bottom) / 2
        });
    }

    /** Cancels a scheduled asynchronous redraw. */
    #cancelScheduledDraw(): void {
        if (this.#animationFrame != null) {
            this.#animationFrameView?.cancelAnimationFrame(this.#animationFrame);
            this.#animationFrame = null;
            this.#animationFrameView = null;
        }
    }

    /**
     * Creates a tile renderer for the current source and cache options.
     *
     * @returns Fresh tile renderer with an empty cache.
     */
    #createTileRenderer(): TileRenderer {
        return new TileRenderer({
            cacheSize: this.#cacheSize,
            document: this.#element.ownerDocument,
            maxConcurrentLoads: this.#maxConcurrentLoads,
            onChange: () => this.invalidate(),
            source: this.#source
        });
    }

    /** Draws the current map contents synchronously. */
    #draw(): void {
        this.#invalid = false;
        this.#continuousDraw = false;
        if (this.#cssWidth <= 0 || this.#cssHeight <= 0 || this.#canvas.width === 0 || this.#canvas.height === 0) {
            return;
        }

        this.#context.setTransform(this.#pixelRatio, 0, 0, this.#pixelRatio, 0, 0);
        this.#context.clearRect(0, 0, this.#cssWidth, this.#cssHeight);
        this.#context.imageSmoothingEnabled = true;
        this.#context.imageSmoothingQuality = "high";
        const targetView = this.#interaction.targetView;
        this.#tileRenderer.draw(this.#context, {
            centerX: this.#camera.centerX,
            centerY: this.#camera.centerY,
            height: this.#cssHeight,
            targetCenterX: targetView?.centerX,
            targetCenterY: targetView?.centerY,
            targetZoom: targetView?.zoom,
            width: this.#cssWidth,
            zoom: this.#camera.zoom
        });
        this.#updateAttributionPosition();

        if (this.#onDraw != null) {
            this.#context.save();
            try {
                this.#continuousDraw = this.#onDraw(this.#context, this) === true;
            } finally {
                this.#context.restore();
            }
        }
    }

    /**
     * Handles one requested animation frame.
     *
     * @param timestamp - Animation-frame timestamp in milliseconds.
     */
    #frame(timestamp: number): void {
        this.#animationFrame = null;
        this.#animationFrameView = null;
        const wasAnimating = this.#interaction.animating;
        if (wasAnimating) {
            this.#interaction.advance(timestamp);
        }
        if (this.#invalid || wasAnimating || this.#continuousDraw) {
            this.#draw();
        }
        if (this.#interaction.animating || this.#continuousDraw) {
            this.#requestFrame();
        }
    }

    /** Replaces the tile renderer and invalidates the map. */
    #replaceTileRenderer(): void {
        this.#tileRenderer.dispose();
        this.#tileRenderer = this.#createTileRenderer();
        this.invalidate();
    }

    /** Requests an animation frame when connected and none is pending. */
    #requestFrame(): void {
        if (this.#animationFrame != null) {
            return;
        }
        const view = this.#element.ownerDocument.defaultView;
        if (!this.#connected || view == null) {
            return;
        }
        this.#animationFrameView = view;
        this.#animationFrame = view.requestAnimationFrame(timestamp => this.#frame(timestamp));
    }

    /** Resets the main backing store, also restoring an origin-clean Canvas after a source change. */
    #resetCanvasBackingStore(): void {
        const width = this.#canvas.width;
        const height = this.#canvas.height;
        this.#canvas.width = width;
        this.#canvas.height = height;
    }

    /**
     * Resizes and redraws the Canvas.
     *
     * @param cssWidth    - Displayed Canvas width in CSS pixels.
     * @param cssHeight   - Displayed Canvas height in CSS pixels.
     * @param pixelWidth  - Exact Canvas width in device pixels, if known.
     * @param pixelHeight - Exact Canvas height in device pixels, if known.
     */
    #resize(cssWidth: number, cssHeight: number, pixelWidth?: number, pixelHeight?: number): void {
        const devicePixelRatio = this.#element.ownerDocument.defaultView?.devicePixelRatio ?? 1;
        const width = Math.max(0, Math.round(pixelWidth ?? cssWidth * devicePixelRatio));
        const height = Math.max(0, Math.round(pixelHeight ?? cssHeight * devicePixelRatio));

        this.#pixelRatio = devicePixelRatio;
        this.#cssWidth = width / devicePixelRatio;
        this.#cssHeight = height / devicePixelRatio;
        this.#camera.resize(this.#cssWidth, this.#cssHeight);

        if (this.#canvas.width !== width) {
            this.#canvas.width = width;
        }
        if (this.#canvas.height !== height) {
            this.#canvas.height = height;
        }

        this.#cancelScheduledDraw();
        if (this.#interaction.animating) {
            const view = this.#element.ownerDocument.defaultView;
            this.#interaction.advance(view?.performance.now() ?? performance.now());
        }
        this.#draw();
        if (this.#interaction.animating || this.#continuousDraw) {
            this.#requestFrame();
        }
    }

    /** Updates the visible attribution from the current tile source. */
    #updateAttribution(): void {
        this.#attribution.textContent = this.#source.attribution;
        if (this.#source.attribution.length > 0 && this.#source.attributionURL.length > 0) {
            this.#attribution.href = this.#source.attributionURL;
        } else {
            this.#attribution.removeAttribute("href");
        }
    }

    /** Positions the attribution at the bottom-right corner of the visible tile coverage. */
    #updateAttributionPosition(): void {
        const bounds = this.#camera.intersectWorldBounds(Bounds.fromViewport(this.#cssWidth, this.#cssHeight));
        this.#attribution.style.right = `${this.#cssWidth - bounds.right}px`;
        this.#attribution.style.bottom = `${this.#cssHeight - bounds.bottom}px`;
    }

    /**
     * Returns horizontal offsets whose translated range intersects the viewport.
     *
     * @param left   - Left edge of the unshifted projected range.
     * @param right  - Right edge of the unshifted projected range.
     * @param bounds - Visible clipping bounds.
     * @returns Horizontal offsets in left-to-right world-copy order.
     */
    #getHorizontalWrapOffsets(left: number, right: number, bounds: Bounds): number[] {
        const wrapWidth = this.#camera.wrapWidth;
        if (wrapWidth == null) {
            return right >= bounds.left && left <= bounds.right ? [ 0 ] : [];
        }
        const firstCopy = Math.ceil((bounds.left - right) / wrapWidth);
        const lastCopy = Math.floor((bounds.right - left) / wrapWidth);
        const offsets: number[] = [];
        for (let copy = firstCopy; copy <= lastCopy; ++copy) {
            offsets.push(copy * wrapWidth);
        }
        return offsets;
    }

    /**
     * Returns every visible horizontal world copy of a projected point.
     *
     * @param point  - Projected point in viewport-relative CSS pixels.
     * @param bounds - Visible clipping bounds.
     * @returns Visible projected copies in left-to-right order.
     */
    #getWrappedPointCopies(point: Point, bounds: Bounds): Point[] {
        if (point.y < bounds.top || point.y > bounds.bottom) {
            return [];
        }
        return this.#getHorizontalWrapOffsets(point.x, point.x, bounds).map(offset => ({ x: point.x + offset, y: point.y }));
    }

    /**
     * Returns every horizontal world-copy offset at which a projected path can intersect the viewport.
     *
     * @param path   - Continuous projected path.
     * @param bounds - Visible clipping bounds.
     * @returns Horizontal offsets for potentially visible path copies.
     */
    #getWrappedPathOffsets(path: readonly Point[], bounds: Bounds): number[] {
        if (path.length === 0) {
            return [];
        }
        let left = Number.POSITIVE_INFINITY;
        let right = Number.NEGATIVE_INFINITY;
        for (const point of path) {
            left = Math.min(left, point.x);
            right = Math.max(right, point.x);
        }
        return this.#getHorizontalWrapOffsets(left, right, bounds);
    }

    /**
     * Translates a path horizontally.
     *
     * @param path   - Path to translate.
     * @param offset - Horizontal offset in CSS pixels.
     * @returns Newly allocated translated path.
     */
    #translatePath(path: readonly Point[], offset: number): Point[] {
        return path.map(point => ({ x: point.x + offset, y: point.y }));
    }
}
