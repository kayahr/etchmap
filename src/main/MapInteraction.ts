/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import type { MapCamera, WorldView } from "./MapCamera.ts";
import { type MapPointerEvent, createMapPointerEvent } from "./MapPointerEvent.ts";
import { type MapWheelEvent, createMapWheelEvent } from "./MapWheelEvent.ts";
import { type Point, getDistance, getMidpoint } from "./Point.ts";
import { assertNotNull } from "./util/assert.ts";
import { clamp } from "./util/math.ts";

/** Time constant controlling the exponential wheel-zoom animation in milliseconds. */
const wheelZoomTimeConstant = 140;

/** Duration of a programmatic camera transition in milliseconds. */
const viewTransitionDuration = 600;

/** One active pointer. */
interface ActivePointer {
    /** Latest viewport-relative position in CSS pixels. */
    point: Point;

    /** Timestamp of the latest accepted pointer event in milliseconds. */
    timestamp: number;
}

/** Position sample used to estimate release velocity. */
interface PositionSample extends Point {
    /** Event timestamp in milliseconds. */
    readonly timestamp: number;
}

/** Active single-pointer pan gesture. */
interface PanGesture {
    /** Gesture discriminator. */
    readonly kind: "pan";

    /** Pointer controlling the pan. */
    readonly pointerId: number;

    /** Recent positions used to estimate release velocity. */
    readonly samples: PositionSample[];

    /** Latest viewport-relative pointer position in CSS pixels. */
    lastPoint: Point;

    /** Whether at least one real pointer-move event was received. */
    moved: boolean;
}

/** Active two-pointer pinch gesture. */
interface PinchGesture {
    /** Zoom-zero world position which remains beneath the moving pinch midpoint. */
    readonly anchorWorld: Point;

    /** Gesture discriminator. */
    readonly kind: "pinch";

    /** Two pointers controlling the pinch. */
    readonly pointerIds: readonly [ number, number ];

    /** Screen-space distance between both pointers at gesture start in CSS pixels. */
    readonly startDistance: number;

    /** Continuous map zoom at gesture start. */
    readonly startZoom: number;
}

/** Current direct-manipulation gesture. */
type Gesture = PanGesture | PinchGesture;

/** Active inertial panning animation. */
interface Momentum {
    /** Timestamp through which momentum has been integrated in milliseconds. */
    lastTimestamp: number;

    /** Horizontal content velocity in CSS pixels per millisecond. */
    velocityX: number;

    /** Vertical content velocity in CSS pixels per millisecond. */
    velocityY: number;
}

/** Active anchored wheel-zoom animation. */
interface WheelZoom {
    /** Fixed viewport-relative wheel anchor in CSS pixels. */
    readonly anchorScreen: Point;

    /** Fixed minimum-zoom world position beneath the wheel anchor. */
    readonly anchorWorld: Point;

    /** Timestamp through which the zoom animation has been integrated in milliseconds. */
    lastTimestamp: number;

    /** Continuous destination zoom. */
    targetZoom: number;
}

/** Active programmatic transition between two complete camera states. */
interface ViewTransition {
    /** Camera state captured when the transition started. */
    readonly startView: WorldView;

    /** Timestamp at which the transition started in milliseconds. */
    readonly startedAt: number;

    /** Requested destination camera state. */
    readonly targetView: WorldView;
}

/** Modern Pointer Events map interaction controller. */
export class MapInteraction {
    /** Camera manipulated by this controller. */
    readonly #camera: MapCamera;

    /** Canvas defining the logical viewport rectangle. */
    readonly #canvas: HTMLCanvasElement;

    /** Map element receiving bubbling interaction events from its Canvas and overlays. */
    readonly #element: HTMLElement;

    /** Pointer IDs claimed by consumers instead of participating in built-in map gestures. */
    readonly #claimedPointers = new Set<number>();

    /** Active direct-manipulation gesture. */
    #gesture: Gesture | null = null;

    /** Whether event listeners are currently installed. */
    #listening = false;

