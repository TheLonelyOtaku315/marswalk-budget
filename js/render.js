// Marswalk Budget — drawing helpers: terrain rasters, map markers, budget bars, O2 chart.
// Owner: UI lane (Claude 1). No state lives here; js/app.js owns state and calls these.

import { cellToLatLon, buildCostGrid } from './engine.js';
import { CONFIG } from './config.js';

const L = window.L;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtDuration(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

/** Mission clock: T+h:mm */
export function fmtClock(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.round(s / 60);
  return `T+${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

export const fmtKg = (kg) => (Number.isFinite(kg) ? kg.toFixed(2) : '—');
export const fmtMSv = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
export const fmtKm = (m) => (Number.isFinite(m) ? (m / 1000).toFixed(2) : '—');

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function cellLatLng(terrain, x, y) {
  const { lat, lon } = cellToLatLon(terrain, x, y);
  return [lat, lon];
}

/** Outer corners of the grid (cell edges, not centres). */
export function terrainBounds(terrain) {
  const nw = cellToLatLon(terrain, -0.5, -0.5);
  const se = cellToLatLon(terrain, terrain.width - 0.5, terrain.height - 0.5);
  return L.latLngBounds([se.lat, nw.lon], [nw.lat, se.lon]);
}

// ---------------------------------------------------------------------------
// Terrain rasters
// ---------------------------------------------------------------------------

function lerp(a, b, t) { return a + (b - a) * t; }
function rampColor(stops, t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const u = (t - t0) / (t1 - t0 || 1);
      return c0.map((v, k) => lerp(v, c1[k], u));
    }
  }
  return stops[stops.length - 1][1];
}

/** Robust min/max (2nd and 98th percentile) ignoring nulls. */
function range(arr) {
  const v = [];
  for (let i = 0; i < arr.length; i += Math.max(1, Math.floor(arr.length / 20000))) {
    if (Number.isFinite(arr[i])) v.push(arr[i]);
  }
  if (!v.length) return [0, 1];
  v.sort((a, b) => a - b);
  const lo = v[Math.floor(v.length * 0.02)], hi = v[Math.floor(v.length * 0.98)];
  return lo === hi ? [lo, lo + 1] : [lo, hi];
}

const RAMPS = {
  elevation: [[0, [52, 22, 14]], [0.45, [150, 70, 38]], [0.8, [205, 140, 80]], [1, [240, 205, 150]]],
  slope: [[0, [255, 230, 120]], [0.5, [245, 150, 40]], [1, [220, 70, 20]]],
  thermalInertia: [[0, [250, 225, 140]], [0.5, [170, 150, 120]], [1, [70, 110, 160]]],
  roughness: [[0, [120, 220, 200]], [0.6, [200, 120, 220]], [1, [120, 20, 120]]],
};

export const LAYER_INFO = {
  hillshade: {
    name: 'Hillshade / elevation', ramp: RAMPS.elevation, opacity: 1,
    labels: ['low', 'high'], defaultOn: true,
  },
  slope: {
    name: 'Slope · red = blocked', ramp: [...RAMPS.slope.map(([t, c]) => [t * 0.85, c]), [0.86, [230, 30, 30]], [1, [230, 30, 30]]],
    opacity: 0.7, labels: ['gentle', 'steep', 'blocked'], defaultOn: true,
  },
  thermalInertia: {
    name: 'Thermal inertia', ramp: RAMPS.thermalInertia, opacity: 0.65,
    labels: ['loose sand', 'bedrock'], defaultOn: false,
  },
  roughness: {
    name: 'Roughness', ramp: RAMPS.roughness, opacity: 0.65,
    labels: ['smooth', 'boulders'], defaultOn: false,
  },
};

export function rampCss(ramp) {
  return `linear-gradient(90deg, ${ramp.map(([t, c]) => `rgb(${c.map(Math.round).join(',')}) ${Math.round(t * 100)}%`).join(', ')})`;
}

function canvasFor(terrain, paint) {
  const { width: W, height: H } = terrain;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < W * H; i++) {
    const rgba = paint(i);
    if (!rgba) continue;
    d[i * 4] = rgba[0]; d[i * 4 + 1] = rgba[1]; d[i * 4 + 2] = rgba[2]; d[i * 4 + 3] = rgba[3] ?? 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Elevation tint multiplied by a hillshade (sun from the north-west, 45° up). */
export function paintHillshade(terrain) {
  const { width: W, height: H, cellSize } = terrain;
  const z = terrain.layers.elevation;
  const [lo, hi] = range(z);
  const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
  const at = (x, y) => {
    x = Math.min(W - 1, Math.max(0, x)); y = Math.min(H - 1, Math.max(0, y));
    return z[y * W + x];
  };
  return canvasFor(terrain, (i) => {
    const e = z[i];
    if (!Number.isFinite(e)) return [10, 6, 5, 255];
    const x = i % W, y = (i / W) | 0;
    const ex = at(x + 1, y), wx = at(x - 1, y), sy = at(x, y + 1), ny = at(x, y - 1);
    const dzdx = ((Number.isFinite(ex) ? ex : e) - (Number.isFinite(wx) ? wx : e)) / (2 * cellSize);
    // y grows southwards; flip so +dzdy means rising to the north.
    const dzdy = ((Number.isFinite(ny) ? ny : e) - (Number.isFinite(sy) ? sy : e)) / (2 * cellSize);
    const slope = Math.atan(Math.hypot(dzdx, dzdy) * 1.5);
    const aspect = Math.atan2(dzdy, -dzdx);
    let shade = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect);
    shade = 0.35 + 0.75 * Math.max(0, shade);
    const c = rampColor(RAMPS.elevation, (e - lo) / (hi - lo));
    return [Math.min(255, c[0] * shade), Math.min(255, c[1] * shade), Math.min(255, c[2] * shade), 255];
  });
}

/** Slope coloured gentle→steep, blocked cells (too steep, too rough, no data) in red. */
export function paintSlope(terrain, conditions) {
  const g = buildCostGrid(terrain, CONFIG, conditions);
  const maxS = g.params?.maxSlopeDeg ?? CONFIG.walk.maxSlopeDeg;
  return canvasFor(terrain, (i) => {
    if (g.blocked[i]) return [230, 30, 30, 235];
    const t = g.slopeDeg[i] / maxS;
    if (t < 0.2) return null; // flat ground stays clear so the hillshade shows through
    const c = rampColor(RAMPS.slope, t);
    return [c[0], c[1], c[2], Math.round(90 + 140 * Math.min(1, t))];
  });
}

export function paintScalar(terrain, layer, ramp, fixedRange) {
  const arr = terrain.layers[layer];
  if (!arr) return null;
  const [lo, hi] = fixedRange ?? range(arr);
  return canvasFor(terrain, (i) => {
    const v = arr[i];
    if (!Number.isFinite(v)) return null;
    const c = rampColor(ramp, (v - lo) / (hi - lo));
    return [c[0], c[1], c[2], 255];
  });
}

export function imageLayer(canvas, bounds, opacity, pane) {
  return L.imageOverlay(canvas.toDataURL(), bounds, { opacity, className: 'terrain-img', pane, interactive: false });
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

export function stopIcon(label, cls = '', selected = false) {
  return L.divIcon({
    className: '', iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<div class="mk ${cls}${selected ? ' selected' : ''}">${label}</div>`,
  });
}

