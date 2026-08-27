/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { type MapComponent, MapElement, type Point, WebMercatorProjection } from "@kayahr/map";

/** Airport data stored in the route-data file. */
interface AirportData {
    /** ICAO identifiers of airports directly reachable from this airport. */
    readonly dests: readonly string[];

    /** Airport longitude in degrees. */
    readonly x: number;

    /** Airport latitude in degrees. */
    readonly y: number;
}

/** Airport network stored as ICAO-keyed route data. */
type AirportNetworkData = Readonly<Record<string, AirportData>>;

/** Airport prepared for repeated route selection and projection. */
interface Airport extends Point {
    /** ICAO identifiers of airports directly reachable from this airport. */
    readonly destinations: readonly string[];

    /** Four-letter ICAO airport identifier. */
    readonly icao: string;
}

/** Aircraft category used by the simulation. */
interface AircraftProfile {
    /** Aircraft color. */
    readonly color: string;

    /** Prebuilt aircraft silhouette pointing along the positive X axis. */
    readonly icon: Path2D;

    /** Route color at 75 percent of the aircraft color's RGB brightness. */
    readonly routeColor: string;

    /** Scale applied to the aircraft silhouette. */
    readonly scale: number;

    /** Cruising speed in kilometers per hour. */
    readonly speedKmH: number;
}

/** Route prepared for repeated projection. */
interface Route {
    /** Great-circle route length in kilometers. */
    readonly distanceKm: number;

    /** Direction-independent route reservation key. */
    readonly key: string;

    /** Departure airport. */
    readonly start: Airport;

    /** Destination airport. */
    readonly stop: Airport;
}

/** Aircraft continually selecting free connections through the airport network. */
interface Flight {
    /** Airport at which the aircraft waits for a free outgoing route, or `null` while airborne. */
    airport: Airport | null;

    /** Aircraft category. */
    readonly profile: AircraftProfile;

    /** Progress from zero at departure through one at the destination. */
    progress: number;

    /** Currently reserved route, or `null` while waiting at an airport. */
    route: Route | null;
}

/** Visible screen-space aircraft position and direction. */
interface ProjectedAircraft {
    /** Aircraft heading in Canvas radians. */
    readonly angle: number;

    /** Aircraft position in CSS pixels. */
    readonly position: Point;
}

const airlinerProfile: AircraftProfile = {
    color: "#38bdf8",
    icon: new Path2D("M 18 0 C 18 -1.5 16 -2.4 12 -2.6 L 3 -2.6 L -5 -11.5 L -8 -11.5 L -4 -2.4 L -11 -1.8 L -15 -5.5 L -17 -5.5 L -16 -1.2 L -18 -0.7 L -18 0.7 L -16 1.2 L -17 5.5 L -15 5.5 L -11 1.8 L -4 2.4 L -8 11.5 L -5 11.5 L 3 2.6 L 12 2.6 C 16 2.4 18 1.5 18 0 Z"),
    routeColor: "#2a8eba",
    scale: 1,
    speedKmH: 900
};
const concordeProfile: AircraftProfile = {
    color: "#fbbf24",
    icon: new Path2D("M 25 0 C 22 -1 17 -1.3 10 -1.4 L 6 -1.8 C 1 -2.2 -4 -5.5 -10 -8.7 C -14 -10.9 -17 -11.8 -19 -11.5 C -19.7 -9 -19.8 -4.2 -19 -2 L -26 0 L -19 2 C -19.8 4.2 -19.7 9 -19 11.5 C -17 11.8 -14 10.9 -10 8.7 C -4 5.5 1 2.2 6 1.8 L 10 1.4 C 17 1.3 22 1 25 0 Z"),
    routeColor: "#bc8f1b",
    scale: 0.75,
    speedKmH: 2_180
};
const scramjetProfile: AircraftProfile = {
    color: "#f43fdb",
    icon: new Path2D("M 17 0 L 3 -1.5 L -9 -8 L -12 -7 L -6 -1 L -13 0 L -6 1 L -12 7 L -9 8 L 3 1.5 Z"),
    routeColor: "#b72fa4",
    scale: 1,
    speedKmH: 7_000
};
const initialFlightCount = 100;
const initialTimeFactor = 100;
const flightFadeDuration = 500;
const concordeShare = 0.2;
const scramjetShare = 0.05;
const earthRadius = 6_371;
const projection = new WebMercatorProjection();
const viewportMargin = -10;

