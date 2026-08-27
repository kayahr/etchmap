/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import {
    type MapComponent,
    connectMapComponent,
    createMapComponentForElement,
    disconnectMapComponent,
    takeMapComponentForNewElement
} from "./MapComponent.ts";
import type { Point } from "./Point.ts";
import type { Projection } from "./Projection.ts";
import { LinearProjection, type LinearProjectionEdges } from "./projections/LinearProjection.ts";
import { WebMercatorProjection } from "./projections/WebMercatorProjection.ts";
import type { TileCoverage, TileCrossOrigin, TileSource } from "./TileSource.ts";
import { assertNotNull } from "./util/assert.ts";

/** Atomically parsed declarative map configuration. */
interface AttributeConfiguration {
    /** Parsed positive cache capacity when the corresponding attribute is present. */
    readonly cacheSize?: number;

    /** Parsed source-coordinate center when both corresponding attributes are present. */
    readonly center?: Point;

    /** Parsed viewport-cover setting when the corresponding attribute is present. */
    readonly coverViewport?: boolean;

    /** Whether `cache-size` is present. */
    readonly hasCacheSize: boolean;

    /** Whether both `center-x` and `center-y` are present. */
    readonly hasCenter: boolean;

    /** Whether `cover-viewport` is present. */
    readonly hasCoverViewport: boolean;

    /** Whether `max-zoom` is present. */
    readonly hasMaxZoom: boolean;

    /** Whether `min-zoom` is present. */
    readonly hasMinZoom: boolean;

    /** Whether `source` is present. */
    readonly hasSource: boolean;

    /** Whether `zoom` is present. */
    readonly hasZoom: boolean;

    /** Parsed maximum continuous view zoom when the corresponding attribute is present. */
    readonly maxZoom?: number;

    /** Parsed minimum continuous view zoom when the corresponding attribute is present. */
    readonly minZoom?: number;

    /** Parsed tile source when the corresponding attribute is present. */
    readonly source?: TileSource;

    /** Parsed continuous zoom when the corresponding attribute is present. */
    readonly zoom?: number;
}

/**
 * Custom element hosting an interactive map component.
 *
 * Importing the package root registers this class as `<kayahr-map>`. Declarative attributes are parsed atomically and applied to the fixed component
 * returned by {@link getComponent}. The open Shadow DOM contains the map Canvas followed by a layer container with the default slot.
 *
 * Map attributes:
 *
 * - `center-x` and `center-y`: Source X and Y coordinates. They must be used together and default to the projected tile-world center.
 * - `zoom`: Initial continuous view zoom. Defaults to one level above the effective minimum.
 * - `min-zoom` and `max-zoom`: Continuous view limits. They default to the native tile-source limits but may extend beyond them.
 * - `cover-viewport`: Whether to raise the effective minimum zoom until tile coverage fills the viewport. Defaults to `true`.
 * - `cache-size`: Positive integer ready-tile cache capacity. Defaults to 512.
 * - `source`: JSON object describing a custom {@link TileSource}. Omit the attribute to use OpenStreetMap. Its `projection` is `web-mercator`, `linear`
 *   or an object containing `type: "linear"` and optional `edges`.
 *
 * Any slotted child becomes an absolutely positioned HTML overlay. The built-in attribution exposes the CSS shadow part `attribution`.
 *
 * @example
 * ```html
 * <kayahr-map center-x="6.9603" center-y="50.9375" zoom="13"></kayahr-map>
 * ```
 */
export class MapElement extends HTMLElement {
    /** Whether declarative attributes must be applied on the next connection or microtask. */
    #attributesDirty = true;

    /** Whether cache size has previously been controlled by an attribute. */
    #cacheSizeControlled = false;

    /** Map component hosted by this element. */
    readonly #component: MapComponent;

    /** Whether this element is currently connected through its lifecycle callback. */
    #connected = false;

    /** Whether center has previously been controlled by an attribute. */
    #centerControlled = false;

    /** Whether viewport covering has previously been controlled by an attribute. */
    #coverViewportControlled = false;

    /** Whether the initial declarative configuration has already been applied. */
    #initialConfigurationApplied = false;

    /** Whether maximum view zoom has previously been controlled by an attribute. */
    #maxZoomControlled = false;