export function habitatIcon() {
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: '<div class="mk-hab" title="Habitat">H</div>' });
}

/** Hypothetical safe haven: a supply cache (O₂) or a storm shelter. "used" = the plan refills there. */
export function havenIcon(kind, used = false) {
  const label = kind === 'cache' ? 'O₂' : '⌂';
  const title = kind === 'cache' ? 'Supply cache (hypothetical)' : 'Storm shelter (hypothetical)';
  return L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div class="mk-haven ${kind}${used ? ' used' : ''}" title="${title}">${label}</div>` });
}

export function turnBackIcon(variant = 'hard') {
  if (variant === 'soft') {
    return L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: '<div class="mk-turn soft" title="Latest safe turn-around">↩</div>' });
  }
  return L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17], html: '<div class="mk-turn" title="Point of no return">↩</div>' });
}

// ---------------------------------------------------------------------------
// Timeline along the path (for hover tooltips and the chart)
// ---------------------------------------------------------------------------

/**
 * Elapsed seconds and O2 used (kg) at every path index.
 * Uses plan.profile when the engine provides it; otherwise interpolates
 * between the exact values the plan gives at each stop (marked approximate).
 */
export function pathTimeline(plan) {
  const n = plan.path.length;
  const t = new Float64Array(n), o2 = new Float64Array(n);
  const prof = plan.profile;
  if (Array.isArray(prof) && prof.length === n && Number.isFinite(prof[0]?.elapsedS ?? prof[0]?.timeS)) {
    const cap = plan.totals.o2CapacityKg;
    prof.forEach((p, k) => {
      t[k] = p.elapsedS ?? p.timeS;
      o2[k] = p.o2UsedKg ?? (p.o2RemainingKg != null ? cap - p.o2RemainingKg : NaN);
    });
    return { t, o2, exact: true };
  }
  // Key points: [pathIndex, departS, departO2] for the habitat and each stop, plus the end.
  const keys = [];
  let depart = { k: 0, s: 0, o2: 0 };
  plan.stops.forEach((s, i) => {
    const legO2 = plan.legs[i]?.o2Kg ?? 0;
    const legT = plan.legs[i]?.timeS ?? 0;
    keys.push([depart, { k: s.pathIndex, s: s.arriveS ?? depart.s + legT, o2: s.arriveO2Kg ?? depart.o2 + legO2 }]);
    const arr = keys[keys.length - 1][1];
    const nextLeg = plan.legs[i + 1];
    const nextArrO2 = i + 1 < plan.stops.length ? plan.stops[i + 1].arriveO2Kg : plan.totals.o2UsedKg;
    const nextArrS = i + 1 < plan.stops.length ? plan.stops[i + 1].arriveS : plan.totals.totalTimeS;
    depart = {
      k: s.pathIndex,
      s: nextLeg ? nextArrS - nextLeg.timeS : arr.s + s.dwellMin * 60,
      o2: nextLeg ? nextArrO2 - nextLeg.o2Kg : arr.o2,
    };
  });
  keys.push([depart, { k: n - 1, s: plan.totals.totalTimeS, o2: plan.totals.o2UsedKg }]);
  for (const [a, b] of keys) {
    const span = Math.max(1, b.k - a.k);
    for (let k = a.k; k <= b.k; k++) {
      const u = (k - a.k) / span;
      t[k] = lerp(a.s, b.s, u);
      o2[k] = lerp(a.o2, b.o2, u);
    }
  }
  for (const r of plan.refills ?? []) {
    for (let k = r.pathIndex + 1; k < n; k++) o2[k] -= r.refillKg ?? 0;
  }
  return { t, o2, exact: false, keys };
}

// ---------------------------------------------------------------------------
// Budget bars
// ---------------------------------------------------------------------------

function level(frac) { return frac > 1 ? 'red' : frac > 0.8 ? 'amber' : 'ok'; }

export function renderBudget(container, plan) {
  const T = plan.totals;
  container.replaceChildren();
  if (plan.vehicle === 'rover') { renderRoverBudget(container, plan); return; }

  // Oxygen: bar spans full capacity; hatched area on the right is the reserve.
  // With a refill at a supply cache, the bar spans capacity + what the cache put back in.
  const o2Frac = T.o2UsedKg / T.o2UsableKg;
  const refilled = T.o2RefilledKg || 0;
  const cap = T.o2CapacityKg + refilled;
  const usedPct = Math.min(100, (T.o2UsedKg / cap) * 100);
  const usablePct = (T.o2UsableKg / cap) * 100;
  const o2Bar = el('div', { class: 'bar' },
    el('div', { class: 'bar-reserve', style: `left:${usablePct}%` }),
    el('div', { class: 'bar-fill', style: `width:${Math.min(usedPct, usablePct)}%` }),
    usedPct > usablePct ? el('div', { class: 'bar-over', style: `left:${usablePct}%;width:${usedPct - usablePct}%` }) : null,
    el('div', { class: 'bar-tick', style: `left:calc(${usablePct}% - 1px)`, title: 'Usable limit; reserve beyond' }));
  container.append(el('div', { class: `metric ${level(o2Frac)}` },
    el('div', { class: 'metric-head' },
      el('span', { class: 'metric-label', html: refilled ? 'Suit O<sub>2</sub> used <small>(incl. 1 refill)</small>' : 'Suit O<sub>2</sub> used' }),
      el('span', { class: 'metric-value', html: `${fmtKg(T.o2UsedKg)} <small>/ ${fmtKg(T.o2UsableKg)} kg</small>` })),
    o2Bar,
    el('div', { class: 'metric-foot' },
      el('span', {}, `${Math.round(o2Frac * 100)}% of usable`),
      el('span', {}, refilled ? `cache added ${fmtKg(refilled)} kg · reserve ${fmtKg(cap - T.o2UsableKg)} kg untouched` : `reserve ${fmtKg(cap - T.o2UsableKg)} kg kept untouched`))));

  // EVA time: walk vs dwell split against the EVA limit (CONTRACTS §4 totals.timeLimitS; 6 h).
  const limit = Number.isFinite(T.timeLimitS) ? T.timeLimitS : null;
  const total = Math.max(T.totalTimeS, limit ?? 0) || 1;
  const pct = (s) => (s / total) * 100;
  const tFrac = limit ? T.totalTimeS / limit : 0;
  container.append(el('div', { class: `metric ${limit ? level(tFrac) : ''}` },
    el('div', { class: 'metric-head' },
      el('span', { class: 'metric-label' }, limit ? 'EVA time' : 'Total time'),
      el('span', { class: 'metric-value', html: `${fmtDuration(T.totalTimeS)}${limit ? ` <small>/ ${limit % 3600 ? fmtDuration(limit) : `${limit / 3600} h`}</small>` : ''}` })),
    el('div', { class: 'bar' },
      el('div', { class: 'bar-fill', style: `width:${pct(T.walkTimeS)}%;background:var(--ochre)` }),
      el('div', { class: 'bar-fill dwell', style: `left:${pct(T.walkTimeS)}%;width:${pct(T.dwellTimeS)}%` }),
      limit && tFrac > 1 ? el('div', { class: 'bar-over', style: `left:${pct(limit)}%;width:${pct(T.totalTimeS - limit)}%` }) : null,
      limit ? el('div', { class: 'bar-tick', style: `left:calc(${pct(limit)}% - 1px)`, title: 'EVA time limit' }) : null),
    el('div', { class: 'metric-foot' },
      el('span', {}, `walking ${fmtDuration(T.walkTimeS)} · ${fmtKm(T.distanceM)} km`),
      el('span', {}, `at stops ${fmtDuration(T.dwellTimeS)}`))));

  // Radiation.
  const dFrac = T.doseMSv / T.doseLimitMSv;
  container.append(el('div', { class: `metric ${level(dFrac)}` },
    el('div', { class: 'metric-head' },
      el('span', { class: 'metric-label' }, 'Radiation dose'),
      el('span', { class: 'metric-value', html: `${fmtMSv(T.doseMSv)} <small>/ ${fmtMSv(T.doseLimitMSv)} mSv</small>` })),
    el('div', { class: 'bar' },
      el('div', { class: 'bar-fill', style: `width:${Math.min(100, dFrac * 100)}%` }),
      dFrac > 1 ? el('div', { class: 'bar-tick', style: `left:calc(${100 / dFrac}% - 1px)`, title: 'Dose limit' }) : null),
    el('div', { class: 'metric-foot' },
      el('span', {}, `${Math.round(dFrac * 100)}% of the per-walk limit`),
      el('span', {}, `science value ${T.scienceValue}`))));
}

/** Rover sortie (js/rover.js): longest suited EVA, walk-back worst case, sortie time, cabin-shielded dose. */
function renderRoverBudget(container, plan) {
  const T = plan.totals, wb = plan.walkback;
  const bar = (frac, extra = '') => el('div', { class: 'bar' },
    el('div', { class: `bar-fill${extra}`, style: `width:${Math.min(100, frac * 100)}%` }),
    frac > 1 ? el('div', { class: 'bar-tick', style: `left:calc(${100 / frac}% - 1px)`, title: 'Limit' }) : null);
  const metric = (frac, label, value, foot1, foot2, b = bar(frac)) => container.append(el('div', { class: `metric ${level(frac)}` },
    el('div', { class: 'metric-head' }, el('span', { class: 'metric-label', html: label }), el('span', { class: 'metric-value', html: value })),
    b, el('div', { class: 'metric-foot' }, el('span', {}, foot1), el('span', {}, foot2))));

  const wbFrac = wb.maxO2Kg / wb.o2LimitKg;
  metric(wbFrac, 'Walk-back O<sub>2</sub> <small>(worst point)</small>',
    `${fmtKg(wb.maxO2Kg)} <small>/ ${fmtKg(wb.o2LimitKg)} kg</small>`,
    `${Math.round(wbFrac * 100)}% of a suit's usable O₂`, wb.beyond.length ? `${Math.round(wb.beyondM)} m out of range` : 'whole drive in range');
  const eFrac = T.o2UsedKg / T.o2UsableKg;
  metric(eFrac, 'Suit O<sub>2</sub> <small>(longest EVA at a stop)</small>',
    `${fmtKg(T.o2UsedKg)} <small>/ ${fmtKg(T.o2UsableKg)} kg</small>`,
    `${Math.round(eFrac * 100)}% of usable`, `all EVAs ${fmtKg(T.evaO2TotalKg)} kg (fresh suit each stop)`);

  const limit = T.timeLimitS, total = Math.max(T.totalTimeS, limit) || 1;
  const pct = (s) => (s / total) * 100;
  const tFrac = T.totalTimeS / limit;
  metric(tFrac, 'Sortie time', `${fmtDuration(T.totalTimeS)} <small>/ ${limit / 3600} h</small>`,
    `driving ${fmtDuration(T.driveTimeS)} · ${fmtKm(T.distanceM)} km`, `suited at stops ${fmtDuration(T.dwellTimeS)}`,
    el('div', { class: 'bar' },
      el('div', { class: 'bar-fill', style: `width:${pct(T.driveTimeS)}%;background:var(--ochre)` }),
      el('div', { class: 'bar-fill dwell', style: `left:${pct(T.driveTimeS)}%;width:${pct(T.dwellTimeS)}%` }),
      el('div', { class: 'bar-tick', style: `left:calc(${pct(limit)}% - 1px)`, title: 'Sortie limit' })));

  const dFrac = T.doseMSv / T.doseLimitMSv;
  metric(dFrac, 'Radiation dose', `${fmtMSv(T.doseMSv)} <small>/ ${fmtMSv(T.doseLimitMSv)} mSv</small>`,
    'cabin shields the drive', `science value ${T.scienceValue}`);
}

