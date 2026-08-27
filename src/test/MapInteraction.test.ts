/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import "./dom.ts";
import { describe, it } from "node:test";
import { assertCloseTo, assertEquals, assertSame } from "@kayahr/assert";
import type { Point } from "../main/Point.ts";
import { MapCamera } from "../main/MapCamera.ts";
import { MapInteraction } from "../main/MapInteraction.ts";
import type { MapPointerEvent } from "../main/MapPointerEvent.ts";
import type { MapWheelEvent } from "../main/MapWheelEvent.ts";
import { normalizeTileSource } from "../main/TileSource.ts";

/** Event-listener registration recorded by the Canvas mock. */
interface ListenerRegistration {
    readonly listener: EventListenerOrEventListenerObject;
    readonly options?: AddEventListenerOptions | boolean;
    readonly type: string;
}

/** Minimal deterministic Canvas event target used by interaction tests. */
class CanvasMock {
    /** Event-listener registrations. */
    public readonly addedListeners: ListenerRegistration[] = [];

    /** Captured pointer IDs. */
    public readonly captures = new Set<number>();

    /** Event-listener removals. */
    public readonly removedListeners: ListenerRegistration[] = [];

    /** Active event listeners by event type. */
    readonly #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

    /** Records and installs an event listener. */
    public addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
        if (listener == null) {
            return;
        }
        this.addedListeners.push({ listener, options, type });
        let listeners = this.#listeners.get(type);
        if (listeners == null) {
            listeners = new Set();
            this.#listeners.set(type, listeners);
        }
        listeners.add(listener);
    }

    /** Dispatches an event synchronously to its current listeners. */
    public dispatch(event: Event): void {
        for (const listener of this.#listeners.get(event.type) ?? []) {
            if (typeof listener === "function") {
                listener.call(this, event);
            } else {
                listener.handleEvent(event);
            }
        }
    }

    /** Returns a fixed positioned 400 by 300 CSS-pixel rectangle. */
    public getBoundingClientRect(): DOMRect {
        return {
            bottom: 320,
            height: 300,
            left: 10,
            right: 410,
            toJSON: () => ({}),
            top: 20,
            width: 400,
            x: 10,
            y: 20
        };
    }

    /** Checks whether a pointer is captured. */
    public hasPointerCapture(pointerId: number): boolean {
        return this.captures.has(pointerId);
    }

    /** Records and removes an event listener. */
    public removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
        if (listener == null) {
            return;
        }
        this.removedListeners.push({ listener, options, type });
        this.#listeners.get(type)?.delete(listener);
    }

    /** Releases pointer capture. */
    public releasePointerCapture(pointerId: number): void {
        this.captures.delete(pointerId);
    }

    /** Captures a pointer. */
    public setPointerCapture(pointerId: number): void {
        this.captures.add(pointerId);
    }
}

/** Interaction fixture with a real, unconstrained-at-center camera. */
interface Fixture {
    readonly camera: MapCamera;
    readonly canvas: CanvasMock;
    readonly changes: { count: number };
    readonly events: MapPointerEvent[];
    readonly interaction: MapInteraction;
    readonly wheelEvents: MapWheelEvent[];
}

/**
 * Creates a deterministic interaction fixture.
 *
 * @param handleMapEvent - Optional callback which may cancel enriched map input events before their default map action.
 * @returns Interaction fixture.
 */
function createFixture(handleMapEvent?: (event: MapPointerEvent | MapWheelEvent) => void): Fixture {
    const source = normalizeTileSource({
        maxZoom: 10,
        rootColumns: 4,
        rootRows: 4,
        tileURL: "tiles/{z}/{x}/{y}.png"
    });
    const camera = new MapCamera(source, { x: 0, y: 0 }, 3);
    const canvas = new CanvasMock();
    const changes = { count: 0 };
    const events: MapPointerEvent[] = [];
    const wheelEvents: MapWheelEvent[] = [];
    camera.resize(400, 300);
    return {
        camera,
        canvas,
        changes,
        events,
        interaction: new MapInteraction(
            canvas as unknown as HTMLCanvasElement,
            camera,
            () => ({ x: 400, y: 300 }),
            () => changes.count++,
            event => {
                if (event instanceof WheelEvent) {
                    wheelEvents.push(event);
                } else {
                    events.push(event);
                }
                handleMapEvent?.(event);
                return !event.defaultPrevented;
            }
        ),
        wheelEvents
    };
}

