// MapLibre's web worker cannot be located by the Next.js bundler ("Worker failed to load"),
// so it is served as a static file from /vendor and referenced with setWorkerUrl().
// Copied (not committed) before dev and build, so it always matches the installed version.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
mkdirSync("public/vendor", { recursive: true });
copyFileSync(join(dist, "maplibre-gl-worker.mjs"), "public/vendor/maplibre-gl-worker.mjs");
console.log("copied maplibre-gl-worker.mjs to public/vendor");
