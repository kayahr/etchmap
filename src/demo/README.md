# @kayahr/map demo

For simplicity the demos in this directory do not use a web bundler. Instead they load the scripts as standard ESM using an importmap. Because browsers don't like loading local files by default for security reasons you must access them via a local web server or start your browser with enabled file access.

## Local webserver

There are many ways to do this. One is this:

- Run `npm install` and `npm run build` in the project root directory.
- Run `npx node-http-server` in the project root directory.
- Open http://127.0.0.1:8080/src/demo/simple/ for the geometry demo, http://127.0.0.1:8080/src/demo/flights/ for the animated international-flight demo, http://127.0.0.1:8080/src/demo/gw2/ for the Guild Wars 2 linear-map demo or http://127.0.0.1:8080/src/demo/wopr/ for the animated attack-route demo.

## Enable file access in Chrome

Start Chrome like this to open the demo with enabled local file access:

```
google-chrome --allow-file-access-from-files src/demo/simple/index.html
```

## Guild Wars 2 content notice

The Guild Wars 2 map demo is an unofficial fan project using ArenaNet's public tile service.

© ArenaNet, LLC. All rights reserved. NCSOFT, ArenaNet, Guild Wars, Guild Wars 2, GW2, Heart of Thorns, Path of Fire, End of Dragons, Secrets of the Obscure, Janthir Wilds, Visions of Eternity, and all associated logos, designs, and composite marks are trademarks or registered trademarks of NCSOFT Corporation. All other trademarks are the property of their respective owners.