    /** Active momentum animation. */
    #momentum: Momentum | null = null;

    /** Callback requesting a rendered frame. */
    readonly #onChange: () => void;

    /** Callback dispatching an enriched map input event. */
    readonly #onMapEvent: (event: MapPointerEvent | MapWheelEvent) => boolean;

    /** Active pointers in insertion order. */
    readonly #pointers = new Map<number, ActivePointer>();

    /** Function returning the current viewport size. */
    readonly #size: () => Point;

    /** Active wheel zoom animation. */
    #wheelZoom: WheelZoom | null = null;

    /** Active programmatic camera transition. */
    #viewTransition: ViewTransition | null = null;

    /**
     * Creates an interaction controller.
     *
     * @param element    - Map element receiving bubbling interaction events from its Canvas and overlays.
     * @param canvas     - Canvas defining the logical viewport rectangle.
     * @param camera     - Camera to manipulate.
     * @param size       - Function returning the current viewport size.
     * @param onChange   - Callback requesting a frame after a camera change.
     * @param onMapEvent - Callback dispatching an enriched map input event and returning whether its default action may run.
     */
    public constructor(element: HTMLElement, canvas: HTMLCanvasElement, camera: MapCamera, size: () => Point, onChange: () => void,
            onMapEvent: (event: MapPointerEvent | MapWheelEvent) => boolean) {
        this.#camera = camera;
        this.#canvas = canvas;
        this.#element = element;
        this.#onChange = onChange;
        this.#onMapEvent = onMapEvent;
        this.#size = size;
    }

    /**
     * Whether a time-based animation is active.
     *
     * @returns `true` while a camera transition, wheel zoom or pan momentum requires animation frames.
     */
    public get animating(): boolean {
        return this.#momentum != null || this.#viewTransition != null || this.#wheelZoom != null;
    }

    /**
     * Destination camera state of an active camera animation.
     *
     * @returns Constrained destination view, or `null` while no camera animation is active.
     */
    public get targetView(): WorldView | null {
        if (this.#viewTransition != null) {
            return this.#camera.constrainView(this.#viewTransition.targetView);
        }
        const wheelZoom = this.#wheelZoom;
        return wheelZoom == null
            ? null
            : this.#camera.getAnchoredView(wheelZoom.anchorWorld, wheelZoom.anchorScreen, wheelZoom.targetZoom);
    }

    /**
     * Advances active time-based animations.
     *
     * @param timestamp - Animation-frame timestamp in milliseconds.
     */
    public advance(timestamp: number): void {
        const viewTransition = this.#viewTransition;
        if (viewTransition != null) {
            const progress = clamp((timestamp - viewTransition.startedAt) / viewTransitionDuration, 0, 1);
            const remaining = 1 - progress;
            const squareRemaining = remaining * remaining;
            const ratio = 1 - squareRemaining * squareRemaining * remaining;
            this.#camera.setInterpolatedView(viewTransition.startView, this.#camera.constrainView(viewTransition.targetView), ratio);
            if (progress === 1) {
                this.#viewTransition = null;
                this.#camera.setWorldView(viewTransition.targetView.centerX, viewTransition.targetView.centerY, viewTransition.targetView.zoom);
            }
            return;
        }

        const wheelZoom = this.#wheelZoom;
        if (wheelZoom != null) {
            wheelZoom.targetZoom = this.#camera.clampZoom(wheelZoom.targetZoom);
            const elapsed = Math.max(0, Math.min(100, timestamp - wheelZoom.lastTimestamp));
            wheelZoom.lastTimestamp = timestamp;
            const factor = 1 - Math.exp(-elapsed / wheelZoomTimeConstant);
            let zoom = this.#camera.zoom + (wheelZoom.targetZoom - this.#camera.zoom) * factor;
            if (Math.abs(wheelZoom.targetZoom - zoom) < 0.001) {
                zoom = wheelZoom.targetZoom;
                this.#wheelZoom = null;
            }
            this.#camera.zoomAt(wheelZoom.anchorWorld, wheelZoom.anchorScreen, zoom);
            return;
        }

        const momentum = this.#momentum;
        if (momentum != null) {
            const elapsed = timestamp - momentum.lastTimestamp;
            momentum.lastTimestamp = timestamp;
            if (elapsed <= 0) {
                return;
            }
            const friction = 0.004;
            const decay = Math.exp(-friction * elapsed);
            const distanceFactor = (1 - decay) / friction;
            const moved = this.#camera.pan(momentum.velocityX * distanceFactor, momentum.velocityY * distanceFactor);
            momentum.velocityX = moved.x === 0 ? 0 : momentum.velocityX * decay;
            momentum.velocityY = moved.y === 0 ? 0 : momentum.velocityY * decay;
            const squareSpeed = momentum.velocityX * momentum.velocityX + momentum.velocityY * momentum.velocityY;
            if (squareSpeed < 0.015 ** 2) {
                this.#momentum = null;
            }
        }
    }

