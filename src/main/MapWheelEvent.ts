/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import type { Point } from "./Point.ts";

/** Wheel event enriched with coordinates from all map coordinate systems. */
export interface MapWheelEvent extends WheelEvent {
    /** Unmodified native wheel event from which this map event was created. */
    readonly originalEvent: WheelEvent;

    /** Position in coordinates interpreted by the current tile-source projection, such as longitude and latitude for Web Mercator. */
    readonly sourcePoint: Point;

    /** Position within the map viewport in CSS pixels. */
    readonly viewportPoint: Point;

    /** Position in minimum-zoom world pixels. Horizontal coordinates may be outside the base world when the source wraps. */
    readonly worldPoint: Point;
}

/** Internal implementation of a map wheel event. */
class MapWheelEventImplementation extends WheelEvent implements MapWheelEvent {
    /** Unmodified native wheel event. */
    public readonly originalEvent: WheelEvent;

    /** Position in source coordinates. */
    public readonly sourcePoint: Point;

    /** Position within the map viewport in CSS pixels. */
    public readonly viewportPoint: Point;

    /** Position in minimum-zoom world pixels. */
    public readonly worldPoint: Point;

    /**
     * Creates a map wheel event.
     *
     * @param originalEvent - Native wheel event to copy.
     * @param viewportPoint - Position within the map viewport in CSS pixels.
     * @param worldPoint    - Position in minimum-zoom world pixels.
     * @param sourcePoint   - Position in source coordinates.
     */
    public constructor(originalEvent: WheelEvent, viewportPoint: Point, worldPoint: Point, sourcePoint: Point) {
        super("map-wheel", MapWheelEventImplementation.#createInit(originalEvent));
        this.originalEvent = originalEvent;
        this.sourcePoint = sourcePoint;
        this.viewportPoint = viewportPoint;
        this.worldPoint = worldPoint;
    }

    /**
     * Copies the Wheel Event state into an initializer for a bubbling, composed and cancelable custom event.
     *
     * @param event - Native Wheel Event to copy.
     * @returns Wheel Event initializer.
     */
    static #createInit(event: WheelEvent): WheelEventInit {
        return {
            altKey: event.altKey,
            bubbles: true,
            button: event.button,
            buttons: event.buttons,
            cancelable: true,
            clientX: event.clientX,
            clientY: event.clientY,
            composed: true,
            ctrlKey: event.ctrlKey,
            deltaMode: event.deltaMode,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaZ: event.deltaZ,
            detail: event.detail,
            metaKey: event.metaKey,
            movementX: event.movementX,
            movementY: event.movementY,
            relatedTarget: event.relatedTarget,
            screenX: event.screenX,
            screenY: event.screenY,
            shiftKey: event.shiftKey,
            view: event.view
        };
    }
}

/**
 * Creates an enriched custom map wheel event.
 *
 * @param originalEvent - Native Wheel Event.
 * @param viewportPoint - Position within the map viewport in CSS pixels.
 * @param worldPoint    - Position in minimum-zoom world pixels.
 * @param sourcePoint   - Position in source coordinates.
 * @returns Enriched map wheel event.
 */
export function createMapWheelEvent(originalEvent: WheelEvent, viewportPoint: Point, worldPoint: Point, sourcePoint: Point): MapWheelEvent {
    return new MapWheelEventImplementation(originalEvent, viewportPoint, worldPoint, sourcePoint);
}

declare global {
    /** Additional custom events dispatched by map elements. */
    interface HTMLElementEventMap {
        /** The wheel moved over a map. Prevent its default to suppress built-in wheel zooming. */
        "map-wheel": MapWheelEvent;
    }
}