    /** Whether minimum view zoom has previously been controlled by an attribute. */
    #minZoomControlled = false;

    /** Whether the tile source has previously been controlled by attributes. */
    #sourceControlled = false;

    /** Whether zoom has previously been controlled by an attribute. */
    #zoomControlled = false;

    /**
     * Custom-element attributes observed for declarative configuration.
     *
     * @returns Names of all map and tile-source attributes which trigger declarative reconfiguration.
     * @internal
     */
    protected static get observedAttributes(): string[] {
        return [ "cache-size", "center-x", "center-y", "cover-viewport", "max-zoom", "min-zoom", "source", "zoom" ];
    }

    /**
     * Creates a new map element with its own fixed map component.
     *
     * @throws {@link !Error} When nested hybrid component construction violates the one-to-one element/component relationship or a 2D Canvas context
     * cannot be created.
     */
    public constructor() {
        super();
        this.#component = takeMapComponentForNewElement() ?? createMapComponentForElement(this);
    }

    /**
     * Schedules atomic application of changed declarative attributes.
     *
     * @param attributeName - Name of the changed observed attribute.
     * @param oldValue      - Previous attribute value, or `null` when it was absent.
     * @param newValue      - Current attribute value, or `null` when it was removed.
     * @internal
     */
    protected attributeChangedCallback(attributeName: string, oldValue: string | null, newValue: string | null): void {
        if (this.#attributesDirty) {
            return;
        }
        this.#attributesDirty = true;
        if (this.#connected) {
            queueMicrotask(() => this.#applyDirtyAttributes());
        }
    }

    /**
     * Applies initial attributes and connects the map component to the document.
     *
     * @throws Any exception raised by a configured projection while applying the initial view.
     * @throws {@link !RangeError} When a numeric attribute is outside its supported range.
     * @throws {@link !SyntaxError} When `source` is not valid JSON.
     * @throws {@link !TypeError} When an attribute cannot be parsed or describes an invalid projection.
     * @internal
     */
    protected connectedCallback(): void {
        this.#connected = true;
        this.#applyDirtyAttributes();
        this.#component[connectMapComponent]();
    }

    /**
     * Disconnects the map component from the document.
     *
     * @internal
     */
    protected disconnectedCallback(): void {
        this.#connected = false;
        this.#component[disconnectMapComponent]();
    }

    /**
     * Returns the map component hosted by this element.
     *
     * @returns Fixed map component belonging exclusively to this element.
     */
    public getComponent(): MapComponent {
        return this.#component;
    }

    /**
     * Applies pending declarative attributes while the element is connected.
     *
     * The dirty flag is cleared before parsing so a later correction after an exception or an attribute change during application can schedule another
     * update.
     *
     * @throws Any exception raised by a configured projection.
     * @throws {@link !RangeError} When a numeric attribute is outside its supported range.
     * @throws {@link !SyntaxError} When `source` is not valid JSON.
     * @throws {@link !TypeError} When an attribute cannot be parsed or describes an invalid projection.
     */
    #applyDirtyAttributes(): void {
        if (!this.#connected || !this.#attributesDirty) {
            return;
        }
        this.#attributesDirty = false;
        this.#applyAttributes();
    }

    /**
     * Parses and atomically applies all declarative attributes.
     *
     * @throws Any exception raised by a configured projection.
     * @throws {@link !RangeError} When a numeric attribute is outside its supported range.
     * @throws {@link !SyntaxError} When `source` is not valid JSON.
     * @throws {@link !TypeError} When an attribute cannot be parsed or describes an invalid projection.
     */
    #applyAttributes(): void {
        const configuration = this.#readAttributes();

        if (configuration.hasSource) {
            this.#component.source = configuration.source;
        } else if (this.#sourceControlled) {
            this.#component.source = undefined;
        }

        const updateMinZoom = configuration.hasMinZoom || this.#minZoomControlled;
        const updateMaxZoom = configuration.hasMaxZoom || this.#maxZoomControlled;
        if (updateMinZoom && updateMaxZoom) {
            this.#component.setZoomRange(configuration.minZoom ?? null, configuration.maxZoom ?? null);
        } else if (updateMinZoom) {
            this.#component.minZoom = configuration.minZoom ?? null;
        } else if (updateMaxZoom) {
            this.#component.maxZoom = configuration.maxZoom ?? null;
        }

