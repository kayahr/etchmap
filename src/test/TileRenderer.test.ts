/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { setCanvasContextFactory } from "./dom.ts";
import { describe, it } from "node:test";
import { assertSame, assertThrowWithMessage, assertTrue } from "@kayahr/assert";
import { TileRenderer } from "../main/TileRenderer.ts";
import { type TileSource, normalizeTileSource } from "../main/TileSource.ts";

/** Root-tile view shared by renderer behavior tests. */
const rootView = { centerX: 128, centerY: 128, height: 256, width: 256, zoom: 0 };

/** Minimal recording Canvas context used for mosaic tests. */
class RecordingContext {
    public clearCount = 0;
    public drawCount = 0;
    public imageSmoothingEnabled = false;
    public imageSmoothingQuality: ImageSmoothingQuality = "low";

    public clearRect(): void {
        this.clearCount++;
    }

    public beginPath(): void {}

    public clip(): void {}

    public drawImage(): void {
        this.drawCount++;
    }

    public rect(): void {}

    public restore(): void {}

    public save(): void {}

    public setTransform(): void {}

}

/** Image implementation which records the URL selected by the request scheduler. */
class RecordingImage extends EventTarget {
    public crossOrigin: string | null = null;
    public decoding: "async" | "auto" | "sync" = "auto";
    public removedSource = false;
    #src = "";

    public get src(): string {
        return this.#src;
    }

    public set src(src: string) {
        this.#src = src;
    }

    /** Completes the simulated image request. */
    public complete(): void {
        this.dispatchEvent(new Event("load"));
    }

    public removeAttribute(name: string): void {
        if (name === "src") {
            this.#src = "";
            this.removedSource = true;
        }
    }
}

/**
 * Creates a document facade which records created tile images and delegates all other elements to the test document.
 *
 * @param images - Array receiving created tile images.
 * @returns Document facade for a tile renderer.
 */
function createTestDocument(images: RecordingImage[]): Document {
    return {
        createElement: (name: string): HTMLElement => {
            if (name === "img") {
                const image = new RecordingImage();
                images.push(image);
                return image as unknown as HTMLImageElement;
            }
            return document.createElement(name);
        }
    } as unknown as Document;
}

/** Reusable renderer fixture backed by controllable images and recording Canvas contexts. */
interface RendererHarness {
    /** Number of renderer change notifications. */
    readonly changes: { count: number };

    /** Offscreen Canvas contexts created by the renderer. */
    readonly contexts: RecordingContext[];

    /** Destination context passed to renderer draws. */
    readonly destination: CanvasRenderingContext2D;

    /** Tile images created by the renderer. */
    readonly images: RecordingImage[];

    /** Renderer under test. */
    readonly renderer: TileRenderer;
}

/**
 * Creates a renderer fixture with controllable image loads and recording Canvas contexts.
 *
 * @param maxConcurrentLoads - Maximum number of simultaneous image requests.
 * @param source             - Tile-source properties overriding the fixture defaults.
 * @returns Renderer fixture.
 */
function createRendererHarness(maxConcurrentLoads = 16, source: Partial<TileSource> = {}): RendererHarness {
    const changes = { count: 0 };
    const contexts: RecordingContext[] = [];
    const images: RecordingImage[] = [];
    setCanvasContextFactory(() => {
        const context = new RecordingContext();
        contexts.push(context);
        return context as unknown as CanvasRenderingContext2D;
    });
    const destination = new RecordingContext() as unknown as CanvasRenderingContext2D;
    const renderer = new TileRenderer({
        cacheSize: 16,
        document: createTestDocument(images),
        maxConcurrentLoads,
        onChange: () => changes.count++,
        source: normalizeTileSource({ tileURL: "https://example.invalid/{z}/{x}/{y}.png", ...source })
    });
    return { changes, contexts, destination, images, renderer };
}

