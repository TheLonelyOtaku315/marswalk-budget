// NASA base layers for the map. Owner: photos layers (Claude 2, then louis-claude for Gale). Contract: CONTRACTS.md §5.
//
// Two sites: Jezero (Mars Trek HiRISE/CTX tiles + Perseverance traverse) and Gale (our own HiRISE
// colour crop data/gale/imagery.png + Curiosity traverse data/gale/traverse.json). The site is picked
// from where the terrain grid is, so callers don't change.
//
// Mars Trek serves Jezero mosaics as WMTS tiles in an equirectangular (plate carrée) grid:
// zoom 0 = 2 x 1 tiles from (-180°, 90°), URL .../{z}/{row}/{col}.png, CORS open. That grid is
// not Leaflet's default web-mercator grid, so instead of L.tileLayer we place each Trek tile as an
// L.imageOverlay at its exact lat/lon bounds. Over a 2 km walk area the mercator stretch inside
// one tile is far below a pixel, so this lines up with the UI's lat/lon overlays on any CRS.
// (If the map itself uses L.CRS.EPSG4326 the grids match and a plain tile layer is used.)
//
// Verified 2026-11-14, see STATUS.md:
//   https://trek.nasa.gov/tiles/Mars/EQ/<layer>/1.0.0/default/default028mm/{z}/{row}/{col}.png
//   https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json

import { cellToLatLon } from './engine.js';

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ';
const TRAVERSE_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json';

// Gale (Mount Sharp boxwork) files, prepared by scripts/prep_gale.mjs (see data/gale/README.md).
const GALE_DIR = new URL('../data/gale/', import.meta.url);
const GALE_CREDIT = 'Imagery: MRO HiRISE colour mosaic (NASA/JPL-Caltech/UArizona), USGS Astrogeology; Curiosity traverse: NASA/JPL MMGIS';

/** True when the terrain grid lies in Gale Crater (about 4.6° S, 137.4° E). */
export function isGale(terrain) {
  const o = terrain?.origin;
  return Boolean(o) && o.lat > -6.5 && o.lat < -3 && o.lon > 136 && o.lon < 139;
}
const TREK_CREDIT = 'Imagery: <a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA Mars Trek</a>, MRO HiRISE/CTX (NASA/JPL-Caltech/UArizona/MSSS)';

export const TREK_LAYERS = {
  hirise: {
    id: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd',
    name: 'HiRISE 25 cm (Mars Trek)',
    minZoom: 8, maxZoom: 17,
    bounds: [[18.3068, 77.2229], [18.6693, 77.5840]],
  },
  ctx: {
    id: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0',
    name: 'CTX 6 m (Mars Trek)',
    minZoom: 6, maxZoom: 12,
    bounds: [[18.2110, 77.1605], [18.7212, 77.6992]],
  },
};

// data/real/area.json, used when no terrain is passed.
const AREA_BOUNDS = [[18.43660, 77.38717], [18.47040, 77.42283]];

export function trekTileUrl(layerId, z, row, col) {
  return `${TREK}/${layerId}/1.0.0/default/default028mm/${z}/${row}/${col}.png`;
}

/** [[south, west], [north, east]] of the terrain grid's outer cell edges. */
export function terrainBounds(terrain) {
  if (!terrain?.origin || !terrain.width) return AREA_BOUNDS;
  const se = cellToLatLon(terrain, terrain.width - 0.5, terrain.height - 0.5);
  return [[se.lat, terrain.origin.lon], [terrain.origin.lat, se.lon]];
}

const tileDeg = (z) => 180 / 2 ** z;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function tileRange(b, z) {
  const d = tileDeg(z);
  return {
    r0: Math.floor((90 - b.getNorth()) / d), r1: Math.floor((90 - b.getSouth()) / d),
    c0: Math.floor((b.getWest() + 180) / d), c1: Math.floor((b.getEast() + 180) / d),
  };
}