        if (configuration.hasCoverViewport || this.#coverViewportControlled) {
            this.#component.coverViewport = configuration.coverViewport ?? true;
        }

        if (configuration.hasCacheSize) {
            const { cacheSize } = configuration;
            assertNotNull(cacheSize, "cache-size");
            this.#component.cacheSize = cacheSize;
        } else if (this.#cacheSizeControlled) {
            this.#component.cacheSize = 512;
        }

        const updateCenter = configuration.hasCenter || this.#centerControlled
            || (!this.#initialConfigurationApplied && configuration.hasSource);
        const updateZoom = configuration.hasZoom || this.#zoomControlled;
        if (updateCenter && updateZoom) {
            if (configuration.zoom == null) {
                this.#component.center = configuration.center ?? null;
                this.#component.zoom = null;
            } else {
                this.#component.setView(configuration.center ?? null, configuration.zoom);
            }
        } else if (updateCenter) {
            this.#component.center = configuration.center ?? null;
        } else if (updateZoom) {
            this.#component.zoom = configuration.zoom ?? null;
        }

        this.#sourceControlled = configuration.hasSource;
        this.#cacheSizeControlled = configuration.hasCacheSize;
        this.#centerControlled = configuration.hasCenter;
        this.#coverViewportControlled = configuration.hasCoverViewport;
        this.#maxZoomControlled = configuration.hasMaxZoom;
        this.#minZoomControlled = configuration.hasMinZoom;
        this.#zoomControlled = configuration.hasZoom;
        this.#initialConfigurationApplied = true;
    }

    /**
     * Parses all current declarative attributes without mutating the component.
     *
     * @returns Complete parsed attribute configuration.
     * @throws {@link !RangeError} When a numeric attribute is outside its supported range.
     * @throws {@link !SyntaxError} When `source` is not valid JSON.
     * @throws {@link !TypeError} When an attribute cannot be parsed.
     */
    #readAttributes(): AttributeConfiguration {
        const centerXAttribute = this.getAttribute("center-x");
        const centerYAttribute = this.getAttribute("center-y");
        const coverViewportAttribute = this.getAttribute("cover-viewport");
        const maxZoomAttribute = this.getAttribute("max-zoom");
        const minZoomAttribute = this.getAttribute("min-zoom");
        const sourceAttribute = this.getAttribute("source");
        const zoomAttribute = this.getAttribute("zoom");
        const cacheSizeAttribute = this.getAttribute("cache-size");
        if ((centerXAttribute == null) !== (centerYAttribute == null)) {
            throw new TypeError("center-x and center-y must be used together");
        }
        const center = centerXAttribute == null || centerYAttribute == null ? undefined : {
            x: parseNumber(centerXAttribute, "center-x"),
            y: parseNumber(centerYAttribute, "center-y")
        };
        return {
            cacheSize: cacheSizeAttribute == null ? undefined : parseInteger(cacheSizeAttribute, "cache-size", 1),
            center,
            coverViewport: coverViewportAttribute == null ? undefined : parseBoolean(coverViewportAttribute, "cover-viewport"),
            hasCacheSize: cacheSizeAttribute != null,
            hasCenter: center != null,
            hasCoverViewport: coverViewportAttribute != null,
            hasMaxZoom: maxZoomAttribute != null,
            hasMinZoom: minZoomAttribute != null,
            hasSource: sourceAttribute != null,
            hasZoom: zoomAttribute != null,
            maxZoom: maxZoomAttribute == null ? undefined : parseNumber(maxZoomAttribute, "max-zoom"),
            minZoom: minZoomAttribute == null ? undefined : parseNumber(minZoomAttribute, "min-zoom"),
            source: sourceAttribute == null ? undefined : parseSource(sourceAttribute),
            zoom: zoomAttribute == null ? undefined : parseNumber(zoomAttribute, "zoom")
        };
    }
}

