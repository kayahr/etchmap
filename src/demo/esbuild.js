/*
 * Copyright (C) 2026 Klaus Reimer
 * SPDX-License-Identifier: MIT
 */

import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = fileURLToPath(new URL("../..", import.meta.url));
const sourceDir = join(projectDir, "src");
const libDir = join(projectDir, "lib");
const demoDir = join(projectDir, "lib/apidoc/demo");
const importMapScript = `    <script type="importmap">
      {
        "imports": {
          "@kayahr/map": "./kayahr-map.js"
        }
      }
    </script>`;

/**
 * Copies a demo HTML file while replacing its development scripts with the self-contained API-documentation scripts.
 *
 * @param name - Name of the demo.
 */
async function copyDemoHtml(name) {
    const sourceFile = join(sourceDir, `demo/${name}/index.html`);
    const targetFile = join(demoDir, `${name}.html`);
    const sourceImportMap = "    <script src=\"../../../lib/importmap.js\"></script>";
    const sourceModule = `    <script src="../../../lib/demo/${name}/demo.js" type="module"></script>`;
    const targetModule = `    <script src="${name}.js" type="module"></script>`;
    const html = await readFile(sourceFile, "utf8");
    if (!html.includes(sourceImportMap) || !html.includes(sourceModule)) {
        throw new Error(`Unable to locate development scripts in ${sourceFile}`);
    }
    await writeFile(targetFile, html.replace(sourceImportMap, importMapScript).replace(sourceModule, targetModule), "utf8");
}

await rm(demoDir, { recursive: true, force: true });
await mkdir(demoDir, { recursive: true });

await build({
    entryPoints: [ join(libDir, "main/index.js") ],
    outfile: join(demoDir, "kayahr-map.js"),
    bundle: true,
    format: "esm",
    legalComments: "none",
    minify: true,
    platform: "browser",
    target: "es2022"
});

await Promise.all([
    copyDemoHtml("flights"),
    copyDemoHtml("gw2"),
    copyDemoHtml("simple"),
    copyFile(join(libDir, "demo/flights/demo.js"), join(demoDir, "flights.js")),
    copyFile(join(libDir, "demo/gw2/demo.js"), join(demoDir, "gw2.js")),
    copyFile(join(libDir, "demo/simple/demo.js"), join(demoDir, "simple.js")),
    copyFile(join(sourceDir, "demo/flights/routes.json"), join(demoDir, "routes.json"))
]);