/** Equirectangular WMTS tiles drawn as georeferenced image overlays (works on any map CRS). */
function eqTileLayer(L, spec, { opacity = 1, maxTiles = 64, pane } = {}) {
  const limit = L.latLngBounds(spec.bounds);
  const group = L.layerGroup();
  const tiles = new Map(); // "z/r/c" -> overlay
  let map = null;
  let shownZ = null;
  let want = new Set();   // tiles the current view needs
  let pending = 0;        // of those, still loading

  // Keep the previous zoom's tiles until the new ones arrive, so the map never flashes empty.
  function dropStale() {
    for (const [key, ov] of tiles) {
      if (want.has(key)) continue;
      if (Number(key.split('/')[0]) !== shownZ || tiles.size > maxTiles * 3) {
        group.removeLayer(ov);
        tiles.delete(key);
      }
    }
  }

  function update() {
    if (!map) return;
    const view = map.getBounds();
    if (!view.intersects(limit)) return;
    const b = L.latLngBounds(
      [Math.max(view.getSouth(), limit.getSouth()), Math.max(view.getWest(), limit.getWest())],
      [Math.min(view.getNorth(), limit.getNorth()), Math.min(view.getEast(), limit.getEast())]);
    const degPerPx = (view.getNorth() - view.getSouth()) / Math.max(1, map.getSize().y);
    let z = clamp(Math.ceil(Math.log2(180 / (256 * degPerPx))), spec.minZoom, spec.maxZoom);
    let rg = tileRange(b, z);
    while (z > spec.minZoom && (rg.r1 - rg.r0 + 1) * (rg.c1 - rg.c0 + 1) > maxTiles) rg = tileRange(b, --z);

    want = new Set();
    pending = 0;
    const d = tileDeg(z);
    const wantNow = want;
    const done = () => { if (want === wantNow && --pending === 0) dropStale(); };
    for (let r = rg.r0; r <= rg.r1; r++) {
      for (let c = rg.c0; c <= rg.c1; c++) {
        const key = `${z}/${r}/${c}`;
        want.add(key);
        if (tiles.has(key)) continue;
        const north = 90 - r * d, west = c * d - 180;
        const o = d / 512; // half-pixel overlap hides hairline seams between overlays
        const ov = L.imageOverlay(trekTileUrl(spec.id, z, r, c), [[north - d - o, west - o], [north + o, west + d + o]],
          { opacity, interactive: false, pane, className: 'pb-trek-tile' });
        pending++;
        ov.once('load error', done);
        tiles.set(key, ov);
        group.addLayer(ov);
      }
    }
    shownZ = z;
    if (pending === 0) dropStale();
  }

  const Layer = L.Layer.extend({
    onAdd(m) {
      map = m;
      group.addTo(m);
      m.on('moveend zoomend resize', update);
      update();
    },
    onRemove(m) {
      m.off('moveend zoomend resize', update);
      group.remove();
      map = null;
    },
    getAttribution: () => TREK_CREDIT,
    setOpacity(o) {
      opacity = o;
      group.eachLayer((ov) => ov.setOpacity(o));
      return this;
    },
  });
  return new Layer();
}

function trekLayer(L, map, spec, opts = {}) {
  if (map.options.crs === L.CRS.EPSG4326) {
    // Same grid as Trek: a normal tile layer lines up exactly.
    return L.tileLayer(`${TREK}/${spec.id}/1.0.0/default/default028mm/{z}/{y}/{x}.png`, {
      bounds: spec.bounds, minNativeZoom: spec.minZoom, maxNativeZoom: spec.maxZoom,
      maxZoom: 22, opacity: opts.opacity ?? 1, attribution: TREK_CREDIT, pane: opts.pane,
    });
  }
  return eqTileLayer(L, spec, opts);
}

const geoCache = new Map();
function loadGeo(url) {
  if (!geoCache.has(url)) {
    geoCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`traverse HTTP ${r.status}`);
      return r.json();
    }));
  }
  return geoCache.get(url);
}

