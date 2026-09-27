import type { StyleSpecification } from "maplibre-gl";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

// A commercial deployment should point this at a keyed / self-hosted raster
// tile service (the public OSM tile servers are for light, non-commercial use).
// Build-time env: NEXT_PUBLIC_MAP_TILE_URL (an {z}/{x}/{y} template) and
// NEXT_PUBLIC_MAP_ATTRIBUTION. Without it the OSM tiles remain the fallback.
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || OSM_TILES;
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION
  ? `${process.env.NEXT_PUBLIC_MAP_ATTRIBUTION} · ${OSM_ATTRIBUTION}`
  : OSM_ATTRIBUTION;

/**
 * The one raster base style for every map (live fleet map, trip map). Built
 * inline (not a hosted style URL) so the map never depends on a style host.
 */
export const BASE_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [TILE_URL],
      tileSize: 256,
      maxzoom: 19,
      attribution: ATTRIBUTION,
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};
