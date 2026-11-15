// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
// Route options: least oxygen (the engine as is), safest, shortest. Owner: engine lane (louis-claude).
//
// Each option is a full plan result (CONTRACTS §4) plus `mode`. Only the cost model used to pick
// paths and order changes (CONFIG.routeModes); time, O2 and dose are always measured with the
// real model, so the three cards compare fairly. No formulas are copied from js/engine.js.

import { CONFIG } from './config.js';
import { planWalk } from './engine.js';

export const ROUTE_MODES = ['eco', 'safe', 'short'];

export const MODE_LABELS = {
  eco: { name: 'Least oxygen', blurb: 'Cheapest walk for the suit.' },
  safe: { name: 'Safest', blurb: 'Avoids steep, sandy and rough ground.' },
  short: { name: 'Shortest', blurb: 'Fewest metres on walkable ground.' },
};

/** The config used to choose paths for `mode` (eco returns the base config unchanged). */
export function routeConfig(mode, base = CONFIG, slopeCapDeg = null) {
  if (mode === 'eco') return base;
  const c = structuredClone(base);
  if (mode === 'short') {
    // Same cost for every metre: constant speed, no grade, sand or roughness terms.
    c.walk.toblerK = 0;
    c.metabolic.uphillPerGrade = 0;
    c.metabolic.downhillPerGrade = 0;
    c.terrain.sandSpeedFactor = 1;
    c.terrain.sandMetabolicFactor = 1;
    c.terrain.roughnessSpeedPenalty = 0;
    return c;
  }
  if (mode === 'safe') {
    const m = base.routeModes.safe;
    c.walk.maxSlopeDeg = Math.min(base.walk.maxSlopeDeg, slopeCapDeg ?? m.maxSlopeDeg[0]);
    c.metabolic.uphillPerGrade *= m.gradeCostFactor;
    c.metabolic.downhillPerGrade *= m.gradeCostFactor;
    c.terrain.sandMetabolicFactor = m.sandMetabolicFactor;
    c.terrain.roughnessSpeedPenalty = m.roughnessSpeedPenalty;
    return c;
  }
  throw new Error(`Unknown route mode: ${mode}`);
}

/** One route option. `safe` relaxes its slope cap until it reaches as many stops as `eco`. */
export function planRoute(mode, terrain, targetsFile, options = {}) {
  const base = options.config ?? CONFIG;
  if (mode === 'eco') return { ...planWalk(terrain, targetsFile, options), mode };
  if (mode === 'short') return { ...planWalk(terrain, targetsFile, { ...options, routeConfig: routeConfig('short', base) }), mode };
  const caps = [...base.routeModes.safe.maxSlopeDeg, base.walk.maxSlopeDeg].filter((d) => d <= base.walk.maxSlopeDeg);
  const want = options.ecoUnreachable ?? planWalk(terrain, targetsFile, { ...options, contingency: false }).unreachable.length;
  let plan = null, cap = null;
  for (cap of caps) {
    try {
      plan = planWalk(terrain, targetsFile, { ...options, routeConfig: routeConfig('safe', base, cap) });
    } catch { plan = null; continue; } // habitat itself too steep for this cap
    if (plan.unreachable.length <= want) break;
  }
  return { ...plan, mode, slopeCapDeg: cap };
}

/** All three options for the same stops and conditions: { eco, safe, short }. */
export function planAlternatives(terrain, targetsFile, options = {}) {
  const eco = planRoute('eco', terrain, targetsFile, options);
  const extra = { ...options, ecoUnreachable: eco.unreachable.length };
  return {
    eco,
    safe: planRoute('safe', terrain, targetsFile, extra),
    short: planRoute('short', terrain, targetsFile, extra),
  };
}

/** Metres of the route on ground of each slope class, for the option cards. */
export function slopeProfile(terrain, plan, classes = [10, 15, 20]) {
  const W = terrain.width, cs = terrain.cellSize, E = terrain.layers.elevation;
  const out = new Array(classes.length + 1).fill(0);
  for (let k = 1; k < plan.path.length; k++) {
    const [x0, y0] = plan.path[k - 1], [x1, y1] = plan.path[k];
    const run = Math.hypot(x1 - x0, y1 - y0) * cs;
    const deg = Math.atan(Math.abs(E[y1 * W + x1] - E[y0 * W + x0]) / run) * 180 / Math.PI;
    let c = classes.findIndex((lim) => deg < lim);
    if (c < 0) c = classes.length;
    out[c] += run;
  }
  return out; // [< 10°, 10-15°, 15-20°, >= 20°] metres
}
