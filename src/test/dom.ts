/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import "@happy-dom/global-registrator/register.js";

/** Scheduled animation-frame callbacks keyed by request ID. */
export const animationFrames = new Map<number, FrameRequestCallback>();

/** Animation-frame request IDs passed to `cancelAnimationFrame`. */
export const canceledAnimationFrames: number[] = [];

/** Device-pixel ratio exposed by the shared DOM environment. */
let currentDevicePixelRatio = 1;

/** ID assigned to the next animation-frame request. */
let nextAnimationFrame = 1;

/** Minimal ResizeObserver entry accepted by {@link ResizeObserverMock.trigger}. */
export interface ResizeObserverEntryLike {
    readonly contentRect: Pick<DOMRectReadOnly, "width" | "height">;
    readonly devicePixelContentBoxSize: readonly ResizeObserverSize[];
}

/** Controllable ResizeObserver implementation shared by DOM-based tests. */
export class ResizeObserverMock implements ResizeObserver {
    /** Created observer instances in construction order. */
    public static readonly instances: ResizeObserverMock[] = [];

    /** Callback notified by {@link trigger}. */
    readonly #callback: ResizeObserverCallback;

    /** Whether {@link disconnect} was called. */
    public disconnected = false;

    /** Recorded observation requests. */
    public readonly observations: Array<{ readonly target: Element; readonly options?: ResizeObserverOptions }> = [];

    /**
     * Creates a controllable observer.
     *
     * @param callback - Callback to invoke from {@link trigger}.
     */
    public constructor(callback: ResizeObserverCallback) {
        this.#callback = callback;
        ResizeObserverMock.instances.push(this);
    }

    /** Marks the observer as disconnected. */
    public disconnect(): void {
        this.disconnected = true;
    }

    /** Records an observation request. */
    public observe(target: Element, options?: ResizeObserverOptions): void {
        this.observations.push({ target, options });
    }

    /** Invokes the observer callback with one synthetic entry. */
    public trigger(entry: ResizeObserverEntryLike): void {
        this.#callback([ entry as ResizeObserverEntry ], this);
    }

    /** Accepts an unobserve request. */
    public unobserve(): void {}
}

/** Factory returning a 2D context for a Canvas created by a test. */
export type CanvasContextFactory = (canvas: HTMLCanvasElement) => CanvasRenderingContext2D;

/** Current 2D context factory used by the shared Canvas mock. */
let canvasContextFactory: CanvasContextFactory = () => ({}) as CanvasRenderingContext2D;

/**
 * Replaces the 2D context returned by every test Canvas.
 *
 * @param context - Context to return.
 */
export function setCanvasContext(context: CanvasRenderingContext2D): void {
    setCanvasContextFactory(() => context);
}

/**
 * Replaces the factory used to create 2D contexts for test Canvases.
 *
 * @param factory - Context factory receiving the Canvas on which `getContext` was called.
 */
export function setCanvasContextFactory(factory: CanvasContextFactory): void {
    canvasContextFactory = factory;
}

/** Clears scheduled and canceled animation-frame requests. */
export function resetAnimationFrames(): void {
    animationFrames.clear();
    canceledAnimationFrames.length = 0;
}

/**
 * Runs and removes the next scheduled animation-frame callback.
 *
 * @param timestamp - Frame timestamp passed to the callback.
 * @throws Error - If no animation frame is scheduled.
 */
export function runAnimationFrame(timestamp: number): void {
    const frame = animationFrames.entries().next().value;
    if (frame == null) {
        throw new Error("Expected a scheduled animation frame");
    }
    animationFrames.delete(frame[0]);
    frame[1](timestamp);
}

/**
 * Changes the device-pixel ratio exposed by the shared DOM environment.
 *
 * @param value - Device-pixel ratio to expose.
 */
export function setDevicePixelRatio(value: number): void {
    currentDevicePixelRatio = value;
}

Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverMock
});
Object.defineProperty(globalThis, "devicePixelRatio", {
    configurable: true,
    get: () => currentDevicePixelRatio
});
Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value(callback: FrameRequestCallback): number {
        const id = nextAnimationFrame++;
        animationFrames.set(id, callback);
        return id;
    }
});
Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value(id: number): void {
        canceledAnimationFrames.push(id);
        animationFrames.delete(id);
    }
});
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(this: HTMLCanvasElement): CanvasRenderingContext2D {
        return canvasContextFactory(this);
    }
});
