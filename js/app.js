// Marswalk Budget — app entry: loads data, runs the planner off the main thread, wires the UI.
// Owner: UI lane (Claude 1). Drawing helpers live in js/render.js.

import { latLonToCell } from './engine.js';
import { planRoute, slopeProfile, MODE_LABELS, ROUTE_MODES } from './routes.js';
import { planRover } from './rover.js';
import { CONFIG } from './config.js';
import { renderPhotos } from './photos.js';
import { addBaseLayers } from './basemap.js';
import { buildSteps } from './steps.js';
import { loadConditions, toToggles, verdict as conditionsVerdict, renderConditions as renderConditionsCard } from './conditions.js';
import {
  el, fmtClock, fmtDuration, fmtKg, fmtMSv, cellLatLng, terrainBounds,
  LAYER_INFO, rampCss, paintHillshade, paintSlope, paintScalar, imageLayer,
  stopIcon, habitatIcon, turnBackIcon, havenIcon, pathTimeline, renderBudget, renderChart,
} from './render.js';

const L = window.L;
const $ = (id) => document.getElementById(id);

// Page URL parameters shared by console, tablet and HUD (CONTRACTS §7).
const PARAMS = new URLSearchParams(location.search);
const SITES = {
  demo: {
    label: 'Demo data', defaultCond: 'demo-quiet', siteName: 'Demo terrain',
    radNote: 'Dose rate: Curiosity RAD measurements at <em>Gale Crater</em> (Hassler et al. 2014, ~0.64 mSv/day), applied to this synthetic demo terrain.',
  },
  real: {
    label: 'Real data · Jezero', defaultCond: 'real', siteName: 'Jezero Crater',
    radNote: 'Dose rate: Curiosity RAD measurements at <em>Gale Crater</em> (Hassler et al. 2014, ~0.64 mSv/day), used as a proxy for Jezero — no surface dosimeter has flown there.',
  },
  gale: {
    // Gale has its own real snapshot (Curiosity REMS, by Spain's CAB); Jezero (MEDA) weather is never shown here.
    label: 'Real data · Gale', defaultCond: 'real-gale', siteName: 'Gale Crater',
    radNote: 'Dose rate: Curiosity RAD measured <em>here</em> at Gale Crater (Hassler et al. 2014, ~0.64 mSv/day on the surface).',
  },
};
// Gale is the front door (CONTRACTS §7, 2026-11-14 16:11): no ?data= means Gale; Jezero is ?data=real.
const DEFAULT_DATASET = 'gale';
const DATASET = Object.hasOwn(SITES, PARAMS.get('data')) ? PARAMS.get('data') : DEFAULT_DATASET;
const SITE = SITES[DATASET];
const DATA_DIR = new URL(`../data/${DATASET}/`, import.meta.url);

const CONDITIONS = [
  { key: 'dustStorm', name: 'Dust storm', param: 'dust' },
  { key: 'solarEvent', name: 'Solar particle event', param: 'solar' },
  { key: 'heavyKit', name: 'Heavy sample kit', param: 'kit' },
];

// Conditions snapshots (CONTRACTS §6), loaded by js/conditions.js.
// Each site lists only its own real weather: Jezero (Perseverance MEDA) or Gale (Curiosity REMS).
const COND_SNAPSHOTS = [
  DATASET === 'gale'
    ? { name: 'real-gale', label: 'Latest real data · Gale (Curiosity REMS)' }
    : { name: 'real', label: 'Latest real data · Jezero (Perseverance MEDA)' },
  { name: 'demo-quiet', label: 'Demo: quiet sol' },
  { name: 'demo-dusty', label: 'Demo: dust storm' },
  { name: 'demo-solar', label: 'Demo: solar alert' },
];

const state = {
  terrain: null,
  habitat: null,
  targets: [],            // all targets, incl. ones the user added
  included: new Set(),    // ids the astronaut wants to visit
  conditions: {},
  plan: null,
  timeline: null,
  selectedId: null,
  customCount: 0,
  condName: COND_SNAPSHOTS.some((s) => s.name === PARAMS.get('cond')) ? PARAMS.get('cond') : SITE.defaultCond,
  route: ROUTE_MODES.includes(PARAMS.get('route')) ? PARAMS.get('route') : 'eco', // route option (CONTRACTS §8)
  alts: {},               // { eco, safe, short } plans for the current stops and conditions, filled in the background
  cond: null,             // loaded conditions snapshot, or null if it could not be loaded
  condError: null,
  chemistry: null,        // Gale APXS card loader (promise), see loadChemistryCard()
  vehicle: PARAMS.get('vehicle') === 'rover' ? 'rover' : 'walk', // on foot, or a pressurized rover (js/rover.js)
  havens: [],             // hypothetical supply cache + storm shelter for this site (data/<site>/havens.json)
  useHavens: PARAMS.get('havens') === '1',
};

let map, overlays = {}, routeLayer, markerLayer, stepHighlight = null, turnBackMarker = null;

// ---------------------------------------------------------------------------
// Planner: Web Worker (module worker from a Blob that imports engine.js), with
// a main-thread fallback if module workers are unavailable.
// ---------------------------------------------------------------------------

const planner = (() => {
  let worker = null, seq = 0;
  const pending = new Map();
  try {
    const routesUrl = new URL('./routes.js', import.meta.url).href;
    const roverUrl = new URL('./rover.js', import.meta.url).href;
    const src = `
      import { planRoute } from ${JSON.stringify(routesUrl)};
      import { planRover } from ${JSON.stringify(roverUrl)};
      let terrain = null;
      self.onmessage = async (e) => {
        const m = e.data;
        try {
          if (m.type === 'init') {
            terrain = await (await fetch(m.terrainUrl)).json();
            self.postMessage({ id: m.id, ok: true });
          } else {
            const plan = m.options && m.options.vehicle === 'rover'
              ? planRover(terrain, m.targetsFile, m.options)
              : planRoute(m.mode || 'eco', terrain, m.targetsFile, m.options); // eco = planWalk exactly (CONTRACTS §8)
            self.postMessage({ id: m.id, plan });
          }
        } catch (err) { self.postMessage({ id: m.id, error: String(err && err.message || err) }); }
      };`;
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data);
    };
    worker.onerror = (e) => { console.warn('planner worker failed, using main thread', e.message); worker = null; for (const p of pending.values()) p.reject(new Error('worker failed')); pending.clear(); };
  } catch (err) {
    console.warn('module worker unavailable, planning on the main thread', err);
    worker = null;
  }
  const call = (msg) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });
  return {
    get mode() { return worker ? 'worker' : 'main thread'; },
    async init(terrainUrl) {
      if (!worker) return;
      try { await call({ type: 'init', terrainUrl }); } catch { worker = null; }
    },
    async plan(targetsFile, options, mode = 'eco') {
      if (worker) {
        try { return (await call({ type: 'plan', targetsFile, options, mode })).plan; }
        catch (err) { if (worker) throw err; } // worker died: fall through to main thread
      }
      await new Promise((r) => setTimeout(r, 30)); // let the "planning…" state paint
      return options.vehicle === 'rover' ? planRover(state.terrain, targetsFile, options) : planRoute(mode, state.terrain, targetsFile, options);
    },
  };
})();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  $('dataset-label').textContent = SITE.label;
  $('rad-note').innerHTML = SITE.radNote;
  $('site-name').textContent = SITE.siteName;
  document.title = `Marswalk Budget — ${SITE.siteName} EVA planner`;
  for (const a of document.querySelectorAll('.site-switch a, .loc-marker')) {
    if (a.dataset.site === DATASET) a.setAttribute('aria-current', 'page');
  }
  for (const dot of document.querySelectorAll('.loc-dot')) dot.classList.toggle('is-current', dot.dataset.site === DATASET);
  initMarsLocator();
  initMarsIntro();
  let terrain, targetsFile;
  try {
    const terrainUrl = new URL('terrain.json', DATA_DIR).href;
    [terrain, targetsFile] = await Promise.all([
      fetch(terrainUrl).then((r) => { if (!r.ok) throw new Error(`terrain.json: HTTP ${r.status}`); return r.json(); }),
      fetch(new URL('targets.json', DATA_DIR)).then((r) => { if (!r.ok) throw new Error(`targets.json: HTTP ${r.status}`); return r.json(); }),
      planner.init(terrainUrl),
    ]);
  } catch (err) {
    const hint = location.protocol === 'file:'
      ? 'Open the app over http (npm run serve), not file://.'
      : DATASET !== 'demo' ? `The ${DATASET} data files may not be generated yet; try the default site (remove ?data=${DATASET}).` : '';
    showError(`Could not load data/${DATASET}/ (${err.message}). ${hint}`);
    $('verdict').textContent = 'No data';
    return;
  }

  state.terrain = terrain;
  state.habitat = targetsFile.habitat;
  // Hypothetical safe havens (optional file): a supply cache and a storm shelter on the walking route.
  try {
    const r = await fetch(new URL('havens.json', DATA_DIR));
    state.havens = r.ok ? ((await r.json()).havens ?? []) : [];
  } catch { state.havens = []; }
  for (const h of state.havens) if (!Number.isInteger(h.x) && h.lat != null) Object.assign(h, latLonToCell(terrain, h.lat, h.lon));
  state.targets = targetsFile.targets.map((t) => ({ ...t }));
  // Targets given as lat/lon get cell x/y here too, so markers can be drawn before the first plan.
  for (const t of [state.habitat, ...state.targets]) {
    if (!(Number.isInteger(t.x) && Number.isInteger(t.y)) && t.lat != null) Object.assign(t, latLonToCell(terrain, t.lat, t.lon));
  }
  state.included = new Set(state.targets.map((t) => t.id));
  if (PARAMS.get('stops')) {
    const wanted = new Set(PARAMS.get('stops').split(','));
    state.included = new Set(state.targets.filter((t) => wanted.has(t.id)).map((t) => t.id));
  }

  // Conditions snapshot pre-sets dust/solar; explicit ?dust= / ?solar= / ?kit= win. Kit is never suggested.
  await loadCondSnapshot(state.condName);
  const suggested = state.cond ? toToggles(state.cond) : {};
  for (const c of CONDITIONS) {
    const v = PARAMS.get(c.param);
    if (v === '1' || (v !== '0' && suggested[c.key])) state.conditions[c.key] = true;
  }

  $('synthetic-banner').hidden = !terrain.synthetic;
  if (terrain.name) $('dataset-label').textContent += ` · ${terrain.name}`;
  // APXS rock chemistry for Gale stops (codex-conditions, js/chemistry.js). Loaded lazily so the
  // console still works if the module or data is missing; other sites never fetch it.
  if (DATASET === 'gale') state.chemistry = loadChemistryCard();
  renderCredits();
  initMap();
  renderConditions();
  renderLayerControls();
  if (TOUR) startTour(); else replan();
}