// ---------------------------------------------------------------------------
// O2 remaining chart (SVG)
// ---------------------------------------------------------------------------

/** Rover chart: O₂ a crew member would need to walk to safety if the rover broke down, along the drive. */
function renderRoverChart(container, plan) {
  const T = plan.totals, wb = plan.walkback;
  const Wd = 340, Ht = 130, pl = 30, pr = 8, pt = 8, pb = 20;
  const tMax = Math.max(T.totalTimeS, 60);
  const top = Math.max(wb.o2LimitKg * 1.15, wb.maxO2Kg * 1.05);
  const X = (s) => pl + (s / tMax) * (Wd - pl - pr);
  const Y = (kg) => pt + (1 - kg / top) * (Ht - pt - pb);
  const pts = plan.profile.filter((q) => q.walkbackO2Kg != null).map((q) => [q.elapsedS, Math.min(q.walkbackO2Kg, top)]);
  const line = pts.map(([s, kg], i) => `${i ? 'L' : 'M'}${X(s).toFixed(1)},${Y(kg).toFixed(1)}`).join('');
  const over = wb.beyond.length > 0;
  let svg = `<svg viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="Walk-back oxygen needed along the drive">`;
  svg += `<rect x="${pl}" y="${pt}" width="${Wd - pl - pr}" height="${Y(wb.o2LimitKg) - pt}" fill="#ef4b3f22"/>`;
  svg += `<line x1="${pl}" x2="${Wd - pr}" y1="${Y(wb.o2LimitKg)}" y2="${Y(wb.o2LimitKg)}" stroke="#ef4b3f" stroke-dasharray="4 3"/>`;
  svg += `<text x="${Wd - pr}" y="${Y(wb.o2LimitKg) - 3}" text-anchor="end">suit usable ${fmtKg(wb.o2LimitKg)} kg</text>`;
  if (pts.length) svg += `<path d="${line}L${X(pts[pts.length - 1][0]).toFixed(1)},${Y(0)}L${X(pts[0][0]).toFixed(1)},${Y(0)}Z" fill="${over ? '#ef4b3f33' : '#7fd3ff2a'}"/>`;
  svg += `<path d="${line}" fill="none" stroke="${over ? '#ef4b3f' : '#7fd3ff'}" stroke-width="2"/>`;
  for (const s of plan.stops) {
    if (!Number.isFinite(s.arriveS)) continue;
    svg += `<rect x="${X(s.arriveS).toFixed(1)}" y="${pt}" width="${Math.max(1, X(s.arriveS + s.dwellMin * 60) - X(s.arriveS)).toFixed(1)}" height="${Y(0) - pt}" fill="#ffffff10"/>`;
  }
  svg += `<line x1="${pl}" x2="${pl}" y1="${pt}" y2="${Y(0)}" stroke="#5a4236"/>`;
  svg += `<line x1="${pl}" x2="${Wd - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="#5a4236"/>`;
  svg += `<text x="${pl - 4}" y="${Y(0)}" text-anchor="end">0</text>`;
  svg += `<text x="${pl}" y="${Ht - 5}">T+0</text>`;
  svg += `<text x="${Wd - pr}" y="${Ht - 5}" text-anchor="end">${fmtClock(T.totalTimeS)}</text>`;
  svg += '</svg>';
  container.innerHTML = svg;
  container.append(el('div', { class: 'chart-legend' },
    'kg of suit O₂ needed to walk to the habitat or a haven if the rover broke down at that moment; light bands = suited work at stops. Below the red line = safe.'));
}