const element = document.querySelector("kayahr-map");
if (!(element instanceof MapElement)) {
    throw new Error("Map element not found");
}
const mapElement = element;

const fps = mapElement.querySelector(".fps");
if (!(fps instanceof HTMLOutputElement)) {
    throw new Error("FPS output not found");
}
const fpsOutput = fps;

const frameTimes: number[] = [];
let lastFPSUpdate = 0;

/** Loads the route data and starts the perpetual flight animation. */
async function initialize(): Promise<void> {
    const airportNetwork = await loadAirportNetwork();
    const activeRoutes = new Set<string>();
    let flights = createFlights(airportNetwork, activeRoutes, initialFlightCount);
    let timeFactor = initialTimeFactor;
    initializeControls(count => {
        activeRoutes.clear();
        flights = createFlights(airportNetwork, activeRoutes, count);
    }, factor => {
        timeFactor = factor;
    });
    let previousFrameTime = performance.now();
    mapElement.getComponent().onDraw = (context, map): true => {
        const now = performance.now();
        const elapsed = now - previousFrameTime;
        previousFrameTime = now;
        const simulationStep = elapsed * timeFactor;
        updateFlights(flights, airportNetwork, activeRoutes, simulationStep);

        context.fillStyle = "rgb(3 12 24 / 52%)";
        context.fillRect(0, 0, map.width, map.height);
        for (const flight of flights) {
            if (flight.route != null) {
                drawRoute(context, map, flight.route, flight.profile, getFlightOpacity(flight, timeFactor));
            }
        }
        for (const flight of flights) {
            drawFlight(context, map, flight, getFlightOpacity(flight, timeFactor));
        }
        updateFPS(now);
        return true;
    };
}

