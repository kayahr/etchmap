# EtchMap

[GitHub] | [NPM] | [API Doc]

A browser library for smooth interactive XYZ raster-tile maps like [OpenStreetMap].

* [Canvas]-based.
* Minimal by design: only renders the map and handles the usual pan and zoom interactions.
* Developer-friendly `onDraw` callback to draw application-specific visuals after the map has been rendered in each frame.
* Programmatic usage through the `MapComponent` class.
* Declarative usage through the `<kayahr-map>` custom element.
* Configurable map source. Defaults to [OpenStreetMap].
* Built-in [Web Mercator] and linear projections with support for custom projections.
* Zero runtime dependencies.

## Declarative creation

Import the package module, give the element a CSS size, and specify the initial view directly in HTML.

```html
<script type="module">
  import "@kayahr/etchmap";
</script>

<style>
  kayahr-map {
    width: 100vw;
    height: 100vh;
  }
</style>

<kayahr-map center-x="6.9603" center-y="50.9375" zoom="13"></kayahr-map>
```

JavaScript can access the complete component API of a declaratively created map with `document.querySelector("kayahr-map").getComponent()`.

## Programmatic creation

```ts
import { MapComponent } from "@kayahr/etchmap";

const map = new MapComponent({
    center: { x: 6.9603, y: 50.9375 },
    zoom: 13
});

map.onDraw = (context, map) => {
    const point = map.projectPoint({ x: 6.9583, y: 50.9413 });
    context.fillRect(point.x - 4, point.y - 4, 8, 8);
};

document.body.append(map.getElement());
```

## Demos

- [Simple demo] uses the default OpenStreetMap source and the `onDraw` callback to position an HTML marker at Cologne Cathedral.
- [GW2 demo] renders the Tyria world map from the [Guild Wars 2 map API] as a linear tile source with viewport covering disabled.
- [Flights demo] is a more complex animated example with moving aircraft, dynamically changing routes and naturally projected great-circle polylines.

## See also

- [View options](doc/view-options.md)
- [onDraw callback](doc/on-draw.md)
- [Map input events](doc/input-events.md)
- [Tile sources and projections](doc/sources.md)

[API Doc]: https://kayahr.github.io/etchmap/
[GitHub]: https://github.com/kayahr/etchmap/
[NPM]: https://www.npmjs.com/package/@kayahr/etchmap/
[Canvas]: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API
[Flights demo]: https://kayahr.github.io/etchmap/demo/flights.html
[GW2 demo]: https://kayahr.github.io/etchmap/demo/gw2.html
[Guild Wars 2 map API]: https://wiki.guildwars2.com/wiki/API:Maps
[Simple demo]: https://kayahr.github.io/etchmap/demo/simple.html
[Web Mercator]: https://en.wikipedia.org/wiki/Web_Mercator_projection
[OpenStreetMap]: https://www.openstreetmap.org/