    /** Installs interaction event listeners. */
    public connect(): void {
        if (this.#listening) {
            return;
        }
        this.#listening = true;
        this.#element.addEventListener("pointerdown", this.#onPointerDown);
        this.#element.addEventListener("pointermove", this.#onPointerMove);
        this.#element.addEventListener("pointerup", this.#onPointerUp);
        this.#element.addEventListener("pointercancel", this.#onPointerCancel);
        this.#element.addEventListener("lostpointercapture", this.#onLostPointerCapture);
        this.#element.addEventListener("wheel", this.#onWheel, { passive: false });
    }

    /** Removes event listeners and cancels all interaction state. */
    public disconnect(): void {
        if (this.#listening) {
            this.#listening = false;
            this.#element.removeEventListener("pointerdown", this.#onPointerDown);
            this.#element.removeEventListener("pointermove", this.#onPointerMove);
            this.#element.removeEventListener("pointerup", this.#onPointerUp);
            this.#element.removeEventListener("pointercancel", this.#onPointerCancel);
            this.#element.removeEventListener("lostpointercapture", this.#onLostPointerCapture);
            this.#element.removeEventListener("wheel", this.#onWheel);
        }
        for (const pointerId of new Set([ ...this.#pointers.keys(), ...this.#claimedPointers ])) {
            if (this.#element.hasPointerCapture(pointerId)) {
                this.#element.releasePointerCapture(pointerId);
            }
        }
        this.#claimedPointers.clear();
        this.#pointers.clear();
        this.#gesture = null;
        this.#momentum = null;
        this.#viewTransition = null;
        this.#wheelZoom = null;
    }

    /** Cancels time-based camera motion. */
    public stop(): void {
        this.#momentum = null;
        this.#viewTransition = null;
        this.#wheelZoom = null;
    }

    /**
     * Starts a fixed-duration eased transition to a complete camera state.
     *
     * Existing camera animation and momentum are canceled. Direct pointer or wheel interaction can cancel and replace the new transition.
     *
     * @param targetView - Requested destination in minimum-zoom world pixels.
     */
    public transitionTo(targetView: WorldView): void {
        this.stop();
        const startView = {
            centerX: this.#camera.centerX,
            centerY: this.#camera.centerY,
            zoom: this.#camera.zoom
        };
        const constrainedTarget = this.#camera.constrainView(targetView);
        if (startView.centerX === constrainedTarget.centerX && startView.centerY === constrainedTarget.centerY && startView.zoom === constrainedTarget.zoom) {
            this.#camera.setWorldView(targetView.centerX, targetView.centerY, targetView.zoom);
        } else {
            const view = this.#element.ownerDocument?.defaultView;
            this.#viewTransition = {
                startView,
                startedAt: view?.performance.now() ?? performance.now(),
                targetView
            };
        }
        this.#onChange();
    }

    /**
     * Handles loss of pointer capture.
     *
     * @param event - Pointer-capture event identifying the pointer to stop tracking.
     */
    readonly #onLostPointerCapture = (event: PointerEvent): void => {
        this.#claimedPointers.delete(event.pointerId);
        if (this.#pointers.delete(event.pointerId)) {
            this.#restartGesture();
        }
    };

