---
title: Tile sources and projections
---

# Tile sources and projections

`@kayahr/map` renders XYZ raster-tile sources. A tile source defines where images are loaded from, the shape of the tile grid, the available zoom levels, horizontal wrapping, the source coordinate system and the attribution required by its provider.

## Default OpenStreetMap source

Omitting source configuration selects the standard OpenStreetMap tile source. It uses 256 × 256 pixel tiles, one root tile at zoom 0, zoom levels 0 through 19, horizontal wrapping and Web Mercator coordinates. The required `© OpenStreetMap contributors` attribution is displayed automatically, with `OpenStreetMap` linked to its copyright page.

```html
<script type="module">
  import "@kayahr/map";
</script>

<kayahr-map center-x="6.9603" center-y="50.9375" zoom="13"></kayahr-map>
```

```ts
import { MapComponent } from "@kayahr/map";

const map = new MapComponent({
    center: { x: 6.9603, y: 50.9375 },
    zoom: 13
});

document.body.append(map.getElement());
```

## Custom sources

A custom source starts with a tile URL. String templates support `{z}` for the integer zoom level, `{x}` for the tile column and `{y}` for the tile row. Configure the attribution HTML according to the requirements of the tile provider.

Attribution strings are inserted as trusted HTML without sanitization. Define them only in application-controlled source configuration, never from untrusted input.

### Programmatic configuration

Pass a `TileSource` in the `MapComponent` options. Programmatic tile URLs may be templates or functions.

```ts
import { MapComponent, WebMercatorProjection, type TileSource } from "@kayahr/map";

const source: TileSource = {
    attribution: '© <a href="https://example.com/copyright">Example Maps</a>',
    crossOrigin: "anonymous",
    maxZoom: 19,
    minZoom: 0,
    projection: new WebMercatorProjection(),
    rootColumns: 1,
    rootRows: 1,
    tileHeight: 256,
    tileURL: (zoom, x, y) => `https://example.com/tiles/${zoom}/${x}/${y}.png`,
    tileWidth: 256,
    wrapX: false
};

const map = new MapComponent({
    center: { x: 6.9603, y: 50.9375 },
    source,
    zoom: 13
});

document.body.append(map.getElement());
```

### Declarative configuration

Set the `source` attribute on `<kayahr-map>` to a JSON object. Single quotes delimit the HTML attribute so the JSON can use its required double quotes without escaping. The following example shows every supported source property with the ordinary custom-source defaults:

```html
<kayahr-map
  center-x="6.9603"
  center-y="50.9375"
  zoom="13"
  source='{
    "attribution": "© <a href=https://example.com/copyright>Example Maps</a>",
    "coverage": {
      "bottom": 1,
      "left": 0,
      "right": 1,
      "top": 0
    },
    "crossOrigin": "anonymous",
    "maxZoom": 19,
    "minZoom": 0,
    "projection": "web-mercator",
    "rootColumns": 1,
    "rootRows": 1,
    "tileHeight": 256,
    "tileURL": "https://example.com/tiles/{z}/{x}/{y}.png",
    "tileWidth": 256,
    "wrapX": false
  }'