/**
 * Parses the JSON representation used by the declarative `source` attribute.
 *
 * The recognized JSON properties mirror {@link TileSource}, except that functional tile URLs and custom projection instances cannot be represented.
 * Projection values select one of the built-in projection classes. Additional properties are ignored.
 *
 * @param value - Complete JSON object stored in the `source` attribute.
 * @returns Parsed custom tile source.
 * @throws {@link !SyntaxError} When `value` is not valid JSON.
 * @throws {@link !TypeError} When the JSON structure, a property type or the projection configuration is invalid.
 * @throws {@link !RangeError} When linear projection edges are invalid.
 */
function parseSource(value: string): TileSource {
    const parsed: unknown = JSON.parse(value);
    const source = parseJSONObject(parsed, "source");
    return {
        attribution: parseOptionalJSONString(source.attribution, "source.attribution"),
        attributionURL: parseOptionalJSONString(source.attributionURL, "source.attributionURL"),
        coverage: parseJSONCoverage(source.coverage),
        crossOrigin: parseJSONCrossOrigin(source.crossOrigin),
        maxZoom: parseOptionalJSONNumber(source.maxZoom, "source.maxZoom"),
        minZoom: parseOptionalJSONNumber(source.minZoom, "source.minZoom"),
        projection: parseJSONProjection(source.projection),
        rootColumns: parseOptionalJSONNumber(source.rootColumns, "source.rootColumns"),
        rootRows: parseOptionalJSONNumber(source.rootRows, "source.rootRows"),
        tileHeight: parseOptionalJSONNumber(source.tileHeight, "source.tileHeight"),
        tileURL: parseJSONString(source.tileURL, "source.tileURL"),
        tileWidth: parseOptionalJSONNumber(source.tileWidth, "source.tileWidth"),
        wrapX: parseOptionalJSONBoolean(source.wrapX, "source.wrapX")
    };
}

/**
 * Parses declarative tile coverage.
 *
 * @param value - Optional JSON coverage value.
 * @returns Parsed coverage, or `undefined` when omitted.
 * @throws {@link !TypeError} When the value is not a complete coverage object.
 */
function parseJSONCoverage(value: unknown): TileCoverage | undefined {
    if (value === undefined) {
        return undefined;
    }
    const coverage = parseJSONObject(value, "source.coverage");
    return {
        bottom: parseJSONNumber(coverage.bottom, "source.coverage.bottom"),
        left: parseJSONNumber(coverage.left, "source.coverage.left"),
        right: parseJSONNumber(coverage.right, "source.coverage.right"),
        top: parseJSONNumber(coverage.top, "source.coverage.top")
    };
}

/**
 * Parses the declarative tile cross-origin mode.
 *
 * @param value - Optional JSON cross-origin value.
 * @returns Parsed cross-origin mode, or `undefined` when omitted.
 * @throws {@link !TypeError} When the value is unsupported.
 */
function parseJSONCrossOrigin(value: unknown): TileCrossOrigin | undefined {
    if (value === undefined || value === null || value === "anonymous" || value === "use-credentials") {
        return value;
    }
    throw new TypeError("source.crossOrigin must be anonymous, use-credentials or null");
}

/**
 * Parses a built-in projection from its declarative JSON representation.
 *
 * @param value - Optional JSON projection value.
 * @returns Corresponding built-in projection, or `undefined` to use the source default.
 * @throws {@link !TypeError} When the projection representation is unsupported.
 * @throws {@link !RangeError} When linear projection edges are invalid.
 */
function parseJSONProjection(value: unknown): Projection | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === "web-mercator") {
        return new WebMercatorProjection();
    }
    if (value === "linear") {
        return new LinearProjection();
    }
    const projection = parseJSONObject(value, "source.projection");
    if (projection.type !== "linear") {
        throw new TypeError("source.projection.type must be linear");
    }
    return new LinearProjection(projection.edges === undefined ? undefined : parseLinearProjectionEdges(projection.edges));
}

/**
 * Parses source-coordinate edges for a declarative linear projection.
 *
 * @param value - JSON edge object.
 * @returns Parsed linear projection edges.
 * @throws {@link !TypeError} When the value is not a complete edge object.
 */
function parseLinearProjectionEdges(value: unknown): LinearProjectionEdges {
    const edges = parseJSONObject(value, "source.projection.edges");
    return {
        bottom: parseJSONNumber(edges.bottom, "source.projection.edges.bottom"),
        left: parseJSONNumber(edges.left, "source.projection.edges.left"),
        right: parseJSONNumber(edges.right, "source.projection.edges.right"),
        top: parseJSONNumber(edges.top, "source.projection.edges.top")
    };
}

