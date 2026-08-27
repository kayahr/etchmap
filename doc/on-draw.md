---
title: onDraw callback
---

# onDraw callback

`MapComponent.onDraw` draws application-specific Canvas content over the raster map. The callback runs synchronously after the base map has been drawn in every produced map frame, so its projected positions always match the current center and zoom.

`onDraw` is called whenever the map is redrawn. This happens when the map first appears, when its size changes, while the user pans or zooms, after the view or tile source changes, and when a tile finishes loading. If nothing changes, the map does not redraw and the callback is not called again. If application data used by the callback changes while the map is idle, call `invalidate()` to request a redraw. Assigning a new callback also requests one.

```ts
type MapDrawCallback = (
    context: CanvasRenderingContext2D,
    map: MapComponent
) => true | false | void;
```

The `context` parameter is the map's destination 2D Canvas context. Its coordinate system uses CSS pixels with `(0, 0)` at the top-left, regardless of the native Canvas resolution and device pixel ratio. The Canvas state is saved before the callback and restored afterwards, so changes to styles, transforms and clipping do not leak into later map rendering.

The `map` parameter is the `MapComponent` producing the frame. It provides the current view, viewport dimensions and projection helpers needed to convert source coordinates into matching Canvas or HTML positions.

Returning `true` requests another frame and is useful for application animations. Returning `false` or nothing lets the map become idle again unless another change requires a frame. Exceptions propagate after the Canvas state has been restored.

## Useful map properties and methods

| API | Purpose inside `onDraw` |
| --- | --- |
| `width`, `height` | Current logical viewport size in CSS pixels. |
| `nativeWidth`, `nativeHeight` | Canvas backing-store size in device pixels. |
| `devicePixelRatio` | Number of backing-store pixels per CSS pixel. |
| `center`, `zoom` | Current view in source coordinates and continuous zoom. |
| `minZoom`, `maxZoom`, `coverViewport` | Current view constraints. |
| `source` | Current normalized tile-source configuration and projection. |
| `projectPoint()` | Projects one location into viewport-relative CSS pixels. Offscreen points include `clippedX` and `clippedY` and can be detected with `isClippedPoint()`. |
| `projectPolyline()` | Projects and clips a source-coordinate polyline, returning all visible runs and wrapped copies. |
| `projectPolygon()` | Projects and clips a source-coordinate polygon, returning all visible wrapped copies. |
| `unproject()` | Converts a viewport-relative CSS-pixel position back into source coordinates. |
| `getElement()` | Returns the map element containing slotted HTML overlays. |
| `invalidate()` | Schedules a frame after application data used by the callback changes. |

## Canvas rendering

This example draws the naturally projected route from Cologne to Bonn over the map. `projectPolyline()` performs viewport clipping and may return multiple visible runs, so each returned line is drawn separately.

```ts
import { MapComponent } from "@kayahr/etchmap";

const map = new MapComponent({
    center: { x: 7.03, y: 50.84 },
    zoom: 10
});
const route = [
    { x: 6.9603, y: 50.9375 },
    { x: 7.0982, y: 50.7374 }
];
const lineWidth = 4;

map.onDraw = (context, map) => {
    context.lineCap = "round";
    context.lineWidth = lineWidth;
    context.strokeStyle = "#0768d7";

    for (const line of map.projectPolyline(route, { margin: lineWidth / 2 })) {
        const [ first, ...remaining ] = line;
        if (first == null) {
            continue;
        }
        context.beginPath();
        context.moveTo(first.x, first.y);
        for (const point of remaining) {
            context.lineTo(point.x, point.y);
        }
        context.stroke();
    }
};

document.body.append(map.getElement());
```

The margin accounts for half the line width, so the route remains visible while any part of its stroke can still overlap the viewport.

## Animation

Returning `true` keeps producing frames. This example draws a time-based pulse around Cologne Cathedral while it is visible. Returning `false` when it is offscreen stops unnecessary animation frames; normal map interaction invokes the callback again and restarts the animation when the location becomes visible.

```ts
import { MapComponent, isClippedPoint } from "@kayahr/etchmap";

const cathedral = { x: 6.9583, y: 50.9413 };
const map = new MapComponent({ center: cathedral, zoom: 14 });
const radius = 12;
const radiusChange = 4;
const lineWidth = 3;

map.onDraw = (context, map) => {
    const point = map.projectPoint(cathedral, {
        margin: radius + radiusChange + lineWidth / 2
    });
    if (isClippedPoint(point)) {
        return false;
    }

    const phase = performance.now() / 1_000 * Math.PI * 2;
    const animatedRadius = radius + Math.sin(phase) * radiusChange;
    context.beginPath();
    context.arc(point.x, point.y, animatedRadius, 0, Math.PI * 2);
    context.lineWidth = lineWidth;
    context.strokeStyle = "#d71920";
    context.stroke();
    return true;
};

document.body.append(map.getElement());
```

The margin accounts for the largest animated radius plus half the line width. The pulse therefore remains visible while any part of its stroke can still overlap the viewport.

## HTML location marker

Direct children of `<kayahr-map>` are slotted into its HTML overlay layer and positioned relative to the map viewport. The same projected CSS-pixel coordinates used for Canvas drawing can therefore update their `left` and `top` styles in `onDraw`.

```html
<script type="module">
  import { MapElement, isClippedPoint } from "@kayahr/etchmap";

  const element = document.querySelector("kayahr-map");
  if (!(element instanceof MapElement)) {
    throw new Error("Map element not found");
  }
  const marker = element.querySelector(".location-marker");
  if (!(marker instanceof HTMLElement)) {
    throw new Error("Location marker not found");
  }

  const cathedral = { x: 6.9583, y: 50.9413 };
  element.getComponent().onDraw = (_context, map) => {
    const point = map.projectPoint(cathedral, { margin: 12 });
    if (isClippedPoint(point)) {
      marker.hidden = true;
      return;
    }
    marker.hidden = false;
    marker.style.left = `${point.x}px`;
    marker.style.top = `${point.y}px`;
  };
</script>

<style>
  kayahr-map {
    width: 100vw;
    height: 100vh;
  }

  .location-marker {
    width: 1rem;
    height: 1rem;
    border: 3px solid white;
    border-radius: 50%;
    background: #d71920;
    box-shadow: 0 2px 6px rgb(0 0 0 / 45%);
    pointer-events: none;
    transform: translate(-50%, -50%);
  }
</style>

<kayahr-map center-x="6.9583" center-y="50.9413" zoom="14">
  <div class="location-marker" title="Cologne Cathedral"></div>
</kayahr-map>
```

The 12 CSS pixel projection margin keeps the marker visible until it has moved completely beyond the viewport edge. Keeping offscreen elements hidden also avoids assigning potentially very large projected coordinates to CSS properties.
