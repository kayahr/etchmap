/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { type NormalizedTileSource, resolveTileURL } from "./TileSource.ts";
import { assertNotNull } from "./util/assert.ts";
import { modulo } from "./util/math.ts";

/** Numeric width reserved for one request-priority class. */
export const tilePriorityClassSize = 1_000_000;

/** Loaded tile retained by the LRU cache. */
interface ReadyTile {
    /** Loaded image ready for synchronous Canvas drawing. */
    readonly image: HTMLImageElement;

    /** Most recent request-collection frame which protected the image from eviction. */
    protectedFrame: number;
}

/** Queued tile request. */
interface QueuedTile {
    /** Canonical zoom/X/Y cache key. */
    readonly key: string;

    /** Monotonic insertion sequence used to stabilize equal priorities. */
    readonly sequence: number;

    /** Canonical tile column. */
    readonly x: number;

    /** Tile row. */
    readonly y: number;

    /** Integer tile zoom. */
    readonly zoom: number;

    /** Most recent request-collection frame referencing the tile. */
    frame: number;

    /** Numeric loading priority where lower values load first. */
    priority: number;

    /** Whether the request represents visible work and protects a resulting image from immediate eviction. */
    protect: boolean;
}

/** Active tile request. */
interface LoadingTile extends QueuedTile {
    /** Image whose request is active. */
    readonly image: HTMLImageElement;

    /** Error listener installed on the image. */
    readonly onError: () => void;

    /** Load listener installed on the image. */
    readonly onLoad: () => void;
}

/** Canonical tile coordinate and cache key. */
interface CanonicalTile {
    /** Canonical zoom/X/Y cache key. */
    readonly key: string;

    /** Canonical tile column after optional horizontal wrapping. */
    readonly x: number;
}

/** Options used to create a tile cache. */
interface TileCacheOptions {
    /** Factory creating an image in the owning document. */
    readonly createImage: () => HTMLImageElement;

    /** Maximum number of concurrent image requests. */
    readonly maxConcurrentLoads: number;

    /** Maximum number of ready images retained by the LRU cache. */
    readonly maxTiles: number;

    /** Callback invoked with zoom, canonical X and Y when a tile becomes ready. */
    readonly onChange: (zoom: number, x: number, y: number) => void;

    /** Callback invoked when a failed request reaches its retry deadline. */
    readonly onRetry: () => void;

    /** Delay after a failed request before it becomes eligible again, in milliseconds. Defaults to 15000. */
    readonly retryDelay?: number;

    /** Normalized tile source served by the cache. */
    readonly source: Readonly<NormalizedTileSource>;
}

/** Priority-aware LRU cache of loaded tile images. */
export class TileCache {
    /** Function used to create tile images. */
    readonly #createImage: () => HTMLImageElement;

    /** Failed requests and the earliest time at which they may be retried. */
    readonly #failed = new Map<string, number>();

    /** Current request-collection frame. */
    #frame = 0;

    /** Active image requests. */
    readonly #loading = new Map<string, LoadingTile>();

    /** Maximum number of concurrent image requests. */
    readonly #maxConcurrentLoads: number;

    /** Maximum number of ready images retained in memory. */
    readonly #maxTiles: number;

    /** Callback invoked when a tile becomes ready. */
    readonly #onChange: (zoom: number, x: number, y: number) => void;

    /** Callback invoked when failed requests are ready to be retried. */
    readonly #onRetry: () => void;

    /** Tile requests waiting for an available loading slot. */
    readonly #queued = new Map<string, QueuedTile>();

    /** Loaded images in least-recently-used to most-recently-used order. */
    readonly #ready = new Map<string, ReadyTile>();

    /** Delay before a failed request may be retried. */
    readonly #retryDelay: number;

    /** Timer which wakes an idle renderer when a failed request becomes retryable. */
    #retryTimer: ReturnType<typeof setTimeout> | null = null;

    /** Timestamp for which the current retry timer was scheduled. */
    #retryTimerAt = Number.POSITIVE_INFINITY;

    /** Sequence used to preserve request order among equal priorities. */
    #sequence = 0;

    /** Tile source served by this cache. */
    readonly #source: Readonly<NormalizedTileSource>;

    /** Whether this cache has been disposed. */
    #disposed = false;