function showError(msg) {
  const b = $('error-banner');
  b.textContent = msg;
  b.hidden = !msg;
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function initMap() {
  const t = state.terrain;
  const bounds = terrainBounds(t);
  map = L.map('map', { zoomSnap: 0.25, maxZoom: 21, attributionControl: true, preferCanvas: false });
  map.attributionControl.setPrefix(false);
  map.fitBounds(bounds, { padding: [10, 10] });
  map.setMaxBounds(bounds.pad(0.6));
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  // 300: above the NASA imagery pane from basemap.js (pbBasemap, 250), below vector overlays (400).
  map.createPane('terrain'); map.getPane('terrain').style.zIndex = 300;
  map.createPane('route'); map.getPane('route').style.zIndex = 450;

  // NASA base layers from the photos lane (empty stub on develop).
  try {
    const base = addBaseLayers(map, t) || {};
    if (base.control && !base.control._map) base.control.addTo(map);
    if (!base.control) for (const layer of Object.values(base.layers || {})) layer.addTo?.(map);
  } catch (err) {
    console.warn('addBaseLayers failed', err);
  }

  // Terrain rasters.
  overlays.hillshade = imageLayer(paintHillshade(t), bounds, LAYER_INFO.hillshade.opacity, 'terrain');
  overlays.slope = imageLayer(paintSlope(t, {}), bounds, LAYER_INFO.slope.opacity, 'terrain');
  const ti = paintScalar(t, 'thermalInertia', LAYER_INFO.thermalInertia.ramp);
  if (ti) overlays.thermalInertia = imageLayer(ti, bounds, LAYER_INFO.thermalInertia.opacity, 'terrain');
  const ro = paintScalar(t, 'roughness', LAYER_INFO.roughness.ramp, [0, 1]);
  if (ro) overlays.roughness = imageLayer(ro, bounds, LAYER_INFO.roughness.opacity, 'terrain');
  // On real terrain the HiRISE imagery is the base map, so the opaque hillshade starts off.
  for (const [k, layer] of Object.entries(overlays)) {
    if (k === 'hillshade' && !t.synthetic) continue;
    if (LAYER_INFO[k].defaultOn) layer.addTo(map);
  }
  L.rectangle(bounds, { color: '#e0a14a', weight: 1, fill: false, dashArray: '4 4', interactive: false, pane: 'terrain' }).addTo(map);

  routeLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => addStopAt(e.latlng));

  // Keep the map sized to its box; refit if it was laid out before the box had a size.
  let fitted = map.getSize().y > 50;
  new ResizeObserver(() => {
    map.invalidateSize();
    if (!fitted && map.getSize().y > 50) { fitted = true; map.fitBounds(bounds, { padding: [10, 10] }); }
  }).observe($('map'));
}

/** Slope/blocked depends on conditions (dust storm and heavy kit lower the max slope). */
function refreshSlopeLayer() {
  const on = map.hasLayer(overlays.slope);
  if (on) map.removeLayer(overlays.slope);
  overlays.slope = imageLayer(paintSlope(state.terrain, state.conditions), terrainBounds(state.terrain), LAYER_INFO.slope.opacity, 'terrain');
  if (on) overlays.slope.addTo(map);
}

function addStopAt(latlng) {
  const t = state.terrain;
  const { x, y } = latLonToCell(t, latlng.lat, latlng.lng);
  if (x < 0 || y < 0 || x >= t.width || y >= t.height) return;
  const n = ++state.customCount;
  const stop = {
    id: `U${n}`, name: `My stop ${n}`, x, y, value: 5, dwellMin: 20,
    note: 'Added by you on the map. Edit its science value and time on site in the stop list.', custom: true,
  };
  state.targets.push(stop);
  state.included.add(stop.id);
  state.selectedId = stop.id;
  replan();
}

