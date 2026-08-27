/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import {
    ResizeObserverMock,
    animationFrames,
    canceledAnimationFrames,
    resetAnimationFrames,
    runAnimationFrame,
    setCanvasContext,
    setDevicePixelRatio
} from "./dom.ts";
import { describe, it } from "node:test";
import { assertCloseTo, assertEquals, assertInstanceOf, assertNotSame, assertSame, assertThrowWithMessage, assertTrue } from "@kayahr/assert";

const calls: Array<{ name: string; values: unknown[] }> = [];
const context = {
    beginPath: (): void => {},
    clearRect: (...values: unknown[]): void => { calls.push({ name: "clearRect", values }); },
    clip: (): void => {},
    drawImage: (...values: unknown[]): void => { calls.push({ name: "drawImage", values }); },
    rect: (): void => {},
    restore: (): void => { calls.push({ name: "restore", values: [] }); },
    save: (): void => { calls.push({ name: "save", values: [] }); },
    setTransform: (...values: unknown[]): void => { calls.push({ name: "setTransform", values }); },
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    lineWidth: 0,
    strokeStyle: ""
};

setDevicePixelRatio(2);
setCanvasContext(context as unknown as CanvasRenderingContext2D);

const { LinearProjection, MapComponent } = await import("../main/index.ts");

function createComponent(): InstanceType<typeof MapComponent> {
    return new MapComponent();
}

