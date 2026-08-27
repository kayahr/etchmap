/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import type { Point } from "./Point.ts";

/** Pointer event enriched with coordinates from all map coordinate systems. */
export interface MapPointerEvent extends PointerEvent {
    /** Unmodified native pointer event from which this map event was created. */
    readonly originalEvent: PointerEvent;

    /** Position in coordinates interpreted by the current tile-source projection, such as longitude and latitude for Web Mercator. */
    readonly sourcePoint: Point;

    /** Position within the map viewport in CSS pixels. */
    readonly viewportPoint: Point;

    /** Position in minimum-zoom world pixels. Horizontal coordinates may be outside the base world when the source wraps. */
    readonly worldPoint: Point;
}

/** Internal implementation of a map pointer event. */
class MapPointerEventImplementation extends PointerEvent implements MapPointerEvent {
    /** Unmodified native pointer event. */
    public readonly originalEvent: PointerEvent;

    /** Position in source coordinates. */
    public readonly sourcePoint: Point;

    /** Position within the map viewport in CSS pixels. */
    public readonly viewportPoint: Point;

    /** Position in minimum-zoom world pixels. */
    public readonly worldPoint: Point;

    /**
     * Creates a map pointer event.
     *
     * @param type          - Custom map pointer event type.
     * @param originalEvent - Native pointer event to copy.
     * @param viewportPoint - Position within the map viewport in CSS pixels.
     * @param worldPoint    - Position in minimum-zoom world pixels.
     * @param sourcePoint   - Position in source coordinates.
     */
    public constructor(type: string, originalEvent: PointerEvent, viewportPoint: Point, worldPoint: Point, sourcePoint: Point) {
        super(type, MapPointerEventImplementation.#createInit(originalEvent));
        this.originalEvent = originalEvent;
        this.sourcePoint = sourcePoint;
        this.viewportPoint = viewportPoint;
        this.worldPoint = worldPoint;
    }

    /**
     * Copies the Pointer Event state into an initializer for a bubbling, composed and cancelable custom event.
     *
     * @param event - Native Pointer Event to copy.
     * @returns Pointer Event initializer.
     */
    static #createInit(event: PointerEvent): PointerEventInit {
        return {
            altKey: event.altKey,
            altitudeAngle: event.altitudeAngle,
            azimuthAngle: event.azimuthAngle,
            bubbles: true,
            button: event.button,
            buttons: event.buttons,
            cancelable: true,
            clientX: event.clientX,
            clientY: event.clientY,
            composed: true,
            ctrlKey: event.ctrlKey,
            detail: event.detail,
            height: event.height,
            isPrimary: event.isPrimary,
            metaKey: event.metaKey,
            movementX: event.movementX,
            movementY: event.movementY,
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            pressure: event.pressure,
            relatedTarget: event.relatedTarget,
            screenX: event.screenX,
            screenY: event.screenY,
            shiftKey: event.shiftKey,
            tangentialPressure: event.tangentialPressure,
            tiltX: event.tiltX,
            tiltY: event.tiltY,
            twist: event.twist,
            view: event.view,
            width: event.width
        };
    }
}

/**
 * Creates an enriched custom map pointer event.
 *
 * @param type          - Custom event type corresponding to the native Pointer Event.
 * @param originalEvent - Native Pointer Event to copy.
 * @param viewportPoint - Position within the map viewport in CSS pixels.
 * @param worldPoint    - Position in minimum-zoom world pixels.
 * @param sourcePoint   - Position in source coordinates.
 * @returns Enriched map pointer event.
 */
export function createMapPointerEvent(type: "map-pointercancel" | "map-pointerdown" | "map-pointermove" | "map-pointerup",
        originalEvent: PointerEvent, viewportPoint: Point, worldPoint: Point, sourcePoint: Point): MapPointerEvent {
    return new MapPointerEventImplementation(type, originalEvent, viewportPoint, worldPoint, sourcePoint);
}

declare global {
    /** Additional custom events dispatched by map elements. */
    interface HTMLElementEventMap {
        /** A tracked pointer was canceled over a map. */
        "map-pointercancel": MapPointerEvent;

        /** A pointer became active over a map. Prevent its default to claim the pointer instead of starting a built-in map gesture. */
        "map-pointerdown": MapPointerEvent;

        /** A pointer moved over a map or continued moving while captured by it. */
        "map-pointermove": MapPointerEvent;

        /** A pointer stopped being active over a map. */
        "map-pointerup": MapPointerEvent;
    }
}
