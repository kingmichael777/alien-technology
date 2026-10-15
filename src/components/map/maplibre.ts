// Loaded on demand by CaseMapTab, so MapLibre and its stylesheet stay out of the main bundle.
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
// MapLibre 6 resolves its worker next to its own module, which does not survive bundling.
// Vite emits the worker as a hashed .js asset (precached by the service worker for offline use).
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";

setWorkerUrl(workerUrl);

export { MapLibreMap, Marker, NavigationControl };