/** Loads and converts the bundled ICAO-keyed airport network. */
async function loadAirportNetwork(): Promise<ReadonlyMap<string, Airport>> {
    const response = await fetch("routes.json");
    if (!response.ok) {
        throw new Error(`Unable to load flight routes: ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as AirportNetworkData;
    return new Map(Object.entries(data).map(([ icao, airport ]) => [ icao, {
        destinations: airport.dests,
        icao,
        x: airport.x,
        y: airport.y
    } ]));
}

/** Creates the configured number of flights on distinct randomly selected routes. */
function createFlights(airportNetwork: ReadonlyMap<string, Airport>, activeRoutes: Set<string>, count: number): Flight[] {
    const candidates = createDirectedRoutes(airportNetwork);
    shuffle(candidates);
    const selectedKeys = new Set(activeRoutes);
    const routes: Route[] = [];
    for (const route of candidates) {
        if (!selectedKeys.has(route.key)) {
            selectedKeys.add(route.key);
            routes.push(route);
            if (routes.length === count) {
                break;
            }
        }
    }
    if (routes.length < count) {
        throw new RangeError(`Unable to place ${count} aircraft on only ${routes.length} exclusive routes`);
    }

    const scramjetCount = Math.round(count * scramjetShare);
    const concordeCount = Math.round(count * concordeShare);
    const profiles = [
        ...Array.from({ length: count - concordeCount - scramjetCount }, () => airlinerProfile),
        ...Array.from({ length: concordeCount }, () => concordeProfile),
        ...Array.from({ length: scramjetCount }, () => scramjetProfile)
    ];
    shuffle(profiles);
    return routes.map((route, index) => {
        activeRoutes.add(route.key);
        return { airport: null, profile: profiles[index], progress: Math.random(), route };
    });
}

/** Creates every directed route contained in the airport network. */
function createDirectedRoutes(airportNetwork: ReadonlyMap<string, Airport>): Route[] {
    const routes: Route[] = [];
    for (const start of airportNetwork.values()) {
        for (const destination of start.destinations) {
            const stop = airportNetwork.get(destination);
            if (stop != null) {
                routes.push(createRoute(start, stop));
            }
        }
    }
    return routes;
}

/** Creates a directed route between two airports. */
function createRoute(start: Airport, stop: Airport): Route {
    return {
        distanceKm: greatCircleDistance(start, stop),
        key: createRouteKey(start, stop),
        start,
        stop
    };
}

/** Creates the unique reservation key shared by both directions of an airport connection. */
function createRouteKey(start: Airport, stop: Airport): string {
    return start.icao < stop.icao ? `${start.icao}-${stop.icao}` : `${stop.icao}-${start.icao}`;
}

/** Advances all aircraft by the elapsed real time while maintaining direction-independent route reservations. */
function updateFlights(flights: readonly Flight[], airportNetwork: ReadonlyMap<string, Airport>, activeRoutes: Set<string>, elapsed: number): void {
    for (const flight of flights) {
        updateFlight(flight, airportNetwork, activeRoutes, elapsed);
    }
}

/** Advances one aircraft and selects free onward connections whenever it arrives at an airport. */
function updateFlight(flight: Flight, airportNetwork: ReadonlyMap<string, Airport>, activeRoutes: Set<string>, elapsed: number): void {
    let remainingDistance = flight.profile.speedKmH * elapsed / 3_600_000;
    while (remainingDistance > 0) {
        if (flight.route == null && !selectNextRoute(flight, airportNetwork, activeRoutes)) {
            return;
        }
        const route = flight.route;
        if (route == null) {
            return;
        }
        const distanceToDestination = (1 - flight.progress) * route.distanceKm;
        if (remainingDistance < distanceToDestination) {
            flight.progress += remainingDistance / route.distanceKm;
            return;
        }

        remainingDistance -= distanceToDestination;
        activeRoutes.delete(route.key);
        flight.airport = route.stop;
        flight.progress = 0;
        flight.route = null;
        selectNextRoute(flight, airportNetwork, activeRoutes);
    }
}

/** Reserves one random route whose airport pair is free in both directions. */
function selectNextRoute(flight: Flight, airportNetwork: ReadonlyMap<string, Airport>, activeRoutes: Set<string>): boolean {
    const start = flight.airport;
    if (start == null) {
        return false;
    }
    const destinations = start.destinations
        .map(destination => airportNetwork.get(destination))
        .filter((destination): destination is Airport => destination != null && !activeRoutes.has(createRouteKey(start, destination)));
    if (destinations.length === 0) {
        return false;
    }

    const stop = destinations[Math.floor(Math.random() * destinations.length)];
    const route = createRoute(start, stop);
    activeRoutes.add(route.key);
    flight.airport = null;
    flight.route = route;
    return true;
}

/** Returns the shortest surface distance between two longitude/latitude points in kilometers. */
function greatCircleDistance(start: Point, stop: Point): number {
    const startLatitude = start.y * Math.PI / 180;
    const stopLatitude = stop.y * Math.PI / 180;
    const latitudeDelta = stopLatitude - startLatitude;
    const longitudeDelta = (stop.x - start.x) * Math.PI / 180;
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(startLatitude) * Math.cos(stopLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return earthRadius * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

/** Returns the linear transition opacity for one aircraft and its active route. */
function getFlightOpacity(flight: Flight, timeFactor: number): number {
    const route = flight.route;
    if (route == null) {
        return 0;
    }
    const transitionDistance = flight.profile.speedKmH * timeFactor * flightFadeDuration / 3_600_000;
    if (transitionDistance <= 0) {
        return 1;
    }
    const distanceFromStart = flight.progress * route.distanceKm;
    const distanceToDestination = (1 - flight.progress) * route.distanceKm;
    return Math.max(0, Math.min(1, distanceFromStart / transitionDistance, distanceToDestination / transitionDistance));
}

/** Randomizes an array in place with a Fisher-Yates shuffle. */
function shuffle<T>(values: T[]): void {
    for (let index = values.length - 1; index > 0; --index) {
        const otherIndex = Math.floor(Math.random() * (index + 1));
        [ values[index], values[otherIndex] ] = [ values[otherIndex], values[index] ];
    }
}

/** Draws every visible wrapped copy of one active flight route. */
function drawRoute(context: CanvasRenderingContext2D, map: MapComponent, route: Route, profile: AircraftProfile, opacity: number): void {
    const lines = map.projectPolyline([ route.start, route.stop ], { interpolation: "natural", margin: viewportMargin });
    const endpoints = [
        ...map.projectPoint(route.start, { margin: viewportMargin, wrapCopies: true }),
        ...map.projectPoint(route.stop, { margin: viewportMargin, wrapCopies: true })
    ];
    context.save();
    context.globalAlpha *= opacity;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = profile.routeColor;
    context.lineWidth = 3;
    strokePolylines(context, lines);
    context.fillStyle = profile.routeColor;
    context.beginPath();
    for (const endpoint of endpoints) {
        context.moveTo(endpoint.x + 4, endpoint.y);
        context.arc(endpoint.x, endpoint.y, 4, 0, Math.PI * 2);
    }
    context.fill();
    context.restore();
}

/** Draws one aircraft at its current route position or waiting airport. */
function drawFlight(context: CanvasRenderingContext2D, map: MapComponent, flight: Flight, opacity: number): void {
    const route = flight.route;
    if (route == null) {
        return;
    }

    const position = projection.interpolateLine(route.start, route.stop, flight.progress);
    for (const aircraft of projectAircraft(map, route, position, flight.progress)) {
        drawAircraft(context, flight.profile, aircraft, opacity);
    }
}

/** Projects all visible wrapped copies of an aircraft and determines their screen-space headings. */
function projectAircraft(map: MapComponent, route: Route, position: Point, ratio: number): ProjectedAircraft[] {
    const positions = map.projectPoint(position, { margin: viewportMargin, wrapCopies: true });
    if (positions.length === 0) {
        return [];
    }

    const ratioStep = 2 ** (-map.zoom - 8);
    const referenceRatio = Math.min(1, ratio + ratioStep);
    const referencePosition = projection.interpolateLine(route.start, route.stop, referenceRatio);
    const references = map.projectPoint(referencePosition, { margin: viewportMargin + 20, wrapCopies: true });
    return positions.map(position => {
        let reference: Point | null = null;
        let squareReferenceDistance = Infinity;
        for (const candidate of references) {
            const deltaX = candidate.x - position.x;
            const deltaY = candidate.y - position.y;
            const squareDistance = deltaX * deltaX + deltaY * deltaY;
            if (squareDistance < squareReferenceDistance) {
                reference = candidate;
                squareReferenceDistance = squareDistance;
            }
        }
        return {
            angle: reference == null ? 0 : Math.atan2(reference.y - position.y, reference.x - position.x),
            position
        };
    });
}

/** Draws a colored vector silhouette for one projected aircraft. */
function drawAircraft(context: CanvasRenderingContext2D, profile: AircraftProfile, aircraft: ProjectedAircraft, opacity: number): void {
    context.save();
    context.globalAlpha *= opacity;
    context.translate(aircraft.position.x, aircraft.position.y);
    context.rotate(aircraft.angle);
    context.scale(profile.scale, profile.scale);
    context.fillStyle = profile.color;
    context.fill(profile.icon);
    context.strokeStyle = "rgb(255 255 255 / 78%)";
    context.lineWidth = 0.8 / profile.scale;
    context.stroke(profile.icon);
    context.restore();
}

/** Draws separately clipped screen-space polylines. */
function strokePolylines(context: CanvasRenderingContext2D, lines: ReadonlyArray<readonly Point[]>): void {
    for (const line of lines) {
        context.beginPath();
        context.moveTo(line[0].x, line[0].y);
        for (let index = 1; index < line.length; ++index) {
            const point = line[index];
            context.lineTo(point.x, point.y);
        }
        context.stroke();
    }
}

/** Connects the flight-count and time-factor controls to the running simulation. */
function initializeControls(onFlightCountChange: (count: number) => void, onTimeFactorChange: (factor: number) => void): void {
    const flightCountButtons = [ ...mapElement.querySelectorAll<HTMLButtonElement>("button[data-flight-count]") ];
    for (const button of flightCountButtons) {
        button.addEventListener("click", () => {
            const count = Number(button.dataset.flightCount);
            onFlightCountChange(count);
            selectControlButton(flightCountButtons, button);
        });
    }

    const timeFactorButtons = [ ...mapElement.querySelectorAll<HTMLButtonElement>("button[data-time-factor]") ];
    for (const button of timeFactorButtons) {
        button.addEventListener("click", () => {
            const factor = Number(button.dataset.timeFactor);
            onTimeFactorChange(factor);
            selectControlButton(timeFactorButtons, button);
        });
    }
}

/** Marks one button in a control group as selected. */
function selectControlButton(buttons: readonly HTMLButtonElement[], selectedButton: HTMLButtonElement): void {
    for (const button of buttons) {
        const selected = button === selectedButton;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", selected.toString());
    }
}

/** Periodically updates the rolling FPS display. */
function updateFPS(now: number): void {
    frameTimes.push(now);
    const cutoff = now - 1_000;
    while ((frameTimes[0] ?? now) < cutoff) {
        frameTimes.shift();
    }
    if (now - lastFPSUpdate < 200) {
        return;
    }
    if (frameTimes.length > 1) {
        fpsOutput.value = `${((frameTimes.length - 1) * 1_000 / (now - frameTimes[0])).toFixed(1)} FPS`;
    }
    lastFPSUpdate = now;
}

void initialize().catch((error: unknown) => {
    queueMicrotask(() => { throw error; });
});