function drawMap() {
  const { terrain: t, plan } = state;
  routeLayer.clearLayers();
  $('map-legend').hidden = true;
  markerLayer.clearLayers();

  if (plan && plan.path.length > 1) {
    const ll = plan.path.map(([x, y]) => cellLatLng(t, x, y));
    const k = plan.turnBack ? plan.turnBack.pathIndex : ll.length - 1;
    const safe = ll.slice(0, k + 1), beyond = ll.slice(k);
    L.polyline(safe, { pane: 'route', color: '#1a0f0a', weight: 7, opacity: 0.7, interactive: false }).addTo(routeLayer);
    L.polyline(safe, { pane: 'route', color: '#ffcf6e', weight: 4, interactive: false }).addTo(routeLayer);
    if (plan.turnBack && beyond.length > 1) {
      L.polyline(beyond, { pane: 'route', color: '#1a0f0a', weight: 7, opacity: 0.6, interactive: false }).addTo(routeLayer);
      L.polyline(beyond, { pane: 'route', color: '#ef4b3f', weight: 4, dashArray: '8 6', interactive: false }).addTo(routeLayer);
    }
    // Stretches the habitat can't see (CONTRACTS §4 lineOfSight.gaps): dark dashes over the route line = dotted.
    const gaps = plan.lineOfSight?.gaps ?? [];
    for (const [a, b] of gaps) {
      const seg = ll.slice(Math.max(0, a - 1), Math.min(ll.length, b + 2));
      if (seg.length > 1) L.polyline(seg, { pane: 'route', color: '#1a0f0a', weight: 4, dashArray: '3 7', lineCap: 'butt', interactive: false }).addTo(routeLayer);
    }
    // Rover: stretches of the drive beyond walk-back range (CONTRACTS §4c walkback.beyond), red dashes.
    for (const [a, b] of plan.walkback?.beyond ?? []) {
      const seg = ll.slice(Math.max(0, a - 1), Math.min(ll.length, b + 2));
      if (seg.length > 1) L.polyline(seg, { pane: 'route', color: '#ef4b3f', weight: 4, dashArray: '8 6', interactive: false }).addTo(routeLayer);
    }
    const legend = $('map-legend');
    legend.hidden = !(plan.lineOfSight?.outOfSightM >= 1);
    if (!legend.hidden) $('map-legend-text').textContent = `Out of sight of the habitat · ${Math.round(plan.lineOfSight.outOfSightM)} m`;
    // Wide invisible line for hover: elapsed time and O2 at the nearest path point.
    const hover = L.polyline(ll, { pane: 'route', weight: 18, opacity: 0 }).addTo(routeLayer);
    hover.on('mousemove', (e) => {
      const kk = nearestPathIndex(ll, e.latlng);
      const tl = state.timeline;
      if (plan.vehicle === 'rover') {
        const q = plan.profile[kk];
        const wb = q?.walkbackO2Kg;
        const to = q?.refuge === 'habitat' ? 'the habitat' : havenName(q?.refuge);
        hover.setTooltipContent(`${fmtClock(tl.t[kk])} · if the rover breaks here:<br>walk to ${to} on ${wb == null ? '—' : fmtKg(wb)} kg O₂ (limit ${fmtKg(plan.walkback.o2LimitKg)})`);
        hover.openTooltip(e.latlng);
        return;
      }
      const left = plan.totals.o2CapacityKg - tl.o2[kk];
      const pastTurn = plan.turnBack && kk > plan.turnBack.pathIndex;
      const hidden = gaps.some(([a, b]) => kk >= a && kk <= b);
      hover.setTooltipContent(`${tl.exact ? '' : '≈ '}${fmtClock(tl.t[kk])} · O₂ left ${fmtKg(left)} kg${hidden ? '<br>out of the habitat’s sight' : ''}${pastTurn ? '<br><b style="color:#ff8a80">beyond the point of no return</b>' : ''}`);
      hover.openTooltip(e.latlng);
    });
    hover.bindTooltip('', { className: 'tip', sticky: true, direction: 'top', offset: [0, -8] });
    hover.on('click', (e) => { L.DomEvent.stopPropagation(e); });
  }

  // Hypothetical safe havens (when switched on): supply cache and storm shelter.
  if (state.useHavens) {
    const refill = new Map((plan?.refills ?? []).map((r) => [r.id, r]));
    for (const h of state.havens) {
      if (!Number.isInteger(h.x)) continue;
      const r = refill.get(h.id);
      const tip = `<b>${esc(h.name)}</b> <small>(hypothetical)</small><br>${esc(h.note || '')}${r ? `<br><b>Refill here at ${fmtClock(r.arriveS)}</b> (+${fmtKg(r.refillKg)} kg O₂)` : ''}`;
      L.marker(cellLatLng(t, h.x, h.y), { icon: havenIcon(h.kind, !!r), zIndexOffset: 450 })
        .bindTooltip(tip, { className: 'tip', direction: 'top', offset: [0, -14] })
        .addTo(markerLayer);
    }
  }

  // Habitat
  L.marker(cellLatLng(t, state.habitat.x, state.habitat.y), { icon: habitatIcon(), zIndexOffset: 500 })
    .bindTooltip(`${state.habitat.name || 'Habitat'}<br>start and finish`, { className: 'tip', direction: 'top', offset: [0, -14] })
    .addTo(markerLayer);

  // Stops
  const orderNum = new Map((plan?.order || []).map((id, i) => [id, i + 1]));
  const unreachable = new Set(plan?.unreachable || []);
  for (const s of state.targets) {
    if (!Number.isInteger(s.x)) continue;
    const num = orderNum.get(s.id);
    const inc = state.included.has(s.id);
    let label = num ?? '', cls = s.custom ? 'custom' : '';
    if (!inc) { cls += ' off'; label = '–'; }
    else if (unreachable.has(s.id)) { cls += ' unreach'; label = '✕'; }
    const sel = s.id === state.selectedId;
    const tip = `<b>${esc(s.name)}</b><br>${!inc ? 'not included' : unreachable.has(s.id) ? 'unreachable under these conditions' : `stop ${num} · value ${s.value} · ${s.dwellMin} min`}`;
    L.marker(cellLatLng(t, s.x, s.y), { icon: stopIcon(label, cls, sel), zIndexOffset: sel ? 1000 : num ? 600 : 300 })
      .bindTooltip(tip, { className: 'tip', direction: 'top', offset: [0, -14] })
      .on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectStop(s.id);
        $('photo-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      })
      .addTo(markerLayer);
  }

  // Point of no return
  if (plan?.turnBack) {
    const tb = plan.turnBack;
    turnBackMarker = L.marker(cellLatLng(t, tb.x, tb.y), { icon: turnBackIcon(), zIndexOffset: 2000 })
      .bindTooltip(`<b>Point of no return</b><br>${fmtClock(tb.elapsedS)} · ${fmtKg(tb.o2UsedKg)} kg O₂ used<br>Past here you can't reach ${refugeText(tb)} without the reserve.`,
        { className: 'tip', direction: 'top', offset: [0, -18], permanent: false })
      .addTo(markerLayer);
  }

  // Rover: last point of the drive still inside walk-back range.
  if (plan?.walkback?.limitPoint) {
    const lp = plan.walkback.limitPoint;
    turnBackMarker = L.marker(cellLatLng(t, lp.x, lp.y), { icon: turnBackIcon(), zIndexOffset: 2000 })
      .bindTooltip(`<b>Walk-back limit</b><br>${fmtClock(lp.elapsedS)}<br>Past here, if the rover breaks down, the crew can't walk to safety on suit O₂.`,
        { className: 'tip', direction: 'top', offset: [0, -18] })
      .addTo(markerLayer);
  }

  // Latest safe turn-around on a route that fits (CONTRACTS §4, feature-detected): softer than the red marker.
  if (plan && !plan.turnBack && plan.turnBackLatest) {
    const tl = plan.turnBackLatest;
    turnBackMarker = L.marker(cellLatLng(t, tl.x, tl.y), { icon: turnBackIcon('soft'), zIndexOffset: 1500 })
      .bindTooltip(`<b>Dust-storm turn-back</b><br>${fmtClock(tl.elapsedS)} · ${fmtKg(tl.o2UsedKg)} kg O₂ used<br>If a dust storm starts, head for ${refugeText(tl)} by here to keep the full O₂ reserve.`,
        { className: 'tip', direction: 'top', offset: [0, -16], permanent: false })
      .addTo(markerLayer);
  }
}

/** Where a turn-back sends the astronaut: the habitat, or the nearest haven (CONTRACTS §4 turnBack.refuge). */
function refugeText(tb) {
  return !tb?.refuge || tb.refuge === 'habitat' ? 'the habitat' : `the ${havenName(tb.refuge).replace(/ \(.*\)$/, '').toLowerCase()}`;
}

function nearestPathIndex(ll, p) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < ll.length; k++) {
    const d = (ll[k][0] - p.lat) ** 2 + (ll[k][1] - p.lng) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

let planSeq = 0;

/** The two route options not on screen, planned after the main plan so the page never waits (CONTRACTS §8). */
async function planOtherRoutes(mine, file, options, shown) {
  // Same reachability target as planAlternatives: safe relaxes its slope cap until it reaches as many stops as eco.
  const extra = shown.mode === 'eco' ? { ...options, ecoUnreachable: shown.unreachable.length } : options;
  for (const mode of ROUTE_MODES) {
    if (mode === state.route) continue;
    try {
      const p = await planner.plan(file, extra, mode);
      if (mine !== planSeq) return; // stops or conditions changed meanwhile
      state.alts = { ...state.alts, [mode]: p };
    } catch (err) {
      if (mine !== planSeq) return;
      console.warn(`route option ${mode} failed`, err);
      state.alts = { ...state.alts, [mode]: { error: err.message } };
    }
    renderRoutes();
    drawAltRoutes();
  }
}

const activeHavens = () => (state.useHavens ? state.havens.map(({ id, name, kind, lat, lon, x, y }) => ({ id, name, kind, lat, lon, x, y })) : []);
const havenName = (id) => state.havens.find((h) => h.id === id)?.name ?? id;

/** Route option cards: least oxygen / safest / shortest for the same stops and conditions. */
function renderRoutes() {
  const box = $('routes');
  if (!box) return;
  box.replaceChildren();
  if (state.vehicle === 'rover') {
    box.append(el('p', { class: 'muted' }, 'Route options compare ways to walk. The rover takes the fastest drive; switch Travel back to “On foot” to compare walks.'));
    return;
  }
  if (!state.plan?.order?.length) {
    box.append(el('p', { class: 'muted' }, 'Select at least one stop to compare routes.'));
    return;
  }
  for (const mode of ROUTE_MODES) {
    const p = state.alts[mode];
    const lab = MODE_LABELS[mode] || { name: mode, blurb: '' };
    const on = mode === state.route;
    let body;
    if (!p) body = el('div', { class: 'route-meta muted' }, 'planning…');
    else if (p.error) body = el('div', { class: 'route-meta muted' }, 'not available');
    else {
      const prof = slopeProfile(state.terrain, p);
      const steep = prof[2] + prof[3];
      const T = p.totals;
      body = el('div', { class: 'route-meta' },
        el('span', {}, `${(T.distanceM / 1000).toFixed(2)} km · ${fmtDuration(T.totalTimeS)}`),
        // 3 decimals here only: the options often differ by a few grams of O₂.
        el('span', { class: T.o2UsedKg > T.o2UsableKg ? 'over' : '' }, `${T.o2UsedKg.toFixed(3)} kg O₂ · ${fmtMSv(T.doseMSv)} mSv`),
        el('span', {}, `${steep.toFixed(0)} m over 15°${p.slopeCapDeg ? ` · kept under ${p.slopeCapDeg}°` : ''}`),
        p.withinBudget ? null : el('span', { class: 'over' }, 'over budget'));
    }
    const card = el('button', {
      type: 'button', class: `route-opt${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false',
      disabled: !p || p.error ? true : null, 'data-mode': mode,
    }, el('b', {}, lab.name), el('small', {}, lab.blurb), body);
    card.addEventListener('click', () => chooseRoute(mode));
    box.append(card);
  }
}

function chooseRoute(mode) {
  const p = state.alts[mode];
  if (!p || p.error || mode === state.route) return;
  state.route = mode;
  state.plan = p;
  state.timeline = pathTimeline(p);
  renderAll();
}

/** The other route options as thin lines under the chosen one. */
let altLayer = null;
function drawAltRoutes() {
  if (!map) return;
  altLayer ??= L.layerGroup().addTo(map);
  altLayer.clearLayers();
  for (const mode of ROUTE_MODES) {
    const p = state.alts[mode];
    if (mode === state.route || !p?.path || p.path.length < 2) continue;
    L.polyline(p.path.map(([x, y]) => cellLatLng(state.terrain, x, y)),
      { pane: 'route', color: '#d9c7b8', weight: 2, opacity: 0.55, dashArray: '2 6', interactive: false })
      .bindTooltip(MODE_LABELS[mode]?.name || mode, { className: 'tip', sticky: true })
      .addTo(altLayer);
  }
}

async function replan() {
  const mine = ++planSeq;
  $('planning').hidden = false;
  const stopIds = state.targets.filter((t) => state.included.has(t.id)).map((t) => t.id);
  try {
    const file = { habitat: state.habitat, targets: state.targets };
    const options = { stopIds, conditions: { ...state.conditions }, havens: activeHavens() };
    if (state.vehicle === 'rover') options.vehicle = 'rover';
    const plan = await planner.plan(file, options, state.route);
    if (mine !== planSeq) return; // a newer request superseded this one
    state.plan = plan;
    state.alts = { [state.route]: plan };
    // Route options compare three ways to walk; a rover sortie has one fastest drive.
    state.altsPromise = state.vehicle === 'rover' ? null : planOtherRoutes(mine, file, options, plan);
    state.timeline = pathTimeline(plan);
    showError('');
  } catch (err) {
    if (mine !== planSeq) return;
    console.error(err);
    showError(`Planner error: ${err.message}`);
  } finally {
    if (mine === planSeq) $('planning').hidden = true;
  }
  renderAll();
}

function renderAll() {
  drawMap();
  renderVerdict();
  renderGoNoGo();
  updateLinks();
  if (state.plan) {
    $('chart-title').innerHTML = state.plan.vehicle === 'rover' ? 'Walk-back O<sub>2</sub> along the drive' : 'O<sub>2</sub> remaining along the walk';
    renderBudget($('budget'), state.plan);
    renderChart($('chart'), state.plan, state.timeline);
  }
  renderRoutes();
  drawAltRoutes();
  renderStops();
  renderSteps();
  renderSelected();
}

/** Turn-by-turn card (js/steps.js): one group per leg, click a step to highlight it on the map. */
function renderSteps() {
  const box = $('steps');
  box.replaceChildren();
  if (stepHighlight) { stepHighlight.remove(); stepHighlight = null; }
  const p = state.plan;
  if (!p?.legs?.length || !p.order.length) {
    $('steps-count').textContent = '';
    box.append(el('p', { class: 'muted' }, 'Select at least one stop to get directions.'));
    return;
  }
  const legs = buildSteps(p, state.terrain, new Map([...state.havens, ...state.targets].map((t) => [t.id, t.name])));
  const refillIds = new Set((p.refills ?? []).map((r) => r.id));
  const swapMin = CONFIG.havens?.cacheSwapMin ?? 10;
  const n = legs.reduce((a, l) => a + l.steps.length, 0);
  $('steps-count').textContent = `${n} steps`;
  let clock = 0;
  legs.forEach((leg, li) => {
    const list = el('ol', { class: 'steps-list' });
    for (const s of leg.steps) {
      const climb = Math.abs(s.climbM) >= 1 ? ` · ${s.climbM > 0 ? '↑' : '↓'} ${Math.abs(s.climbM).toFixed(0)} m` : '';
      const row = el('li', { class: 'step', tabindex: '0' },
        el('span', { class: 'step-text' }, s.text),
        el('span', { class: 'step-meta' }, `${s.distanceM.toFixed(0)} m · ${fmtDuration(s.timeS)}${climb}`),
        s.sandy ? el('span', { class: 'step-tag' }, 'loose sand') : null);
      const show = () => highlightStep(s, row);
      row.addEventListener('click', show);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
      list.append(row);
    }
    clock += leg.timeS;
    const isRefill = refillIds.has(leg.to);
    const arrive = leg.to === 'habitat'
      ? `Back at the habitat · ${fmtClock(clock)}`
      : isRefill ? `Arrive at ${leg.toName} · ${fmtClock(clock)} · swap in a full O₂ bottle (${swapMin} min)`
      : `Arrive at ${leg.toName} · ${fmtClock(clock)} · work ${leg.dwellMin} min`;
    clock += (isRefill ? swapMin : leg.dwellMin || 0) * 60;
    box.append(el('div', { class: 'steps-leg' },
      el('div', { class: 'steps-leg-head' }, `${li + 1}. To ${leg.toName}`, el('small', {}, ` ${(leg.distanceM / 1000).toFixed(2)} km`)),
      list,
      el('div', { class: 'steps-arrive' }, arrive)));
  });
}

function highlightStep(s, row) {
  if (stepHighlight) stepHighlight.remove();
  document.querySelectorAll('.step.on').forEach((r) => r.classList.remove('on'));
  row.classList.add('on');
  const ll = state.plan.path.slice(s.startIndex, s.endIndex + 1).map(([x, y]) => cellLatLng(state.terrain, x, y));
  stepHighlight = L.polyline(ll, { pane: 'route', color: '#7fd3ff', weight: 7, opacity: 0.95, interactive: false }).addTo(map);
  const b = stepHighlight.getBounds();
  if (!map.getBounds().contains(b)) map.fitBounds(b, { padding: [60, 60], maxZoom: map.getZoom() });
}

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

/** "Over budget on oxygen and radiation", "Over the 6 h EVA", or both (CONTRACTS §4 violations). */
function violationText(p) {
  const budgets = p.violations.filter((x) => x === 'oxygen' || x === 'radiation');
  const time = p.violations.includes('time') ? `over the ${evaHours(p)} h EVA` : '';
  if (!budgets.length) return time ? time[0].toUpperCase() + time.slice(1) : 'Over budget';
  return `Over budget on ${budgets.join(' and ')}${time ? ` and ${time}` : ''}`;
}
const evaHours = (p) => +((p.totals.timeLimitS ?? 21600) / 3600).toFixed(1);
/** Summary tail: how much of the route the habitat can't see (CONTRACTS §4 lineOfSight). */
function outOfSightText(p, sep = ' · ') {
  const m = p.lineOfSight?.outOfSightM;
  return m >= 1 ? `${sep}${Math.round(m)} m out of the habitat's sight (dotted)${sep === ' ' ? '.' : ''}` : '';
}

function renderVerdict() {
  const p = state.plan;
  const v = $('verdict'), sub = $('verdict-sub'), btn = $('drop-btn');
  btn.hidden = true;
  renderBestSubset(p);
  if (!p) return;
  const nStops = p.order.length;
  if (p.vehicle === 'rover') { renderRoverVerdict(p, v, sub); return; }
  if (p.withinBudget) {
    v.className = 'verdict ok';
    v.textContent = nStops ? `Fits the budget · ${nStops} stop${nStops > 1 ? 's' : ''}` : 'No stops selected';
    sub.textContent = `${fmtDuration(p.totals.totalTimeS)} out and back · science value ${p.totals.scienceValue}`;
    // CONTRACTS §4: turnBackLatest null on a feasible plan = survivable even if a dust storm starts anywhere.
    if (nStops && 'turnBackLatest' in p) {
      sub.textContent += p.turnBackLatest
        ? ` · if a dust storm starts, turn back by ${fmtClock(p.turnBackLatest.elapsedS)} (amber ↩)`
        : ' · dust-storm safe all the way';
    }
    sub.textContent += outOfSightText(p);
    for (const r of p.refills ?? []) sub.textContent += ` · refill O₂ at the ${havenName(r.id).replace(/ \(.*\)$/, '').toLowerCase()} at ${fmtClock(r.arriveS)}`;
  } else {
    v.className = 'verdict over';
    v.textContent = violationText(p);
    sub.textContent = p.turnBack
      ? `Turn back by ${fmtClock(p.turnBack.elapsedS)} (red ↩ on the map) or drop a stop.`
      : p.violations.includes('radiation')
        ? 'O₂ still gets you home, but the dose limit is exceeded. Drop a stop or shorten the walk.'
        : `O₂ still gets you home, but the walk runs past the ${evaHours(p)} h EVA limit. Drop a stop or shorten the walk.`;
    sub.textContent += outOfSightText(p, ' ');
  }
  if (p.unreachable.length) {
    sub.textContent += ` ${p.unreachable.length} stop${p.unreachable.length > 1 ? 's' : ''} unreachable.`;
  }
  const d = p.dropSuggestion;
  if (d) {
    btn.hidden = false;
    btn.innerHTML = '';
    btn.append(`Drop “${d.name}” to ${d.makesFeasible ? 'fit the budget' : 'get closer'}`,
      el('small', {}, `saves ${fmtKg(d.o2SavedKg)} kg O₂ and ${fmtMSv(d.doseSavedMSv)} mSv · loses ${d.value} science`));
    btn.onclick = () => { state.included.delete(d.id); replan(); };
  }
}

/** Verdict for a pressurized-rover sortie (js/rover.js): budget, EVA time and the walk-back limit. */
function renderRoverVerdict(p, v, sub) {
  const n = p.order.length;
  const wb = p.walkback;
  const T = p.totals;
  v.className = `verdict ${p.withinBudget ? 'ok' : 'over'}`;
  if (p.withinBudget) v.textContent = n ? `Rover sortie fits · ${n} stop${n > 1 ? 's' : ''}` : 'No stops selected';
  else v.textContent = p.violations.includes('walkback') ? 'Drive goes beyond walk-back range' : `Rover sortie over: ${p.violations.join(', ')}`;
  sub.textContent = `${fmtDuration(T.driveTimeS)} driving + ${fmtDuration(T.dwellTimeS)} suited work · science value ${T.scienceValue}`;
  sub.textContent += wb.beyond.length
    ? ` · ${Math.round(wb.beyondM)} m of the drive is out of walk-back range (red ↩ marks the limit)`
    : ` · walk-back OK everywhere (worst ${fmtKg(wb.maxO2Kg)} of ${fmtKg(wb.o2LimitKg)} kg suit O₂)`;
  if (p.unreachable.length) sub.textContent += ` ${p.unreachable.length} stop${p.unreachable.length > 1 ? 's' : ''} unreachable by rover.`;
}

/** Engine's best stop set that fits (CONTRACTS §4, feature-detected: absent until the engine lane lands it). */
function renderBestSubset(p) {
  const box = $('best-subset');
  box.replaceChildren();
  box.hidden = true;
  const bs = p?.bestSubset;
  if (!bs || !Array.isArray(bs.ids) || !bs.ids.length) return;
  const byId = new Map(state.targets.map((t) => [t.id, t]));
  const names = (bs.order?.length ? bs.order : bs.ids).map((id) => byId.get(id)?.name || id);
  const same = bs.ids.length === state.included.size && bs.ids.every((id) => state.included.has(id));
  if (same) return;
  const use = el('button', { type: 'button', class: 'best-use' }, 'Use it');
  use.onclick = () => { state.included = new Set(bs.ids); replan(); };
  box.append(
    el('div', { class: 'best-text' },
      el('b', {}, 'Best set that fits: '), names.join(' → '),
      el('small', {}, ` science ${bs.scienceValue} · ${fmtKg(bs.o2UsedKg)} kg O₂ · ${fmtMSv(bs.doseMSv)} mSv`)),
    use);
  box.hidden = false;
}

async function loadCondSnapshot(name) {
  state.condName = name;
  try {
    state.cond = await loadConditions(name);
    state.condError = null;
  } catch (err) {
    // Never invent "quiet": the card shows CAUTION / unknown data instead.
    state.cond = null;
    state.condError = err.message;
    console.warn('conditions snapshot unavailable', err);
  }
}

/** GO / CAUTION / NO-GO card from the conditions lane, refreshed after every plan. */
/**
 * The Go/No-Go card (js/conditions.js) is long: the level and its reasons stay visible, and everything after
 * the reasons (weather readings, radiation note, sources, fine print) goes into a closed <details>.
 * Only moves the nodes conditions.js made; if its layout changes and no reasons list is found, nothing moves.
 */
function foldConditionsDetails(box) {
  const card = box.querySelector('.conditions-card');
  const reasons = card?.querySelector(':scope > ul');
  if (!reasons) return;
  const rest = [];
  for (let n = reasons.nextElementSibling; n; n = n.nextElementSibling) if (n.tagName !== 'STYLE') rest.push(n);
  if (!rest.length) return;
  const more = el('details', { class: 'cond-more' }, el('summary', {}, 'Weather readings, radiation and sources'));
  more.open = !!state.condDetailsOpen;
  more.addEventListener('toggle', () => { state.condDetailsOpen = more.open; });
  more.append(...rest);
  card.append(more);
  compactSources(more);
}

/**
 * Sources list from js/conditions.js: each item is a link, a "Retrieved / recorded: <ISO time>" line and a long
 * note. Show each as one line (name · date) with the note behind a click. Items that don't match are left alone.
 */
function compactSources(scope) {
  for (const li of scope.querySelectorAll(':scope > ul > li')) {
    const link = li.querySelector(':scope > a');
    const smalls = [...li.querySelectorAll(':scope > small')];
    if (!smalls.length) continue;
    const when = smalls.find((s) => /^Retrieved/i.test(s.textContent));
    const date = when?.textContent.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const notes = smalls.filter((s) => s !== when).map((s) => s.textContent.trim()).filter(Boolean);
    const name = link ?? el('span', {}, li.firstChild?.textContent?.trim() || 'Source');
    const summary = el('summary', {}, name, date ? el('span', { class: 'src-date' }, ` · ${date}`) : null);
    const item = el('details', { class: 'src-item' }, summary, ...notes.map((n) => el('p', { class: 'src-note' }, n)));
    if (when) item.title = when.textContent.trim();
    li.replaceChildren(item);
    li.classList.add('src-li');
  }
}

function renderGoNoGo() {
  const box = $('conditions-card');
  if (!box) return;
  // Level badge next to the verdict, so GO / CAUTION / NO-GO is visible without scrolling.
  const badge = $('go-badge');
  try {
    const { level } = conditionsVerdict(state.cond, state.plan);
    badge.textContent = level;
    badge.className = `go-badge go-${level.toLowerCase().replace(/[^a-z]/g, '')}`;
    badge.hidden = false;
  } catch { badge.hidden = true; }
  try {
    renderConditionsCard(box, state.cond, state.plan);
    foldConditionsDetails(box);
    if (state.condError) box.append(el('p', { class: 'note' }, `Conditions snapshot unavailable: ${state.condError}`));
  } catch (err) {
    box.textContent = `Go/No-Go unavailable: ${err.message}`;
  }
}

/** Links to the tablet and HUD (CONTRACTS §7), and keep this page's URL in sync so a reload keeps the plan. */
function updateLinks() {
  const q = new URLSearchParams();
  q.set('data', DATASET); // explicit, so links still work if the default site changes again
  // Stops the user added on the map exist only in this page, so they can't travel in a link.
  const fileIds = state.targets.filter((t) => !t.custom && state.included.has(t.id)).map((t) => t.id);
  if (fileIds.length !== state.targets.filter((t) => !t.custom).length) q.set('stops', fileIds.join(','));
  for (const c of CONDITIONS) if (state.conditions[c.key]) q.set(c.param, '1');
  if (state.route !== 'eco') q.set('route', state.route); // CONTRACTS §7: tablet and HUD plan the same option
  if (state.vehicle === 'rover') q.set('vehicle', 'rover'); // console only for now; tablet and HUD plan the walk
  if (state.useHavens) q.set('havens', '1');
  // Gale always names its snapshot: the tablet/HUD default is Jezero weather (codex-views is changing that).
  if (state.condName !== SITE.defaultCond || DATASET === 'gale') q.set('cond', state.condName);
  const qs = q.toString().replace(/%2C/g, ','); // readable stop lists; URLSearchParams accepts both
  $('open-tablet').href = `tablet.html?${qs}`;
  $('open-hud').href = `hud.html?${qs}`;
  $('open-flyover').href = `flyover.html?${qs}`; // views lane: 3D fly-through, same §7 params
  $('open-checklist').href = `checklist.html?${qs}`; // EVA cuff checklist (js/checklist.js)
  const hasCustom = state.targets.some((t) => t.custom && state.included.has(t.id));
  $('view-links-note').hidden = !hasCustom;
  updateSiteSwitch();
  const own = TOUR ? [qs, 'tour=1'].filter(Boolean).join('&') : qs; // presenter mode survives a reload
  try { history.replaceState(null, '', `?${own}`); } catch { /* sandboxed previews */ }
}

/** Header site switch: same conditions and route on the other site; site-specific stops and weather are dropped. */
// "Where on Mars?" panel: a <details>, so it opens without JS; this only closes it on Escape or an outside click.
function initMarsLocator() {
  const box = $('mars-locator');
  if (!box) return;
  document.addEventListener('click', (e) => { if (box.open && !box.contains(e.target)) box.open = false; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && box.open) { box.open = false; box.querySelector('summary').focus(); }
  });
}

// Full-screen Mars intro (index.html's inline script adds <html class="intro"> on the bare site, once per tab).
// Picking the site already loaded underneath zooms in and reveals it; the other site zooms in, then loads.
function initMarsIntro() {
  const root = document.documentElement;
  const box = $('mars-intro');
  if (!box || !root.classList.contains('intro')) return;
  try { sessionStorage.setItem('marswalk-intro', '1'); } catch { /* private mode: intro may show again */ }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const choose = (a) => {
    if (box.classList.contains('zooming')) return;
    const here = a.dataset.site === DATASET;
    $('intro-map').style.transformOrigin = `${a.style.left} ${a.style.top}`;
    box.classList.add('zooming');
    if (here) box.classList.add('reveal');
    setTimeout(() => {
      if (here) { root.classList.remove('intro'); map?.invalidateSize(); }
      else location.href = a.getAttribute('href');
    }, reduce ? 350 : 1500);
  };
  const sites = [...box.querySelectorAll('.intro-site')];
  const current = sites.find((a) => a.dataset.site === DATASET) ?? sites[0];
  for (const a of sites) a.addEventListener('click', (e) => { e.preventDefault(); choose(a); });
  $('intro-skip').addEventListener('click', () => choose(current));
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') choose(current); });
  current.focus({ preventScroll: true });
}

function updateSiteSwitch() {
  for (const a of document.querySelectorAll('.site-switch a, .loc-marker')) {
    const q = new URLSearchParams();
    if (a.dataset.site !== DEFAULT_DATASET) q.set('data', a.dataset.site);
    if (TOUR) q.set('tour', '1');
    else {
      for (const c of CONDITIONS) if (state.conditions[c.key]) q.set(c.param, '1');
      if (state.route !== 'eco') q.set('route', state.route);
      if (state.condName.startsWith('demo-')) q.set('cond', state.condName); // demo snapshots exist on every site
    }
    const qs = q.toString();
    a.href = qs ? `./?${qs}` : './';
  }
}

function renderConditions() {
  const box = $('conditions');
  box.replaceChildren();
  // Which conditions snapshot drives the Go/No-Go card and the suggested switches.
  const select = el('select', { 'aria-label': 'Conditions snapshot', class: 'cond-source' });
  for (const s of COND_SNAPSHOTS) {
    const o = el('option', { value: s.name }, s.label);
    if (s.name === state.condName) o.selected = true;
    select.append(o);
  }
  select.addEventListener('change', async () => {
    await loadCondSnapshot(select.value);
    const sug = state.cond ? toToggles(state.cond) : {};
    // A new snapshot re-applies its suggestions for dust and solar; the kit switch stays as the astronaut set it.
    for (const key of ['dustStorm', 'solarEvent']) {
      if (sug[key]) state.conditions[key] = true; else delete state.conditions[key];
    }
    renderConditions();
    refreshSlopeLayer();
    replan();
  });
  box.append(el('label', { class: 'cond-source-row' }, el('span', {}, 'Snapshot'), select));
  for (const c of CONDITIONS) {
    const cfg = CONFIG.conditions[c.key] || {};
    const fx = [];
    if (cfg.speedFactor && cfg.speedFactor !== 1) fx.push(`walk ×${cfg.speedFactor}`);
    if (cfg.metabolicFactor && cfg.metabolicFactor !== 1) fx.push(`effort +${Math.round((cfg.metabolicFactor - 1) * 100)}%`);
    if (cfg.doseFactor && cfg.doseFactor !== 1) fx.push(`dose ×${cfg.doseFactor}`);
    if (cfg.maxSlopeDeg != null) fx.push(`avoid slopes > ${cfg.maxSlopeDeg}°`);
    const input = el('input', { type: 'checkbox', 'aria-label': c.name });
    input.checked = !!state.conditions[c.key];
    const row = el('label', { class: `cond${input.checked ? ' on' : ''}` },
      input, el('span', { class: 'cond-name' }, c.name), el('span', { class: 'cond-effect' }, fx.join(' · ')));
    input.addEventListener('change', () => {
      state.conditions[c.key] = input.checked;
      if (!input.checked) delete state.conditions[c.key];
      row.classList.toggle('on', input.checked);
      refreshSlopeLayer();
      replan();
    });
    box.append(row);
  }

  // Travel: on foot or by pressurized rover (js/rover.js).
  const travel = el('div', { class: 'travel', role: 'group', 'aria-label': 'Travel' }, el('span', { class: 'travel-label' }, 'Travel'));
  for (const [key, label] of [['walk', 'On foot'], ['rover', 'Pressurized rover']]) {
    const b = el('button', { type: 'button', class: `travel-opt${state.vehicle === key ? ' on' : ''}`, 'aria-pressed': state.vehicle === key ? 'true' : 'false' }, label);
    b.addEventListener('click', () => {
      if (state.vehicle === key) return;
      state.vehicle = key;
      renderConditions();
      replan();
    });
    travel.append(b);
  }
  box.append(travel);
  if (state.vehicle === 'rover') {
    box.append(el('p', { class: 'note' }, 'Crew rides in a shirt-sleeve cabin (~10 km/h) and suits up only at stops. Rule: if the rover breaks down anywhere, they must be able to walk to safety on suit O₂ (the Apollo walk-back limit).'));
  }

  // Hypothetical safe havens: a supply cache (refills the suit) and a storm shelter (counts as safety).
  if (state.havens.length) {
    const input = el('input', { type: 'checkbox', 'aria-label': 'Safe havens' });
    input.checked = state.useHavens;
    const row = el('label', { class: `cond${input.checked ? ' on' : ''}` },
      input, el('span', { class: 'cond-name' }, 'Supply cache + storm shelter'),
      el('span', { class: 'cond-effect' }, 'hypothetical · refill O₂ · nearer safety'));
    input.addEventListener('change', () => {
      state.useHavens = input.checked;
      row.classList.toggle('on', input.checked);
      replan();
    });
    box.append(row);
  }
}

function renderStops() {
  const list = $('stops');
  list.replaceChildren();
  const p = state.plan;
  const byId = new Map(state.targets.map((t) => [t.id, t]));
  const planStop = new Map((p?.stops || []).map((s) => [s.id, s]));
  const unreachable = new Set(p?.unreachable || []);
  const ordered = [
    ...(p?.order || []).map((id) => byId.get(id)).filter(Boolean),
    ...state.targets.filter((t) => state.included.has(t.id) && !p?.order.includes(t.id)),
    ...state.targets.filter((t) => !state.included.has(t.id)),
  ];
  let turnShown = false;
  const refillShown = new Set();
  ordered.forEach((t) => {
    const ps = planStop.get(t.id);
    const inc = state.included.has(t.id);
    const isUnreach = inc && unreachable.has(t.id);
    // Show where the turn-back point falls between stops.
    for (const r of p?.refills ?? []) {
      if (ps && r.pathIndex < ps.pathIndex && !refillShown.has(r.id)) {
        refillShown.add(r.id);
        list.append(el('li', { class: 'refill-row' }, `⛽ Refill O₂ at the ${havenName(r.id).replace(/ \(.*\)$/, '').toLowerCase()} · ${fmtClock(r.arriveS)} · +${fmtKg(r.refillKg)} kg`));
      }
    }
    if (p?.turnBack && !turnShown && ps && ps.pathIndex > p.turnBack.pathIndex) {
      list.append(el('li', { class: 'turnback-row' }, `↩ Point of no return at ${fmtClock(p.turnBack.elapsedS)} — stops below need the O₂ reserve`));
      turnShown = true;
    }
    const cb = el('input', { type: 'checkbox', 'aria-label': `Include ${t.name}` });
    cb.checked = inc;
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      cb.checked ? state.included.add(t.id) : state.included.delete(t.id);
      replan();
    });
    const num = ps ? p.order.indexOf(t.id) + 1 : null;
    const badge = el('span', { class: `badge${!inc ? ' muted-badge' : isUnreach ? ' bad' : ''}` }, inc ? (isUnreach ? '✕' : num ?? '…') : '–');
    const sub = !inc ? 'not included'
      : isUnreach ? 'unreachable under these conditions'
      : ps ? `arrive ${fmtClock(ps.arriveS)} · ${t.dwellMin} min on site${ps.evaO2Kg != null ? ` · suited EVA ${fmtKg(ps.evaO2Kg)} kg O₂` : ''}` : 'planning…';
    const main = el('div', {}, el('div', { class: 'stop-name' }, t.name), el('div', { class: 'stop-sub' }, sub));
    if (t.custom) main.append(customEditor(t));
    const right = el('div', { class: 'stop-right', html: `<b>${t.value}</b><br>value` });
    const li = el('li', { class: `stop${!inc ? ' excluded' : ''}${isUnreach ? ' unreachable' : ''}${t.id === state.selectedId ? ' selected' : ''}` },
      cb, badge, main, right);
    li.addEventListener('click', () => selectStop(t.id));
    list.append(li);
  });
  for (const r of p?.refills ?? []) {
    if (!refillShown.has(r.id)) list.append(el('li', { class: 'refill-row' }, `⛽ Refill O₂ at the ${havenName(r.id).replace(/ \(.*\)$/, '').toLowerCase()} · ${fmtClock(r.arriveS)} · +${fmtKg(r.refillKg)} kg (on the way home)`));
  }
  if (p?.turnBack && !turnShown) {
    list.append(el('li', { class: 'turnback-row' }, `↩ Point of no return at ${fmtClock(p.turnBack.elapsedS)} — on the way home`));
  }
}

function customEditor(t) {
  const num = (key, min, max) => {
    const i = el('input', { type: 'number', min, max, value: t[key] });
    i.addEventListener('click', (e) => e.stopPropagation());
    i.addEventListener('change', () => {
      const v = Math.round(Number(i.value));
      if (!Number.isFinite(v)) return;
      t[key] = Math.min(max, Math.max(min, v));
      replan();
    });
    return i;
  };
  const rm = el('button', { type: 'button' }, 'remove');
  rm.addEventListener('click', (e) => {
    e.stopPropagation();
    state.targets = state.targets.filter((x) => x.id !== t.id);
    state.included.delete(t.id);
    if (state.selectedId === t.id) state.selectedId = null;
    replan();
  });
  return el('div', { class: 'stop-edit' }, 'value', num('value', 1, 10), 'min', num('dwellMin', 0, 240), rm);
}

function selectStop(id) {
  state.selectedId = id;
  const t = state.targets.find((x) => x.id === id);
  drawMap();
  renderStops();
  renderSelected();
  if (t && Number.isInteger(t.x)) map.panTo(cellLatLng(state.terrain, t.x, t.y), { animate: true });
}

function renderSelected() {
  const t = state.targets.find((x) => x.id === state.selectedId);
  const box = $('photos');
  renderChemistryCard(t);
  if (!t) {
    $('photo-title').textContent = 'Stop details';
    $('photo-meta').textContent = '';
    box.replaceChildren(el('p', { class: 'muted' }, 'Select a stop on the map or in the list.'));
    return;
  }
  $('photo-title').textContent = t.name;
  const ps = state.plan?.stops.find((s) => s.id === t.id);
  const bits = [`science value ${t.value}`, `${t.dwellMin} min on site`];
  if (ps) bits.push(`arrive ${fmtClock(ps.arriveS)} with ${fmtKg(ps.arriveO2Kg)} kg O₂ used`);
  if (t.sol != null) bits.push(`${DATASET === 'gale' ? 'Curiosity' : 'Perseverance'} sol ${t.sol}`);
  $('photo-meta').textContent = bits.join(' · ');
  try {
    renderPhotos(box, t);
  } catch (err) {
    console.warn('renderPhotos failed', err);
    box.replaceChildren(el('p', {}, t.note || ''));
  }
}

/** { render, chem } once js/chemistry.js loads; chem is null when the data failed (explicit unavailable state). */
async function loadChemistryCard() {
  try {
    const mod = await import('./chemistry.js');
    const chem = await mod.loadChemistry('gale').catch((err) => { console.warn('APXS chemistry', err); return null; });
    return { render: mod.renderChemistry, chem };
  } catch (err) {
    console.warn('APXS chemistry module not available', err);
    return null;
  }
}

/** APXS card under the selected stop's photos (Gale only); hidden elsewhere or until it loads. */
async function renderChemistryCard(t) {
  const box = $('chemistry');
  if (!t || !state.chemistry) { box.hidden = true; box.replaceChildren(); return; }
  const card = await state.chemistry;
  if (state.selectedId !== t.id) return; // another stop was picked meanwhile
  if (!card) { box.hidden = true; return; }
  card.render(box, t.id, card.chem);
  box.hidden = false;
}

function renderLayerControls() {
  const box = $('layers');
  box.replaceChildren();
  for (const [key, info] of Object.entries(LAYER_INFO)) {
    if (!overlays[key]) continue;
    const input = el('input', { type: 'checkbox', 'aria-label': info.name });
    input.checked = map.hasLayer(overlays[key]);
    input.addEventListener('change', () => {
      input.checked ? overlays[key].addTo(map) : map.removeLayer(overlays[key]);
    });
    const labels = info.labels.map((s) => el('span', {}, s));
    box.append(el('label', { class: 'layer' },
      input,
      el('span', { class: 'layer-name' }, info.name),
      el('div', { class: 'ramp', style: `background:${rampCss(info.ramp)}` }),
      el('div', { class: 'ramp-labels' }, labels)));
  }
}

function renderCredits() {
  const t = state.terrain;
  const parts = [];
  if (t.synthetic) parts.push('Terrain: synthetic demo grid (scripts/make_demo.mjs).');
  for (const s of t.sources || []) {
    parts.push(s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> (${esc(s.layer)})` : `${esc(s.name)} (${esc(s.layer)})`);
  }
  parts.push('Model numbers tagged ASSUMPTION in js/config.js are estimates, not flight rules.');
  $('credits').innerHTML = parts.join(' · ');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Handle for debugging from the console.
// ---------------------------------------------------------------------------
// Presenter mode (?tour=1) for the demo video. Right arrow / PageDown / Space = next step,
// left arrow / PageUp = back. Every step rebuilds its state from scratch, so a recording is the
// same every time. The only extra UI is the one-line caption over the map.
// ---------------------------------------------------------------------------

const TOUR = PARAMS.get('tour') === '1';
let tourStep = -1, tourBest = null, tourBusy = false, tourHaz = 0;

// Hazards are added one at a time until the walk breaks, so the story works on every site
// (Jezero: dust alone is enough; Gale needs more). Deterministic, so recordings still repeat.
const TOUR_HAZARDS = [
  { conditions: { dustStorm: true }, text: 'Dust storm forecast: slower walking, more effort.', short: 'dust storm on' },
  { conditions: { dustStorm: true, heavyKit: true }, text: 'Dust storm plus a heavy sample kit: slower, harder walking.', short: 'dust storm + heavy kit' },
  { conditions: { dustStorm: true, heavyKit: true, solarEvent: true }, text: 'Dust storm, heavy kit and a solar particle event.', short: 'all three hazards' },
];
const tourHazSet = (included) => tourSet({ cond: 'demo-dusty', conditions: TOUR_HAZARDS[tourHaz].conditions, included });

const tourFileIds = () => state.targets.filter((t) => !t.custom).map((t) => t.id);
const tourStops = (p) => `${p.order.length} stop${p.order.length === 1 ? '' : 's'}`;
const tourO2 = (p) => {
  const { o2UsedKg: u, o2UsableKg: a } = p.totals;
  const d = fmtKg(u) === fmtKg(a) && u !== a ? 3 : 2; // "0.40 of 0.40" would hide whether it fits
  return `${u.toFixed(d)} of ${a.toFixed(d)} kg O₂`;
};

async function tourSet({ cond, conditions, included }) {
  if (state.condName !== cond) await loadCondSnapshot(cond);
  state.conditions = { ...conditions };
  state.included = new Set(included);
  state.selectedId = null;
  state.route = 'eco'; // the tour always narrates the least-oxygen route; step 6 compares the others
  renderConditions();
  refreshSlopeLayer();
  await replan();
}

/** Scroll the side panel (or the page, on phones) so this element is in view. */
function tourReveal(node) {
  const panel = document.querySelector('.panel');
  const scroller = panel.scrollHeight > panel.clientHeight + 1 && getComputedStyle(panel).overflowY !== 'visible' ? panel : document.scrollingElement;
  const top = node.getBoundingClientRect().top - (scroller === panel ? panel.getBoundingClientRect().top : 0) + scroller.scrollTop - 12;
  scroller.scrollTo({ top: Math.max(0, top) });
}

function tourFitRoute() {
  if (!state.plan?.path?.length) return;
  const b = L.latLngBounds(state.plan.path.map(([x, y]) => cellLatLng(state.terrain, x, y)));
  map.flyToBounds(b, { padding: [70, 70], duration: 0.8 });
}

const TOUR_STEPS = [
  {
    run: () => tourSet({ cond: 'demo-quiet', conditions: {}, included: tourFileIds() }),
    after: tourFitRoute,
    caption: (p) => p.withinBudget
      ? `A quiet sol: ${tourStops(p)}, ${fmtDuration(p.totals.totalTimeS)} out and back, ${tourO2(p)}. The walk fits.`
      : `A quiet sol: ${tourStops(p)}, ${tourO2(p)}. Even this walk is over budget.`,
  },
  {
    run: async () => {
      for (tourHaz = 0; tourHaz < TOUR_HAZARDS.length; tourHaz++) {
        await tourHazSet(tourFileIds());
        if (!state.plan?.withinBudget) break;
      }
      tourHaz = Math.min(tourHaz, TOUR_HAZARDS.length - 1);
    },
    after: () => { tourBest = state.plan?.bestSubset || null; tourFitRoute(); },
    caption: (p) => p.withinBudget
      ? `${TOUR_HAZARDS[tourHaz].text} Still fits: ${tourO2(p)}.`
      : p.violations.includes('oxygen')
        ? `${TOUR_HAZARDS[tourHaz].text} Same stops now need ${tourO2(p)}: over budget.`
        : `${TOUR_HAZARDS[tourHaz].text} O₂ is fine, but the radiation dose goes over the per-walk limit.`,
  },
  {
    run: () => tourHazSet(tourFileIds()),
    after: () => {
      if (!turnBackMarker) return;
      map.flyTo(turnBackMarker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.8 });
      map.once('moveend', () => turnBackMarker?.openTooltip());
    },
    caption: (p) => p.turnBack
      ? `Point of no return at ${fmtClock(p.turnBack.elapsedS)}: past the red marker, the suit can't get home without the O₂ reserve.`
      : 'No point of no return on this walk: oxygen gets the astronaut home.',
  },
  {
    run: () => tourHazSet(tourFileIds()),
    after: () => {
      tourFitRoute();
      const box = $('best-subset');
      if (!box.hidden) { box.classList.add('tour-focus'); tourReveal(box); }
    },
    caption: (p) => p.bestSubset?.ids?.length
      ? `The planner searches every set of stops for the most science that still fits: ${p.bestSubset.ids.length} stops, value ${p.bestSubset.scienceValue}.`
      : 'The planner looks for the most science that still fits the budget.',
  },
  {
    run: () => tourHazSet(tourBest?.ids || tourFileIds()),
    after: tourFitRoute,
    caption: (p) => {
      let level = '';
      try { level = conditionsVerdict(state.cond, p).level; } catch { /* card shows the error */ }
      const fit = p.withinBudget ? `fits${level ? `, ${level}` : ''}` : 'still over budget';
      return `Best set, ${TOUR_HAZARDS[tourHaz].short}: ${tourStops(p)}, science ${p.totals.scienceValue}, ${tourO2(p)}: ${fit}.`;
    },
  },
  {
    // Same stops and hazards as the best set; wait for the other two route options, then show the cards.
    run: async () => { await tourHazSet(tourBest?.ids || tourFileIds()); await state.altsPromise; },
    after: () => {
      const box = $('routes-card');
      box.classList.add('tour-focus');
      tourReveal(box);
    },
    caption: () => {
      const parts = ROUTE_MODES.filter((m) => state.alts[m]?.totals).map((m) => {
        const p = state.alts[m];
        const steep = slopeProfile(state.terrain, p);
        return `${MODE_LABELS[m].name} ${p.totals.o2UsedKg.toFixed(3)} kg, ${Math.round(steep[2] + steep[3])} m over 15°`;
      });
      return `Compare routes for the same stops: ${parts.join(' · ')}.`;
    },
  },
  {
    run: async () => {},
    after: () => setTimeout(() => { location.href = `${$('open-hud').href}&play=30`; }, 1800),
    caption: () => 'Same plan in the helmet HUD the astronaut follows, and on a one-page cuff checklist (Print EVA checklist).',
  },
];

function tourCaption(text) {
  let box = $('tour-caption');
  if (!box) {
    box = el('div', { id: 'tour-caption', class: 'tour-caption', 'aria-live': 'polite' });
    document.querySelector('.map-wrap').append(box);
  }
  box.replaceChildren(
    el('span', { class: 'tour-count' }, `${tourStep + 1}/${TOUR_STEPS.length}`),
    el('span', { class: 'tour-text' }, text));
}

async function tourGo(i) {
  if (tourBusy || i < 0 || i >= TOUR_STEPS.length) return;
  tourBusy = true;
  try {
    tourStep = i;
    document.querySelectorAll('.tour-focus').forEach((n) => n.classList.remove('tour-focus'));
    const s = TOUR_STEPS[i];
    // The best set comes from the full dust-storm plan: if we jump straight to it, compute that first.
    if (i >= 4 && i < TOUR_STEPS.length - 1 && !tourBest) { await TOUR_STEPS[1].run(); tourBest = state.plan?.bestSubset || null; }
    await s.run();
    tourCaption(state.plan ? s.caption(state.plan) : '');
    s.after?.();
  } finally { tourBusy = false; }
}

// "About this model" dialog (index.html). Native <dialog>: Esc and the Close button close it.
// Two tabs: "The model" and "Site data: history and latest" (js/sitedata.js, loaded the first time it is shown).
function showAboutTab(which) {
  for (const [tab, panel] of [['tab-model', 'panel-model'], ['tab-sites', 'panel-sites']]) {
    const on = tab === which;
    $(tab).setAttribute('aria-selected', String(on));
    $(tab).tabIndex = on ? 0 : -1;
    $(panel).hidden = !on;
  }
  if (which === 'tab-sites') {
    import('./sitedata.js')
      .then((m) => m.renderSiteData($('site-data'), DATASET))
      .catch((err) => { console.warn('Site data', err); $('site-data').textContent = 'Site data could not be loaded.'; });
  }
}
$('about-open')?.addEventListener('click', () => { showAboutTab('tab-model'); $('about').showModal(); });
$('sites-open')?.addEventListener('click', () => { showAboutTab('tab-sites'); $('about').showModal(); });
for (const id of ['tab-model', 'tab-sites']) {
  $(id)?.addEventListener('click', () => showAboutTab(id));
  $(id)?.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault(); e.stopPropagation();
    const next = id === 'tab-model' ? 'tab-sites' : 'tab-model';
    showAboutTab(next); $(next).focus();
  });
}

