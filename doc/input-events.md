---
title: Map input events
---

# Map input events

`<kayahr-map>` dispatches enriched events for mouse, pen, touch and wheel input on the map Canvas. They provide the usual browser-event information together with the map location beneath the input. Use them to inspect or select locations, implement drawing tools or replace a built-in map interaction with application-specific behavior.

| Event | Dispatched when |
| --- | --- |
| `map-pointerdown` | A pointer becomes active on the map Canvas. |
| `map-pointermove` | A pointer moves over the Canvas or continues moving while captured by it. |
| `map-pointerup` | An active pointer is released. |
| `map-pointercancel` | The browser cancels an active pointer. |
| `map-wheel` | A wheel event occurs over the map Canvas. |

The four `map-pointer*` events implement `MapPointerEvent`, which extends `PointerEvent`. `map-wheel` implements `MapWheelEvent`, which extends `WheelEvent`. All map input events bubble from the `<kayahr-map>` element and are composed, so they can also be handled by its ancestors.

Slotted HTML overlays receive their ordinary native pointer events. Map pointer events are generated for input handled by the map Canvas itself.

## Listening for events

Listen on the element owned by a `MapComponent`. Merely observing an event does not interfere with the built-in map interactions.

```ts
import { MapComponent } from "@kayahr/etchmap";

const map = new MapComponent({
    center: { x: 6.9603, y: 50.9375 },
    zoom: 13
});
const element = map.getElement();

element.addEventListener("map-pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) {
        return;
    }
    console.log("Selected source position", event.sourcePoint);
});

element.addEventListener("map-wheel", event => {
    console.log("Wheel at source position", event.sourcePoint, event.deltaY);
});

document.body.append(element);
```

## Coordinates

`MapPointerEvent` and `MapWheelEvent` provide the input position in three map coordinate systems in addition to the inherited browser coordinates.

| Property | Coordinate system |
| --- | --- |
| `viewportPoint` | CSS pixels relative to the top-left corner of the map viewport. |
| `sourcePoint` | Coordinates interpreted by the current source projection, such as longitude and latitude in degrees for Web Mercator. This is equivalent to calling `map.unproject(event.viewportPoint)`. |
| `worldPoint` | Pixels in the tile world at the source's minimum zoom level. Unlike `sourcePoint`, its horizontal coordinate preserves which repeated world copy was targeted when the source wraps. |
| `clientX`, `clientY` | Inherited browser-viewport coordinates from the native pointer event. |
| `originalEvent` | The unmodified native `PointerEvent` from which the map event was created. |

## Wheel input

`map-wheel` exposes the inherited `deltaX`, `deltaY`, `deltaZ` and `deltaMode` properties together with the map coordinates beneath the wheel cursor. Calling `preventDefault()` on the map event suppresses the built-in wheel-zoom animation. It does not cancel the native browser action; call `event.originalEvent.preventDefault()` as well when an application-specific wheel interaction must also prevent page scrolling.

## Claiming a pointer

Call `preventDefault()` on `map-pointerdown` when application code should handle that pointer instead of the built-in map interaction. The map captures the claimed pointer, continues dispatching its move and final up or cancel event even outside the element, and does not use it for panning or pinch zooming.

This example lets one pointer drag a custom location without moving the map:

```ts
import { MapComponent, type MapPointerEvent } from "@kayahr/etchmap";

const map = new MapComponent({
    center: { x: 6.9603, y: 50.9375 },
    zoom: 13
});
const element = map.getElement();
let location = { x: 6.9603, y: 50.9375 };
let pointerId: number | null = null;
const radius = 6;

map.onDraw = (context, map) => {
    const point = map.projectPoint(location, { margin: radius });
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = "#d71920";
    context.fill();
};

const moveLocation = (event: MapPointerEvent): void => {
    location = event.sourcePoint;
    map.invalidate();
};

element.addEventListener("map-pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) {
        return;
    }
    event.preventDefault();
    pointerId = event.pointerId;
    moveLocation(event);
});

element.addEventListener("map-pointermove", event => {
    if (event.pointerId === pointerId) {
        moveLocation(event);
    }
});

const finishDrag = (event: MapPointerEvent): void => {
    if (event.pointerId === pointerId) {
        pointerId = null;
    }
};

element.addEventListener("map-pointerup", finishDrag);
element.addEventListener("map-pointercancel", finishDrag);
document.body.append(element);
```

Canceling only a `map-pointermove` suppresses the built-in camera update for that movement. Canceling `map-pointerup` suppresses momentum that would otherwise start on release. A `map-pointercancel` always ends the pointer stream.