/** Creates a pointer event using viewport coordinates and a deterministic timestamp. */
function createPointerEvent(type: string, pointerId: number, point: Point, timestamp: number, pointerType = "touch", button = 0): PointerEvent {
    const event = new PointerEvent(type, {
        button,
        cancelable: true,
        clientX: point.x + 10,
        clientY: point.y + 20,
        pointerId,
        pointerType
    });
    Object.defineProperty(event, "timeStamp", { value: timestamp });
    return event;
}

/** Creates a wheel event using viewport coordinates and a deterministic timestamp. */
function createWheelEvent(point: Point, deltaY: number, timestamp: number, deltaMode: number = WheelEvent.DOM_DELTA_PIXEL): WheelEvent {
    const event = Object.assign(new WheelEvent("wheel", {
        cancelable: true,
        deltaMode,
        deltaY
    }), {
        // Happy DOM incorrectly derives WheelEvent from UIEvent instead of MouseEvent and ignores these initializer properties.
        clientX: point.x + 10,
        clientY: point.y + 20
    });
    Object.defineProperty(event, "timeStamp", { value: timestamp });
    return event;
}

describe("MapInteraction", () => {
    describe("connect", () => {
        it("installs only modern pointer and wheel listeners without canceling pointer down", () => {
            const { canvas, interaction } = createFixture();

            interaction.connect();
            interaction.connect();

            assertEquals(canvas.addedListeners.map(listener => listener.type), [
                "pointerdown",
                "pointermove",
                "pointerup",
                "pointercancel",
                "lostpointercapture",
                "wheel"
            ]);
            assertEquals(canvas.addedListeners.at(-1)?.options, { passive: false });

            const pointerDown = createPointerEvent("pointerdown", 7, { x: 100, y: 100 }, 10);
            canvas.dispatch(pointerDown);
            assertSame(pointerDown.defaultPrevented, false);
            assertSame(canvas.hasPointerCapture(7), true);
        });
    });

    describe("disconnect", () => {
        it("removes listeners, releases pointers and stops interaction", () => {
            const { camera, canvas, changes, interaction } = createFixture();
            const initialCenter = camera.sourceCenter;
            interaction.connect();
            canvas.dispatch(createPointerEvent("pointerdown", 7, { x: 100, y: 100 }, 10));

            interaction.disconnect();
            interaction.disconnect();

            assertEquals(canvas.removedListeners.map(listener => listener.type), [
                "pointerdown",
                "pointermove",
                "pointerup",
                "pointercancel",
                "lostpointercapture",
                "wheel"
            ]);
            assertSame(canvas.hasPointerCapture(7), false);
            assertSame(interaction.animating, false);

            canvas.dispatch(createPointerEvent("pointerdown", 8, { x: 200, y: 100 }, 20));
            canvas.dispatch(createPointerEvent("pointermove", 8, { x: 250, y: 100 }, 30));
            assertCloseTo(camera.sourceCenter, initialCenter, 10);
            assertSame(changes.count, 0);
        });
    });

    describe("pointer events", () => {
        it("dispatches enriched map events for every pointer before applying built-in interaction", () => {
            const { camera, canvas, changes, events, interaction } = createFixture();
            interaction.connect();
            const viewportPoint = { x: 100, y: 75 };
            const worldPoint = camera.toWorld(viewportPoint);
            const sourcePoint = camera.unproject(viewportPoint);
            const originalEvent = createPointerEvent("pointermove", 7, viewportPoint, 10, "pen");

            canvas.dispatch(originalEvent);

            const event = events[0];
            if (event == null) {
                throw new Error("Expected an enriched map pointer event");
            }
            assertSame(event.type, "map-pointermove");
            assertSame(event.pointerId, 7);
            assertSame(event.pointerType, "pen");
            assertSame(event.originalEvent, originalEvent);
            assertEquals(event.viewportPoint, viewportPoint);
            assertCloseTo(event.worldPoint, worldPoint, 10);
            assertCloseTo(event.sourcePoint, sourcePoint, 10);
            assertSame(event.bubbles, true);
            assertSame(event.cancelable, true);
            assertSame(event.composed, true);
            assertSame(changes.count, 0);
        });

        it("lets a canceled map pointer down claim the complete captured pointer stream", () => {
            const { camera, canvas, changes, events, interaction } = createFixture(event => {
                if (event.type === "map-pointerdown") {
                    event.preventDefault();
                }
            });
            const initialView = { centerX: camera.centerX, centerY: camera.centerY, zoom: camera.zoom };
            interaction.connect();

            canvas.dispatch(createPointerEvent("pointerdown", 3, { x: 100, y: 100 }, 10));
            canvas.dispatch(createPointerEvent("pointermove", 3, { x: 200, y: 150 }, 20));
            canvas.dispatch(createPointerEvent("pointerup", 3, { x: 200, y: 150 }, 30));

            assertEquals(events.map(event => event.type), [ "map-pointerdown", "map-pointermove", "map-pointerup" ]);
            assertSame(canvas.hasPointerCapture(3), true);
            assertCloseTo({ centerX: camera.centerX, centerY: camera.centerY, zoom: camera.zoom }, initialView, 10);
            assertSame(interaction.animating, false);
            assertSame(changes.count, 0);
        });

        it("transitions from pointer pan to anchored pinch and back to pointer pan", () => {
            const { camera, canvas, changes, interaction } = createFixture();
            interaction.connect();

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 100, y: 150 }, 0));
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 140, y: 170 }, 20));
            assertCloseTo(camera.project({ x: 0, y: 0 }), { x: 240, y: 170 }, 10);

            canvas.dispatch(createPointerEvent("pointerdown", 2, { x: 300, y: 170 }, 30));
            const pinchAnchor = camera.toWorld({ x: 220, y: 170 });
            canvas.dispatch(createPointerEvent("pointermove", 2, { x: 460, y: 170 }, 40));

            assertCloseTo(camera.zoom, 4, 10);
            assertCloseTo(camera.toWorld({ x: 300, y: 170 }), pinchAnchor, 10);

            const viewBeforeRelease = { centerX: camera.centerX, centerY: camera.centerY, zoom: camera.zoom };
            canvas.dispatch(createPointerEvent("pointerup", 2, { x: 460, y: 170 }, 50));
            assertCloseTo({ centerX: camera.centerX, centerY: camera.centerY, zoom: camera.zoom }, viewBeforeRelease, 10);
            const centerBeforeSecondPan = { x: camera.centerX, y: camera.centerY };
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 150, y: 180 }, 60));

            assertCloseTo({ x: camera.centerX, y: camera.centerY }, {
                x: centerBeforeSecondPan.x - 10 / 16,
                y: centerBeforeSecondPan.y - 10 / 16
            }, 10);
            assertSame(changes.count, 3);

            canvas.dispatch(createPointerEvent("pointerup", 1, { x: 150, y: 180 }, 500));
            assertSame(interaction.animating, false);
        });

        it("derives every pinch update from the fixed screen-space start distance and zoom", () => {
            const { camera, canvas, changes, interaction } = createFixture();
            interaction.connect();

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 100, y: 150 }, 0));
            canvas.dispatch(createPointerEvent("pointerdown", 2, { x: 300, y: 150 }, 10));
            const anchor = camera.toWorld({ x: 200, y: 150 });
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 80, y: 170 }, 20));
            canvas.dispatch(createPointerEvent("pointermove", 2, { x: 320, y: 170 }, 20));

            assertCloseTo(camera.zoom, 3 + Math.log2(1.2), 10);
            assertCloseTo(camera.toWorld({ x: 200, y: 170 }), anchor, 10);
            assertSame(interaction.animating, false);
            assertSame(changes.count, 2);
        });

        it("keeps a clamped pinch tied to its fixed start distance and zoom", () => {
            const { camera, canvas, interaction } = createFixture();
            interaction.connect();
            camera.setZoom(10);

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 100, y: 150 }, 0));
            canvas.dispatch(createPointerEvent("pointerdown", 2, { x: 300, y: 150 }, 10));
            canvas.dispatch(createPointerEvent("pointermove", 2, { x: 500, y: 150 }, 20));
            assertSame(camera.zoom, 10);

            canvas.dispatch(createPointerEvent("pointermove", 2, { x: 300, y: 150 }, 30));
            assertSame(camera.zoom, 10);

            canvas.dispatch(createPointerEvent("pointermove", 2, { x: 280, y: 150 }, 40));
            assertCloseTo(camera.zoom, 10 + Math.log2(0.9), 10);
        });

        it("ignores release coordinates and does not create momentum when pinch pointers are released at different times", () => {
            const { camera, canvas, changes, interaction } = createFixture();
            interaction.connect();

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 100, y: 150 }, 0));
            canvas.dispatch(createPointerEvent("pointerdown", 2, { x: 300, y: 150 }, 10));
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 80, y: 150 }, 20));
            const viewAfterPinch = { centerX: camera.centerX, centerY: camera.centerY, zoom: camera.zoom };
            const changesAfterPinch = changes.count;

            canvas.dispatch(createPointerEvent("pointerup", 2, { x: 390, y: 40 }, 30));
            assertCloseTo({ centerX: camera.centerX, centerY: camera.centerY, zoom: camera.zoom }, viewAfterPinch, 10);

            canvas.dispatch(createPointerEvent("pointerup", 1, { x: 10, y: 290 }, 500));

            assertSame(interaction.animating, false);
            assertSame(changes.count, changesAfterPinch);
            assertCloseTo({ centerX: camera.centerX, centerY: camera.centerY, zoom: camera.zoom }, viewAfterPinch, 10);
        });

        it("ignores secondary buttons and stops tracking canceled or capture-lost pointers", () => {
            const { camera, canvas, changes, events, interaction } = createFixture();
            interaction.connect();

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 100, y: 100 }, 0, "mouse", 1));
            assertSame(canvas.hasPointerCapture(1), false);

            canvas.dispatch(createPointerEvent("pointerdown", 2, { x: 100, y: 100 }, 10));
            canvas.dispatch(createPointerEvent("pointermove", 2, { x: 120, y: 100 }, 20));
            const centerAfterMove = camera.sourceCenter;
            canvas.dispatch(createPointerEvent("pointercancel", 2, { x: 120, y: 100 }, 30));
            canvas.dispatch(createPointerEvent("pointermove", 2, { x: 180, y: 100 }, 40));
            assertCloseTo(camera.sourceCenter, centerAfterMove, 10);

            canvas.dispatch(createPointerEvent("pointerdown", 3, { x: 200, y: 100 }, 50));
            canvas.dispatch(createPointerEvent("lostpointercapture", 3, { x: 200, y: 100 }, 60));
            canvas.dispatch(createPointerEvent("pointermove", 3, { x: 250, y: 100 }, 70));

            assertCloseTo(camera.sourceCenter, centerAfterMove, 10);
            assertSame(changes.count, 1);
            assertSame(events.some(event => event.type === "map-pointercancel"), true);
        });

        it("continues panning from a canceled pointer-move position without deriving momentum from it", () => {
            const { camera, canvas, changes, interaction } = createFixture(event => {
                if (event.type === "map-pointermove" && event.viewportPoint.x === 150) {
                    event.preventDefault();
                }
            });
            const initialCenterX = camera.centerX;
            interaction.connect();

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 100, y: 100 }, 0));
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 150, y: 100 }, 20));
            assertSame(camera.centerX, initialCenterX);
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 160, y: 100 }, 30));
            assertCloseTo(camera.centerX, initialCenterX - 10 / 8, 10);
            canvas.dispatch(createPointerEvent("pointerup", 1, { x: 160, y: 100 }, 500));

            assertSame(changes.count, 1);
            assertSame(interaction.animating, false);
        });
    });

    describe("wheel events", () => {
        it("dispatches an enriched map event before applying built-in zoom", () => {
            const { camera, canvas, changes, interaction, wheelEvents } = createFixture();
            interaction.connect();
            const viewportPoint = { x: 100, y: 75 };
            const worldPoint = camera.toWorld(viewportPoint);
            const sourcePoint = camera.unproject(viewportPoint);
            const originalEvent = createWheelEvent(viewportPoint, -100, 100);

            canvas.dispatch(originalEvent);

            const event = wheelEvents[0];
            if (event == null) {
                throw new Error("Expected an enriched map wheel event");
            }
            assertSame(event.type, "map-wheel");
            assertSame(event.deltaY, -100);
            assertSame(event.originalEvent, originalEvent);
            assertEquals(event.viewportPoint, viewportPoint);
            assertCloseTo(event.worldPoint, worldPoint, 10);
            assertCloseTo(event.sourcePoint, sourcePoint, 10);
            assertSame(event.bubbles, true);
            assertSame(event.cancelable, true);
            assertSame(event.composed, true);
            assertSame(changes.count, 1);
        });

        it("does not zoom when the enriched event is canceled", () => {
            const { canvas, changes, interaction, wheelEvents } = createFixture(event => {
                if (event instanceof WheelEvent) {
                    event.preventDefault();
                }
            });
            interaction.connect();
            const originalEvent = createWheelEvent({ x: 100, y: 75 }, -100, 100);

            canvas.dispatch(originalEvent);

            assertSame(wheelEvents.length, 1);
            assertSame(interaction.animating, false);
            assertSame(changes.count, 0);
            assertSame(originalEvent.defaultPrevented, false);
        });

        it("animates and retargets wheel zoom while preserving its screen anchor", () => {
            const { camera, canvas, changes, interaction } = createFixture();
            const anchor = { x: 100, y: 75 };
            interaction.connect();
            const anchorWorld = camera.toWorld(anchor);

            const firstWheel = createWheelEvent(anchor, -100, 100);
            canvas.dispatch(firstWheel);

            assertSame(firstWheel.defaultPrevented, true);
            assertSame(interaction.animating, true);
            assertSame(interaction.targetView?.zoom ?? null, 4);
            assertSame(changes.count, 1);

            interaction.advance(135);
            assertCloseTo(camera.zoom, 3.221199216928595, 10);
            assertCloseTo(camera.toWorld(anchor), anchorWorld, 10);

            const secondWheel = createWheelEvent(anchor, -100, 140);
            canvas.dispatch(secondWheel);
            assertSame(interaction.targetView?.zoom ?? null, 5);
            assertSame(changes.count, 2);

            let timestamp = 140;
            for (let frame = 0; frame < 100 && interaction.animating; frame++) {
                timestamp += 16;
                interaction.advance(timestamp);
                assertCloseTo(camera.toWorld(anchor), anchorWorld, 10);
            }

            assertSame(interaction.animating, false);
            assertSame(interaction.targetView?.zoom ?? null, null);
            assertSame(camera.zoom, 5);

            const idleZoom = camera.zoom;
            interaction.advance(timestamp + 16);
            assertSame(camera.zoom, idleZoom);
            assertSame(changes.count, 2);

            const zeroWheel = createWheelEvent(anchor, 0, timestamp + 20);
            canvas.dispatch(zeroWheel);
            assertSame(zeroWheel.defaultPrevented, false);
            assertSame(interaction.animating, false);
            assertSame(changes.count, 2);
        });

        it("normalizes pixel, line and page deltas", () => {
            const { canvas, interaction } = createFixture();
            interaction.connect();

            canvas.dispatch(createWheelEvent({ x: 200, y: 150 }, -25, 100));
            assertSame(interaction.targetView?.zoom ?? null, 3.25);
            interaction.stop();

            canvas.dispatch(createWheelEvent({ x: 200, y: 150 }, -3, 200, WheelEvent.DOM_DELTA_LINE));
            assertSame(interaction.targetView?.zoom ?? null, 4);
            interaction.stop();

            canvas.dispatch(createWheelEvent({ x: 200, y: 150 }, 1, 300, WheelEvent.DOM_DELTA_PAGE));
            assertSame(interaction.targetView?.zoom ?? null, 2);
        });
    });

    describe("transitionTo", () => {
        it("animates a complete camera transition and exposes its destination", () => {
            const { camera, changes, interaction } = createFixture();
            const start = { centerX: camera.centerX, centerY: camera.centerY, zoom: camera.zoom };
            const target = { centerX: 700, centerY: 600, zoom: 5 };

            interaction.transitionTo(target);

            assertSame(interaction.animating, true);
            assertSame(interaction.targetView?.zoom ?? null, 5);
            assertEquals(interaction.targetView, target);
            assertSame(changes.count, 1);

            interaction.advance(performance.now() + 300);
            assertSame(camera.centerX > start.centerX && camera.centerX < target.centerX, true);
            assertSame(camera.centerY > start.centerY && camera.centerY < target.centerY, true);
            assertSame(camera.zoom > start.zoom && camera.zoom < target.zoom, true);
            assertSame(camera.zoom > start.zoom + (target.zoom - start.zoom) * 0.9, true);

            interaction.advance(performance.now() + 600);
            assertSame(interaction.animating, false);
            assertSame(interaction.targetView, null);
            assertCloseTo({ centerX: camera.centerX, centerY: camera.centerY, zoom: camera.zoom }, target, 10);
        });

        it("applies an already reached destination without starting an animation", () => {
            const { camera, changes, interaction } = createFixture();
            const target = { centerX: camera.centerX, centerY: camera.centerY, zoom: camera.zoom };

            interaction.transitionTo(target);

            assertSame(interaction.animating, false);
            assertSame(interaction.targetView, null);
            assertCloseTo({ centerX: camera.centerX, centerY: camera.centerY, zoom: camera.zoom }, target, 10);
            assertSame(changes.count, 1);
        });
    });

    describe("targetView", () => {
        it("snaps full wheel steps from a fractional camera zoom to integer levels", () => {
            const { camera, canvas, interaction } = createFixture();
            interaction.connect();
            camera.setZoom(3.25);

            canvas.dispatch(createWheelEvent({ x: 200, y: 150 }, -100, 100));
            assertSame(interaction.targetView?.zoom ?? null, 4);
            interaction.stop();

            canvas.dispatch(createWheelEvent({ x: 200, y: 150 }, 100, 200));
            assertSame(interaction.targetView?.zoom ?? null, 3);
        });

        it("reconciles an active wheel destination with a raised viewport minimum", () => {
            const { camera, canvas, interaction } = createFixture();
            interaction.connect();

            canvas.dispatch(createWheelEvent({ x: 200, y: 150 }, 100, 100));
            assertSame(interaction.targetView?.zoom ?? null, 2);
            camera.resize(16_384, 16_384);
            assertSame(camera.zoom, 4);

            interaction.advance(116);

            assertSame(camera.zoom, 4);
            assertSame(interaction.animating, false);
        });
    });

    describe("advance", () => {
        it("continues a released pointer pan with time-based momentum until idle", () => {
            const { camera, canvas, changes, interaction } = createFixture();
            interaction.connect();

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 100, y: 100 }, 0));
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 120, y: 100 }, 40));
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 160, y: 100 }, 80));
            canvas.dispatch(createPointerEvent("pointerup", 1, { x: 160, y: 100 }, 100));

            const centerAfterRelease = camera.centerX;
            assertSame(interaction.animating, true);
            assertSame(changes.count, 3);

            interaction.advance(116);
            assertSame(camera.centerX < centerAfterRelease, true);
            assertSame(camera.centerY, 512);

            const centerAfterFirstFrame = camera.centerX;
            interaction.advance(116);
            assertSame(camera.centerX, centerAfterFirstFrame);

            let timestamp = 116;
            for (let frame = 0; frame < 100 && interaction.animating; frame++) {
                timestamp += 16;
                interaction.advance(timestamp);
            }

            assertSame(interaction.animating, false);
            const idleCenter = camera.centerX;
            interaction.advance(timestamp + 16);
            assertSame(camera.centerX, idleCenter);
            assertSame(changes.count, 3);
        });

        it("integrates momentum across a long frame pause", () => {
            const { camera, canvas, interaction } = createFixture();
            interaction.connect();

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 100, y: 100 }, 0));
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 160, y: 100 }, 80));
            canvas.dispatch(createPointerEvent("pointerup", 1, { x: 160, y: 100 }, 100));
            const centerAfterRelease = camera.centerX;

            interaction.advance(1_100);

            assertSame(camera.centerX < centerAfterRelease, true);
            assertSame(interaction.animating, false);
        });

        it("does not reuse stale movement after the pointer was held still", () => {
            const { canvas, interaction } = createFixture();
            interaction.connect();

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 100, y: 100 }, 0));
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 350, y: 100 }, 20));
            canvas.dispatch(createPointerEvent("pointerup", 1, { x: 350, y: 100 }, 1_000));

            assertSame(interaction.animating, false);
        });

        it("remains idle after direct manipulation without release velocity", () => {
            const { camera, canvas, changes, interaction } = createFixture();
            interaction.connect();
            const initialCenter = camera.sourceCenter;

            interaction.advance(1_000);
            assertSame(interaction.animating, false);
            assertSame(changes.count, 0);

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 200, y: 150 }, 1_100));
            canvas.dispatch(createPointerEvent("pointerup", 1, { x: 200, y: 150 }, 1_300));

            assertSame(interaction.animating, false);
            assertCloseTo(camera.sourceCenter, initialCenter, 10);
            assertSame(changes.count, 0);

            interaction.advance(2_000);
            assertSame(interaction.animating, false);
            assertCloseTo(camera.sourceCenter, initialCenter, 10);
            assertSame(changes.count, 0);
        });

        it("rejects slow release velocity", () => {
            const { canvas, interaction } = createFixture();
            interaction.connect();

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 100, y: 100 }, 0));
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 101, y: 100 }, 100));
            canvas.dispatch(createPointerEvent("pointerup", 1, { x: 101, y: 100 }, 100));

            assertSame(interaction.animating, false);
        });

        it("caps excessive release velocity", () => {
            const { camera, canvas, interaction } = createFixture();
            interaction.connect();

            canvas.dispatch(createPointerEvent("pointerdown", 1, { x: 100, y: 100 }, 0));
            canvas.dispatch(createPointerEvent("pointermove", 1, { x: 400, y: 100 }, 10));
            canvas.dispatch(createPointerEvent("pointerup", 1, { x: 400, y: 100 }, 10));
            const centerAfterRelease = camera.centerX;
            interaction.advance(11);

            const expectedDistance = 3 * (1 - Math.exp(-0.004)) / 0.004 / 8;
            assertCloseTo(centerAfterRelease - camera.centerX, expectedDistance, 10);
        });
    });
});
