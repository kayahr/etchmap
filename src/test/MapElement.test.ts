/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import "./dom.ts";
import { describe, it } from "node:test";
import { assertCloseTo, assertEquals, assertInstanceOf, assertSame, assertThrowWithMessage } from "@kayahr/assert";

const { MapComponent, MapElement, osmTileSource } = await import("../main/index.ts");

describe("MapElement", () => {
    describe("getComponent", () => {
        it("owns and returns its fixed component", () => {
            const element = document.createElement("kayahr-map");
            assertInstanceOf(element, MapElement);
            const component = element.getComponent();
            assertInstanceOf(component, MapComponent);
            assertSame(element.getComponent(), component);
            assertSame(component.getElement(), element);

            const shadow = element.shadowRoot;
            assertInstanceOf(shadow, ShadowRoot);
            assertInstanceOf(shadow.children[0], HTMLCanvasElement);
            assertSame(shadow.children[1]?.className, "layers");
            assertInstanceOf(shadow.children[1]?.firstElementChild, HTMLSlotElement);
            assertInstanceOf(shadow.children[1]?.children[1], HTMLDivElement);
            assertInstanceOf(shadow.children[2], HTMLStyleElement);
        });

        it("uses the component which created it", () => {
            const component = new MapComponent();
            const element = component.getElement();
            assertInstanceOf(element, MapElement);
            assertSame(element.getComponent(), component);
        });

    });

    describe("attributeChangedCallback", () => {
        it("applies complete declarative options before connecting", () => {
            const element = document.createElement("kayahr-map");
            element.setAttribute("center-x", "6.9603");
            element.setAttribute("center-y", "50.9375");
            element.setAttribute("cover-viewport", "false");
            element.setAttribute("max-zoom", "24");
            element.setAttribute("min-zoom", "-2");
            element.setAttribute("zoom", "13.5");
            element.setAttribute("source", JSON.stringify({
                coverage: { bottom: 0.9, left: 0.1, right: 0.8, top: 0.2 },
                crossOrigin: null,
                maxZoom: 7,
                minZoom: 1,
                projection: {
                    edges: { bottom: -90, left: -180, right: 180, top: 90 },
                    type: "linear"
                },
                rootColumns: 16,
                rootRows: 9,
                tileHeight: 90,
                tileURL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                tileWidth: 160
            }));
            document.body.append(element);

            const component = element.getComponent();
            assertCloseTo(component.center, { x: 6.9603, y: 50.9375 }, 8);
            assertSame(component.coverViewport, false);
            assertSame(component.maxZoom, 24);
            assertSame(component.minZoom, -2);
            assertSame(component.zoom, 13.5);
            assertSame(component.source.tileWidth, 160);
            assertSame(component.source.tileHeight, 90);
            assertSame(component.source.rootColumns, 16);
            assertSame(component.source.rootRows, 9);
            assertSame(component.source.maxZoom, 7);
            assertSame(component.source.minZoom, 1);
            assertEquals(component.source.coverage, { bottom: 0.9, left: 0.1, right: 0.8, top: 0.2 });
            assertSame(component.source.crossOrigin, null);
            assertCloseTo(component.source.projection?.project({ x: -180, y: 90 }), { x: 0, y: 0 }, 8);
            assertCloseTo(component.source.projection?.project({ x: 180, y: -90 }), { x: 1, y: 1 }, 8);
            const attribution = element.shadowRoot?.querySelector(".attribution");
            assertInstanceOf(attribution, HTMLDivElement);
            assertSame(attribution.innerHTML, "");
            element.remove();
        });

        it("requires both declarative center coordinates and accepts a later correction", async () => {
            const element = document.createElement("kayahr-map");
            element.setAttribute("center-x", "6.9603");

            assertThrowWithMessage(() => document.body.append(element), TypeError, "center-x and center-y must be used together");
            element.setAttribute("center-y", "50.9375");
            await Promise.resolve();

            assertCloseTo(element.getComponent().center, { x: 6.9603, y: 50.9375 }, 8);
            element.remove();
        });

        it("restores source-derived view limits when declarative overrides are removed", async () => {
            const element = document.createElement("kayahr-map");
            element.setAttribute("cover-viewport", "false");
            element.setAttribute("max-zoom", "24");
            element.setAttribute("min-zoom", "-2");
            element.setAttribute("source", JSON.stringify({
                maxZoom: 7,
                minZoom: 1,
                tileURL: "https://example.com/{z}/{x}/{y}.png"
            }));
            element.setAttribute("zoom", "13.5");
            document.body.append(element);

            const component = element.getComponent();
            element.removeAttribute("cover-viewport");
            element.removeAttribute("max-zoom");
            element.removeAttribute("min-zoom");
            await Promise.resolve();

            assertSame(component.coverViewport, true);
            assertSame(component.maxZoom, 7);
            assertSame(component.minZoom, 1);
            assertSame(component.zoom, 7);
            element.remove();
        });

        it("restores the default OpenStreetMap source when the source attribute is removed", async () => {
            const element = document.createElement("kayahr-map");
            element.setAttribute("source", JSON.stringify({
                attribution: "Custom map",
                tileURL: "https://example.com/{z}/{x}/{y}.png"
            }));
            document.body.append(element);

            const component = element.getComponent();
            assertSame(component.source.attribution, "Custom map");
            element.removeAttribute("source");
            await Promise.resolve();

            assertSame(component.source.attribution, osmTileSource.attribution);
            assertSame(component.source.tileURL, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
            element.remove();
        });

        it("uses the projected tile-coverage center for an initial declarative source", () => {
            const element = document.createElement("kayahr-map");
            element.setAttribute("source", JSON.stringify({
                coverage: { bottom: 0.5, left: 0.25, right: 0.75, top: 0.25 },
                projection: {
                    edges: { bottom: -200, left: 100, right: 500, top: 200 },
                    type: "linear"
                },
                tileURL: "https://example.com/{z}/{x}/{y}.png"
            }));
            document.body.append(element);

            assertCloseTo(element.getComponent().center, { x: 300, y: 50 }, 8);
            element.remove();
        });

        it("supports built-in projections, validates used properties and ignores additional data", () => {
            const linear = document.createElement("kayahr-map");
            linear.setAttribute("source", JSON.stringify({
                projection: "linear",
                tileURL: "https://example.com/{z}/{x}/{y}.png"
            }));
            document.body.append(linear);
            assertCloseTo(linear.getComponent().source.projection?.project({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 }, 8);
            linear.remove();

            const mercator = document.createElement("kayahr-map");
            mercator.setAttribute("source", JSON.stringify({
                projection: "web-mercator",
                tileURL: "https://example.com/{z}/{x}/{y}.png"
            }));
            document.body.append(mercator);
            assertCloseTo(mercator.getComponent().source.projection?.project({ x: 0, y: 0 }), { x: 0.5, y: 0.5 }, 8);
            mercator.remove();

            const malformed = document.createElement("kayahr-map");
            malformed.setAttribute("source", "{}");
            assertThrowWithMessage(() => document.body.append(malformed), TypeError, "source.tileURL must be a string");
            malformed.remove();

            const extended = document.createElement("kayahr-map");
            extended.setAttribute("source", JSON.stringify({
                applicationData: { name: "Extended map" },
                tileURL: "https://example.com/{z}/{x}/{y}.png"
            }));
            document.body.append(extended);
            assertSame(extended.getComponent().source.tileURL, "https://example.com/{z}/{x}/{y}.png");
            extended.remove();
        });

        it("applies and restores independently controlled scalar options", async () => {
            const minimum = document.createElement("kayahr-map");
            minimum.setAttribute("cache-size", "64");
            minimum.setAttribute("cover-viewport", "true");
            minimum.setAttribute("min-zoom", "-2");
            document.body.append(minimum);
            assertSame(minimum.getComponent().cacheSize, 64);
            assertSame(minimum.getComponent().coverViewport, true);
            assertSame(minimum.getComponent().minZoom, -2);

            minimum.removeAttribute("cache-size");
            await Promise.resolve();
            assertSame(minimum.getComponent().cacheSize, 512);
            minimum.remove();

            const maximum = document.createElement("kayahr-map");
            maximum.setAttribute("max-zoom", "24");
            document.body.append(maximum);
            assertSame(maximum.getComponent().maxZoom, 24);
            maximum.remove();
        });

        it("rejects malformed scalar attributes", () => {
            const cases: ReadonlyArray<readonly [ string, string, Function, string ]> = [
                [ "cache-size", "0", RangeError, "cache-size must be an integer greater than or equal to 1" ],
                [ "cache-size", "1.5", RangeError, "cache-size must be an integer greater than or equal to 1" ],
                [ "cover-viewport", "yes", TypeError, "cover-viewport must be true or false" ],
                [ "zoom", "", TypeError, "zoom must not be empty" ],
                [ "zoom", "Infinity", TypeError, "zoom must be a finite number" ]
            ];
            for (const [ name, value, errorType, message ] of cases) {
                const element = document.createElement("kayahr-map");
                element.setAttribute(name, value);
                assertThrowWithMessage(() => document.body.append(element), errorType, message);
                element.remove();
            }
        });

        it("rejects malformed declarative sources", () => {
            const cases: ReadonlyArray<readonly [ unknown, Function, string | RegExp ]> = [
                [ "{", SyntaxError, /./ ],
                [ null, TypeError, "source must be an object" ],
                [ [], TypeError, "source must be an object" ],
                [ { attribution: 1, tileURL: "tiles" }, TypeError, "source.attribution must be a string" ],
                [ { coverage: {}, tileURL: "tiles" }, TypeError, "source.coverage.bottom must be a number" ],
                [ { crossOrigin: "include", tileURL: "tiles" }, TypeError, "source.crossOrigin must be anonymous, use-credentials or null" ],
                [ { maxZoom: "7", tileURL: "tiles" }, TypeError, "source.maxZoom must be a number" ],
                [ { projection: false, tileURL: "tiles" }, TypeError, "source.projection must be an object" ],
                [ { projection: { type: "globe" }, tileURL: "tiles" }, TypeError, "source.projection.type must be linear" ],
                [ { projection: { edges: [], type: "linear" }, tileURL: "tiles" }, TypeError, "source.projection.edges must be an object" ],
                [ { tileURL: "tiles", wrapX: "true" }, TypeError, "source.wrapX must be a boolean" ]
            ];
            for (const [ source, errorType, message ] of cases) {
                const element = document.createElement("kayahr-map");
                element.setAttribute("source", typeof source === "string" ? source : JSON.stringify(source));
                assertThrowWithMessage(() => document.body.append(element), errorType, message);
                element.remove();
            }
        });

        it("does not apply a queued attribute change after disconnection", async () => {
            const element = document.createElement("kayahr-map");
            document.body.append(element);
            element.setAttribute("zoom", "7");
            element.remove();

            await Promise.resolve();

            assertSame(element.getComponent().zoom, 1);
        });

    });

    describe("connectedCallback", () => {
        it("does not overwrite standalone component options on connection", () => {
            const component = new MapComponent({
                center: { x: 34, y: 12 },
                source: {
                    attribution: "Custom tiles by <a href=\"https://example.com/copyright\">Example Maps</a>",
                    tileURL: "https://example.com/{z}/{x}/{y}.png"
                },
                zoom: 7
            });
            const element = component.getElement();
            document.body.append(element);

            assertCloseTo(component.center, { x: 34, y: 12 }, 8);
            assertSame(component.zoom, 7);
            assertSame(component.source.tileURL, "https://example.com/{z}/{x}/{y}.png");
            const attribution = element.shadowRoot?.querySelector(".attribution");
            assertInstanceOf(attribution, HTMLDivElement);
            assertSame(attribution.textContent, "Custom tiles by Example Maps");
            const link = attribution.querySelector("a");
            assertInstanceOf(link, HTMLAnchorElement);
            assertSame(link.href, "https://example.com/copyright");
            element.remove();
        });
    });
});
