/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from "node:test";
import { assertCloseTo, assertEquals, assertSame, assertThrowWithMessage, assertTrue } from "@kayahr/assert";
import { Bounds } from "../main/Bounds.ts";
import { squaredDistanceToSegment } from "../main/Point.ts";
import { MapCamera } from "../main/MapCamera.ts";
import { LinearProjection } from "../main/projections/LinearProjection.ts";
import { type NormalizedTileSource, type TileSource, normalizeTileSource } from "../main/TileSource.ts";

/** Creates a normalized custom tile source for camera tests. */
function createSource(options: Partial<TileSource> = {}): Readonly<NormalizedTileSource> {
    return normalizeTileSource({ tileURL: "tiles/{z}/{x}/{y}.png", ...options });
}

describe("MapCamera", () => {
    describe("constructor", () => {
        it("rejects inverted zoom limits", () => {
            const source = createSource();

            assertThrowWithMessage(() => new MapCamera(source, { x: 0, y: 0 }, 0, 2, 1), RangeError,
                "minZoom must not be greater than maxZoom");
        });
    });

    describe("project / unproject", () => {
        it("round-trips Web Mercator positions", () => {
            const source = createSource({ wrapX: true });
            const positions = [
                { x: 0, y: 0 },
                { x: 6.9603, y: 50.9375 },
                { x: -122.5, y: -73.25 },
                { x: 179.999, y: 85.0511287798066 }
            ];

            for (const position of positions) {
                assertCloseTo(new MapCamera(source, position, 0).sourceCenter, position, 10);
            }
        });

        it("uses independent dimensions for rectangular worlds", () => {
            const source = createSource({ rootColumns: 4, rootRows: 3, tileHeight: 90, tileWidth: 160 });
            const project = (position: { x: number; y: number }) => {
                const camera = new MapCamera(source, position, 0);
                return { x: camera.centerX, y: camera.centerY };
            };

            assertCloseTo(project({ x: -180, y: 85.0511287798066 }), { x: 0, y: 0 }, 10);
            assertCloseTo(project({ x: 0, y: 0 }), { x: 320, y: 135 }, 10);
            assertCloseTo(project({ x: 180, y: -85.0511287798066 }), { x: 640, y: 270 }, 10);
        });

        it("projects linear source coordinates into a rectangular world", () => {
            const source = createSource({
                projection: new LinearProjection({ bottom: -50, left: -100, right: 300, top: 150 }),
                rootColumns: 4,
                rootRows: 3,
                tileHeight: 90,
                tileWidth: 160
            });
            const camera = new MapCamera(source, { x: -100, y: 150 }, 0);

            assertCloseTo({ x: camera.centerX, y: camera.centerY }, { x: 0, y: 0 }, 10);
            camera.setCenter({ x: 100, y: 50 });
            assertCloseTo({ x: camera.centerX, y: camera.centerY }, { x: 320, y: 135 }, 10);
            camera.setWorldView(640, 270, 0);
            assertCloseTo(camera.sourceCenter, { x: 300, y: -50 }, 10);
        });

        it("uses a custom reversible projection", () => {
            const source = createSource({
                projection: {
                    project: point => ({ x: point.x / 10, y: point.y / 20 }),
                    unproject: point => ({ x: point.x * 10, y: point.y * 20 })
                },
                tileHeight: 100,
                tileWidth: 100
            });
            const camera = new MapCamera(source, { x: 2.5, y: 15 }, 0);

            assertCloseTo({ x: camera.centerX, y: camera.centerY }, { x: 25, y: 75 }, 10);
            assertCloseTo(camera.sourceCenter, { x: 2.5, y: 15 }, 10);
        });

    });

    describe("project", () => {
        it("projects the nearest horizontal copy of a wrapping world", () => {
            const source = createSource({ wrapX: true });
            const camera = new MapCamera(source, { x: 179, y: 0 }, 2);
            camera.resize(500, 300);

            assertSame(camera.wrapWidth, 1_024);
            assertCloseTo(camera.project({ x: -179, y: 0 }), { x: 255.6888888888889, y: 150 }, 10);
            assertCloseTo(camera.unproject({ x: 1_274, y: 150 }), { x: 179, y: 0 }, 10);
        });
    });

    describe("resize", () => {
        it("raises the continuous minimum zoom to cover a resized viewport", () => {
            const camera = new MapCamera(createSource({ wrapX: true }), { x: 0, y: 0 }, 0);
            camera.resize(2560, 1440);

            const minimumZoom = Math.log2(1440 / 256);
            assertCloseTo(camera.zoom, minimumZoom, 10);
            assertCloseTo(camera.clampZoom(0), minimumZoom, 10);
            assertCloseTo(camera.project({ x: 0, y: 85.0511287798066 }).y, 0, 10);
            assertCloseTo(camera.project({ x: 0, y: -85.0511287798066 }).y, 1440, 10);
        });

        it("uses the root grid at the source minimum zoom", () => {
            const source = createSource({
                maxZoom: 7,
                minZoom: 1,
                projection: new LinearProjection({ bottom: 7, left: 0, right: 5, top: 0 }),
                rootColumns: 5,
                rootRows: 7
            });
            const camera = new MapCamera(source, { x: 2.5, y: 3.5 }, 1, 0);

            camera.resize(640, 896);
            camera.setZoom(-100);
            assertSame(camera.zoom, 0);
            assertCloseTo(camera.project({ x: 0, y: 0 }), { x: 0, y: 0 }, 10);
            assertCloseTo(camera.project({ x: 5, y: 7 }), { x: 640, y: 896 }, 10);

            camera.resize(1280, 1792);

            assertSame(camera.zoom, 1);
            assertCloseTo(camera.project({ x: 0, y: 0 }), { x: 0, y: 0 }, 10);
            assertCloseTo(camera.project({ x: 5, y: 7 }), { x: 1280, y: 1792 }, 10);

            camera.resize(2560, 3584);
            assertSame(camera.zoom, 2);
            assertCloseTo(camera.project({ x: 0, y: 0 }), { x: 0, y: 0 }, 10);
            assertCloseTo(camera.project({ x: 5, y: 7 }), { x: 2560, y: 3584 }, 10);
        });

        it("uses tile coverage for viewport zoom and camera constraints", () => {
            const source = createSource({
                coverage: { bottom: 111_000 / 131_072, left: 0, right: 81_920 / 98_304, top: 9_000 / 131_072 },
                maxZoom: 7,
                minZoom: 0,
                projection: new LinearProjection({ bottom: 131_072, left: 0, right: 98_304, top: 0 }),
                rootColumns: 3,
                rootRows: 4
            });
            const camera = new MapCamera(source, { x: 40_960, y: 60_000 }, 0);
            camera.resize(768, 600);

            assertCloseTo(camera.zoom, Math.log2(768 / 640), 10);
            assertCloseTo(camera.sourceCenter, { x: 40_960, y: 60_000 }, 10);

            camera.setZoom(2);
            camera.pan(10_000, 10_000);
            assertCloseTo(camera.sourceCenter, { x: 12_288, y: 18_600 }, 10);

            camera.pan(-10_000, -10_000);
            assertCloseTo(camera.sourceCenter, { x: 69_632, y: 101_400 }, 10);
        });

        it("also covers the viewport width when the tile world does not wrap", () => {
            const source = createSource({
                projection: new LinearProjection(),
                tileHeight: 100,
                tileWidth: 100
            });
            const camera = new MapCamera(source, { x: 0.5, y: 0.5 }, 0);
            camera.resize(400, 200);

            assertSame(camera.zoom, 2);
            assertCloseTo(camera.project({ x: 0, y: 0 }), { x: 0, y: -100 }, 10);
            assertCloseTo(camera.project({ x: 1, y: 1 }), { x: 400, y: 300 }, 10);
        });

        it("allows the view to scale beyond the native tile LOD range", () => {
            const source = createSource({ maxZoom: 2, tileHeight: 100, tileWidth: 100 });
            const camera = new MapCamera(source, { x: 0, y: 0 }, 0, -2, 4);
            camera.resize(1_000, 1_000);

            const minimumZoom = Math.log2(10);
            assertCloseTo(camera.zoom, minimumZoom, 10);
            assertSame(camera.clampZoom(100), 4);

            camera.setZoom(-1);
            assertCloseTo(camera.zoom, minimumZoom, 10);
            camera.setZoom(4);
            assertSame(camera.zoom, 4);
        });

        it("can permit empty space around a view below the viewport-cover zoom", () => {
            const source = createSource({ maxZoom: 2, tileHeight: 100, tileWidth: 100 });
            const camera = new MapCamera(source, { x: 0, y: 0 }, -1, -2, 4, false);
            camera.resize(1_000, 1_000);

            assertSame(camera.zoom, -1);
            assertSame(camera.clampZoom(-100), -2);
            camera.setZoom(3);
            assertSame(camera.zoom, 3);
        });

        it("allows coverage corners to remain centered when viewport covering is disabled", () => {
            const source = createSource({ projection: new LinearProjection(), tileHeight: 100, tileWidth: 100 });
            const camera = new MapCamera(source, { x: 0, y: 0 }, -1, -2, 4, false);
            camera.resize(1_000, 1_000);

            assertCloseTo(camera.sourceCenter, { x: 0, y: 0 }, 10);
            assertCloseTo(camera.project({ x: 0, y: 0 }), { x: 500, y: 500 }, 10);

            camera.setCenter({ x: 1, y: 1 });
            assertCloseTo(camera.sourceCenter, { x: 1, y: 1 }, 10);
            assertCloseTo(camera.project({ x: 1, y: 1 }), { x: 500, y: 500 }, 10);
        });

        it("selects an automatic initial zoom one level above the effective minimum", () => {
            const camera = new MapCamera(createSource({ wrapX: true }), { x: 0, y: 0 }, null);
            camera.resize(2_560, 1_440);

            assertCloseTo(camera.zoom, Math.log2(1_440 / 256) + 1, 10);
            camera.setZoom(7);
            camera.resize(1_280, 720);
            assertSame(camera.zoom, 7);
            camera.setZoom(null);
            assertCloseTo(camera.zoom, Math.log2(720 / 256) + 1, 10);
        });

    });

    describe("projectPath", () => {
        it("keeps connected paths continuous across the horizontal world edge", () => {
            const source = createSource({ wrapX: true });
            const camera = new MapCamera(source, { x: 0, y: 0 }, 2);
            camera.resize(500, 300);

            const path = camera.projectPath([
                { x: 179, y: 0 },
                { x: -179, y: 0 }
            ]);

            assertSame((path[0]?.x ?? 0) > 500, true);
            assertSame((path[1]?.x ?? 0) > 500, true);
            assertCloseTo((path[1]?.x ?? 0) - (path[0]?.x ?? 0), 5.688888888888869, 10);
        });

        it("keeps dateline paths beside a dateline-centered viewport in either direction", () => {
            const source = createSource({ wrapX: true });
            const camera = new MapCamera(source, { x: 179, y: 0 }, 2);
            camera.resize(500, 300);

            assertCloseTo(camera.projectPath([
                { x: 179, y: 0 },
                { x: -179, y: 0 }
            ]), [ { x: 250, y: 150 }, { x: 255.6888888888889, y: 150 } ], 10);
            assertCloseTo(camera.projectPath([
                { x: -179, y: 0 },
                { x: 179, y: 0 }
            ]), [ { x: 255.6888888888889, y: 150 }, { x: 250, y: 150 } ], 10);
        });

        it("adaptively projects a custom natural path on every call", () => {
            let interpolationCalls = 0;
            const projection = {
                interpolateLine(start: { x: number; y: number }, end: { x: number; y: number }, ratio: number) {
                    interpolationCalls++;
                    return {
                        x: start.x + (end.x - start.x) * ratio,
                        y: start.y + (end.y - start.y) * ratio - Math.sin(Math.PI * ratio) * 0.3
                    };
                },
                project: (point: { x: number; y: number }) => point,
                unproject: (point: { x: number; y: number }) => point
            };
            const camera = new MapCamera(createSource({ projection, tileHeight: 100, tileWidth: 100 }), { x: 0.5, y: 0.5 }, 0);
            camera.resize(100, 100);

            assertSame(camera.wrapWidth, null);
            const positions = [ { x: 0.1, y: 0.7 }, { x: 0.9, y: 0.7 } ];
            const line = camera.projectPath(positions, { interpolation: "natural" });

            assertTrue(line.length > 2);
            assertCloseTo(line[0], { x: 10, y: 70 }, 10);
            assertCloseTo(line.at(-1), { x: 90, y: 70 }, 10);
            assertTrue(Math.min(...line.map(point => point.y)) < 41);
            const callsAfterFirstProjection = interpolationCalls;
            assertSame(callsAfterFirstProjection, 39);
            assertCloseTo(camera.projectPath(positions, { interpolation: "natural" }), line, 10);
            assertSame(interpolationCalls, callsAfterFirstProjection * 2);
        });

        it("detects an S-shaped Web Mercator route whose midpoint hides its curvature", () => {
            const camera = new MapCamera(createSource({ wrapX: true }), { x: -86.7607, y: 0.8 }, 0);
            const positions = [
                { x: -115.1398, y: 36.1699 },
                { x: -58.3816, y: -34.6037 }
            ];
            camera.resize(256, 256);

            const projected = camera.projectPath(positions, { interpolation: "projected" });
            const natural = camera.projectPath(positions, { interpolation: "natural" });

            assertSame(projected.length, 2);
            assertTrue(natural.length > 2);
            assertTrue(Math.max(...natural.map(point => squaredDistanceToSegment(point, natural[0], natural.at(-1)!))) > 0.5 ** 2);
        });

        it("stops refining natural path intervals whose error envelope misses the viewport", () => {
            let interpolationCalls = 0;
            const projection = {
                interpolateLine(start: { x: number; y: number }, end: { x: number; y: number }, ratio: number) {
                    interpolationCalls++;
                    return {
                        x: start.x + (end.x - start.x) * ratio,
                        y: start.y + (end.y - start.y) * ratio - Math.sin(Math.PI * ratio) * 0.01
                    };
                },
                project: (point: { x: number; y: number }) => point,
                unproject: (point: { x: number; y: number }) => point
            };
            const camera = new MapCamera(createSource({ projection, tileHeight: 100, tileWidth: 100 }), { x: 0.5, y: 0.5 }, 10);
            const bounds = Bounds.fromViewport(100, 100);
            const positions = [ { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 } ];
            camera.resize(100, 100);

            const complete = camera.projectPath(positions, { interpolation: "natural" });
            const completeCalls = interpolationCalls;
            interpolationCalls = 0;
            const culled = camera.projectPath(positions, { bounds, interpolation: "natural" });

            assertTrue(complete.length > 2);
            assertSame(culled.length, 2);
            assertSame(interpolationCalls, 3);
            assertTrue(interpolationCalls < completeCalls);
            assertEquals(bounds.clipPolyline(complete), []);
            assertEquals(bounds.clipPolyline(culled), []);
        });

    });

    describe("zoomAt", () => {
        it("preserves the world position beneath an anchored zoom", () => {
            const source = createSource({ wrapX: true });
            const camera = new MapCamera(source, { x: 6.9603, y: 50.9375 }, 4);
            const anchor = { x: 620, y: 180 };
            camera.resize(800, 600);
            const world = camera.toWorld(anchor);
            const position = camera.unproject(anchor);

            camera.zoomAt(world, anchor, 8.5);

            assertSame(camera.zoom, 8.5);
            assertCloseTo(camera.toWorld(anchor), world, 10);
            assertCloseTo(camera.project(position), anchor, 10);
        });
    });

    describe("pan", () => {
        it("constrains panning to a non-wrapping world", () => {
            const source = createSource({ rootColumns: 4, rootRows: 3, tileHeight: 90, tileWidth: 160 });
            const camera = new MapCamera(source, { x: 0, y: 0 }, 0);
            camera.resize(200, 100);

            assertEquals(camera.pan(1_000, 1_000), { x: 1, y: 1 });
            assertSame(camera.centerX, 100);
            assertSame(camera.centerY, 50);
            assertEquals(camera.pan(1_000, 1_000), { x: 0, y: 0 });

            assertEquals(camera.pan(-1_000, -1_000), { x: 1, y: 1 });
            assertSame(camera.centerX, 540);
            assertSame(camera.centerY, 220);
        });
    });

    describe("setCenter", () => {
        it("restores a requested center when later zoom or viewport constraints allow it", () => {
            const source = createSource();
            const cologne = { x: 6.9603, y: 50.9375 };
            const camera = new MapCamera(source, { x: 0, y: 0 }, 0);
            camera.resize(800, 600);

            camera.setCenter(cologne);
            camera.setZoom(13);
            assertCloseTo(camera.sourceCenter, cologne, 10);

            camera.resize(10_000_000, 10_000_000);
            assertCloseTo(camera.sourceCenter, { x: 0, y: 0 }, 10);
            camera.resize(800, 600);
            assertCloseTo(camera.sourceCenter, cologne, 10);
        });
    });

    describe("setSource", () => {
        it("preserves a constrained requested center across a source change", () => {
            const cologne = { x: 6.9603, y: 50.9375 };
            const camera = new MapCamera(createSource(), { x: 0, y: 0 }, 0);
            camera.resize(800, 600);
            camera.setCenter(cologne);

            camera.setSource(createSource({ rootColumns: 2, rootRows: 2 }));
            camera.setZoom(13);

            assertCloseTo(camera.sourceCenter, cologne, 10);
        });
    });
});