export function renderChart(container, plan, timeline) {
  container.replaceChildren();
  if (plan.vehicle === 'rover') { renderRoverChart(container, plan); return; }
  const T = plan.totals;
  const Wd = 340, Ht = 130, pl = 30, pr = 8, pt = 8, pb = 20;
  const tMax = Math.max(T.totalTimeS, 60);
  const cap = T.o2CapacityKg;
  const X = (s) => pl + (s / tMax) * (Wd - pl - pr);
  const Y = (kg) => pt + (1 - kg / cap) * (Ht - pt - pb);
  const reserve = cap - (T.o2UsableKg - (T.o2RefilledKg || 0)); // the reserve never changes with a refill
  const pts = [];
  const step = Math.max(1, Math.floor(timeline.t.length / 300));
  for (let k = 0; k < timeline.t.length; k += step) pts.push([timeline.t[k], cap - timeline.o2[k]]);
  pts.push([T.totalTimeS, cap - (T.o2UsedKg - (T.o2RefilledKg || 0))]);
  const line = pts.map(([s, kg], i) => `${i ? 'L' : 'M'}${X(s).toFixed(1)},${Y(Math.max(0, kg)).toFixed(1)}`).join('');
  const area = `${line}L${X(T.totalTimeS).toFixed(1)},${Y(0)}L${X(0)},${Y(0)}Z`;
  const over = T.o2UsedKg > T.o2UsableKg;

  let svg = `<svg viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="Oxygen remaining over time">`;
  svg += `<rect x="${pl}" y="${Y(reserve)}" width="${Wd - pl - pr}" height="${Y(0) - Y(reserve)}" fill="#ef4b3f22"/>`;
  svg += `<line x1="${pl}" x2="${Wd - pr}" y1="${Y(reserve)}" y2="${Y(reserve)}" stroke="#ef4b3f" stroke-dasharray="4 3"/>`;
  svg += `<text x="${Wd - pr}" y="${Y(reserve) - 3}" text-anchor="end">reserve ${fmtKg(reserve)} kg</text>`;
  // Stretches out of the habitat's sight (CONTRACTS §4 lineOfSight.gaps, path indices -> time).
  const gaps = plan.lineOfSight?.gaps ?? [];
  for (const [a, b] of gaps) {
    const t0 = timeline.t[a], t1 = timeline.t[Math.min(b + 1, timeline.t.length - 1)];
    if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0) {
      svg += `<rect x="${X(t0).toFixed(1)}" y="${pt}" width="${Math.max(1, X(t1) - X(t0)).toFixed(1)}" height="${Y(0) - pt}" fill="#9fb4c826"/>`;
    }
  }
  svg += `<path d="${area}" fill="${over ? '#ef4b3f33' : '#e0a14a33'}"/>`;
  for (const r of plan.refills ?? []) {
    if (!Number.isFinite(r.arriveS)) continue;
    const x = X(r.arriveS);
    svg += `<line x1="${x}" x2="${x}" y1="${pt}" y2="${Y(0)}" stroke="#7fd3ff" stroke-dasharray="3 3"/>`;
    svg += `<text x="${x + 3}" y="${pt + 9}" style="fill:#7fd3ff">refill</text>`;
  }
  svg += `<path d="${line}" fill="none" stroke="${over ? '#ef4b3f' : '#ffcf6e'}" stroke-width="2"/>`;
  for (const s of plan.stops) {
    if (!Number.isFinite(s.arriveS)) continue;
    svg += `<line x1="${X(s.arriveS)}" x2="${X(s.arriveS)}" y1="${pt}" y2="${Y(0)}" stroke="#ffffff22"/>`;
  }
  if (plan.turnBack) {
    const x = X(plan.turnBack.elapsedS);
    svg += `<line x1="${x}" x2="${x}" y1="${pt}" y2="${Y(0)}" stroke="#ef4b3f" stroke-width="2"/>`;
    const nearRight = x > Wd - 70;
    svg += `<text x="${nearRight ? x - 3 : x + 3}" y="${pt + 9}" text-anchor="${nearRight ? 'end' : 'start'}" style="fill:#ff8a80">turn back</text>`;
  }
  svg += `<line x1="${pl}" x2="${pl}" y1="${pt}" y2="${Y(0)}" stroke="#5a4236"/>`;
  svg += `<line x1="${pl}" x2="${Wd - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="#5a4236"/>`;
  svg += `<text x="${pl - 4}" y="${Y(cap) + 8}" text-anchor="end">${fmtKg(cap)}</text>`;
  svg += `<text x="${pl - 4}" y="${Y(0)}" text-anchor="end">0</text>`;
  svg += `<text x="${pl}" y="${Ht - 5}">T+0</text>`;
  svg += `<text x="${Wd - pr}" y="${Ht - 5}" text-anchor="end">${fmtClock(T.totalTimeS)}</text>`;
  svg += '</svg>';
  container.innerHTML = svg;
  container.append(el('div', { class: 'chart-legend' },
    `kg O₂ left in the suit vs mission time; grey ticks = arrival at stops${gaps.length ? "; blue-grey bands = out of the habitat's sight" : ''}.${timeline.exact ? '' : ' Between stops the curve is interpolated.'}`));
}