describe("TileRenderer", () => {
    describe("draw", () => {
        it("draws one buffered mosaic and reuses it for small camera movements", () => {
            const contexts: RecordingContext[] = [];
            setCanvasContextFactory(() => {
                const context = new RecordingContext();
                contexts.push(context);
                return context as unknown as CanvasRenderingContext2D;
            });
            const destination = new RecordingContext();
            const renderer = new TileRenderer({
                cacheSize: 32,
                document,
                maxConcurrentLoads: 2,
                onChange: (): void => {},
                source: normalizeTileSource({ tileURL: "https://example.invalid/{z}/{x}/{y}.png", wrapX: true })
            });

            renderer.draw(destination as unknown as CanvasRenderingContext2D, {
                centerX: 128,
                centerY: 128,
                height: 300,
                width: 400,
                zoom: 2
            });
            assertSame(destination.drawCount, 1);
            assertSame(contexts.length, 1);
            assertSame(contexts[0]?.clearCount, 1);

            renderer.draw(destination as unknown as CanvasRenderingContext2D, {
                centerX: 138,
                centerY: 128,
                height: 300,
                width: 400,
                zoom: 2.1
            });
            assertSame(destination.drawCount, 2);
            assertSame(contexts.length, 1);

            renderer.draw(destination as unknown as CanvasRenderingContext2D, {
                centerX: 300,
                centerY: 128,
                height: 300,
                width: 400,
                zoom: 2.1
            });
            assertSame(destination.drawCount, 3);
            assertSame(contexts.length, 2);
            assertSame(contexts[1]?.drawCount, 1);
            renderer.dispose();
        });

        it("uses the minimum native tile level when view zoom is below it", () => {
            const images: RecordingImage[] = [];
            setCanvasContextFactory(() => new RecordingContext() as unknown as CanvasRenderingContext2D);
            const renderer = new TileRenderer({
                cacheSize: 64,
                document: createTestDocument(images),
                maxConcurrentLoads: 64,
                onChange: (): void => {},
                source: normalizeTileSource({
                    maxZoom: 7,
                    minZoom: 1,
                    rootColumns: 5,
                    rootRows: 7,
                    tileURL: "https://example.invalid/{z}/{x}/{y}.png"
                })
            });

            renderer.draw(new RecordingContext() as unknown as CanvasRenderingContext2D, {
                centerX: 640,
                centerY: 896,
                height: 896,
                width: 640,
                zoom: 0
            });

            assertSame(images.length, 35);
            assertTrue(images.every(image => /^https:\/\/example\.invalid\/1\/[0-4]\/[0-6]\.png$/.test(image.src)));
            assertTrue(images.some(image => image.src === "https://example.invalid/1/4/6.png"));
            renderer.dispose();
        });

        it("uses the maximum native tile level when view zoom is above it", () => {
            const images: RecordingImage[] = [];
            setCanvasContextFactory(() => new RecordingContext() as unknown as CanvasRenderingContext2D);
            const renderer = new TileRenderer({
                cacheSize: 64,
                document: createTestDocument(images),
                maxConcurrentLoads: 64,
                onChange: (): void => {},
                source: normalizeTileSource({
                    maxZoom: 2,
                    tileURL: "https://example.invalid/{z}/{x}/{y}.png",
                    wrapX: true
                })
            });

            renderer.draw(new RecordingContext() as unknown as CanvasRenderingContext2D, {
                centerX: 128,
                centerY: 128,
                height: 64,
                width: 64,
                zoom: 4
            });

            assertTrue(images.length > 0);
            assertTrue(images.every(image => /^https:\/\/example\.invalid\/2\/\d+\/\d+\.png$/.test(image.src)));
            renderer.dispose();
        });

        it("renders a padded root grid without requesting tiles outside its coverage", () => {
            const images: RecordingImage[] = [];
            setCanvasContextFactory(() => new RecordingContext() as unknown as CanvasRenderingContext2D);
            const renderer = new TileRenderer({
                cacheSize: 64,
                document: createTestDocument(images),
                maxConcurrentLoads: 64,
                onChange: (): void => {},
                source: normalizeTileSource({
                    coverage: { bottom: 111_000 / 131_072, left: 0, right: 81_920 / 98_304, top: 9_000 / 131_072 },
                    maxZoom: 7,
                    minZoom: 0,
                    rootColumns: 3,
                    rootRows: 4,
                    tileURL: "https://example.invalid/{z}/{x}/{y}.png"
                })
            });

            renderer.draw(new RecordingContext() as unknown as CanvasRenderingContext2D, {
                centerX: 320,
                centerY: 468.75,
                height: 1_024,
                width: 768,
                zoom: 0
            });

            assertSame(images.length, 12);
            assertTrue(images.every(image => /^https:\/\/example\.invalid\/0\/[0-2]\/[0-3]\.png$/.test(image.src)));
            renderer.dispose();
        });

        it("preempts a transient current-view load for the destination view", () => {
            const images: RecordingImage[] = [];
            setCanvasContextFactory(() => new RecordingContext() as unknown as CanvasRenderingContext2D);
            const renderer = new TileRenderer({
                cacheSize: 32,
                document: createTestDocument(images),
                maxConcurrentLoads: 1,
                onChange: (): void => {},
                source: normalizeTileSource({ tileURL: "https://example.invalid/{z}/{x}/{y}.png", wrapX: true })
            });

            const destination = new RecordingContext() as unknown as CanvasRenderingContext2D;
            renderer.draw(destination, {
                centerX: 32,
                centerY: 128,
                height: 64,
                width: 64,
                zoom: 2.1
            });
            assertSame(images.length, 1);
            assertTrue(images[0]?.src.startsWith("https://example.invalid/2/0/") ?? false);

            renderer.draw(destination, {
                centerX: 32,
                centerY: 128,
                height: 64,
                targetCenterX: 224,
                targetCenterY: 128,
                targetZoom: 2.4,
                width: 64,
                zoom: 2.1
            });

            assertSame(images[0]?.removedSource, true);
            assertSame(images.length, 2);
            assertTrue(images[1]?.src.startsWith("https://example.invalid/2/3/") ?? false);
            renderer.dispose();
            assertSame(images[1]?.removedSource, true);
        });

        it("draws newly ready exact tiles and cached ancestors while finer tiles load", () => {
            const { changes, contexts, destination, images, renderer } = createRendererHarness(16, { maxZoom: 1 });

            renderer.draw(destination, rootView);
            assertSame(images.length, 1);
            images[0]?.complete();
            assertSame(changes.count, 1);

            renderer.draw(destination, rootView);
            assertSame(contexts.at(-1)?.drawCount, 2);

            renderer.draw(destination, { ...rootView, zoom: 1 });
            assertSame(images.length, 5);
            assertSame(contexts.at(-1)?.drawCount, 2);
            renderer.dispose();
        });

        it("composes a complete cached child group only after its fourth tile loads", () => {
            const { changes, contexts, destination, images, renderer } = createRendererHarness(4, { maxZoom: 1 });

            renderer.draw(destination, { ...rootView, targetCenterX: 128, targetCenterY: 128, targetZoom: 1 });
            assertSame(images.length, 4);
            assertTrue(images.every(image => image.src.includes("/1/")));
            for (const image of images) {
                image.complete();
            }
            assertSame(changes.count, 1);

            renderer.draw(destination, rootView);
            assertSame(images.length, 5);
            assertTrue(contexts.some(context => context.drawCount === 4));
            renderer.dispose();
        });

        it("ignores loaded tiles more than one level finer than the current mosaic", () => {
            const { changes, destination, images, renderer } = createRendererHarness(16, { maxZoom: 2 });

            renderer.draw(destination, {
                centerX: 128,
                centerY: 128,
                height: 64,
                targetCenterX: 128,
                targetCenterY: 128,
                targetZoom: 2,
                width: 64,
                zoom: 0
            });
            assertTrue(images.length > 0);
            const detailedImage = images.find(image => image.src.includes("/2/"));
            if (detailedImage == null) {
                throw new Error("Expected a loading tile at zoom 2");
            }
            detailedImage.complete();
            assertSame(changes.count, 0);
            renderer.dispose();
        });

        it("ignores loaded destination tiles outside the current mosaic", () => {
            const { changes, destination, images, renderer } = createRendererHarness(1, { rootColumns: 4 });

            renderer.draw(destination, {
                centerX: 128,
                centerY: 128,
                height: 64,
                targetCenterX: 896,
                targetCenterY: 128,
                targetZoom: 0,
                width: 64,
                zoom: 0
            });
            assertSame(images.length, 1);
            assertSame(images[0]?.src, "https://example.invalid/0/3/0.png");
            images[0]?.complete();
            assertSame(changes.count, 0);
            renderer.dispose();
        });

        it("invalidates when a loaded lower-LOD destination tile overlaps the current mosaic", () => {
            const { changes, destination, images, renderer } = createRendererHarness(1, { maxZoom: 1, rootRows: 2 });

            renderer.draw(destination, {
                centerX: 128,
                centerY: 256,
                height: 256,
                targetCenterX: 128,
                targetCenterY: 384,
                targetZoom: 0,
                width: 64,
                zoom: 1
            });
            assertSame(images.length, 1);
            assertSame(images[0]?.src, "https://example.invalid/0/0/1.png");
            images[0]?.complete();
            assertSame(changes.count, 1);
            renderer.dispose();
        });

        it("reports an unavailable mosaic Canvas context", () => {
            const { destination, renderer } = createRendererHarness(1);
            setCanvasContextFactory(() => null as unknown as CanvasRenderingContext2D);

            assertThrowWithMessage(() => renderer.draw(destination, rootView), Error, "Unable to create tile mosaic Canvas context");
            renderer.dispose();
        });

        it("reports an unavailable child-group Canvas context", () => {
            const { destination, images, renderer } = createRendererHarness(4, { maxZoom: 1 });
            renderer.draw(destination, { ...rootView, targetCenterX: 128, targetCenterY: 128, targetZoom: 1 });
            for (const image of images) {
                image.complete();
            }
            let contextRequests = 0;
            setCanvasContextFactory(() => ++contextRequests === 2
                ? null as unknown as CanvasRenderingContext2D
                : new RecordingContext() as unknown as CanvasRenderingContext2D);

            assertThrowWithMessage(() => renderer.draw(destination, rootView), Error, "Unable to create child tile Canvas context");
            renderer.dispose();
        });
    });
});
