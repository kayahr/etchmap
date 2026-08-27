/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { describe, it } from "node:test";
import { assertEquals, assertNull, assertSame } from "@kayahr/assert";
import { TileCache } from "../main/TileCache.ts";
import { type TileSource, normalizeTileSource } from "../main/TileSource.ts";

/** Controllable image implementation used by the tile-cache tests. */
class FakeImage extends EventTarget {
    public readonly crossOriginAssignments: Array<string | null> = [];
    public decoding: "async" | "auto" | "sync" = "auto";
    public removedSource = false;
    public readonly sourceAssignments: Array<{ readonly crossOrigin: string | null; readonly url: string }> = [];
    #crossOrigin: string | null = null;
    #src = "";

    public get crossOrigin(): string | null {
        return this.#crossOrigin;
    }

    public set crossOrigin(value: string | null) {
        this.#crossOrigin = value;
        this.crossOriginAssignments.push(value);
    }

    public get src(): string {
        return this.#src;
    }

    public set src(value: string) {
        this.#src = value;
        this.sourceAssignments.push({ crossOrigin: this.#crossOrigin, url: value });
    }

    public complete(): void {
        this.dispatchEvent(new Event("load"));
    }

    public fail(): void {
        this.dispatchEvent(new Event("error"));
    }

    public removeAttribute(name: string): void {
        if (name === "src") {
            this.#src = "";
            this.removedSource = true;
        }
    }
}

interface CacheHarness {
    readonly cache: TileCache;
    readonly changes: Array<readonly [ number, number, number ]>;
    readonly images: FakeImage[];
    readonly retries: { count: number };
}

/** Creates a cache with a controllable image factory. */
function createHarness({
    maxConcurrentLoads = 4,
    maxTiles = 16,
    retryDelay,
    source = { tileURL: "/{z}/{x}/{y}.png" }
}: {
    readonly maxConcurrentLoads?: number;
    readonly maxTiles?: number;
    readonly retryDelay?: number;
    readonly source?: TileSource;
} = {}): CacheHarness {
    const images: FakeImage[] = [];
    const changes: Array<readonly [ number, number, number ]> = [];
    const retries = { count: 0 };
    const cache = new TileCache({
        createImage: () => {
            const image = new FakeImage();
            images.push(image);
            return image as unknown as HTMLImageElement;
        },
        maxConcurrentLoads,
        maxTiles,
        onChange: (zoom, x, y) => { changes.push([ zoom, x, y ]); },
        onRetry: () => { retries.count++; },
        retryDelay,
        source: normalizeTileSource(source)
    });
    return { cache, changes, images, retries };
}

describe("TileCache", () => {
    describe("request", () => {
        it("loads queued tiles by priority and respects the concurrency limit", () => {
            const { cache, changes, images } = createHarness({ maxConcurrentLoads: 1 });

            cache.beginFrame();
            assertNull(cache.request(2, 0, 0, 5));
            assertNull(cache.request(2, 1, 0, 1));
            assertNull(cache.request(2, 2, 0, 1));
            cache.endFrame();

            assertSame(images.length, 1);
            assertSame(images[0]?.src, "/2/1/0.png");
            assertEquals(images[0]?.sourceAssignments, [ { crossOrigin: "anonymous", url: "/2/1/0.png" } ]);

            images[0]?.complete();
            assertSame(images.length, 1);
            cache.beginFrame();
            cache.request(2, 2, 0, 1);
            cache.request(2, 0, 0, 5);
            cache.endFrame();
            assertSame(images.length, 2);
            assertSame(images[1]?.src, "/2/2/0.png");

            images[1]?.complete();
            assertSame(images.length, 2);
            cache.beginFrame();
            cache.request(2, 0, 0, 5);
            cache.endFrame();
            assertSame(images.length, 3);
            assertSame(images[2]?.src, "/2/0/0.png");

            images[2]?.complete();
            assertEquals(changes, [ [ 2, 1, 0 ], [ 2, 2, 0 ], [ 2, 0, 0 ] ]);
        });

        it("waits for a newly prioritized frame before filling a freed loading slot", () => {
            const { cache, images } = createHarness({ maxConcurrentLoads: 1 });
            cache.beginFrame();
            cache.request(4, 0, 0, 0);
            cache.request(4, 1, 0, 1);
            cache.endFrame();
            assertSame(images[0]?.src, "/4/0/0.png");

            images[0]?.complete();
            assertSame(images.length, 1);

            cache.beginFrame();
            cache.request(6, 32, 20, 0);
            cache.endFrame();
            assertSame(images.length, 2);
            assertSame(images[1]?.src, "/6/32/20.png");
        });

        it("preempts obsolete loads which block newly visible tiles", () => {
            const { cache, changes, images } = createHarness({ maxConcurrentLoads: 2 });

            cache.beginFrame();
            cache.request(4, 0, 0, 0);
            cache.request(4, 1, 0, 0);
            cache.endFrame();
            assertSame(images.length, 2);

            cache.beginFrame();
            cache.request(6, 32, 20, 0);
            cache.request(6, 33, 20, 1);
            cache.endFrame();

            assertSame(images[0]?.removedSource, true);
            assertSame(images[1]?.removedSource, true);
            assertSame(images.length, 4);
            assertSame(images[2]?.src, "/6/32/20.png");
            assertSame(images[3]?.src, "/6/33/20.png");
            images[0]?.complete();
            images[1]?.complete();
            assertEquals(changes, []);
            assertNull(cache.peek(4, 0, 0));
            assertNull(cache.peek(4, 1, 0));

            images[2]?.complete();
            images[3]?.complete();
            assertEquals(changes, [ [ 6, 32, 20 ], [ 6, 33, 20 ] ]);
        });

        it("keeps relevant and non-blocking loads instead of canceling them", () => {
            const relevant = createHarness({ maxConcurrentLoads: 2 });
            relevant.cache.beginFrame();
            relevant.cache.request(4, 0, 0, 0);
            relevant.cache.request(4, 1, 0, 0);
            relevant.cache.endFrame();

            relevant.cache.beginFrame();
            relevant.cache.request(4, 0, 0, 0);
            relevant.cache.request(6, 32, 20, 0);
            relevant.cache.endFrame();
            assertSame(relevant.images[0]?.removedSource, false);
            assertSame(relevant.images[1]?.removedSource, true);
            assertSame(relevant.images.length, 3);
            assertSame(relevant.images[2]?.src, "/6/32/20.png");

            const buffered = createHarness({ maxConcurrentLoads: 1 });
            buffered.cache.beginFrame();
            buffered.cache.request(4, 0, 0, 0);
            buffered.cache.endFrame();
            buffered.cache.beginFrame();
            buffered.cache.request(6, 32, 20, 2_000_000, false);
            buffered.cache.endFrame();
            assertSame(buffered.images.length, 1);
            assertSame(buffered.images[0]?.removedSource, false);
            buffered.images[0]?.complete();
            assertSame(buffered.images.length, 1);
            buffered.cache.beginFrame();
            buffered.cache.request(6, 32, 20, 2_000_000, false);
            buffered.cache.endFrame();
            assertSame(buffered.images.length, 2);
            assertSame(buffered.images[1]?.src, "/6/32/20.png");
        });

        it("preempts a relevant transient load for a higher-priority destination tile", () => {
            const { cache, images } = createHarness({ maxConcurrentLoads: 1 });
            cache.beginFrame();
            cache.request(4, 0, 0, 0);
            cache.endFrame();

            cache.beginFrame();
            cache.request(4, 0, 0, 1_000_000);
            cache.request(6, 32, 20, 0);
            cache.endFrame();

            assertSame(images[0]?.removedSource, true);
            assertSame(images.length, 2);
            assertSame(images[1]?.src, "/6/32/20.png");
        });

        it("canonicalizes horizontally wrapped coordinates and rejects invalid rows", () => {
            const { cache, changes, images } = createHarness({
                source: {
                    rootColumns: 2,
                    rootRows: 1,
                    tileURL: "/{z}/{x}/{y}.png",
                    wrapX: true
                }
            });

            cache.beginFrame();
            assertNull(cache.request(1, -1, 0, 0));
            assertNull(cache.request(1, 3, 0, 0));
            assertNull(cache.request(1, 0, -1, 0));
            assertNull(cache.request(1, 0, 2, 0));
            cache.endFrame();

            assertSame(images.length, 1);
            assertSame(images[0]?.src, "/1/3/0.png");
            images[0]?.complete();
            assertSame(cache.peek(1, 7, 0), images[0] as unknown as HTMLImageElement);
            assertEquals(changes, [ [ 1, 3, 0 ] ]);
        });

        it("uses the root grid at the source minimum zoom", () => {
            const { cache, images } = createHarness({
                source: {
                    maxZoom: 7,
                    minZoom: 1,
                    rootColumns: 5,
                    rootRows: 7,
                    tileURL: "/{z}/{x}/{y}.png"
                }
            });

            cache.beginFrame();
            cache.request(1, 4, 6, 0);
            cache.request(1, 5, 6, 0);
            cache.request(1, 4, 7, 0);
            cache.request(2, 9, 13, 0);
            cache.request(2, 10, 13, 0);
            cache.request(2, 9, 14, 0);
            cache.endFrame();

            assertEquals(images.map(image => image.src), [ "/1/4/6.png", "/2/9/13.png" ]);
        });

        it("requests only tiles which intersect the configured coverage", () => {
            const { cache, images } = createHarness({
                maxConcurrentLoads: 8,
                source: {
                    coverage: { bottom: 111_000 / 131_072, left: 0, right: 81_920 / 98_304, top: 9_000 / 131_072 },
                    maxZoom: 7,
                    minZoom: 0,
                    rootColumns: 3,
                    rootRows: 4,
                    tileURL: "/{z}/{x}/{y}.png"
                }
            });

            cache.beginFrame();
            cache.request(0, 2, 3, 0);
            cache.request(0, 3, 3, 0);
            cache.request(1, 4, 6, 0);
            cache.request(1, 5, 6, 0);
            cache.request(2, 0, 0, 0);
            cache.request(2, 0, 1, 0);
            cache.request(5, 0, 7, 0);
            cache.request(5, 0, 8, 0);
            cache.request(5, 79, 108, 0);
            cache.request(5, 79, 109, 0);
            cache.endFrame();

            assertEquals(images.map(image => image.src), [ "/0/2/3.png", "/1/4/6.png", "/2/0/1.png", "/5/0/8.png", "/5/79/108.png" ]);
        });

        it("evicts the least recently used unprotected ready tile", () => {
            const { cache, images } = createHarness({ maxTiles: 2 });

            cache.beginFrame();
            cache.request(1, 0, 0, 0);
            cache.request(1, 1, 0, 0);
            cache.endFrame();
            images[0]?.complete();
            images[1]?.complete();

            cache.beginFrame();
            assertSame(cache.peek(1, 0, 0, false), images[0] as unknown as HTMLImageElement);
            cache.request(1, 0, 1, 0);
            cache.endFrame();
            images[2]?.complete();

            assertNull(cache.peek(1, 1, 0, false));
            assertSame(cache.peek(1, 0, 0, false), images[0] as unknown as HTMLImageElement);
            assertSame(cache.peek(1, 0, 1, false), images[2] as unknown as HTMLImageElement);
        });

        it("enforces the cache limit even when every ready tile was used in the current frame", () => {
            const { cache, images } = createHarness({ maxTiles: 1 });

            cache.beginFrame();
            cache.request(2, 0, 0, 0);
            cache.request(2, 1, 0, 0);
            cache.request(2, 2, 0, 0);
            cache.endFrame();
            for (const image of images) {
                image.complete();
            }

            assertNull(cache.peek(2, 0, 0, false));
            assertNull(cache.peek(2, 1, 0, false));
            assertSame(cache.peek(2, 2, 0, false), images[2] as unknown as HTMLImageElement);
        });

        it("updates protection while a tile is loading", () => {
            const sameFrame = createHarness({ maxConcurrentLoads: 2, maxTiles: 1 });
            sameFrame.cache.beginFrame();
            sameFrame.cache.request(1, 0, 0, 0, false);
            sameFrame.cache.request(1, 0, 0, 0, true);
            sameFrame.cache.request(1, 1, 0, 0, true);
            sameFrame.cache.endFrame();
            sameFrame.images[1]?.complete();
            sameFrame.images[0]?.complete();
            assertNull(sameFrame.cache.peek(1, 1, 0, false));
            assertSame(sameFrame.cache.peek(1, 0, 0, false), sameFrame.images[0] as unknown as HTMLImageElement);

            const laterFrame = createHarness({ maxConcurrentLoads: 2, maxTiles: 1 });
            laterFrame.cache.beginFrame();
            laterFrame.cache.request(1, 0, 0, 0, true);
            laterFrame.cache.endFrame();
            laterFrame.cache.beginFrame();
            laterFrame.cache.request(1, 0, 0, 0, false);
            laterFrame.cache.request(1, 1, 0, 0, true);
            laterFrame.cache.endFrame();
            laterFrame.images[1]?.complete();
            laterFrame.images[0]?.complete();
            assertNull(laterFrame.cache.peek(1, 0, 0, false));
            assertSame(laterFrame.cache.peek(1, 1, 0, false), laterFrame.images[1] as unknown as HTMLImageElement);
        });

        it("wakes an idle renderer at the failure deadline and leaves CORS disabled when configured", context => {
            context.mock.timers.enable({ apis: [ "Date", "setTimeout" ], now: 1_000 });
            const { cache, changes, images, retries } = createHarness({
                maxConcurrentLoads: 1,
                retryDelay: 100,
                source: {
                    crossOrigin: null,
                    tileURL: "/{z}/{x}/{y}.png"
                }
            });

            cache.beginFrame();
            cache.request(0, 0, 0, 0);
            cache.endFrame();
            assertSame(images.length, 1);
            assertEquals(images[0]?.crossOriginAssignments, []);
            assertEquals(images[0]?.sourceAssignments, [ { crossOrigin: null, url: "/0/0/0.png" } ]);
            images[0]?.fail();
            assertEquals(changes, []);

            cache.beginFrame();
            cache.request(0, 0, 0, 0);
            cache.endFrame();
            assertSame(images.length, 1);

            context.mock.timers.tick(99);
            assertSame(retries.count, 0);
            assertSame(images.length, 1);

            context.mock.timers.tick(1);
            assertSame(retries.count, 1);
            cache.beginFrame();
            cache.request(0, 0, 0, 0);
            cache.endFrame();
            assertSame(images.length, 2);
            images[1]?.complete();
            assertEquals(changes, [ [ 0, 0, 0 ] ]);
            assertSame(cache.peek(0, 0, 0), images[1] as unknown as HTMLImageElement);
            cache.dispose();

            const disposed = createHarness({ retryDelay: 100 });
            disposed.cache.beginFrame();
            disposed.cache.request(1, 0, 0, 0);
            disposed.cache.endFrame();
            disposed.images[0]?.fail();
            disposed.cache.beginFrame();
            disposed.cache.request(1, 1, 0, 0);
            disposed.cache.endFrame();
            disposed.cache.dispose();
            assertSame(disposed.images[1]?.removedSource, true);

            context.mock.timers.tick(100);
            assertSame(disposed.retries.count, 0);
        });

        it("contains tile URL resolution errors as failed image requests", () => {
            const { cache, images } = createHarness({
                source: {
                    tileURL: () => { throw new Error("Broken tile URL"); }
                }
            });

            cache.beginFrame();
            cache.request(0, 0, 0, 0);
            cache.endFrame();

            assertSame(images.length, 1);
            assertEquals(images[0]?.sourceAssignments, []);
            assertNull(cache.peek(0, 0, 0));
            cache.dispose();
        });
    });
});