/**
 * Parses a JSON object.
 *
 * @param value - JSON value to inspect.
 * @param name  - Property path used in exception messages.
 * @returns Parsed object record.
 * @throws {@link !TypeError} When `value` is not an object.
 */
function parseJSONObject(value: unknown, name: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${name} must be an object`);
    }
    return value as Record<string, unknown>;
}

/**
 * Parses a required JSON string.
 *
 * @param value - JSON value to inspect.
 * @param name  - Property path used in exception messages.
 * @returns Parsed string.
 * @throws {@link !TypeError} When `value` is not a string.
 */
function parseJSONString(value: unknown, name: string): string {
    if (typeof value !== "string") {
        throw new TypeError(`${name} must be a string`);
    }
    return value;
}

/**
 * Parses an optional JSON string.
 *
 * @param value - JSON value to inspect.
 * @param name  - Property path used in exception messages.
 * @returns Parsed string, or `undefined` when omitted.
 * @throws {@link !TypeError} When a present value is not a string.
 */
function parseOptionalJSONString(value: unknown, name: string): string | undefined {
    return value === undefined ? undefined : parseJSONString(value, name);
}

/**
 * Parses a required JSON number.
 *
 * @param value - JSON value to inspect.
 * @param name  - Property path used in exception messages.
 * @returns Parsed number. Its semantic range is validated by the receiving source or projection.
 * @throws {@link !TypeError} When `value` is not a number.
 */
function parseJSONNumber(value: unknown, name: string): number {
    if (typeof value !== "number") {
        throw new TypeError(`${name} must be a number`);
    }
    return value;
}

/**
 * Parses an optional JSON number.
 *
 * @param value - JSON value to inspect.
 * @param name  - Property path used in exception messages.
 * @returns Parsed number, or `undefined` when omitted.
 * @throws {@link !TypeError} When a present value is not a number.
 */
function parseOptionalJSONNumber(value: unknown, name: string): number | undefined {
    return value === undefined ? undefined : parseJSONNumber(value, name);
}

/**
 * Parses an optional JSON boolean.
 *
 * @param value - JSON value to inspect.
 * @param name  - Property path used in exception messages.
 * @returns Parsed boolean, or `undefined` when omitted.
 * @throws {@link !TypeError} When a present value is not a boolean.
 */
function parseOptionalJSONBoolean(value: unknown, name: string): boolean | undefined {
    if (value === undefined || typeof value === "boolean") {
        return value;
    }
    throw new TypeError(`${name} must be a boolean`);
}

/**
 * Parses an integer with a lower bound.
 *
 * @param value   - Attribute value to parse.
 * @param name    - Attribute name used in exception messages.
 * @param minimum - Inclusive lower bound.
 * @returns Parsed integer.
 * @throws {@link !RangeError} When the parsed number is not an integer or is below `minimum`.
 * @throws {@link !TypeError} When the value is empty or not finite.
 */
function parseInteger(value: string, name: string, minimum: number): number {
    const number = parseNumber(value, name);
    if (!Number.isInteger(number) || number < minimum) {
        throw new RangeError(`${name} must be an integer greater than or equal to ${minimum}`);
    }
    return number;
}

/**
 * Parses a finite number.
 *
 * @param value - Attribute value to parse.
 * @param name  - Attribute name used in exception messages.
 * @returns Parsed finite number.
 * @throws {@link !TypeError} When the value is empty or not finite.
 */
function parseNumber(value: string, name: string): number {
    if (value.trim().length === 0) {
        throw new TypeError(`${name} must not be empty`);
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new TypeError(`${name} must be a finite number`);
    }
    return number;
}

/**
 * Parses a boolean attribute.
 *
 * @param value - Attribute value to parse.
 * @param name  - Attribute name used in exception messages.
 * @returns `true` for an empty value or `true`, and `false` for `false`.
 * @throws {@link !TypeError} When the value is neither `true` nor `false`.
 */
function parseBoolean(value: string, name: string): boolean {
    switch (value) {
        case "":
        case "true":
            return true;
        case "false":
            return false;
        default:
            throw new TypeError(`${name} must be true or false`);
    }
}