describe("MapComponent", () => {
    describe("constructor", () => {
        it("owns a dedicated map element", () => {
            const first = createComponent();
            const second = createComponent();

            assertNotSame(first.getElement(), second.getElement());
            assertSame(first.getElement().getComponent(), first);
            assertSame(second.getElement().getComponent(), second);
        });
    });

    describe("pointer events", () => {
        it("dispatches typed map pointer events from its map element", () => {
            const component = createComponent();
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 400, height: 300 },
                devicePixelContentBoxSize: [ { inlineSize: 800, blockSize: 600 } ]
            });
            const canvas = element.shadowRoot?.querySelector("canvas");
            assertInstanceOf(canvas, HTMLCanvasElement);
            canvas.getBoundingClientRect = (): DOMRect => new DOMRect(10, 20, 400, 300);
            const events: Array<HTMLElementEventMap["map-pointermove"]> = [];
            element.addEventListener("map-pointermove", event => events.push(event));
            const originalEvent = new PointerEvent("pointermove", {
                clientX: 110,
                clientY: 95,
                pointerId: 7,
                pointerType: "pen"
            });
            const expectedSourcePoint = component.unproject({ x: 100, y: 75 });

            element.dispatchEvent(originalEvent);

            const received = events[0];
            if (received == null) {
                throw new Error("Expected a map pointer event");
            }
            assertSame(received.originalEvent, originalEvent);
            assertEquals(received.viewportPoint, { x: 100, y: 75 });
            assertCloseTo(received.sourcePoint, expectedSourcePoint, 10);
            element.remove();
        });

        it("receives pointer events which bubble from non-interactive overlays", () => {
            const component = createComponent();
            const element = component.getElement();
            const marker = document.createElement("div");
            element.append(marker);
            document.body.append(element);
            const events: Array<HTMLElementEventMap["map-pointermove"]> = [];
            element.addEventListener("map-pointermove", event => events.push(event));

            marker.dispatchEvent(new PointerEvent("pointermove", {
                bubbles: true,
                clientX: 40,
                clientY: 30,
                composed: true,
                pointerId: 7,
                pointerType: "touch"
            }));

            assertSame(events.length, 1);
            element.remove();
        });

        it("lets overlays stop pointer events before they reach the map", () => {
            const component = createComponent();
            const element = component.getElement();
            const marker = document.createElement("a");
            marker.addEventListener("pointerdown", event => event.stopPropagation());
            element.append(marker);
            document.body.append(element);
            const events: Array<HTMLElementEventMap["map-pointerdown"]> = [];
            element.addEventListener("map-pointerdown", event => events.push(event));

            marker.dispatchEvent(new PointerEvent("pointerdown", {
                bubbles: true,
                composed: true,
                pointerId: 7,
                pointerType: "touch"
            }));

            assertSame(events.length, 0);
            element.remove();
        });
    });

    describe("wheel events", () => {
        it("zooms from wheel events which bubble from interactive overlays", () => {
            resetAnimationFrames();
            const component = createComponent();
            const element = component.getElement();
            const marker = document.createElement("a");
            marker.href = "https://example.com";
            element.append(marker);
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 400, height: 300 },
                devicePixelContentBoxSize: [ { inlineSize: 800, blockSize: 600 } ]
            });
            const canvas = element.shadowRoot?.querySelector("canvas");
            assertInstanceOf(canvas, HTMLCanvasElement);
            canvas.getBoundingClientRect = (): DOMRect => new DOMRect(10, 20, 400, 300);
            const events: Array<HTMLElementEventMap["map-wheel"]> = [];
            element.addEventListener("map-wheel", event => events.push(event));
            const originalEvent = Object.assign(new WheelEvent("wheel", {
                bubbles: true,
                cancelable: true,
                composed: true,
                deltaY: -100
            }), {
                clientX: 110,
                clientY: 95
            });

            marker.dispatchEvent(originalEvent);

            assertSame(events.length, 1);
            assertEquals(events[0]?.viewportPoint, { x: 100, y: 75 });
            assertSame(originalEvent.defaultPrevented, true);
            element.remove();
        });
    });

    describe("center", () => {
        it("uses the projected world center by default", () => {
            const component = new MapComponent({
                source: {
                    projection: new LinearProjection({ bottom: -200, left: 100, right: 500, top: 200 }),
                    tileURL: "https://example.com/{z}/{x}/{y}.png"
                }
            });

            assertEquals(component.center, { x: 300, y: 0 });
        });

        it("uses the tile-coverage center by default", () => {
            const component = new MapComponent({
                source: {
                    coverage: { bottom: 111_000 / 131_072, left: 0, right: 81_920 / 98_304, top: 9_000 / 131_072 },
                    projection: new LinearProjection({ bottom: 131_072, left: 0, right: 98_304, top: 0 }),
                    rootColumns: 3,
                    rootRows: 4,
                    tileURL: "https://example.com/{z}/{x}/{y}.png"
                }
            });

            assertEquals(component.center, { x: 40_960, y: 60_000 });
            component.center = { x: 20_000, y: 30_000 };
            component.center = null;
            assertEquals(component.center, { x: 40_960, y: 60_000 });
            component.setView(null, 4);
            assertEquals(component.center, { x: 40_960, y: 60_000 });
            assertSame(component.zoom, 4);
        });
    });

    describe("resize", () => {
        it("draws with a uniform CSS-pixel scale at the exact device-pixel size", () => {
            calls.length = 0;
            const component = createComponent();
            const element = component.getElement();
            document.body.append(element);

            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            assertSame(observer.observations.length, 1);
            assertSame(observer.observations[0]?.options?.box, "device-pixel-content-box");

            observer.trigger({
                contentRect: { width: 123.4, height: 45.6 },
                devicePixelContentBoxSize: [ { inlineSize: 247, blockSize: 91 } ]
            });

            assertSame(component.width, 123.5);
            assertSame(component.height, 45.5);
            assertSame(component.nativeWidth, 247);
            assertSame(component.nativeHeight, 91);
            assertSame(component.devicePixelRatio, 2);
            assertEquals(calls.slice(0, 2), [
                { name: "setTransform", values: [ 2, 0, 0, 2, 0, 0 ] },
                { name: "clearRect", values: [ 0, 0, 123.5, 45.5 ] }
            ]);
            assertSame(calls.at(-1)?.name, "drawImage");

            element.remove();
            assertSame(observer.disconnected, true);
        });

        it("selects the automatic zoom synchronously when the viewport grows", () => {
            const component = createComponent();
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);

            observer.trigger({
                contentRect: { width: 2_560, height: 1_440 },
                devicePixelContentBoxSize: [ { inlineSize: 5_120, blockSize: 2_880 } ]
            });

            assertCloseTo(component.zoom, Math.log2(1_440 / 256) + 1, 10);
            element.remove();
        });

        it("keeps an explicit zoom at the viewport-cover minimum", () => {
            const component = new MapComponent({ zoom: 0 });
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);

            observer.trigger({
                contentRect: { width: 2_560, height: 1_440 },
                devicePixelContentBoxSize: [ { inlineSize: 5_120, blockSize: 2_880 } ]
            });

            assertCloseTo(component.zoom, Math.log2(1_440 / 256), 10);
            element.remove();
        });
    });

    describe("attribution", () => {
        it("stays at the bottom-right corner of the visible tile coverage", () => {
            const component = new MapComponent({
                center: { x: 0, y: 0 },
                coverViewport: false,
                minZoom: -2,
                source: {
                    attribution: "Example Maps",
                    projection: new LinearProjection(),
                    tileHeight: 100,
                    tileURL: "https://example.com/{z}/{x}/{y}.png",
                    tileWidth: 100
                },
                zoom: 0
            });
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);

            observer.trigger({
                contentRect: { width: 500, height: 500 },
                devicePixelContentBoxSize: [ { inlineSize: 1_000, blockSize: 1_000 } ]
            });

            const attribution = element.shadowRoot?.querySelector(".attribution");
            assertInstanceOf(attribution, HTMLDivElement);
            assertSame(attribution.style.right, "150px");
            assertSame(attribution.style.bottom, "150px");
            element.remove();
        });
    });

    describe("setZoomRange", () => {
        it("uses view limits independently of native tile LOD", () => {
            const component = new MapComponent({ coverViewport: false, maxZoom: 21, minZoom: -2, zoom: -1 });
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);

            observer.trigger({
                contentRect: { width: 2_560, height: 1_440 },
                devicePixelContentBoxSize: [ { inlineSize: 5_120, blockSize: 2_880 } ]
            });

            assertSame(component.source.minZoom, 0);
            assertSame(component.source.maxZoom, 19);
            assertSame(component.minZoom, -2);
            assertSame(component.maxZoom, 21);
            assertSame(component.coverViewport, false);
            assertSame(component.zoom, -1);

            component.zoom = 20;
            assertSame(component.zoom, 20);
            component.setZoomRange(null, null);
            assertSame(component.minZoom, 0);
            assertSame(component.maxZoom, 19);
            assertSame(component.zoom, 19);
            component.coverViewport = true;
            assertSame(component.coverViewport, true);
            element.remove();
        });
    });

    describe("fitPoints", () => {
        it("fits points into the viewport with a proportional default margin and zoom constraints", () => {
            const component = new MapComponent({
                coverViewport: false,
                maxZoom: 10,
                minZoom: -10,
                source: {
                    projection: new LinearProjection(),
                    tileHeight: 100,
                    tileURL: "https://example.com/{z}/{x}/{y}.png",
                    tileWidth: 100
                }
            });
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 500, height: 500 },
                devicePixelContentBoxSize: [ { inlineSize: 1_000, blockSize: 1_000 } ]
            });
            const points = [ { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 } ];

            component.fitPoints(points);

            assertCloseTo(component.center, { x: 0.5, y: 0.5 }, 10);
            assertCloseTo(component.zoom, Math.log2(9), 10);
            assertCloseTo(component.projectPoint(points[0]), { x: 25, y: 25 }, 10);
            assertCloseTo(component.projectPoint(points[1]), { x: 475, y: 475 }, 10);

            component.fitPoints(points, { margin: 50 });
            assertSame(component.zoom, 3);
            assertCloseTo(component.projectPoint(points[0]), { x: 50, y: 50 }, 10);
            assertCloseTo(component.projectPoint(points[1]), { x: 450, y: 450 }, 10);

            component.setZoomRange(-10, 2);
            component.fitPoints([ { x: 0.5, y: 0.5 } ]);
            assertSame(component.zoom, 2);

            component.setZoomRange(4, 10);
            component.fitPoints(points, { margin: 50 });
            assertSame(component.zoom, 4);

            component.setZoomRange(-10, 10);
            component.fitPoints([ { x: 0.5, y: 0.5 } ], { maxZoom: 6 });
            assertSame(component.zoom, 6);

            assertThrowWithMessage(() => component.fitPoints([]), RangeError, "points must not be empty");
            assertThrowWithMessage(() => component.fitPoints(points, { margin: -1 }), RangeError, "margin must not be negative");
            assertThrowWithMessage(() => component.fitPoints(points, { margin: 250 }), RangeError,
                "margin must be less than half the viewport width and height");
            element.remove();
        });

        it("optionally animates a fitted view", () => {
            resetAnimationFrames();
            const component = new MapComponent({ coverViewport: false, maxZoom: 10, minZoom: -10, zoom: 3 });
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 500, height: 500 },
                devicePixelContentBoxSize: [ { inlineSize: 1_000, blockSize: 1_000 } ]
            });
            const start = component.center;

            component.fitPoints([ { x: 90, y: 40 } ], { animated: true, maxZoom: 6 });

            assertEquals(component.center, start);
            assertSame(component.zoom, 3);
            assertSame(animationFrames.size, 1);
            runAnimationFrame(performance.now() + 1_000);
            assertCloseTo(component.center, { x: 90, y: 40 }, 10);
            assertSame(component.zoom, 6);
            assertSame(animationFrames.size, 0);
            element.remove();
        });

        it("fits the shortest horizontal span of a wrapping source", () => {
            const component = new MapComponent({
                coverViewport: false,
                maxZoom: 10,
                minZoom: -10,
                source: {
                    projection: new LinearProjection(),
                    tileHeight: 100,
                    tileURL: "https://example.com/{z}/{x}/{y}.png",
                    tileWidth: 100,
                    wrapX: true
                }
            });
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 100, height: 100 },
                devicePixelContentBoxSize: [ { inlineSize: 200, blockSize: 200 } ]
            });

            component.fitPoints([ { x: 0.99, y: 0.5 }, { x: 0.01, y: 0.5 } ]);

            assertCloseTo(component.center, { x: 0, y: 0.5 }, 10);
            assertCloseTo(component.zoom, Math.log2(45), 10);
            assertCloseTo(component.projectPoint({ x: 0.99, y: 0.5 }), { x: 5, y: 50 }, 10);
            assertCloseTo(component.projectPoint({ x: 0.01, y: 0.5 }), { x: 95, y: 50 }, 10);
            element.remove();
        });
    });

    describe("onDraw", () => {
        it("invokes onDraw with the context and map", () => {
            const component = createComponent();
            const element = component.getElement();
            let drawnContext: CanvasRenderingContext2D | null = null;
            let drawnMap: InstanceType<typeof MapComponent> | null = null;
            const onDraw = (valueContext: CanvasRenderingContext2D, map: InstanceType<typeof MapComponent>): void => {
                drawnContext = valueContext;
                drawnMap = map;
            };
            component.onDraw = onDraw;
            assertSame(component.onDraw, onDraw);
            document.body.append(element);

            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 100, height: 50 },
                devicePixelContentBoxSize: [ { inlineSize: 200, blockSize: 100 } ]
            });

            assertSame(drawnContext, context);
            assertSame(drawnMap, component);
            element.remove();
        });

        it("keeps drawing while onDraw returns true", () => {
            resetAnimationFrames();
            const component = createComponent();
            const element = component.getElement();
            let draws = 0;
            component.onDraw = (): true | false => ++draws < 3;
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);

            observer.trigger({
                contentRect: { width: 100, height: 50 },
                devicePixelContentBoxSize: [ { inlineSize: 200, blockSize: 100 } ]
            });

            assertSame(draws, 1);
            assertSame(animationFrames.size, 1);
            for (const timestamp of [ 10, 20 ]) {
                runAnimationFrame(timestamp);
            }
            assertSame(draws, 3);
            assertSame(animationFrames.size, 0);
            element.remove();
        });
    });

    describe("projection helpers", () => {
        it("projects points and clips offscreen positions along their viewport direction", () => {
            const component = new MapComponent({
                center: { x: 0.5, y: 0.5 },
                source: {
                    projection: new LinearProjection(),
                    tileURL: "https://example.com/{z}/{x}/{y}.png"
                },
                zoom: 0
            });
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 100, height: 80 },
                devicePixelContentBoxSize: [ { inlineSize: 200, blockSize: 160 } ]
            });

            assertEquals(component.projectPoint({ x: 0.5, y: 0.5 }, { margin: -10 }), {
                x: 50,
                y: 40
            });
            assertCloseTo(component.projectPoint({ x: 1, y: 0.6 }, { margin: -10 }), {
                clippedX: 90,
                clippedY: 48,
                x: 178,
                y: 65.6
            }, 10);
            assertEquals(component.projectPolyline([ { x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 } ], { interpolation: "projected", margin: -10 }), [
                [ { x: 10, y: 40 }, { x: 90, y: 40 } ]
            ]);

            element.remove();
        });

        it("projects every visible horizontal world copy of points, polylines and polygons", () => {
            const component = new MapComponent({
                center: { x: 0.5, y: 0.5 },
                source: {
                    projection: new LinearProjection(),
                    tileHeight: 100,
                    tileURL: "https://example.com/{z}/{x}/{y}.png",
                    tileWidth: 100,
                    wrapX: true
                },
                zoom: 0
            });
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 300, height: 80 },
                devicePixelContentBoxSize: [ { inlineSize: 600, blockSize: 160 } ]
            });

            assertEquals(component.projectPoint({ x: 0.5, y: 0.5 }), {
                x: 150,
                y: 40
            });
            assertEquals(component.projectPoint({ x: 0.5, y: 0.5 }, { margin: -10, wrapCopies: true }), [
                { x: 50, y: 40 },
                { x: 150, y: 40 },
                { x: 250, y: 40 }
            ]);
            assertEquals(component.projectPoint({ x: 0.5, y: 1 }, { margin: -10, wrapCopies: true }), []);
            assertEquals(component.projectPolyline([ { x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 } ], { interpolation: "projected", margin: -10 }), [
                [ { x: 40, y: 40 }, { x: 60, y: 40 } ],
                [ { x: 140, y: 40 }, { x: 160, y: 40 } ],
                [ { x: 240, y: 40 }, { x: 260, y: 40 } ]
            ]);
            assertEquals(component.projectPolygon([
                { x: 0.4, y: 0.4 },
                { x: 0.6, y: 0.4 },
                { x: 0.6, y: 0.6 },
                { x: 0.4, y: 0.6 }
            ], { interpolation: "projected", margin: -10 }), [
                [ { x: 40, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 50 }, { x: 40, y: 50 } ],
                [ { x: 140, y: 30 }, { x: 160, y: 30 }, { x: 160, y: 50 }, { x: 140, y: 50 } ],
                [ { x: 240, y: 30 }, { x: 260, y: 30 }, { x: 260, y: 50 }, { x: 240, y: 50 } ]
            ]);

            element.remove();
        });

        it("never extends path clipping beyond the finite tile world", () => {
            const component = new MapComponent({
                center: { x: 0.5, y: 0.5 },
                source: {
                    projection: new LinearProjection(),
                    tileHeight: 100,
                    tileURL: "https://example.com/{z}/{x}/{y}.png",
                    tileWidth: 100,
                    wrapX: true
                },
                zoom: 0
            });
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 100, height: 300 },
                devicePixelContentBoxSize: [ { inlineSize: 200, blockSize: 600 } ]
            });

            assertEquals(component.projectPoint({ x: 0.5, y: -0.1 }, { margin: 100, wrapCopies: true }), []);
            assertEquals(component.projectPolyline([
                { x: 0.4, y: -0.5 },
                { x: 0.6, y: 0.5 }
            ], { interpolation: "projected", margin: 100 }), [ [
                { x: 50, y: 0 },
                { x: 80, y: 150 }
            ] ]);
            element.remove();
        });

        it("clips polar great-circle routes without following the Web Mercator tile edge", () => {
            const component = new MapComponent({ center: { x: 0, y: 0 }, zoom: 0 });
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 200, height: 600 },
                devicePixelContentBoxSize: [ { inlineSize: 400, blockSize: 1_200 } ]
            });

            const mapTop = 0;
            const lines = component.projectPolyline([ { x: -90, y: 60 }, { x: 90, y: 60 } ], { margin: 100 });
            assertTrue(lines.length >= 2);
            for (const line of lines) {
                assertTrue(line.every(point => point.y >= mapTop));
                for (let index = 1; index < line.length; ++index) {
                    const start = line[index - 1];
                    const end = line[index];
                    assertTrue(start.y !== mapTop || end.y !== mapTop || start.x === end.x);
                }
            }
            element.remove();
        });

        it("naturally interpolates Web Mercator polylines and polygons by default", () => {
            const component = createComponent();
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 256, height: 256 },
                devicePixelContentBoxSize: [ { inlineSize: 512, blockSize: 512 } ]
            });

            const points = [ { x: -74.006, y: 40.7128 }, { x: -0.1276, y: 51.5072 } ];
            const lines = component.projectPolyline(points);
            const projectedLines = component.projectPolyline(points, { interpolation: "projected" });
            const polygons = component.projectPolygon([ ...points, { x: 18.4241, y: -33.9249 } ]);
            const projectedPolygons = component.projectPolygon([ ...points, { x: 18.4241, y: -33.9249 } ], { interpolation: "projected" });

            assertSame(lines.length, 1);
            assertTrue(lines[0].length > 2);
            assertTrue(Math.min(...lines[0].map(point => point.y)) < Math.min(lines[0][0].y, lines[0].at(-1)?.y ?? Number.POSITIVE_INFINITY));
            assertSame(projectedLines.length, 1);
            assertSame(projectedLines[0].length, 2);
            assertSame(polygons.length, 1);
            assertSame(projectedPolygons.length, 1);
            assertTrue(polygons[0].length > projectedPolygons[0].length);
            assertSame(projectedPolygons[0].length, 3);
            element.remove();
        });

        it("preserves a natural polygon containing the viewport while its edges are far outside", () => {
            const component = new MapComponent({ center: { x: 6.9603, y: 50.9375 }, zoom: 19 });
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 100, height: 80 },
                devicePixelContentBoxSize: [ { inlineSize: 200, blockSize: 160 } ]
            });

            const polygon = component.projectPolygon([
                { x: -74.006, y: 40.7128 },
                { x: 2.3522, y: 48.8566 },
                { x: -0.1276, y: 51.5072 },
                { x: 13.405, y: 52.52 },
                { x: 12.4964, y: 41.9028 },
                { x: 18.4241, y: -33.9249 }
            ], { margin: -10 });

            assertEquals(polygon, [ [
                { x: 90, y: 10 },
                { x: 90, y: 70 },
                { x: 10, y: 70 },
                { x: 10, y: 10 }
            ] ]);
            element.remove();
        });
    });

    describe("invalidate", () => {
        it("combines invalidations into a single asynchronous redraw", () => {
            const component = createComponent();
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            observer.trigger({
                contentRect: { width: 100, height: 50 },
                devicePixelContentBoxSize: [ { inlineSize: 200, blockSize: 100 } ]
            });
            calls.length = 0;
            resetAnimationFrames();

            component.invalidate();
            component.invalidate();

            assertSame(animationFrames.size, 1);
            assertSame(calls.length, 0);
            runAnimationFrame(42);

            assertSame(animationFrames.size, 0);
            assertSame(calls.length, 3);
            assertSame(calls.at(-1)?.name, "drawImage");

            component.invalidate();
            assertSame(animationFrames.size, 1);
            const scheduledFrame = animationFrames.keys().next().value;
            assertSame(typeof scheduledFrame, "number");
            element.remove();
            assertEquals(canceledAnimationFrames, [ scheduledFrame ]);
            assertSame(animationFrames.size, 0);
        });

        it("draws synchronously on resize and cancels a scheduled redraw", () => {
            const component = createComponent();
            const element = component.getElement();
            document.body.append(element);
            const observer = ResizeObserverMock.instances.at(-1);
            assertInstanceOf(observer, ResizeObserverMock);
            calls.length = 0;
            resetAnimationFrames();

            component.invalidate();
            const scheduledFrame = animationFrames.keys().next().value;
            assertSame(typeof scheduledFrame, "number");

            observer.trigger({
                contentRect: { width: 120, height: 80 },
                devicePixelContentBoxSize: [ { inlineSize: 240, blockSize: 160 } ]
            });

            assertEquals(canceledAnimationFrames, [ scheduledFrame ]);
            assertSame(animationFrames.size, 0);
            assertSame(calls.length, 5);
            assertSame(calls.at(-1)?.name, "drawImage");
            element.remove();
        });
    });
});
