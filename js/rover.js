// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
// Marswalk Budget — pressurized-rover sortie planner.
//
// Pure functions, no DOM, no network (runs in the browser and in Node tests), like js/engine.js.
//
// Model in one paragraph:
//   The crew drives from the habitat to each stop in a pressurized rover and breathes cabin air, so
//   driving costs no suit O2. At each stop they suit up for the work there (one EVA per stop, with a
//   fresh suit). The route is the fastest drive. The binding safety rule is the walk-back limit, as in
//   Apollo LRV traverse planning: if the rover breaks down anywhere on the drive, the crew must be able
//   to walk to the habitat or a haven on suit O2 alone, keeping the reserve. Walk-back uses the walking
//   model under today's conditions, without the sample kit (it stays in the rover).

import { CONFIG } from './config.js';
import {
  buildCostGrid, search, bestOrder, rebuildPath, measurePath, effectiveParams,
  energyToO2Kg, resolveTargets, resolvePoint,
} from './engine.js';

/** Config for the driving grid: cost = seconds of driving (speed falls with grade, sand and roughness). */
export function roverGridConfig(config = CONFIG) {
  const R = config.rover;
  const conditions = {};
  for (const [name, c] of Object.entries(config.conditions)) {
    // Dust slows the drive (visibility); the sample kit rides in the rover, so it does not.
    conditions[name] = { speedFactor: name === 'heavyKit' ? 1 : c.speedFactor ?? 1, maxSlopeDeg: c.maxSlopeDeg };
  }
  return {
    ...config,
    walk: { ...config.walk, vFlatMps: R.speedMps, toblerK: R.gradeK, toblerG0: 0, maxSlopeDeg: R.maxSlopeDeg },
    metabolic: { ...config.metabolic, baseW: 1, uphillPerGrade: 0, downhillPerGrade: 0 },
    terrain: { ...config.terrain, sandMetabolicFactor: 1 },
    conditions,
  };
}

/** Walk-back field: energy (J) to walk from every cell to the nearest refuge, and which one. */
function walkbackField(g, cells) {
  const N = g.width * g.height;
  const dist = new Float64Array(N).fill(Infinity);
  const who = new Int16Array(N);
  cells.forEach((c, r) => {
    const d = search(g, c, { reverse: true }).dist;
    for (let i = 0; i < N; i++) if (d[i] < dist[i]) { dist[i] = d[i]; who[i] = r; }
  });
  return { dist, who };
}

/**
 * Plan a pressurized-rover sortie from the habitat through the chosen stops and back.
 * Same inputs as planWalk (options: stopIds, conditions, havens, config). Returns a Plan with the
 * planWalk fields the console draws, plus `vehicle: 'rover'` and `walkback` (CONTRACTS §4c).
 */
