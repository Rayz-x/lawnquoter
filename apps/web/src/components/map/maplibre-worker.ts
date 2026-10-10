import { setWorkerUrl } from "maplibre-gl";

/**
 * MapLibre loads its parser from a worker script next to its own module
 * (`maplibre-gl-worker.mjs` beside `import.meta.url`). Next bundles that module
 * into a hashed chunk and does not emit the sibling worker, so the worker
 * errors. Raster imagery still draws. GeoJSON does not, which is every parcel,
 * footprint, pin, and measurement shape.
 *
 * `new URL(..., import.meta.url)` makes the bundler emit the worker as its own
 * file and rewrite this to that file's URL.
 */
const workerUrl = new URL("../../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url);

setWorkerUrl(workerUrl.href);