/** A rover's actual drive path as a dashed line, clipped to `bounds` (+ margin). */
function traverseLayer(L, bounds, { url = TRAVERSE_URL, rover = 'Perseverance' } = {}) {
  const group = L.layerGroup();
  const box = L.latLngBounds(bounds).pad(0.5);
  loadGeo(url).then((geo) => {
    for (const f of geo.features || []) {
      const g = f.geometry;
      const lines = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
      for (const coords of lines) {
        const pts = coords.map(([lon, lat]) => [lat, lon]);
        if (!pts.some((p) => box.contains(p))) continue;
        L.polyline(pts, {
          color: '#7fd3ff', weight: 2, opacity: 0.9, dashArray: '6 5', interactive: true,
        }).bindTooltip(`${rover} drive${f.properties?.sol != null ? `, sol ${f.properties.sol}` : ''}`, { sticky: true })
          .addTo(group);
      }
    }
  }).catch((err) => console.warn('[basemap] rover traverse not loaded:', err.message));
  return group;
}

/** Gale: our HiRISE colour crop as one image overlay, placed on the exact area.json bounds. */
function galeImageryLayer(L, terrain, pane) {
  const layer = L.imageOverlay(new URL('imagery.png', GALE_DIR).href, terrainBounds(terrain),
    { pane, interactive: false, attribution: GALE_CREDIT, className: 'pb-gale-imagery' });
  fetch(new URL('area.json', GALE_DIR)).then((r) => (r.ok ? r.json() : null)).then((a) => {
    const b = a?.bounds;
    if (b) layer.setBounds(L.latLngBounds([b.south, b.west], [b.north, b.east]));
  }).catch(() => { /* keep the terrain bounds */ });
  return layer;
}

function addGaleLayers(L, map, terrain, pane) {
  const bounds = terrainBounds(terrain);
  const hirise = galeImageryLayer(L, terrain, pane);
  const traverse = traverseLayer(L, bounds, { url: new URL('traverse.json', GALE_DIR).href, rover: 'Curiosity' });
  hirise.addTo(map);
  traverse.addTo(map);
  const control = L.control.layers(null, {
    'HiRISE colour (USGS mosaic)': hirise,
    'Curiosity traverse': traverse,
  }, { collapsed: true, position: 'topright' }).addTo(map);
  return { layers: { hirise, traverse }, control };
}

/**
 * Add NASA base layers to the Leaflet map.
 * Returns { layers: { hirise, ctx, traverse }, control } (CONTRACTS §5).
 * On real terrain the HiRISE mosaic and the rover traverse are shown; on synthetic terrain they
 * are only offered in the layer control, because the imagery would not match the invented grid.
 */
export function addBaseLayers(map, terrain) {
  const L = globalThis.L;
  if (!map || !L) return { layers: {}, control: null };

  const pane = 'pbBasemap';
  if (!map.getPane(pane)) {
    map.createPane(pane);
    map.getPane(pane).style.zIndex = 250; // above Leaflet tiles (200), below overlays (400)
  }

  if (isGale(terrain)) return addGaleLayers(L, map, terrain, pane);

  const bounds = terrainBounds(terrain);
  const hirise = trekLayer(L, map, TREK_LAYERS.hirise, { pane });
  const ctx = trekLayer(L, map, TREK_LAYERS.ctx, { pane, maxTiles: 36 });
  const traverse = traverseLayer(L, bounds);

  const synthetic = Boolean(terrain?.synthetic);
  const tag = synthetic ? ' — real Jezero, not this synthetic grid' : '';
  const overlays = {
    [`${TREK_LAYERS.hirise.name}${tag}`]: hirise,
    [`${TREK_LAYERS.ctx.name}${tag}`]: ctx,
    [`Perseverance traverse${tag}`]: traverse,
  };
  if (!synthetic) {
    hirise.addTo(map);
    traverse.addTo(map);
  }
  const control = L.control.layers(null, overlays, { collapsed: true, position: 'topright' }).addTo(map);
  return { layers: { hirise, ctx, traverse }, control };
}
