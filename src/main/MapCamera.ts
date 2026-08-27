/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { Bounds } from "./Bounds.ts";
import type { PathInterpolation } from "./PathInterpolation.ts";
import { type Point, samePoint, squaredDistanceToSegment } from "./Point.ts";
import type { NormalizedTileSource } from "./TileSource.ts";
import { assertFinite } from "./util/assert.ts";
import { clamp, modulo } from "./util/math.ts";

/** Maximum visible deviation of an adaptively projected line segment in CSS pixels. */
const pathTolerance = 0.5;

/** Squared maximum visible deviation of an adaptively projected line segment. */
const squaredPathTolerance = pathTolerance ** 2;

/** Maximum recursion depth used while adaptively projecting a line. */
const maxProjectedLineSubdivisionDepth = 14;

/** Complete camera state in minimum-zoom world pixels. */
export interface WorldView {
    /** Horizontal center in minimum-zoom world pixels. */
    readonly centerX: number;

    /** Vertical center in minimum-zoom world pixels. */
    readonly centerY: number;

    /** Continuous zoom level. */
    readonly zoom: number;
}

/** Options for projecting a path through the camera. */
interface ProjectPathOptions {
    /** Optional visible bounds used to stop natural-path subdivision of safely offscreen intervals. */
    readonly bounds?: Bounds;

    /** Whether to connect the final point back to the first one. Defaults to `false`. */
    readonly closed?: boolean;

    /** Path-edge interpolation mode. Defaults to `projected`. */
    readonly interpolation?: PathInterpolation;
}

/** Mutable continuous map camera using minimum-zoom world pixels. */
export class MapCamera {
    /** Whether the camera still uses its automatic initial zoom. */
    #automaticZoom: boolean;

    /** Horizontal center in minimum-zoom world pixels. */
    #centerX: number;

    /** Vertical center in minimum-zoom world pixels. */
    #centerY: number;

    /** Requested horizontal center retained while viewport constraints temporarily prevent it. */
    #desiredCenterX: number;

    /** Requested vertical center retained while viewport constraints temporarily prevent it. */
    #desiredCenterY: number;

    /** Whether the minimum zoom is raised as needed to cover the viewport. */
    #coverViewport: boolean;

    /** Maximum continuous view zoom. */
    #maxZoom: number;

    /** Minimum continuous view zoom before applying the optional viewport-cover constraint. */
    #minZoom: number;

    /** Tile source defining world geometry and native tile zoom limits. */
    #source: Readonly<NormalizedTileSource>;

    /** Viewport height in CSS pixels. */
    #viewportHeight = 0;

    /** Viewport width in CSS pixels. */
    #viewportWidth = 0;

    /** Continuous zoom level. */
    #zoom: number;

    /**
     * Creates a camera.
     *
     * @param source - Tile source defining world geometry.
     * @param center - Initial center in source coordinates.
     * @param zoom   - Initial continuous zoom, or `null` to select an automatic zoom after the viewport size is known.
     * @param minZoom - Minimum continuous view zoom.
     * @param maxZoom - Maximum continuous view zoom.
     * @param coverViewport - Whether the minimum zoom is raised as needed to cover the viewport.
     * @throws Any exception raised by the configured projection.
     * @throws {@link !RangeError} When a zoom value is not finite or `minZoom` is greater than `maxZoom`.
     */
    public constructor(source: Readonly<NormalizedTileSource>, center: Point, zoom: number | null, minZoom = source.minZoom,
            maxZoom = source.maxZoom, coverViewport = true) {
        this.#validateZoomRange(minZoom, maxZoom);
        this.#automaticZoom = zoom == null;
        this.#coverViewport = coverViewport;
        this.#maxZoom = maxZoom;
        this.#minZoom = minZoom;
        this.#source = source;
        const world = this.#projectToWorld(center);
        this.#centerX = world.x;
        this.#centerY = world.y;
        this.#desiredCenterX = world.x;
        this.#desiredCenterY = world.y;
        this.#zoom = zoom == null ? this.#defaultZoom : this.clampZoom(zoom);
        this.#constrain();
    }