></kayahr-map>
```

The recognized JSON properties mirror `TileSource`. Additional application-specific properties are ignored:

- `tileURL`: Required URL template containing `{z}`, `{x}` and `{y}` placeholders. Functions are available only through the programmatic API.
- `tileWidth` and `tileHeight`: Positive integer tile dimensions in CSS pixels. Both default to 256 and may differ.
- `rootColumns` and `rootRows`: Positive integer grid dimensions at the minimum zoom level. Both default to one.
- `minZoom` and `maxZoom`: Inclusive non-negative integer native tile LOD range. They default to zero and 19.
- `projection`: `web-mercator`, `linear` or a linear projection object with custom `edges`. It defaults to `web-mercator`.
- `coverage`: Rectangular valid area within the tile world. All four edges are normalized values from zero through one, with `(0, 0)` at the top-left and `(1, 1)` at the bottom-right. `left` must be smaller than `right`, and `top` must be smaller than `bottom`. It defaults to `{ left: 0, top: 0, right: 1, bottom: 1 }`. Tiles completely outside this area are not requested, intersecting edge tiles are clipped to it, and camera constraints use it as the available map area. It does not change the tile grid or URL coordinates and cannot describe holes within the rectangle.
- `wrapX`: Whether the grid repeats horizontally. It defaults to `false`.
- `crossOrigin`: `anonymous`, `use-credentials` or `null`. It defaults to `anonymous`.
- `attribution`: Trusted provider-credit HTML displayed over the map. It defaults to an empty string, which hides the attribution.

## Tile-grid geometry

At integer zoom `z`, a source contains `rootColumns * 2 ** (z - minZoom)` tile columns and `rootRows * 2 ** (z - minZoom)` tile rows. `rootColumns` and `rootRows` need not be equal, nor do `tileWidth` and `tileHeight`. A custom map can therefore model its native aspect ratio without fractional grid dimensions or transparent padding.

`minZoom` and `maxZoom` describe only the native tile-image levels available from the source. The renderer independently clamps its selected integer tile level to this range. [View zoom limits](view-options.md#zoom-limits) are configured separately and may extend below or above the native range, causing the renderer to scale the minimum- or maximum-level tiles.

When `wrapX` is enabled, the tile world and its columns repeat horizontally. Vertical wrapping is not supported, so tile rows never repeat.

## Partial tile coverage

Some providers use a rectangular tile grid whose edge tiles are only padding or whose finer zoom levels omit tiles outside the actual map. Sources describe the available rectangle with `coverage`, either in the declarative JSON or programmatically. Its edges use normalized tile-world coordinates from zero through one, with zero at the top or left and one at the bottom or right. `left` must be smaller than `right`, and `top` must be smaller than `bottom`. The default `{ left: 0, top: 0, right: 1, bottom: 1 }` covers the complete tile world. A tile is requested when any part of it intersects the coverage; pixels beyond the exact coverage edge are clipped. Camera constraints and the viewport-dependent minimum zoom also use this covered area. Coverage neither changes the tile grid or URL coordinates nor describes missing tiles within its rectangle.

```ts
const source: TileSource = {
    coverage: {
        bottom: 0.9,
        left: 0.1,
        right: 0.8,
        top: 0.2
    },
    tileURL: "https://example.com/tiles/{z}/{x}/{y}.png"
};
```

Horizontally wrapping sources must cover the complete width from zero through one because their entire tile grid is repeated.

## CORS

Tile images use anonymous CORS by default. Select `use-credentials` only when the provider requires credentialed requests and supplies matching CORS headers. A server without CORS support can be selected with `"crossOrigin": null` in the declarative JSON or `crossOrigin: null` programmatically, but drawing its images taints the Canvas. A tainted Canvas can still be displayed and drawn over in `onDraw`, but pixel reads and image export fail with a security exception.

## Coordinate projections

Every source coordinate is a `Point` with `x` and `y`. A projection maps these source coordinates to the normalized tile world, whose finite image area conventionally spans zero through one on both axes. Coordinates outside that range remain valid and allow paths to be clipped correctly at the tile-world edges.

### Web Mercator

`WebMercatorProjection` interprets X as longitude and Y as latitude, both in degrees. It is the default projection and is used by OpenStreetMap and many compatible geographic tile sources. Its natural line interpolation follows the shortest great-circle connection, which appears curved after projection.

Select it with `"projection": "web-mercator"` in a declarative source or programmatically with `new WebMercatorProjection()`. Geographic world maps commonly combine it with horizontal wrapping.

### Linear maps

`LinearProjection` maps arbitrary rectangular source coordinates directly to the tile world. It is suitable for game maps, floor plans, diagrams and other flat images. The four edges define the source coordinates corresponding to the complete tile world. Reversing `top` and `bottom` supports a Y axis which points upward.

```ts
import { LinearProjection, MapComponent } from "@kayahr/map";

const map = new MapComponent({
    center: { x: 0, y: 0 },
    source: {
        attribution: '© <a href="https://example.com/copyright">Example Game Maps</a>',
        projection: new LinearProjection({
            bottom: -324698,
            left: -324698,
            right: 324698,
            top: 324698
        }),
        tileURL: "https://example.com/satisfactory/{z}/{x}/{y}.png"
    }
});
```

Linear projections do not define curved natural routes, so natural and projected path interpolation produce the same straight connections.

Declarative example:

```html
<kayahr-map
  center-x="0"
  center-y="0"
  source='{
    "attribution": "© <a href=https://example.com/copyright>Example Game Maps</a>",
    "projection": {
      "type": "linear",
      "edges": {
        "bottom": -324698,
        "left": -324698,
        "right": 324698,
        "top": 324698
      }
    },
    "tileURL": "https://example.com/satisfactory/{z}/{x}/{y}.png"
  }'
></kayahr-map>
```

The short form `"projection": "linear"` uses the unit square from `{ x: 0, y: 0 }` at the top-left edge to `{ x: 1, y: 1 }` at the bottom-right edge. Use the object form shown above to configure source-coordinate edges. Reversing `top` and `bottom` supports a Y axis which points upward.

### Custom projections

Custom projections are configured programmatically by implementing the `Projection` interface. `project()` converts a source point to normalized tile-world coordinates and `unproject()` performs the reverse conversion. Both functions may return coordinates outside the finite zero-to-one tile area.

```ts
import { MapComponent, type Point, type Projection } from "@kayahr/map";

const projection: Projection = {
    project(point: Point): Point {
        return {
            x: (point.x + 1000) / 2000,
            y: (500 - point.y) / 1000
        };
    },
    unproject(point: Point): Point {
        return {
            x: point.x * 2000 - 1000,
            y: 500 - point.y * 1000
        };
    }
};

const map = new MapComponent({
    source: {
        attribution: '© <a href="https://example.com/copyright">Example Maps</a>',
        projection,
        tileURL: "https://example.com/tiles/{z}/{x}/{y}.png"
    }
});
```

Custom projections may additionally implement `interpolateLine(start, end, ratio)` to define the natural path between two source points. Without it, natural path interpolation falls back to straight connections in the projected map plane.
