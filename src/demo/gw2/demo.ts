/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { LinearProjection, MapComponent, type TileSource } from "@kayahr/etchmap";

const source: TileSource = {
    attribution: "© <a href=\"https://www.arena.net/en/legal/content-terms-of-use\" target=\"_blank\" rel=\"noopener noreferrer\">ArenaNet, LLC.</a>",
    coverage: {
        bottom: 111_000 / 114_688,
        left: 0,
        right: 1,
        top: 9_000 / 114_688
    },
    maxZoom: 7,
    minZoom: 1,
    projection: new LinearProjection({ bottom: 114_688, left: 0, right: 81_920, top: 0 }),
    rootColumns: 5,
    rootRows: 7,
    tileURL: "https://tiles.guildwars2.com/1/1/{z}/{x}/{y}.jpg"
};

const map = new MapComponent({ coverViewport: false, source, zoom: 1, minZoom: 0 });
document.body.append(map.getElement());