    /**
     * Current center in source coordinates.
     *
     * @returns Camera center interpreted by the current projection.
     * @throws Any exception raised by the configured inverse projection.
     */
    public get sourceCenter(): Point {
        return this.#unprojectWorldPoint({ x: this.#centerX, y: this.#centerY });
    }

    /**
     * Horizontal center in minimum-zoom world pixels.
     *
     * @returns Horizontal world center.
     */
    public get centerX(): number {
        return this.#centerX;
    }

    /**
     * Vertical center in minimum-zoom world pixels.
     *
     * @returns Vertical world center.
     */
    public get centerY(): number {
        return this.#centerY;
    }

    /**
     * Current continuous view zoom.
     *
     * @returns Zoom clamped to the configured map and viewport limits.
     */
    public get zoom(): number {
        return this.#zoom;
    }

    /**
     * Horizontal distance between wrapped world copies in CSS pixels.
     *
     * @returns Current screen-space world width, or `null` when wrapping is disabled.
     */
    public get wrapWidth(): number | null {
        return this.#source.wrapX ? this.#worldWidth * 2 ** (this.#zoom - this.#source.minZoom) : null;
    }

    /**
     * Intersects clipping bounds with the covered tile-world area visible through the viewport.
     *
     * @param bounds - Viewport-relative clipping bounds.
     * @returns Bounds limited vertically to the tile coverage and also horizontally when wrapping is disabled.
     */
    public intersectWorldBounds(bounds: Bounds): Bounds {
        const scale = 2 ** (this.#zoom - this.#source.minZoom);
        const worldLeft = this.#viewportWidth / 2 + (this.#coverageLeft - this.#centerX) * scale;
        const worldTop = this.#viewportHeight / 2 + (this.#coverageTop - this.#centerY) * scale;
        return new Bounds(
            this.#source.wrapX ? bounds.left : Math.max(bounds.left, worldLeft),
            Math.max(bounds.top, worldTop),
            this.#source.wrapX ? bounds.right : Math.min(bounds.right, worldLeft + this.#coverageWidth * scale),
            Math.min(bounds.bottom, worldTop + this.#coverageHeight * scale)
        );
    }

    /**
     * Clamps a continuous view zoom to the configured map limits and optional viewport-cover limit.
     *
     * Native tile-source zoom limits are independent. The renderer scales minimum-level tiles down below the source minimum and maximum-level tiles
     * up above the source maximum.
     *
     * @param zoom - Continuous zoom to clamp.
     * @returns Zoom within the inclusive map and viewport limits.
     * @throws {@link !RangeError} When `zoom` is not finite.
     */
    public clampZoom(zoom: number): number {
        assertFinite(zoom, "zoom");
        return clamp(zoom, this.#minimumZoom, this.#maxZoom);
    }

    /**
     * Returns an anchored and constrained camera state without changing this camera.
     *
     * @param world  - Minimum-zoom world position to preserve beneath the anchor.
     * @param anchor - Viewport-relative anchor in CSS pixels.
     * @param zoom   - Requested continuous zoom.
     * @returns Anchored camera state constrained to source geometry and source/viewport zoom limits.
     * @throws {@link !RangeError} When `zoom` is not finite.
     */
    public getAnchoredView(world: Point, anchor: Point, zoom: number): WorldView {
        const clampedZoom = this.clampZoom(zoom);
        const scale = 2 ** (clampedZoom - this.#source.minZoom);
        const worldWidth = this.#worldWidth;
        const centerX = world.x - (anchor.x - this.#viewportWidth / 2) / scale;
        const centerY = world.y - (anchor.y - this.#viewportHeight / 2) / scale;
        return {
            centerX: this.#source.wrapX
                ? modulo(centerX, worldWidth)
                : this.#constrainAxis(centerX, scale, "x"),
            centerY: this.#constrainAxis(centerY, scale, "y"),
            zoom: clampedZoom
        };
    }

    /**
     * Constrains a complete camera state without changing this camera.
     *
     * @param view - Requested state in minimum-zoom world pixels.
     * @returns Camera state constrained to source geometry and map/viewport zoom limits.
     * @throws {@link !RangeError} When the requested zoom is not finite.
     */
    public constrainView(view: WorldView): WorldView {
        const zoom = this.clampZoom(view.zoom);
        const scale = 2 ** (zoom - this.#source.minZoom);
        return {
            centerX: this.#source.wrapX
                ? modulo(view.centerX, this.#worldWidth)
                : this.#constrainAxis(view.centerX, scale, "x"),
            centerY: this.#constrainAxis(view.centerY, scale, "y"),
            zoom
        };
    }

    /**
     * Moves the camera by a screen-space delta.
     *
     * @param x - Horizontal content movement in CSS pixels.
     * @param y - Vertical content movement in CSS pixels.
     * @returns Whether each axis was able to move.
     */
    public pan(x: number, y: number): Point {
        const previousX = this.#centerX;
        const previousY = this.#centerY;
        const scale = 2 ** (this.#zoom - this.#source.minZoom);
        this.#centerX -= x / scale;
        this.#centerY -= y / scale;
        this.#desiredCenterX = this.#centerX;
        this.#desiredCenterY = this.#centerY;
        this.#constrain();
        this.#desiredCenterX = this.#centerX;
        this.#desiredCenterY = this.#centerY;
        return { x: this.#centerX === previousX ? 0 : 1, y: this.#centerY === previousY ? 0 : 1 };
    }

    /**
     * Projects a source-coordinate point into viewport-relative CSS pixels.
     *
     * @param position - Point in source coordinates.
     * @returns Nearest horizontal world copy in viewport-relative CSS pixels.
     * @throws Any exception raised by the configured projection.
     */
    public project(position: Point): Point {
        const world = this.#projectToWorld(position);
        let deltaX = world.x - this.#centerX;
        if (this.#source.wrapX) {
            const worldWidth = this.#worldWidth;
            deltaX -= Math.round(deltaX / worldWidth) * worldWidth;
        }
        const scale = 2 ** (this.#zoom - this.#source.minZoom);
        return {
            x: this.#viewportWidth / 2 + deltaX * scale,
            y: this.#viewportHeight / 2 + (world.y - this.#centerY) * scale
        };
    }

    /**
     * Converts a viewport-relative CSS-pixel position into source coordinates.
     *
     * @param position - Viewport-relative point in CSS pixels.
     * @returns Corresponding point interpreted by the current projection.
     * @throws Any exception raised by the configured inverse projection.
     */
    public unproject(position: Point): Point {
        return this.#unprojectWorldPoint(this.toWorld(position));
    }

    /**
     * Projects a source-coordinate point into minimum-zoom world pixels.
     *
     * @param position - Point in source coordinates.
     * @returns Point in minimum-zoom world pixels.
     * @throws Any exception raised by the configured projection.
     */
    #projectToWorld(position: Point): Point {
        const projected = this.#source.projection.project(position);
        return {
            x: projected.x * this.#worldWidth,
            y: projected.y * this.#worldHeight
        };
    }

    /**
     * Converts minimum-zoom world pixels into source coordinates.
     *
     * @param position - Point in minimum-zoom world pixels.
     * @returns Point in source coordinates.
     * @throws Any exception raised by the configured inverse projection.
     */
    #unprojectWorldPoint(position: Point): Point {
        const x = this.#source.wrapX ? modulo(position.x, this.#worldWidth) : position.x;
        return this.#source.projection.unproject({ x: x / this.#worldWidth, y: position.y / this.#worldHeight });
    }

    /**
     * Projects a connected source-coordinate path while preserving continuity across a wrapping world edge.
     *
     * @param positions - Ordered vertices in source coordinates.
     * @param options   - Path closure, interpolation and optional subdivision-culling bounds.
     * @returns Continuous projected path in viewport-relative CSS pixels.
     * @throws Any exception raised by the configured projection or natural-line interpolator.
     */
    public projectPath(positions: readonly Point[], { bounds, closed = false, interpolation = "projected" }: ProjectPathOptions = {}): Point[] {
        const normalizedPositions = closed && positions.length > 1 && samePoint(positions[0], positions[positions.length - 1])
            ? positions.slice(0, -1)
            : positions;
        const interpolateLine = this.#source.projection.interpolateLine;
        if (interpolation === "projected" || interpolateLine == null || normalizedPositions.length < 2) {
            return this.#projectPositions(normalizedPositions);
        }

        const path: Point[] = [];
        const segmentCount = closed ? normalizedPositions.length : normalizedPositions.length - 1;
        let previousPoint: Point | undefined;
        for (let index = 0; index < segmentCount; index++) {
            previousPoint = this.#appendNaturalLine(path, normalizedPositions[index], normalizedPositions[(index + 1) % normalizedPositions.length],
                previousPoint, interpolateLine, bounds);
        }
        if (closed) {
            path.pop();
        }
        return path;
    }

    /**
     * Projects source-coordinate positions without adding intermediate points.
     *
     * @param positions - Ordered vertices in source coordinates.
     * @returns Projected vertices adjusted for continuity across horizontal world edges.
     * @throws Any exception raised by the configured projection.
     */
    #projectPositions(positions: readonly Point[]): Point[] {
        const points: Point[] = [];
        const wrapWidth = this.#worldWidth * 2 ** (this.#zoom - this.#source.minZoom);
        let previousX: number | undefined;
        for (const position of positions) {
            let point = this.project(position);
            if (this.#source.wrapX && previousX != null) {
                point = { ...point, x: point.x + Math.round((previousX - point.x) / wrapWidth) * wrapWidth };
            }
            points.push(point);
            previousX = point.x;
        }
        return points;
    }

    /**
     * Adaptively appends the potentially visible part of a natural route.
     *
     * @param output         - Projected path receiving generated points.
     * @param start          - Segment start in source coordinates.
     * @param end            - Segment end in source coordinates.
     * @param projectedStart - Already projected start point shared with the previous segment, or `undefined` for the first segment.
     * @param interpolateLine - Natural-route interpolator supplied by the current projection.
     * @param bounds         - Optional visible bounds used to stop safe offscreen subdivision.
     * @returns Projected destination point for reuse by the next segment.
     * @throws Any exception raised by the configured projection or natural-line interpolator.
     */
    #appendNaturalLine(output: Point[], start: Point, end: Point, projectedStart: Point | undefined,
            interpolateLine: (start: Point, end: Point, ratio: number) => Point, bounds: Bounds | undefined): Point {
        const origin = projectedStart ?? this.project(start);
        const wrapWidth = this.#worldWidth * 2 ** (this.#zoom - this.#source.minZoom);
        const wrappedWidth = this.#source.wrapX ? wrapWidth : null;
        if (output.length === 0) {
            output.push(origin);
        }
        /**
         * Projects a natural segment position and moves wrapped copies beside the segment origin.
         *
         * @param ratio - Segment interpolation ratio from zero through one.
         * @returns Projected viewport-relative position in the continuous world copy.
         */
        const getProjectedPosition = (ratio: number): Point => {
            const position = ratio === 1 ? end : interpolateLine.call(this.#source.projection, start, end, ratio);
            let projected = this.project(position);
            if (wrappedWidth != null) {
                projected = { ...projected, x: projected.x + Math.round((origin.x - projected.x) / wrappedWidth) * wrappedWidth };
            }
            return projected;
        };
        /**
         * Recursively appends one adaptively subdivided interval.
         *
         * @param startRatio  - Interpolation ratio at the interval start.
         * @param startPoint  - Projected point at `startRatio`.
         * @param middleRatio - Interpolation ratio at the interval midpoint.
         * @param middlePoint - Projected point at `middleRatio`.
         * @param endRatio    - Interpolation ratio at the interval end.
         * @param endPoint    - Projected point at `endRatio`.
         * @param depth       - Current recursive subdivision depth.
         */
        const appendSegment = (startRatio: number, startPoint: Point, middleRatio: number, middlePoint: Point, endRatio: number, endPoint: Point,
            depth: number): void => {
            if (depth >= maxProjectedLineSubdivisionDepth) {
                output.push(endPoint);
                return;
            }
            const firstQuarterRatio = (startRatio + middleRatio) / 2;
            const thirdQuarterRatio = (middleRatio + endRatio) / 2;
            const firstQuarterPoint = getProjectedPosition(firstQuarterRatio);
            const thirdQuarterPoint = getProjectedPosition(thirdQuarterRatio);
            const squaredError = Math.max(
                squaredDistanceToSegment(firstQuarterPoint, startPoint, endPoint),
                squaredDistanceToSegment(middlePoint, startPoint, endPoint),
                squaredDistanceToSegment(thirdQuarterPoint, startPoint, endPoint)
            );
            if ((bounds != null && this.#isOutsideBounds(startPoint, firstQuarterPoint, middlePoint, thirdQuarterPoint, endPoint,
                Math.max(Math.sqrt(squaredError), pathTolerance), bounds)) || squaredError <= squaredPathTolerance) {
                output.push(endPoint);
                return;
            }
            appendSegment(startRatio, startPoint, firstQuarterRatio, firstQuarterPoint, middleRatio, middlePoint, depth + 1);
            appendSegment(middleRatio, middlePoint, thirdQuarterRatio, thirdQuarterPoint, endRatio, endPoint, depth + 1);
        };
        const destination = getProjectedPosition(1);
        appendSegment(0, origin, 0.5, getProjectedPosition(0.5), 1, destination, 0);
        return destination;
    }

    /**
     * Returns whether a padded point set is completely outside rectangular bounds.
     *
     * @param start        - First projected point.
     * @param firstQuarter - Projected point one quarter through the interval.
     * @param middle       - Projected interval midpoint.
     * @param thirdQuarter - Projected point three quarters through the interval.
     * @param end          - Final projected point.
     * @param padding      - Error-envelope padding in CSS pixels.
     * @param bounds       - Visible clipping bounds.
     * @returns `true` when no padded horizontal world copy can intersect the bounds.
     */
    #isOutsideBounds(start: Point, firstQuarter: Point, middle: Point, thirdQuarter: Point, end: Point, padding: number, bounds: Bounds): boolean {
        const bottom = Math.max(start.y, firstQuarter.y, middle.y, thirdQuarter.y, end.y);
        const left = Math.min(start.x, firstQuarter.x, middle.x, thirdQuarter.x, end.x);
        const right = Math.max(start.x, firstQuarter.x, middle.x, thirdQuarter.x, end.x);
        const top = Math.min(start.y, firstQuarter.y, middle.y, thirdQuarter.y, end.y);
        if (bottom + padding < bounds.top || top - padding > bounds.bottom) {
            return true;
        }
        const wrapWidth = this.wrapWidth;
        if (wrapWidth == null) {
            return right + padding < bounds.left || left - padding > bounds.right;
        }
        const firstCopy = Math.ceil((bounds.left - right - padding) / wrapWidth);
        const lastCopy = Math.floor((bounds.right - left + padding) / wrapWidth);
        return firstCopy > lastCopy;
    }

    /**
     * Changes the viewport size and constrains the current zoom and center to it.
     *
     * @param width  - Viewport width in CSS pixels.
     * @param height - Viewport height in CSS pixels.
     */
    public resize(width: number, height: number): void {
        this.#viewportWidth = width;
        this.#viewportHeight = height;
        this.#zoom = this.#automaticZoom ? this.#defaultZoom : this.clampZoom(this.#zoom);
        this.#constrain();
    }

    /**
     * Replaces the tile source while preserving the center in source coordinates where possible.
     *
     * @param source  - New normalized tile source.
     * @param minZoom - Minimum continuous view zoom.
     * @param maxZoom - Maximum continuous view zoom.
     * @throws Any exception raised by the old inverse projection or new forward projection.
     * @throws {@link !RangeError} When a zoom limit is not finite or `minZoom` is greater than `maxZoom`.
     */
    public setSource(source: Readonly<NormalizedTileSource>, minZoom = source.minZoom, maxZoom = source.maxZoom): void {
        this.#validateZoomRange(minZoom, maxZoom);
        const center = this.#unprojectWorldPoint({ x: this.#desiredCenterX, y: this.#desiredCenterY });
        this.#source = source;
        this.#maxZoom = maxZoom;
        this.#minZoom = minZoom;
        const world = this.#projectToWorld(center);
        this.#centerX = world.x;
        this.#centerY = world.y;
        this.#desiredCenterX = world.x;
        this.#desiredCenterY = world.y;
        this.#zoom = this.#automaticZoom ? this.#defaultZoom : this.clampZoom(this.#zoom);
        this.#constrain();
    }

    /**
     * Changes continuous view-zoom constraints.
     *
     * @param minZoom       - Minimum continuous view zoom.
     * @param maxZoom       - Maximum continuous view zoom.
     * @param coverViewport - Whether the minimum zoom is raised as needed to cover the viewport.
     * @throws {@link !RangeError} When a zoom limit is not finite or `minZoom` is greater than `maxZoom`.
     */
    public setZoomConstraints(minZoom: number, maxZoom: number, coverViewport: boolean): void {
        this.#validateZoomRange(minZoom, maxZoom);
        this.#coverViewport = coverViewport;
        this.#maxZoom = maxZoom;
        this.#minZoom = minZoom;
        this.#zoom = this.#automaticZoom ? this.#defaultZoom : this.clampZoom(this.#zoom);
        this.#constrain();
    }

    /**
     * Calculates a camera state which fits all specified source-coordinate points inside the viewport margin.
     *
     * Horizontally wrapping sources use the shortest cyclic span containing every point. The resulting zoom is clamped to the configured map and
     * viewport constraints. The returned center is not constrained to the tile coverage until the view is applied.
     *
     * @param points - Non-empty collection of points interpreted by the current projection.
     * @param margin - Non-negative inset from every viewport edge in CSS pixels, smaller than half of both viewport dimensions.
     * @param maxZoom - Maximum zoom to use for this fit operation.
     * @returns Requested camera state in minimum-zoom world pixels.
     * @throws Any exception raised by the configured projection.
     * @throws {@link !RangeError} When `maxZoom` is not finite.
     */
    public getFittedView(points: readonly Point[], margin: number, maxZoom: number): WorldView {
        const first = this.#projectToWorld(points[0]);
        let left = first.x;
        let right = first.x;
        let top = first.y;
        let bottom = first.y;
        const horizontalPositions = this.#source.wrapX ? [ modulo(first.x, this.#worldWidth) ] : null;
        for (let index = 1; index < points.length; index++) {
            const position = this.#projectToWorld(points[index]);
            if (horizontalPositions == null) {
                left = Math.min(left, position.x);
                right = Math.max(right, position.x);
            } else {
                horizontalPositions.push(modulo(position.x, this.#worldWidth));
            }
            top = Math.min(top, position.y);
            bottom = Math.max(bottom, position.y);
        }

        if (horizontalPositions != null) {
            horizontalPositions.sort((a, b) => a - b);
            const lastIndex = horizontalPositions.length - 1;
            let largestGap = horizontalPositions[0] + this.#worldWidth - horizontalPositions[lastIndex];
            let firstIndex = 0;
            for (let index = 0; index < lastIndex; index++) {
                const gap = horizontalPositions[index + 1] - horizontalPositions[index];
                if (gap > largestGap) {
                    largestGap = gap;
                    firstIndex = index + 1;
                }
            }
            left = horizontalPositions[firstIndex];
            right = horizontalPositions[(firstIndex + lastIndex) % horizontalPositions.length];
            if (right < left) {
                right += this.#worldWidth;
            }
        }

        const availableWidth = this.#viewportWidth - margin * 2;
        const availableHeight = this.#viewportHeight - margin * 2;
        let zoom = Math.min(this.#maxZoom, maxZoom);
        if (right > left) {
            zoom = Math.min(zoom, this.#source.minZoom + Math.log2(availableWidth / (right - left)));
        }
        if (bottom > top) {
            zoom = Math.min(zoom, this.#source.minZoom + Math.log2(availableHeight / (bottom - top)));
        }
        return {
            centerX: (left + right) / 2,
            centerY: (top + bottom) / 2,
            zoom: this.clampZoom(zoom)
        };
    }

    /**
     * Sets the center in source coordinates immediately.
     *
     * @param center - New center interpreted by the current projection.
     * @throws Any exception raised by the configured projection.
     */
    public setCenter(center: Point): void {
        const world = this.#projectToWorld(center);
        this.#desiredCenterX = world.x;
        this.#desiredCenterY = world.y;
        this.#constrain();
    }

    /**
     * Sets the source-coordinate center and zoom atomically.
     *
     * @param center - New center interpreted by the current projection.
     * @param zoom   - New continuous zoom, clamped to source and viewport limits.
     * @throws Any exception raised by the configured projection.
     * @throws {@link !RangeError} When `zoom` is not finite.
     */
    public setView(center: Point, zoom: number): void {
        const world = this.#projectToWorld(center);
        this.#desiredCenterX = world.x;
        this.#desiredCenterY = world.y;
        this.#automaticZoom = false;
        this.#zoom = this.clampZoom(zoom);
        this.#constrain();
    }

    /**
     * Sets the complete camera state in minimum-zoom world pixels.
     *
     * @param centerX - Horizontal center in minimum-zoom world pixels.
     * @param centerY - Vertical center in minimum-zoom world pixels.
     * @param zoom    - New continuous zoom, clamped to source and viewport limits.
     * @throws {@link !RangeError} When `zoom` is not finite.
     */
    public setWorldView(centerX: number, centerY: number, zoom: number): void {
        this.#desiredCenterX = centerX;
        this.#desiredCenterY = centerY;
        this.#automaticZoom = false;
        this.#zoom = this.clampZoom(zoom);
        this.#constrain();
    }

    /**
     * Applies an interpolated camera state, taking the shortest path across a horizontal world wrap.
     *
     * @param start  - Camera state at interpolation ratio zero.
     * @param target - Camera state at interpolation ratio one.
     * @param ratio  - Interpolation ratio from zero through one.
     */
    public setInterpolatedView(start: WorldView, target: WorldView, ratio: number): void {
        let deltaX = target.centerX - start.centerX;
        if (this.#source.wrapX) {
            const worldWidth = this.#worldWidth;
            deltaX -= Math.round(deltaX / worldWidth) * worldWidth;
        }
        this.setWorldView(
            start.centerX + deltaX * ratio,
            start.centerY + (target.centerY - start.centerY) * ratio,
            start.zoom + (target.zoom - start.zoom) * ratio
        );
    }

    /**
     * Sets the continuous zoom immediately around the viewport center.
     *
     * @param zoom - New continuous zoom, or `null` to restore the automatic zoom one level above the effective minimum.
     * @throws {@link !RangeError} When `zoom` is not finite.
     */
    public setZoom(zoom: number | null): void {
        this.#automaticZoom = zoom == null;
        this.#zoom = zoom == null ? this.#defaultZoom : this.clampZoom(zoom);
        this.#constrain();
    }

    /**
     * Returns the minimum-zoom world position beneath a viewport point.
     *
     * @param position - Viewport-relative point in CSS pixels.
     * @returns Corresponding minimum-zoom world position.
     */
    public toWorld(position: Point): Point {
        const scale = 2 ** (this.#zoom - this.#source.minZoom);
        return {
            x: this.#centerX + (position.x - this.#viewportWidth / 2) / scale,
            y: this.#centerY + (position.y - this.#viewportHeight / 2) / scale
        };
    }

    /**
     * Sets a zoom while preserving a world position beneath a viewport anchor.
     *
     * @param world  - Minimum-zoom world position to preserve.
     * @param anchor - Viewport-relative anchor in CSS pixels.
     * @param zoom   - Requested continuous zoom.
     * @throws {@link !RangeError} When `zoom` is not finite.
     */
    public zoomAt(world: Point, anchor: Point, zoom: number): void {
        const view = this.getAnchoredView(world, anchor, zoom);
        this.#automaticZoom = false;
        this.#centerX = view.centerX;
        this.#centerY = view.centerY;
        this.#desiredCenterX = view.centerX;
        this.#desiredCenterY = view.centerY;
        this.#zoom = view.zoom;
    }

    /**
     * Constrains one non-wrapping camera axis.
     *
     * @param center - Requested center in minimum-zoom world pixels.
     * @param scale  - CSS-pixel scale relative to the minimum zoom level.
     * @param axis   - Axis to constrain.
     * @returns Center constrained to the coverage. When viewport covering is enabled, the viewport is additionally kept inside the coverage and the
     *          coverage midpoint is used when that is impossible.
     */
    #constrainAxis(center: number, scale: number, axis: "x" | "y"): number {
        const horizontal = axis === "x";
        const minimum = horizontal ? this.#coverageLeft : this.#coverageTop;
        const maximum = horizontal ? this.#coverageRight : this.#coverageBottom;
        if (!this.#coverViewport) {
            return clamp(center, minimum, maximum);
        }
        const viewportSize = horizontal ? this.#viewportWidth : this.#viewportHeight;
        const halfViewport = viewportSize / (2 * scale);
        if (halfViewport * 2 >= maximum - minimum) {
            return (minimum + maximum) / 2;
        }
        return clamp(center, minimum + halfViewport, maximum - halfViewport);
    }

    /**
     * Validates continuous view-zoom limits.
     *
     * @param minZoom - Minimum continuous view zoom.
     * @param maxZoom - Maximum continuous view zoom.
     * @throws {@link !RangeError} When a limit is not finite or `minZoom` is greater than `maxZoom`.
     */
    #validateZoomRange(minZoom: number, maxZoom: number): void {
        assertFinite(minZoom, "minZoom");
        assertFinite(maxZoom, "maxZoom");
        if (minZoom > maxZoom) {
            throw new RangeError("minZoom must not be greater than maxZoom");
        }
    }

    /** Constrains the camera center to the configured tile coverage. */
    #constrain(): void {
        const worldWidth = this.#worldWidth;
        const scale = 2 ** (this.#zoom - this.#source.minZoom);
        this.#centerX = this.#source.wrapX
            ? modulo(this.#desiredCenterX, worldWidth)
            : this.#constrainAxis(this.#desiredCenterX, scale, "x");
        this.#centerY = this.#constrainAxis(this.#desiredCenterY, scale, "y");
    }

    /** Bottom tile-coverage edge in minimum-zoom world pixels. */
    get #coverageBottom(): number {
        return this.#source.coverage.bottom * this.#worldHeight;
    }

    /** Tile-coverage height in minimum-zoom world pixels. */
    get #coverageHeight(): number {
        return (this.#source.coverage.bottom - this.#source.coverage.top) * this.#worldHeight;
    }

    /** Left tile-coverage edge in minimum-zoom world pixels. */
    get #coverageLeft(): number {
        return this.#source.coverage.left * this.#worldWidth;
    }

    /** Right tile-coverage edge in minimum-zoom world pixels. */
    get #coverageRight(): number {
        return this.#source.coverage.right * this.#worldWidth;
    }

    /** Top tile-coverage edge in minimum-zoom world pixels. */
    get #coverageTop(): number {
        return this.#source.coverage.top * this.#worldHeight;
    }

    /** Tile-coverage width in minimum-zoom world pixels. */
    get #coverageWidth(): number {
        return (this.#source.coverage.right - this.#source.coverage.left) * this.#worldWidth;
    }

    /**
     * Minimum-zoom world height.
     *
     * @returns Root-row count multiplied by logical tile height.
     */
    get #worldHeight(): number {
        return this.#source.rootRows * this.#source.tileHeight;
    }

    /**
     * Lowest effective continuous view zoom.
     *
     * @returns Configured minimum, optionally raised to cover the viewport but never beyond the configured maximum.
     */
    get #minimumZoom(): number {
        if (!this.#coverViewport) {
            return this.#minZoom;
        }
        const verticalScale = this.#viewportHeight / this.#coverageHeight;
        const horizontalScale = this.#source.wrapX ? 0 : this.#viewportWidth / this.#coverageWidth;
        const viewportZoom = this.#source.minZoom + Math.log2(Math.max(verticalScale, horizontalScale));
        return Math.min(this.#maxZoom, Math.max(this.#minZoom, viewportZoom));
    }

    /** Automatic initial zoom one level above the effective minimum. */
    get #defaultZoom(): number {
        return Math.min(this.#maxZoom, this.#minimumZoom + 1);
    }

    /**
     * Minimum-zoom world width.
     *
     * @returns Root-column count multiplied by logical tile width.
     */
    get #worldWidth(): number {
        return this.#source.rootColumns * this.#source.tileWidth;
    }

}