// Side panel width, adjustable by the user: drag the handle, or focus it and use the arrow keys
// (Home/End = narrowest/widest, double-click or Enter = default). Remembered in this browser.
const PANEL_DEFAULT = 390, PANEL_MIN = 320, PANEL_KEY = 'marswalk-panel-w';
function initPanelResizer() {
  const handle = $('panel-resizer');
  const layout = document.querySelector('.layout');
  if (!handle || !layout) return;
  const maxW = () => Math.max(PANEL_MIN, Math.min(900, layout.clientWidth - 360)); // keep at least 360 px of map
  const setW = (w, save = true) => {
    const px = Math.round(Math.min(maxW(), Math.max(PANEL_MIN, w)));
    layout.style.setProperty('--panel-w', `${px}px`);
    handle.setAttribute('aria-valuenow', String(px));
    handle.setAttribute('aria-valuemin', String(PANEL_MIN));
    handle.setAttribute('aria-valuemax', String(maxW()));
    if (save) { try { localStorage.setItem(PANEL_KEY, String(px)); } catch { /* storage blocked: width just isn't remembered */ } }
    return px;
  };
  let saved = null;
  try { saved = Number(localStorage.getItem(PANEL_KEY)) || null; } catch { /* ignore */ }
  setW(saved ?? PANEL_DEFAULT, false);

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const move = (ev) => setW(layout.getBoundingClientRect().right - ev.clientX, false);
    const up = (ev) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      setW(parseFloat(layout.style.getPropertyValue('--panel-w')));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => setW(PANEL_DEFAULT));
  handle.addEventListener('keydown', (e) => {
    const now = parseFloat(layout.style.getPropertyValue('--panel-w')) || PANEL_DEFAULT;
    const step = e.shiftKey ? 80 : 20;
    const next = { ArrowLeft: now + step, ArrowRight: now - step, Home: PANEL_MIN, End: maxW(), Enter: PANEL_DEFAULT }[e.key];
    if (next == null) return;
    e.preventDefault(); e.stopPropagation(); // don't step the tour
    setW(next);
  });
  // Window got smaller: keep the panel within the new limit without forgetting the user's choice.
  addEventListener('resize', () => {
    const now = parseFloat(layout.style.getPropertyValue('--panel-w')) || PANEL_DEFAULT;
    if (now > maxW()) setW(now, false);
  });
}
initPanelResizer();

function startTour() {
  document.body.classList.add('touring');
  $('map-hint').hidden = true;
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, select, textarea')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); tourGo(tourStep + 1); }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); tourGo(tourStep - 1); }
  });
  tourGo(0);
}

window.marswalk = { state, get map() { return map; }, get planner() { return planner.mode; }, replan, render: renderAll };

boot();