export function planRover(terrain, targetsFile, options = {}) {
  const config = options.config ?? CONFIG;
  const conditions = options.conditions ?? {};
  const R = config.rover;
  const gr = buildCostGrid(terrain, roverGridConfig(config), conditions);
  const walkCond = { ...conditions };
  delete walkCond.heavyKit;
  const gw = buildCostGrid(terrain, config, walkCond);
  const W = gr.width;

  const resolved = resolveTargets(terrain, targetsFile);
  const habitat = resolved.habitat;
  const wanted = options.stopIds ? resolved.targets.filter((t) => options.stopIds.includes(t.id)) : resolved.targets;
  const inGrid = (p) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < gr.height;
  if (!inGrid(habitat)) throw new Error('habitat is outside the terrain');
  const hCell = habitat.y * W + habitat.x;
  if (gr.blocked[hCell]) throw new Error('habitat sits on impassable ground');
  const havens = (options.havens ?? []).map((h) => resolvePoint(terrain, h)).filter((h) => inGrid(h) && !gw.blocked[h.y * W + h.x]);

  // Fastest drive between every pair of nodes.
  const nodes = [habitat, ...wanted];
  const cells = nodes.map((p) => (inGrid(p) ? p.y * W + p.x : -1));
  const n = nodes.length;
  const E = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  const prevs = new Array(n);
  for (let i = 0; i < n; i++) {
    if (cells[i] < 0 || gr.blocked[cells[i]]) continue;
    const targets = cells.filter((c, j) => j !== i && c >= 0 && !gr.blocked[c]);
    const { dist, prev } = search(gr, cells[i], { targets });
    prevs[i] = prev;
    for (let j = 0; j < n; j++) E[i][j] = i === j ? 0 : cells[j] >= 0 ? dist[cells[j]] : Infinity;
  }
  const reachable = [], unreachable = [];
  for (let j = 1; j < n; j++) {
    if (Number.isFinite(E[0][j]) && Number.isFinite(E[j][0])) reachable.push(j);
    else unreachable.push(nodes[j].id);
  }
  const order = bestOrder(E, reachable, config.planner.bruteForceMaxStops);

  // Legs and the full path.
  const p = effectiveParams(config, conditions);
  const evaPowerW = config.metabolic.dwellW * p.metabolicFactor;
  const usable = config.suit.o2CapacityKg * (1 - config.suit.reserveFraction);
  const legs = [], path = [], stops = [];
  let driveTimeS = 0, distanceM = 0, last = 0;
  for (const j of [...order, 0]) {
    const pc = rebuildPath(prevs[last], cells[last], cells[j]);
    const m = measurePath(gr, pc);
    driveTimeS += m.timeS; distanceM += m.distanceM;
    legs.push({
      from: last === 0 ? 'habitat' : nodes[last].id, to: j === 0 ? 'habitat' : nodes[j].id,
      path: pc.map((c) => [c % W, Math.floor(c / W)]), distanceM: m.distanceM, timeS: m.timeS, energyJ: 0, o2Kg: 0,
    });
    for (let k = path.length === 0 ? 0 : 1; k < pc.length; k++) path.push(pc[k]);
    if (j !== 0) {
      const s = nodes[j];
      const evaO2Kg = energyToO2Kg(s.dwellMin * 60 * evaPowerW, config);
      stops.push({ id: s.id, name: s.name, x: s.x, y: s.y, value: s.value, dwellMin: s.dwellMin, pathIndex: path.length - 1, evaO2Kg });
    }
    last = j;
  }

  // Dose: cabin while driving (shielded), full surface dose while suited at stops.
  const base = config.radiation.surfaceMSvPerDay / 86400;
  const cabinRate = base * (R.cabinGcrDoseFactor + (p.doseFactor - 1) * R.cabinSpeDoseFactor);
  const evaRate = base * p.doseFactor;

  // Timeline, walk-back O2 at every path point.
  const refugeIds = ['habitat', ...havens.map((h) => h.id)];
  const back = walkbackField(gw, [hCell, ...havens.map((h) => h.y * W + h.x)]);
  const stopAt = new Map(stops.map((s) => [s.pathIndex, s]));
  const L = path.length;
  const cap = config.suit.o2CapacityKg;
  const profile = [];
  const beyond = [];
  let t = 0, d = 0, dose = 0, maxBack = 0, maxBackAt = 0, beyondM = 0, evaTimeS = 0;
  for (let k = 0; k < L; k++) {
    if (k > 0) {
      const m = measurePath(gr, [path[k - 1], path[k]]);
      t += m.timeS; d += m.distanceM; dose += m.timeS * cabinRate;
    }
    const wb = energyToO2Kg(back.dist[path[k]], config);
    if (wb > maxBack) { maxBack = wb; maxBackAt = k; }
    const out = !(wb <= usable);
    if (out) {
      if (k > 0) beyondM += d - profile[profile.length - 1].distanceM;
      const lastGap = beyond[beyond.length - 1];
      if (lastGap && lastGap[1] === k - 1) lastGap[1] = k; else beyond.push([k, k]);
    }
    const pt = (time, doseNow) => ({
      pathIndex: k, elapsedS: time, distanceM: d, doseMSv: doseNow, elevationM: gr.elev[path[k]],
      walkbackO2Kg: Number.isFinite(wb) ? wb : null, refuge: refugeIds[back.who[path[k]]],
      o2RemainingKg: cap - (Number.isFinite(wb) ? Math.min(wb, cap) : cap), // chart: suit O2 left after a walk-back from here
    });
    profile.push(pt(t, dose));
    const s = stopAt.get(k);
    if (s) {
      s.arriveS = t; s.arriveO2Kg = 0;
      t += s.dwellMin * 60; evaTimeS += s.dwellMin * 60; dose += s.dwellMin * 60 * evaRate;
    }
  }
  // One profile point per path point, so the console can use it as an exact timeline.

  const scienceValue = stops.reduce((a, s) => a + s.value, 0);
  const evaMax = stops.reduce((a, s) => Math.max(a, s.evaO2Kg), 0);
  const totals = {
    distanceM, walkTimeS: driveTimeS, dwellTimeS: evaTimeS, totalTimeS: driveTimeS + evaTimeS,
    driveTimeS, energyJ: stops.reduce((a, s) => a + s.dwellMin * 60 * evaPowerW, 0),
    o2UsedKg: evaMax, // the longest single EVA: each stop is its own suited EVA from the rover
    evaO2TotalKg: stops.reduce((a, s) => a + s.evaO2Kg, 0),
    o2UsableKg: usable, o2CapacityKg: cap,
    doseMSv: dose, doseLimitMSv: config.radiation.walkLimitMSv,
    scienceValue, timeLimitS: R.maxHours * 3600,
  };
  const violations = [];
  if (evaMax > usable) violations.push('oxygen');
  if (dose > totals.doseLimitMSv) violations.push('radiation');
  if (totals.totalTimeS > totals.timeLimitS) violations.push('time');
  if (beyond.length) violations.push('walkback');

  const first = beyond[0];
  const limitK = first ? Math.max(0, first[0] - 1) : null;
  const walkback = {
    o2LimitKg: usable,
    maxO2Kg: maxBack, maxAtPathIndex: maxBackAt,
    beyond, beyondM,
    // Last point on the drive still inside walk-back range, before the route first leaves it.
    limitPoint: first ? { pathIndex: limitK, x: path[limitK] % W, y: Math.floor(path[limitK] / W), elapsedS: profile[limitK].elapsedS } : null,
    note: R.walkbackSpeedNote,
  };

  return {
    ok: true,
    vehicle: 'rover',
    conditions: { ...conditions },
    order: order.map((j) => nodes[j].id),
    stops, unreachable, legs,
    path: path.map((c) => [c % W, Math.floor(c / W)]),
    totals,
    withinBudget: violations.length === 0,
    violations,
    turnBack: null, turnBackLatest: null, dropSuggestion: null, bestSubset: null,
    profile,
    walkback,
    havens: havens.map((h) => ({ id: h.id, name: h.name, kind: h.kind, x: h.x, y: h.y })),
    refills: [],
  };
}