    /**
     * Handles a canceled pointer.
     *
     * @param event - Canceled pointer event.
     */
    readonly #onPointerCancel = (event: PointerEvent): void => {
        this.#dispatchPointerEvent("map-pointercancel", event, this.#toPoint(event));
        this.#claimedPointers.delete(event.pointerId);
        if (this.#pointers.delete(event.pointerId)) {
            this.#restartGesture();
        }
    };

    /**
     * Starts tracking a pointer without canceling it because touch-action handles browser gestures and Firefox otherwise breaks multi-touch delivery.
     *
     * @param event - Pointer-down event to begin tracking.
     */
    readonly #onPointerDown = (event: PointerEvent): void => {
        const point = this.#toPoint(event);
        if (!this.#dispatchPointerEvent("map-pointerdown", event, point)) {
            this.#claimedPointers.add(event.pointerId);
            this.#element.setPointerCapture(event.pointerId);
            return;
        }
        if (event.pointerType !== "touch" && event.button !== 0) {
            return;
        }
        this.stop();
        this.#pointers.set(event.pointerId, { point, timestamp: event.timeStamp });
        this.#element.setPointerCapture(event.pointerId);
        this.#restartGesture();
    };

    /**
     * Updates a tracked pointer and applies the active direct-manipulation gesture.
     *
     * @param event - Pointer-move event containing the latest screen position.
     */
    readonly #onPointerMove = (event: PointerEvent): void => {
        const point = this.#toPoint(event);
        const applyDefault = this.#dispatchPointerEvent("map-pointermove", event, point);
        if (this.#claimedPointers.has(event.pointerId)) {
            return;
        }
        const pointer = this.#pointers.get(event.pointerId);
        if (pointer == null) {
            return;
        }
        pointer.point = point;
        pointer.timestamp = event.timeStamp;

        const gesture = this.#gesture;
        if (!applyDefault) {
            if (gesture?.kind === "pan" && gesture.pointerId === event.pointerId) {
                gesture.lastPoint = point;
                gesture.samples.length = 0;
                gesture.samples.push({ ...point, timestamp: event.timeStamp });
            }
            return;
        }
        if (gesture?.kind === "pan" && gesture.pointerId === event.pointerId) {
            const deltaX = point.x - gesture.lastPoint.x;
            const deltaY = point.y - gesture.lastPoint.y;
            gesture.lastPoint = point;
            gesture.moved = true;
            this.#camera.pan(deltaX, deltaY);
            const coalescedEvents = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
            const events = coalescedEvents.length === 0 ? [ event ] : coalescedEvents;
            for (const coalescedEvent of events) {
                const sample = this.#toPoint(coalescedEvent);
                gesture.samples.push({ ...sample, timestamp: coalescedEvent.timeStamp });
            }
            this.#trimSamples(gesture.samples, event.timeStamp);
            this.#onChange();
        } else if (gesture?.kind === "pinch" && gesture.pointerIds.includes(event.pointerId)) {
            this.#applyPinch(gesture);
            this.#onChange();
        }
    };

    /**
     * Finishes tracking a pointer and optionally starts momentum from real preceding move events.
     *
     * Pointer-up coordinates deliberately do not transform the camera because some browsers report release coordinates which differ from the last
     * delivered move.
     *
     * @param event - Pointer-up event identifying the pointer to stop tracking.
     */
    readonly #onPointerUp = (event: PointerEvent): void => {
        const applyDefault = this.#dispatchPointerEvent("map-pointerup", event, this.#toPoint(event));
        if (this.#claimedPointers.delete(event.pointerId)) {
            return;
        }
        const gesture = this.#gesture;
        if (applyDefault && gesture?.kind === "pan" && gesture.pointerId === event.pointerId && this.#pointers.size === 1 && gesture.moved) {
            gesture.samples.push({ ...gesture.lastPoint, timestamp: event.timeStamp });
            this.#trimSamples(gesture.samples, event.timeStamp);
            this.#startMomentum(gesture.samples, event.timeStamp);
        }
        this.#pointers.delete(event.pointerId);
        this.#restartGesture();
    };

    /**
     * Starts or retargets an anchored wheel-zoom animation.
     *
     * @param event - Wheel event whose position becomes the fixed zoom anchor.
     */
    readonly #onWheel = (event: WheelEvent): void => {
        const anchorScreen = this.#toPoint(event);
        if (!this.#dispatchWheelEvent(event, anchorScreen)) {
            return;
        }
        const delta = normalizeWheelDelta(event);
        if (delta === 0) {
            return;
        }
        this.#momentum = null;
        this.#viewTransition = null;
        const anchorWorld = this.#camera.toWorld(anchorScreen);
        const targetZoom = this.#camera.clampZoom(getWheelZoomTarget(this.#wheelZoom?.targetZoom ?? this.#camera.zoom, delta));
        this.#wheelZoom = {
            anchorScreen,
            anchorWorld,
            lastTimestamp: event.timeStamp,
            targetZoom
        };
        this.#onChange();
        event.preventDefault();
    };

    /** Restarts the direct-manipulation gesture from the current camera and pointer set. */
    #restartGesture(): void {
        const pointers = [ ...this.#pointers.entries() ];
        if (pointers.length >= 2) {
            const first = pointers[0];
            const second = pointers[1];
            const midpoint = getMidpoint(first[1].point, second[1].point);
            this.#gesture = {
                anchorWorld: this.#camera.toWorld(midpoint),
                kind: "pinch",
                pointerIds: [ first[0], second[0] ],
                startDistance: Math.max(1, getDistance(first[1].point, second[1].point)),
                startZoom: this.#camera.zoom
            };
        } else if (pointers.length === 1) {
            const [ pointerId, pointer ] = pointers[0];
            this.#gesture = {
                kind: "pan",
                lastPoint: pointer.point,
                moved: false,
                pointerId,
                samples: [ { ...pointer.point, timestamp: pointer.timestamp } ]
            };
        } else {
            this.#gesture = null;
        }
    }

    /**
     * Applies the latest positions of both pointers in the active pinch gesture.
     *
     * Every update derives its zoom from the immutable gesture-start zoom and screen-space distance. Previously calculated zoom values never feed into
     * later pinch calculations.
     *
     * @param gesture - Active pinch gesture whose two pointers are still registered.
     */
    #applyPinch(gesture: PinchGesture): void {
        const first = this.#pointers.get(gesture.pointerIds[0]);
        assertNotNull(first, "first pinch pointer");
        const second = this.#pointers.get(gesture.pointerIds[1]);
        assertNotNull(second, "second pinch pointer");
        const midpoint = getMidpoint(first.point, second.point);
        const distance = Math.max(1, getDistance(first.point, second.point));
        const zoom = gesture.startZoom + Math.log2(distance / gesture.startDistance);
        this.#camera.zoomAt(gesture.anchorWorld, midpoint, zoom);
    }

    /**
     * Dispatches an enriched map pointer event using the camera state before the built-in interaction handles the native event.
     *
     * @param type          - Custom event type corresponding to the native Pointer Event.
     * @param originalEvent - Native Pointer Event.
     * @param viewportPoint - Pointer position within the map viewport in CSS pixels.
     * @returns `true` when the built-in default action may run, or `false` when the map pointer event was canceled.
     * @throws Any exception raised by the configured inverse projection or event listener.
     */
    #dispatchPointerEvent(type: "map-pointercancel" | "map-pointerdown" | "map-pointermove" | "map-pointerup", originalEvent: PointerEvent,
            viewportPoint: Point): boolean {
        return this.#onMapEvent(createMapPointerEvent(
            type,
            originalEvent,
            viewportPoint,
            this.#camera.toWorld(viewportPoint),
            this.#camera.unproject(viewportPoint)
        ));
    }

    /**
     * Dispatches an enriched map wheel event using the camera state before the built-in interaction handles the native event.
     *
     * @param originalEvent - Native Wheel Event.
     * @param viewportPoint - Pointer position within the map viewport in CSS pixels.
     * @returns `true` when the built-in default action may run, or `false` when the map wheel event was canceled.
     * @throws Any exception raised by the configured inverse projection or event listener.
     */
    #dispatchWheelEvent(originalEvent: WheelEvent, viewportPoint: Point): boolean {
        return this.#onMapEvent(createMapWheelEvent(
            originalEvent,
            viewportPoint,
            this.#camera.toWorld(viewportPoint),
            this.#camera.unproject(viewportPoint)
        ));
    }

    /**
     * Starts momentum from recent pointer samples when their velocity exceeds the threshold.
     *
     * @param samples   - Non-empty chronological recent pointer positions in CSS pixels.
     * @param timestamp - Release timestamp in milliseconds.
     */
    #startMomentum(samples: readonly PositionSample[], timestamp: number): void {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const elapsed = last.timestamp - first.timestamp;
        if (elapsed <= 0) {
            return;
        }
        let velocityX = (last.x - first.x) / elapsed;
        let velocityY = (last.y - first.y) / elapsed;
        const squareSpeed = velocityX * velocityX + velocityY * velocityY;
        if (squareSpeed < 0.05 ** 2) {
            return;
        }
        if (squareSpeed > 3 ** 2) {
            const scale = 3 / Math.sqrt(squareSpeed);
            velocityX *= scale;
            velocityY *= scale;
        }
        this.#momentum = { lastTimestamp: timestamp, velocityX, velocityY };
        this.#onChange();
    }

    /**
     * Converts a client event coordinate into viewport-relative CSS pixels.
     *
     * @param event - Mouse-derived event carrying client coordinates.
     * @returns Position in the camera's logical viewport coordinate system.
     */
    #toPoint(event: MouseEvent): Point {
        const bounds = this.#canvas.getBoundingClientRect();
        const size = this.#size();
        return {
            x: bounds.width === 0 ? 0 : (event.clientX - bounds.left) * size.x / bounds.width,
            y: bounds.height === 0 ? 0 : (event.clientY - bounds.top) * size.y / bounds.height
        };
    }

    /**
     * Removes velocity samples older than 120 milliseconds while retaining at least one sample.
     *
     * @param samples   - Mutable chronological sample list.
     * @param timestamp - Current event timestamp in milliseconds.
     */
    #trimSamples(samples: PositionSample[], timestamp: number): void {
        while (samples.length > 1 && (samples[0]?.timestamp ?? timestamp) < timestamp - 120) {
            samples.shift();
        }
    }
}

