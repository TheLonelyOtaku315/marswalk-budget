// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
import { cellToLatLon } from '../engine.js';

const MARS_RADIUS_M = 3_389_500;
const RAD = Math.PI / 180;
const lerp = (a, b, fraction) => a + (b - a) * fraction;

export function clampProgress(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function bearingDeg(from, to) {
  const a = from.lat * RAD;
  const b = to.lat * RAD;
  const dl = (to.lon - from.lon) * RAD;
  const east = Math.sin(dl) * Math.cos(b);
  const north = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dl);
  return (Math.atan2(east, north) / RAD + 360) % 360;
}

export function distanceM(from, to) {
  const dlat = (to.lat - from.lat) * RAD;
  const dlon = (to.lon - from.lon) * RAD;
  const h = Math.sin(dlat / 2) ** 2
    + Math.cos(from.lat * RAD) * Math.cos(to.lat * RAD) * Math.sin(dlon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
}

function interpolate(points, index, key) {
  const right = points.findIndex((point) => point.pathIndex > index);
  if (right === 0) return points[0][key];
  if (right === -1) return points.at(-1)[key];
  const a = points[right - 1];
  const b = points[right];
  return lerp(a[key], b[key], (index - a.pathIndex) / (b.pathIndex - a.pathIndex));
}

function profileValue(plan, p, key) {
  if (!plan.profile?.length) return null;
  const points = plan.profile;
  const index = clampProgress(p) * (plan.path.length - 1);
  const value = p <= 0 ? points[0][key] : interpolate(points, index, key);
  return Number.isFinite(value) ? value : null;
}

function betweenArrivals(plan, p, key, legKey, total) {
  const progress = clampProgress(p);
  if (progress === 0) return 0;
  const end = plan.path.length - 1;
  if (end === 0) return total * progress;
  const points = [{ pathIndex: 0, [key]: 0 }];
  for (const [i, stop] of plan.stops.entries()) {
    const nextArrival = plan.stops[i + 1]?.[key] ?? total;
    const nextLeg = plan.legs[i + 1];
    points.push(stop);
    if (nextLeg) {
      // Use the next leg's measured cost to account for time and oxygen spent at the stop.
      points.push({ pathIndex: stop.pathIndex, [key]: Math.max(stop[key], nextArrival - nextLeg[legKey]) });
    }
  }
  points.push({ pathIndex: end, [key]: total });
  return interpolate(points, progress * end, key);
}

function elapsedAt(plan, p) {
  if (p <= 0) return 0;
  if (p >= 1) return plan.totals.totalTimeS;
  return profileValue(plan, p, 'elapsedS')
    ?? betweenArrivals(plan, p, 'arriveS', 'timeS', plan.totals.totalTimeS);
}

export function positionAt(plan, terrain, p) {
  const progress = clampProgress(p);
  const last = plan.path.length - 1;
  const index = progress * last;
  const pathIndex = Math.floor(index);
  const [ax, ay] = plan.path[pathIndex];
  const [bx, by] = plan.path[Math.min(pathIndex + 1, last)];
  const x = lerp(ax, bx, index - pathIndex);
  const y = lerp(ay, by, index - pathIndex);
  return { pathIndex, x, y, ...cellToLatLon(terrain, x, y), elapsedS: elapsedAt(plan, progress) };
}

// Suit oxygen, including the reserve. All consumption comes from the plan.
export function o2At(plan, p) {
  const { o2CapacityKg, o2UsedKg } = plan.totals;
  if (p <= 0) return o2CapacityKg;
  if (p >= 1) return o2CapacityKg - o2UsedKg;
  return profileValue(plan, p, 'o2RemainingKg')
    ?? o2CapacityKg - betweenArrivals(plan, p, 'arriveO2Kg', 'o2Kg', o2UsedKg);
}

export function doseAt(plan, p) {
  const { doseMSv, totalTimeS } = plan.totals;
  if (p <= 0) return 0;
  if (p >= 1) return doseMSv;
  return profileValue(plan, p, 'doseMSv') ?? (totalTimeS ? doseMSv * elapsedAt(plan, p) / totalTimeS : 0);
}

export function nextStop(plan, pathIndex) {
  return plan.stops.find((stop) => stop.pathIndex > pathIndex) ?? null;
}

export function passedTurnBack(plan, p) {
  const point = plan.turnBack;
  return point != null && clampProgress(p) * (plan.path.length - 1) > point.pathIndex;
}

export function outOfSightAt(plan, pathIndex) {
  if (plan.lineOfSight?.gaps) {
    return plan.lineOfSight.gaps.some(([start, end]) => pathIndex >= start && pathIndex <= end);
  }
  // Legacy or partial plans may carry only the downsampled profile.
  const point = plan.profile?.findLast((sample) => sample.pathIndex <= pathIndex);
  return point?.inSight === false;
}

export function stormGuidance(plan, terrain, routeIndex, complete) {
  if (complete || plan.conditions?.dustStorm || plan.turnBackLatest === undefined) return null;
  const mark = plan.turnBackLatest;
  if (mark === null) return plan.withinBudget ? 'safe' : null;
  if (routeIndex > mark.pathIndex) return 'past';
  const end = plan.path.length - 1;
  const here = profileValue(plan, routeIndex / end, 'distanceM');
  const there = profileValue(plan, mark.pathIndex / end, 'distanceM');
  const metresLeft = here !== null && there !== null ? there - here : (mark.pathIndex - routeIndex) * terrain.cellSize;
  return metresLeft <= 50 ? 'approaching' : null;
}

export function currentInstruction(legs, pathIndex, plan) {
  for (const leg of legs) {
    const step = leg.steps.find(({ startIndex, endIndex }) => startIndex <= pathIndex && pathIndex < endIndex);
    if (!step) continue;
    const last = plan.path.length - 1;
    const here = profileValue(plan, pathIndex / last, 'distanceM');
    const end = profileValue(plan, step.endIndex / last, 'distanceM');
    const remainingM = here !== null && end !== null
      ? Math.max(0, end - here)
      : step.distanceM * (step.endIndex - pathIndex) / (step.endIndex - step.startIndex);
    return { step, destination: leg.to === 'habitat' ? 'habitat' : leg.toName, remainingM };
  }
  return null;
}

// Average signed grade over the next metres of the planned path.
export function slopeAheadDeg(terrain, plan, pathIndex, lookaheadM) {
  const start = Math.floor(pathIndex);
  if (start >= plan.path.length - 1 || lookaheadM <= 0) return null;
  const elevation = ([x, y]) => terrain.layers.elevation[y * terrain.width + x];
  let rise = 0;
  let run = 0;
  for (let i = start; i < plan.path.length - 1 && run < lookaheadM; i++) {
    const a = plan.path[i];
    const b = plan.path[i + 1];
    const ea = elevation(a);
    const eb = elevation(b);
    if (!Number.isFinite(ea) || !Number.isFinite(eb)) return null;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * terrain.cellSize;
    if (!length) continue;
    const available = i === start ? length * (1 - (pathIndex - start)) : length;
    const step = Math.min(available, lookaheadM - run);
    run += step;
    rise += (eb - ea) * step / length;
  }
  return run ? Math.atan2(rise, run) / RAD : null;
}

export function walkSnapshot(plan, terrain, habitat, p) {
  const progress = clampProgress(p);
  const position = positionAt(plan, terrain, progress);
  const complete = progress === 1 || plan.totals.totalTimeS === 0;
  const upcoming = nextStop(plan, position.pathIndex);
  const returning = !complete && !upcoming;
  const destination = upcoming ?? habitat;
  const target = cellToLatLon(terrain, destination.x, destination.y);
  const nextCell = plan.path[position.pathIndex + 1];
  const bearing = complete ? null : bearingDeg(position, target);
  const heading = !complete && nextCell ? bearingDeg(position, cellToLatLon(terrain, ...nextCell)) : null;
  const { totals } = plan;
  const o2LeftKg = o2At(plan, progress);
  const reserveKg = totals.o2CapacityKg - totals.o2UsableKg;
  // The legacy plan has no walkback estimate except on its final leg home.
  const lastLeg = plan.legs.at(-1);
  const homeIndex = plan.path.length - 1;
  const lastStopIndex = plan.stops.at(-1)?.pathIndex ?? 0;
  const routeIndex = progress * homeIndex;
  const o2ToHomeKg = complete || progress === 0 ? 0 : profileValue(plan, progress, 'o2ToHomeKg')
    ?? (returning && lastLeg && homeIndex > lastStopIndex
      ? lastLeg.o2Kg * (homeIndex - routeIndex) / (homeIndex - lastStopIndex)
      : null);
  const o2MarginKg = o2LeftKg - reserveKg - (o2ToHomeKg ?? 0);
  return {
    position, routeIndex, upcoming, complete, returning, destination, bearing, heading,
    rangeM: complete ? 0 : distanceM(position, target),
    remainingS: Math.max(0, totals.totalTimeS - position.elapsedS),
    o2LeftKg, o2ToHomeKg, o2MarginKg, reserveKg,
    o2MarginFraction: totals.o2UsableKg ? clampProgress(o2MarginKg / totals.o2UsableKg) : 0,
    doseMSv: doseAt(plan, progress),
    slopeDeg: complete ? null : slopeAheadDeg(terrain, plan, routeIndex, 30),
    turnBack: !complete && passedTurnBack(plan, progress),
    storm: stormGuidance(plan, terrain, routeIndex, complete),
    outOfSight: !complete && outOfSightAt(plan, position.pathIndex),
  };
}

export function relativeBearingDeg(bearing, heading) {
  return wrapHeadingDeg(bearing - heading + 180) - 180;
}

export function wrapHeadingDeg(degrees) {
  return ((degrees % 360) + 360) % 360;
}

export function smoothHeadingDeg(previous, next, fraction) {
  if (!Number.isFinite(previous)) return wrapHeadingDeg(next);
  return wrapHeadingDeg(previous + relativeBearingDeg(next, previous) * clampProgress(fraction));
}

// Horizontal projection of the back-of-screen direction (W3C Device Orientation, A.1).
export function deviceHeadingDeg(alpha, beta = 0, gamma = 0) {
  if (!Number.isFinite(alpha)) return null;
  const pitch = (beta ?? 0) * RAD;
  const roll = (gamma ?? 0) * RAD;
  const east = -Math.sin(roll);
  const north = Math.sin(pitch) * Math.cos(roll);
  const bearing = Math.hypot(east, north) < 0.01 ? 0 : Math.atan2(east, north) / RAD;
  return wrapHeadingDeg(bearing - alpha);
}

export function stereoEyes(width) {
  const eyeWidth = width / 2;
  const inward = Math.min(6, eyeWidth * 0.015);
  return [
    { left: 0, width: eyeWidth, offset: inward },
    { left: eyeWidth, width: eyeWidth, offset: -inward },
  ];
}

export function compassTicks(heading) {
  const first = Math.ceil((heading - 50) / 10) * 10;
  const ticks = [];
  for (let angle = first; angle <= heading + 50; angle += 10) {
    const degrees = (angle + 360) % 360;
    const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[degrees];
    ticks.push({
      offset: angle - heading,
      label: cardinal ?? (degrees % 30 === 0 ? String(degrees) : ''),
    });
  }
  return ticks;
}
