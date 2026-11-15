// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
// Marswalk Budget — EVA cuff checklist: the timed list an astronaut wears on the wrist, built only
// from the plan result (CONTRACTS §4). No new maths: times, O2 and dose come from the planner.
// Owner: tonny-claude. buildChecklist() is pure (tested in tests/checklist.test.mjs);
// mountChecklist() is the page (checklist.html) and imports the browser-only loader lazily.

/** Mission clock: T+h:mm */
export function clock(s) {
  if (!Number.isFinite(s)) return 'T+—';
  const m = Math.round(s / 60);
  return `T+${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
/** "1 h 05 min" / "25 min" */
export function duration(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}
const kg = (v) => (Number.isFinite(v) ? `${v.toFixed(2)} kg` : '—');
const metres = (v) => (Number.isFinite(v) ? `${Math.round(v)} m` : '—');

/**
 * Elapsed time and distance at a path index, read off plan.profile (which may be downsampled):
 * linear between the two profile points around it. Returns null without a usable profile.
 */
export function atPathIndex(plan, k) {
  const prof = plan.profile;
  if (!Array.isArray(prof) || !prof.length) return null;
  let lo = null, hi = null;
  for (const p of prof) {
    if (p.pathIndex <= k && (!lo || p.pathIndex >= lo.pathIndex)) lo = p; // last at or before k (after the dwell, if a stop)
    if (p.pathIndex >= k && !hi) hi = p;                                    // first at or after k
  }
  lo ??= hi; hi ??= lo;
  if (lo.pathIndex === hi.pathIndex) return { elapsedS: lo.elapsedS, distanceM: lo.distanceM };
  const f = (k - lo.pathIndex) / (hi.pathIndex - lo.pathIndex);
  return {
    elapsedS: lo.elapsedS + f * (hi.elapsedS - lo.elapsedS),
    distanceM: lo.distanceM + f * (hi.distanceM - lo.distanceM),
  };
}

/** Join out-of-sight gaps closer than `joinCells` path cells (50 m at 5 m cells), so the list gets one line per blind stretch. */
export function mergeGaps(gaps = [], joinCells = 10) {
  const out = [];
  for (const [a, b] of [...gaps].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a - last[1] <= joinCells) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const MIN_BLIND_M = 20;

// Same time: a turn-back comes before starting the next walk or work; comm checks after the step they fall in.
const ORDER = { egress: 0, turnback: 1, storm: 2, walk: 3, work: 4, comm: 5, return: 6, ingress: 7 };

/**
 * The cuff checklist for one plan.
 * @param plan    plan result (CONTRACTS §4)
 * @param opts    { names: Map(id -> name), level: 'GO'|'CAUTION'|'NO-GO'|null }
 * @returns { level, fits, violations, budgets: [...], items: [{ t, kind, text, note, alert }], limitS, outOfSightM, stormSafe }
 */
export function buildChecklist(plan, { names = new Map(), level = null } = {}) {
  const T = plan.totals;
  const cap = T.o2CapacityKg;
  const nameOf = (s) => s.name ?? names.get(s.id) ?? s.id;
  const limitS = Number.isFinite(T.timeLimitS) ? T.timeLimitS : null;
  const reserve = cap - T.o2UsableKg;
  // O2 left in the suit, said plainly: never a negative number on a wrist list.
  const o2Left = (usedKg) => {
    const left = cap - usedKg;
    if (left <= 0) return { text: 'none: suit empty', low: true };
    return { text: kg(left) + (left < reserve - 1e-9 ? ' · in the reserve' : ''), low: left < reserve - 1e-9 };
  };
  const items = [];
  const add = (t, kind, text, note = '', alert = false) => items.push({ t, kind, text, note, alert });

  add(0, 'egress', 'Egress: leave the habitat', `O₂ ${kg(cap)} in the suit · reserve ${kg(reserve)} stays untouched`);

  const stops = plan.stops ?? [];
  const legs = plan.legs ?? [];
  stops.forEach((s, i) => {
    const leg = legs[i];
    if (leg) add(s.arriveS - leg.timeS, 'walk', `Walk to ${nameOf(s)}`, `${metres(leg.distanceM)} · ${duration(leg.timeS)}`);
    const left = o2Left(s.arriveO2Kg);
    add(s.arriveS, 'work', `Work ${duration((s.dwellMin ?? 0) * 60)} at ${nameOf(s)}`, `O₂ left on arrival ${left.text}`, left.low);
  });
  const home = legs[stops.length];
  if (home) add(T.totalTimeS - home.timeS, 'return', 'Walk back to the habitat', `${metres(home.distanceM)} · ${duration(home.timeS)}`);
  add(T.totalTimeS, 'ingress', 'Ingress: back inside',
    `O₂ left ${o2Left(T.o2UsedKg).text} · dose ${Number.isFinite(T.doseMSv) ? T.doseMSv.toFixed(2) : '—'} mSv`, !plan.withinBudget);

  // Point of no return (over budget) and the dust-storm turn-back (CONTRACTS §4 turnBackLatest).
  if (plan.turnBack) {
    add(plan.turnBack.elapsedS, 'turnback', `TURN BACK BY ${clock(plan.turnBack.elapsedS)}`,
      'Point of no return: past here the suit can’t get home without the O₂ reserve', true);
  }
  const tl = plan.turnBackLatest;
  if (tl && !(plan.turnBack && plan.turnBack.pathIndex === tl.pathIndex)) {
    add(tl.elapsedS, 'storm', `IF A DUST STORM STARTS, TURN BACK BY ${clock(tl.elapsedS)}`,
      'Last point a storm walk home still fits without the reserve', true);
  }

  // Blind stretches: the habitat's antenna can't see the astronaut (CONTRACTS §4 lineOfSight).
  // Blind spots shorter than MIN_BLIND_M are left off the wrist list (still counted in the total).
  for (const [a, b] of mergeGaps(plan.lineOfSight?.gaps)) {
    const start = atPathIndex(plan, a), end = atPathIndex(plan, b + 1 < (plan.path?.length ?? Infinity) ? b + 1 : b);
    if (!start || !end || end.distanceM - start.distanceM < MIN_BLIND_M) continue;
    add(start.elapsedS, 'comm', 'Comm check: out of habitat’s sight',
      `until ${clock(end.elapsedS)} · about ${metres(end.distanceM - start.distanceM)}; report before and after`);
  }

  items.sort((x, y) => x.t - y.t || ORDER[x.kind] - ORDER[y.kind]);

  const budgets = [
    { key: 'oxygen', label: 'Suit O₂', used: `${T.o2UsedKg.toFixed(2)}`, limit: `${T.o2UsableKg.toFixed(2)} kg usable`, over: T.o2UsedKg > T.o2UsableKg },
    { key: 'time', label: 'EVA time', used: duration(T.totalTimeS), limit: limitS ? `${+(limitS / 3600).toFixed(1)} h limit` : 'no limit', over: limitS != null && T.totalTimeS > limitS },
    { key: 'radiation', label: 'Dose', used: `${T.doseMSv.toFixed(2)}`, limit: `${T.doseLimitMSv.toFixed(2)} mSv limit`, over: T.doseMSv > T.doseLimitMSv },
  ];
  return {
    level, fits: !!plan.withinBudget, violations: plan.violations ?? [], budgets, items, limitS,
    outOfSightM: plan.lineOfSight?.outOfSightM ?? null,
    stormSafe: !!plan.withinBudget && 'turnBackLatest' in plan && !plan.turnBackLatest,
  };
}

// ---------------------------------------------------------------------------
// Page (checklist.html): browser only.
// ---------------------------------------------------------------------------

export async function mountChecklist(doc = document) {
  const $ = (id) => doc.getElementById(id);
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let walk;
  try {
    const { loadWalk } = await import('./views/walk.js');
    walk = await loadWalk();
  } catch (err) {
    $('status').textContent = `Could not build the checklist: ${err.message}`;
    return null;
  }
  const { plan } = walk;
  const names = new Map([...walk.targets.values()].map((t) => [t.id, t.name]));
  const level = walk.verdict?.level ?? null;
  const list = buildChecklist(plan, { names, level });

  const ROUTES = { eco: 'Least-oxygen route', safe: 'Safest route', short: 'Shortest route' };
  doc.title = `EVA checklist — ${walk.label}`;
  $('site').textContent = walk.label;
  $('route').textContent = `${ROUTES[plan.mode] ?? 'Route'} · ${plan.order.length} stop${plan.order.length === 1 ? '' : 's'} · science ${plan.totals.scienceValue}`;
  const badge = $('level');
  badge.hidden = !level;
  badge.textContent = level ?? '';
  badge.dataset.level = level ?? '';
  $('fit').textContent = list.fits
    ? `Fits the budget${list.stormSafe ? ' · dust-storm safe all the way' : ''}`
    : `Over budget: ${list.violations.map((v) => (v === 'time' ? 'EVA time' : v)).join(', ')}`;
  $('fit').className = list.fits ? 'fit ok' : 'fit over';

  const budgets = $('budgets');
  budgets.replaceChildren(...list.budgets.map((b) => {
    const cell = make('div', `budget${b.over ? ' over' : ''}`);
    cell.append(make('span', 'b-label', b.label), make('strong', null, b.used), make('span', 'b-limit', `/ ${b.limit}`));
    return cell;
  }));

  const body = $('items');
  body.replaceChildren(...list.items.map((it) => {
    const row = make('li', `item ${it.kind}${it.alert ? ' alert' : ''}`);
    const box = make('span', 'box'); box.setAttribute('aria-hidden', 'true');
    const text = make('div', 'what');
    text.append(make('strong', null, it.text));
    if (it.note) text.append(make('span', 'note', it.note));
    row.append(box, make('span', 'time', clock(it.t)), text);
    return row;
  }));

  const foot = [];
  if (list.limitS) foot.push(`EVA limit ${+(list.limitS / 3600).toFixed(1)} h: inside by ${clock(list.limitS)} at the latest.`);
  if (list.outOfSightM >= 1) foot.push(`${Math.round(list.outOfSightM)} m of the route is out of the habitat’s sight.`);
  foot.push(walk.dataset === 'gale'
    ? 'Dose: Curiosity RAD measured at Gale Crater.'
    : 'Dose: Curiosity RAD at Gale Crater, used as a proxy for Jezero.');
  if (walk.plan && walk.terrain?.synthetic) foot.push('Synthetic demo terrain, not a real site.');
  $('foot').textContent = foot.join(' ');
  $('status').hidden = true;
  $('sheet').hidden = false;

  // Back to the console with the same plan.
  const q = new URLSearchParams(walk.url.search);
  q.delete('p'); q.delete('play');
  $('back').href = `./?${q.toString().replace(/%2C/g, ',')}`;
  $('print').addEventListener('click', () => window.print());
  window.marswalkChecklist = { walk, list };
  return list;
}