    /**
     * Creates a tile cache.
     *
     * @param options - Cache options.
     */
    public constructor(options: TileCacheOptions) {
        this.#createImage = options.createImage;
        this.#maxConcurrentLoads = options.maxConcurrentLoads;
        this.#maxTiles = options.maxTiles;
        this.#onChange = options.onChange;
        this.#onRetry = options.onRetry;
        this.#retryDelay = options.retryDelay ?? 15_000;
        this.#source = options.source;
    }

    /** Starts collecting tile requests for a new rendered frame. */
    public beginFrame(): void {
        this.#frame++;
        const now = Date.now();
        for (const [ key, failedUntil ] of this.#failed) {
            if (failedUntil <= now) {
                this.#failed.delete(key);
            }
        }
        this.#scheduleRetry();
    }

    /** Cancels queued work and releases all cached images. */
    public dispose(): void {
        this.#disposed = true;
        this.#queued.clear();
        this.#ready.clear();
        this.#failed.clear();
        if (this.#retryTimer != null) {
            clearTimeout(this.#retryTimer);
            this.#retryTimer = null;
        }
        for (const tile of this.#loading.values()) {
            tile.image.removeEventListener("load", tile.onLoad);
            tile.image.removeEventListener("error", tile.onError);
            tile.image.removeAttribute("src");
        }
        this.#loading.clear();
    }

    /**
     * Finishes request collection, removes obsolete work and starts the highest-priority requests.
     *
     * @throws Any exception raised by the configured image factory.
     */
    public endFrame(): void {
        for (const [ key, tile ] of this.#queued) {
            if (tile.frame !== this.#frame) {
                this.#queued.delete(key);
            }
        }
        this.#preemptLoads();
        this.#pump();
        this.#evict();
    }

    /**
     * Returns a ready tile or schedules it for loading.
     *
     * @param zoom     - Integer tile zoom.
     * @param x        - Possibly unwrapped tile column.
     * @param y        - Tile row.
     * @param priority - Loading priority where lower numbers are loaded first.
     * @param protect  - Whether a ready tile must be protected from eviction during this frame.
     * @returns Ready image or null while unavailable.
     */
    public request(zoom: number, x: number, y: number, priority: number, protect = true): HTMLImageElement | null {
        const canonical = this.#canonicalize(zoom, x, y);
        if (canonical == null) {
            return null;
        }
        const { key, x: canonicalX } = canonical;

        const ready = this.#ready.get(key);
        if (ready != null) {
            this.#ready.delete(key);
            if (protect) {
                ready.protectedFrame = this.#frame;
            }
            this.#ready.set(key, ready);
            return ready.image;
        }

        const loading = this.#loading.get(key);
        if (loading != null) {
            if (loading.frame === this.#frame) {
                loading.priority = Math.min(loading.priority, priority);
                loading.protect ||= protect;
            } else {
                loading.frame = this.#frame;
                loading.priority = priority;
                loading.protect = protect;
            }
            return null;
        }

        const failedUntil = this.#failed.get(key);
        if (failedUntil != null) {
            if (failedUntil > Date.now()) {
                return null;
            }
            this.#failed.delete(key);
        }

        const queued = this.#queued.get(key);
        if (queued != null) {
            if (queued.frame === this.#frame) {
                queued.priority = Math.min(queued.priority, priority);
                queued.protect ||= protect;
            } else {
                queued.priority = priority;
                queued.protect = protect;
            }
            queued.frame = this.#frame;
        } else {
            this.#queued.set(key, {
                frame: this.#frame,
                key,
                priority,
                protect,
                sequence: this.#sequence++,
                x: canonicalX,
                y,
                zoom
            });
        }
        return null;
    }

    /**
     * Returns a ready tile without scheduling a request.
     *
     * @param zoom    - Integer tile zoom.
     * @param x       - Possibly unwrapped tile column.
     * @param y       - Tile row.
     * @param protect - Whether the tile must be protected from eviction during this frame.
     * @returns Ready image or null when unavailable.
     */
    public peek(zoom: number, x: number, y: number, protect = true): HTMLImageElement | null {
        const canonical = this.#canonicalize(zoom, x, y);
        if (canonical == null) {
            return null;
        }
        const ready = this.#ready.get(canonical.key);
        if (ready == null) {
            return null;
        }
        this.#ready.delete(canonical.key);
        if (protect) {
            ready.protectedFrame = this.#frame;
        }
        this.#ready.set(canonical.key, ready);
        return ready.image;
    }

    /**
     * Returns the canonical coordinate for a tile.
     *
     * @param zoom - Integer tile zoom.
     * @param x    - Possibly unwrapped tile column.
     * @param y    - Tile row.
     * @returns Canonical cache key and X coordinate, or `null` when the tile is outside the grid or configured coverage.
     */
    #canonicalize(zoom: number, x: number, y: number): CanonicalTile | null {
        const scale = 2 ** (zoom - this.#source.minZoom);
        const columns = this.#source.rootColumns * scale;
        const rows = this.#source.rootRows * scale;
        if (y < 0 || y >= rows || (!this.#source.wrapX && (x < 0 || x >= columns))) {
            return null;
        }
        const canonicalX = this.#source.wrapX ? modulo(x, columns) : x;
        const coverage = this.#source.coverage;
        if (canonicalX + 1 <= coverage.left * columns || canonicalX >= coverage.right * columns
            || y + 1 <= coverage.top * rows || y >= coverage.bottom * rows) {
            return null;
        }
        return { key: `${zoom}/${canonicalX}/${y}`, x: canonicalX };
    }

    /** Evicts least-recently-used ready images until the configured limit is met. */
    #evict(): void {
        while (this.#ready.size > this.#maxTiles) {
            let oldestKey: string | undefined;
            let unprotectedKey: string | undefined;
            for (const [ key, tile ] of this.#ready) {
                oldestKey ??= key;
                if (tile.protectedFrame !== this.#frame) {
                    unprotectedKey = key;
                    break;
                }
            }
            const key = unprotectedKey ?? oldestKey;
            if (key == null) {
                return;
            }
            this.#ready.delete(key);
        }
    }

    /**
     * Compares two queued requests by priority and insertion order.
     *
     * @param first  - First request.
     * @param second - Second request.
     * @returns Negative when `first` loads earlier, positive when `second` loads earlier, or zero when equivalent.
     */
    static #comparePriority(first: QueuedTile, second: QueuedTile): number {
        return first.priority - second.priority || first.sequence - second.sequence;
    }

    /**
     * Returns the discrete priority class encoded in a numeric tile priority.
     *
     * @param priority - Numeric request priority.
     * @returns Non-negative priority-class index.
     */
    #getPriorityClass(priority: number): number {
        return Math.floor(priority / tilePriorityClassSize);
    }

    /**
     * Cancels obsolete or lower-class loads only when they block visible current- or destination-view requests.
     *
     * Buffer requests deliberately do not trigger cancellation, so ordinary small pans can reuse
     * requests which have just moved outside the buffered range.
     */
    #preemptLoads(): void {
        const freeSlots = Math.max(0, this.#maxConcurrentLoads - this.#loading.size);
        const blockedRequests = [ ...this.#queued.values() ]
            .filter(tile => tile.protect)
            .sort(TileCache.#comparePriority)
            .slice(freeSlots);
        if (blockedRequests.length === 0) {
            return;
        }

        const candidates = [ ...this.#loading.values() ]
            .sort((first, second) => Number(second.frame !== this.#frame) - Number(first.frame !== this.#frame)
                || second.priority - first.priority
                || first.frame - second.frame
                || first.sequence - second.sequence);
        for (const request of blockedRequests) {
            const requestClass = this.#getPriorityClass(request.priority);
            const candidateIndex = candidates.findIndex(tile => tile.frame !== this.#frame || this.#getPriorityClass(tile.priority) > requestClass);
            if (candidateIndex === -1) {
                return;
            }
            const [ tile ] = candidates.splice(candidateIndex, 1);
            if (tile != null) {
                this.#abort(tile);
            }
        }
    }

    /**
     * Cancels one active request without treating it as a failed tile load.
     *
     * @param tile - Active request to cancel and detach from its image.
     */
    #abort(tile: LoadingTile): void {
        tile.image.removeEventListener("load", tile.onLoad);
        tile.image.removeEventListener("error", tile.onError);
        this.#loading.delete(tile.key);
        tile.image.removeAttribute("src");
    }

    /** Starts queued requests while loading slots are available. */
    #pump(): void {
        while (!this.#disposed && this.#loading.size < this.#maxConcurrentLoads && this.#queued.size > 0) {
            const queued = this.#queued.values();
            let next = queued.next().value;
            assertNotNull(next, "first queued tile");
            for (const tile of queued) {
                if (tile.priority < next.priority || (tile.priority === next.priority && tile.sequence < next.sequence)) {
                    next = tile;
                }
            }
            this.#queued.delete(next.key);
            this.#start(next);
        }
    }

    /**
     * Starts loading one queued tile.
     *
     * URL-resolution errors are recorded as ordinary failed tile loads rather than escaping into the render loop.
     *
     * @param tile - Queued request to start.
     * @throws Any exception raised by the configured image factory.
     */
    #start(tile: QueuedTile): void {
        const image = this.#createImage();

        /** Promotes the completed request into the ready LRU cache and reports relevant activity. */
        const onLoad = (): void => {
            image.removeEventListener("error", onError);
            const loading = this.#loading.get(tile.key);
            const protectedFrame = loading?.protect === true ? loading.frame : -1;
            this.#loading.delete(tile.key);
            if (!this.#disposed) {
                this.#ready.set(tile.key, { image, protectedFrame });
                this.#failed.delete(tile.key);
                this.#scheduleRetry();
                this.#evict();
                this.#onChange(tile.zoom, tile.x, tile.y);
            }
        };

        /** Records an image request failure and reports loader activity. */
        const onError = (): void => {
            image.removeEventListener("load", onLoad);
            this.#loading.delete(tile.key);
            if (!this.#disposed) {
                this.#rememberFailure(tile.key);
            }
        };
        const loading: LoadingTile = { ...tile, image, onError, onLoad };
        this.#loading.set(tile.key, loading);

        if (this.#source.crossOrigin != null) {
            image.crossOrigin = this.#source.crossOrigin;
        }
        image.decoding = "async";
        image.addEventListener("load", onLoad, { once: true });
        image.addEventListener("error", onError, { once: true });
        try {
            image.src = resolveTileURL(this.#source.tileURL, tile.zoom, tile.x, tile.y);
        } catch {
            image.removeEventListener("load", onLoad);
            image.removeEventListener("error", onError);
            this.#loading.delete(tile.key);
            this.#rememberFailure(tile.key);
        }
    }

    /**
     * Remembers a failed request without allowing the failure cache to grow without bounds.
     *
     * @param key - Canonical tile key which failed.
     */
    #rememberFailure(key: string): void {
        this.#failed.delete(key);
        this.#failed.set(key, Date.now() + this.#retryDelay);
        while (this.#failed.size > this.#maxTiles) {
            const oldest = this.#failed.keys().next().value;
            assertNotNull(oldest, "oldest failed tile key");
            this.#failed.delete(oldest);
        }
        this.#scheduleRetry();
    }

    /**
     * Schedules one wake-up for the earliest future retry deadline.
     *
     * @param ignoreUntil - Retry timestamps through this value are ignored because they have already triggered a wake-up. Defaults to the current time.
     */
    #scheduleRetry(ignoreUntil = Date.now()): void {
        if (this.#disposed) {
            return;
        }
        const now = Date.now();
        let retryAt = Number.POSITIVE_INFINITY;
        for (const failedUntil of this.#failed.values()) {
            if (failedUntil > ignoreUntil) {
                retryAt = Math.min(retryAt, failedUntil);
            }
        }
        if (retryAt === this.#retryTimerAt) {
            return;
        }
        if (this.#retryTimer != null) {
            clearTimeout(this.#retryTimer);
            this.#retryTimer = null;
        }
        this.#retryTimerAt = retryAt;
        if (Number.isFinite(retryAt)) {
            const scheduledAt = retryAt;
            this.#retryTimer = setTimeout(() => {
                this.#retryTimer = null;
                this.#retryTimerAt = Number.POSITIVE_INFINITY;
                if (!this.#disposed) {
                    if (Date.now() < scheduledAt) {
                        this.#scheduleRetry();
                        return;
                    }
                    this.#onRetry();
                    this.#scheduleRetry(scheduledAt);
                }
            }, Math.max(0, retryAt - now));
        }
    }
}
