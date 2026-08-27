---
title: View options
---

# View options

View options configure the initial camera center and zoom, the permitted zoom range and whether the map must fill the viewport. They can be specified programmatically through `MapOptions` or declaratively through attributes on `<kayahr-map>`.

Pass the initial view and its constraints to `MapComponent`:

```ts
const map = new MapComponent({
    center: { x: 6.9603, y: 50.9375 },
    coverViewport: false,
    maxZoom: 18,
    minZoom: 5,
    zoom: 13
});
```

For declarative configuration the custom element provides equivalent HTML attributes:

```html
<kayahr-map
  center-x="6.9603"
  center-y="50.9375"
  cover-viewport="false"
  max-zoom="18"
  min-zoom="5"
  zoom="13"
></kayahr-map>
```

## Center

`MapOptions.center` sets the initial center in the coordinate system interpreted by the source projection. It defaults to the center of the source's tile coverage. Declarative maps use the `center-x` and `center-y` attributes, which must either both be present or both be omitted.

## Zoom

At a view zoom equal to the source's `minZoom`, one logical source-tile pixel occupies one CSS pixel. Each additional zoom level doubles the displayed map dimensions, while subtracting one level halves them. View zooms may be fractional or negative.

`MapOptions.zoom` sets the initial view zoom. When it is omitted, the map starts one level above its effective minimum, capped at its view maximum. Declarative maps use the `zoom` attribute.

## Zoom limits

`MapOptions.minZoom` and `MapOptions.maxZoom` limit the continuous view zoom. They default to the current source's native `minZoom` and `maxZoom`, but are independent of tile LOD: A lower view minimum scales the source's minimum-level tiles down, while a higher view maximum scales its maximum-level tiles up. Declarative maps use the `min-zoom` and `max-zoom` attributes.

## Viewport covering

By default, `MapOptions.coverViewport` raises the effective minimum zoom as necessary to prevent unused space above and below the tile coverage, and also at its sides for a non-wrapping source. Set it to `false` or use `cover-viewport="false"` declaratively to permit this empty space. The effective minimum never exceeds the configured view maximum.

## Changing view options

The `center`, `zoom`, `minZoom`, `maxZoom` and `coverViewport` properties on `MapComponent` can change the corresponding values after construction. Use `setView()` to apply a center and zoom together. Because `minZoom` must not exceed `maxZoom`, replacing both limits individually can temporarily produce an invalid range even when the final range is valid. `setZoomRange()` validates and applies the new pair together.