/**
 * Converts a wheel-event delta into a bounded zoom delta.
 *
 * @param event - Wheel event whose delta and unit mode to normalize.
 * @returns Zoom delta clamped to minus one through one.
 */
function normalizeWheelDelta(event: WheelEvent): number {
    let delta: number;
    switch (event.deltaMode) {
        case WheelEvent.DOM_DELTA_LINE:
            delta = -event.deltaY / 3;
            break;
        case WheelEvent.DOM_DELTA_PAGE:
            delta = -event.deltaY;
            break;
        default:
            delta = -event.deltaY / 100;
            break;
    }
    return clamp(delta, -1, 1);
}

/**
 * Calculates a wheel-zoom destination while snapping full wheel steps to integer zoom levels.
 *
 * Fractional deltas from high-resolution scrolling remain continuous. A full step moves from a fractional camera zoom to the next integer level in its
 * direction so settled raster tiles are drawn at their native scale whenever viewport constraints permit it.
 *
 * @param zoom  - Current or already scheduled destination zoom.
 * @param delta - Normalized wheel delta from minus one through one.
 * @returns Unclamped destination zoom.
 */
function getWheelZoomTarget(zoom: number, delta: number): number {
    if (delta === 1) {
        return Math.floor(zoom) + 1;
    }
    if (delta === -1) {
        return Math.ceil(zoom) - 1;
    }
    return zoom + delta;
}
