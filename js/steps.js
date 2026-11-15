// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
// Turn-by-turn steps for a planned walk. Pure functions, no imports (tests run offline).
// Owner: integrate (tonny-claude). Input: a planWalk() result (CONTRACTS §4) + its terrain (§1).
//
// Each leg's cell path is simplified (Douglas-Peucker) into straight stretches; each stretch
// becomes one step: heading, turn relative to the previous stretch, distance, time, climb and
// whether most of it is loose sand. Times are the leg's engine time shared out by distance, so
// the steps of a leg always add up to the engine's leg time.

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SAND_TI = 200; // same threshold as CONFIG.terrain.looseSandTI

/** Compass bearing (deg, clockwise from north) from cell a to cell b. x = east, y = south. */
export function bearing(a, b) {
  const deg = (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function compass(deg) {
  return COMPASS[Math.round(deg / 45) % 8];
}

/** Signed smallest difference b - a in (-180, 180]. Positive = clockwise = to the right. */
export function turnAngle(a, b) {
  let d = ((b - a) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export function turnWord(d) {
  const side = d > 0 ? 'right' : 'left';
  const a = Math.abs(d);
  if (a < 20) return 'Continue';
  if (a < 60) return `Bear ${side}`;
  if (a < 135) return `Turn ${side}`;
  return `Turn sharply ${side}`;
}

/** Indices of the points kept by Douglas-Peucker with tolerance eps (cells). Always keeps ends. */
export function simplify(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, best = eps;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / len;
      if (d > best) { best = d; far = k; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  const out = [];
  for (let k = 0; k < pts.length; k++) if (keep[k]) out.push(k);
  return out;
}

/**
 * Build turn-by-turn steps.
 * @param plan     planWalk() result
 * @param terrain  terrain file (cellSize, layers.elevation, layers.thermalInertia)
 * @param names    Map id -> display name (optional); 'habitat' is always "the habitat"
 * @param opts     { toleranceM = 12, minStepM = 20 }
 * @returns [{ from, to, toName, dwellMin, distanceM, timeS, steps: [{ text, heading, bearingDeg,
 *            turn, distanceM, timeS, climbM, sandy, startIndex, endIndex }] }]
 *          startIndex/endIndex index into plan.path (the full route).
 */
export function buildSteps(plan, terrain, names = new Map(), opts = {}) {
  if (!plan?.legs?.length) return [];
  const cs = terrain.cellSize;
  const W = terrain.width;
  const elev = terrain.layers.elevation;
  const ti = terrain.layers.thermalInertia;
  const tol = (opts.toleranceM ?? 12) / cs;
  const minStep = opts.minStepM ?? 20;
  const nameOf = (id) => (id === 'habitat' ? 'the habitat' : names.get(id) || id);
  const dwell = new Map((plan.stops || []).map((s) => [s.id, s.dwellMin]));
  const z = (p) => elev[p[1] * W + p[0]];

  let offset = 0;
  return plan.legs.map((leg) => {
    const pts = leg.path;
    const start = offset;
    offset += Math.max(0, pts.length - 1);

    // Cumulative distance along the cell path (m).
    const cum = [0];
    for (let k = 1; k < pts.length; k++) {
      cum.push(cum[k - 1] + cs * Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    }
    const legDist = cum[cum.length - 1] || 1;

    // Vertices of the simplified line; drop stretches shorter than minStep (merge into the next).
    let idx = pts.length > 1 ? simplify(pts, tol) : [0];
    if (idx.length > 2) {
      const merged = [idx[0]];
      for (let q = 1; q < idx.length - 1; q++) {
        if (cum[idx[q]] - cum[merged[merged.length - 1]] >= minStep) merged.push(idx[q]);
      }
      merged.push(idx[idx.length - 1]);
      idx = merged;
    }

    const steps = [];
    let prevBearing = null;
    for (let q = 0; q + 1 < idx.length; q++) {
      const i = idx[q], j = idx[q + 1];
      const b = bearing(pts[i], pts[j]);
      const dist = cum[j] - cum[i];
      let sand = 0, n = 0;
      if (ti) for (let k = i; k <= j; k++) { n++; if (ti[pts[k][1] * W + pts[k][0]] < SAND_TI) sand++; }
      const za = z(pts[i]), zb = z(pts[j]);
      const climbM = za == null || zb == null ? 0 : zb - za;
      const turn = prevBearing == null ? null : turnAngle(prevBearing, b);
      const head = compass(b);
      const verb = turn == null ? `Head ${head}` : `${turnWord(turn)} ${turnWord(turn) === 'Continue' ? head : `to ${head}`}`;
      steps.push({
        text: verb,
        heading: head,
        bearingDeg: Math.round(b),
        turn: turn == null ? null : Math.round(turn),
        distanceM: dist,
        timeS: (leg.timeS * dist) / legDist,
        climbM,
        sandy: n > 0 && sand / n > 0.5,
        startIndex: start + i,
        endIndex: start + j,
      });
      prevBearing = b;
    }

    // Fold consecutive "Continue" steps into one (DP can split a gently curving line).
    const folded = [];
    for (const s of steps) {
      const last = folded[folded.length - 1];
      if (last && s.text.startsWith('Continue') && s.sandy === last.sandy) {
        last.distanceM += s.distanceM; last.timeS += s.timeS; last.climbM += s.climbM; last.endIndex = s.endIndex;
      } else folded.push({ ...s });
    }

    return {
      from: leg.from,
      to: leg.to,
      toName: nameOf(leg.to),
      dwellMin: leg.to === 'habitat' ? 0 : dwell.get(leg.to) ?? 0,
      distanceM: leg.distanceM,
      timeS: leg.timeS,
      steps: folded,
    };
  });
}
