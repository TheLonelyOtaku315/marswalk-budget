// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
// "Site data" tab of the About dialog: what the planner knows about Gale and Jezero, where each piece comes
// from, and whether it is history (recorded in the past) or the latest reading we pulled, with its age.
// Facts that never change are written here; dates, sols, counts and weather are read from the data files.

const FILES = {
  galeTargets: 'data/gale/targets.json',
  realTargets: 'data/real/targets.json',
  galeCond: 'data/conditions/real-gale.json',
  realCond: 'data/conditions/real.json',
  galeChem: 'data/gale/chemistry.json',
};

export const TAGS = {
  here: 'Measured here',
  orbit: 'From orbit',
  calc: 'Worked out by us',
  latest: 'Latest reading',
  borrowed: 'Borrowed',
  missing: 'Not available',
};

const DAY_MS = 864e5;

/** Whole days between an ISO date and now (null if the date is missing). */
export function daysOld(iso, now = Date.now()) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : null;
}

/** Plain-language age: "today", "12 days old", "about 3 months old", "about 2.5 years old". */
export function ageText(days) {
  if (days == null) return 'age unknown';
  if (days < 1) return 'today';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} old`;
  if (days < 365) return `about ${Math.round(days / 30.4)} months old`;
  const y = Math.round((days / 365.25) * 2) / 2;
  return `about ${y} year${y === 1 ? '' : 's'} old`;
}

/** The weather observation date the conditions lane writes into its source note. */
export function weatherDate(cond) {
  for (const s of cond?.sources ?? []) {
    const m = /observation date:\s*(\d{4}-\d{2}-\d{2})/i.exec(s.note ?? '');
    if (m) return m[1];
  }
  return null;
}

/** Stops, photos, sol range and Earth-date range of the photos (dates read from the photo captions). */
export function stopsSummary(file) {
  const targets = file?.targets ?? [];
  const sols = targets.map((t) => t.sol).filter(Number.isFinite);
  const photos = targets.flatMap((t) => t.photos ?? []);
  for (const p of photos) if (Number.isFinite(p.sol)) sols.push(p.sol);
  const dates = photos.map((p) => /(\d{4}-\d{2}-\d{2})/.exec(p.caption ?? '')?.[1]).filter(Boolean).sort();
  return {
    stops: targets.length, photos: photos.length,
    solMin: sols.length ? Math.min(...sols) : null, solMax: sols.length ? Math.max(...sols) : null,
    dateMin: dates[0] ?? null, dateMax: dates.at(-1) ?? null,
  };
}

function stopsCell(sum, rover) {
  if (!sum || !sum.stops) return { tag: 'missing', text: 'Stops file not loaded.' };
  const span = sum.dateMin ? ` (${sum.dateMin === sum.dateMax ? sum.dateMin : `${sum.dateMin} to ${sum.dateMax}`})` : '';
  return {
    tag: 'here',
    text: `${sum.stops} real ${rover} stops with ${sum.photos} raw photos taken there.`,
    when: `History: sols ${sum.solMin}–${sum.solMax}${span}`,
  };
}

function weatherCell(cond, instrument, now) {
  if (!cond) return { tag: 'missing', text: 'Weather snapshot not loaded.' };
  const date = weatherDate(cond);
  const days = daysOld(date, now);
  const t = cond.tempC ?? {};
  const bits = [`sol ${cond.sol}`];
  if (Number.isFinite(t.min) && Number.isFinite(t.max)) bits.push(`${Math.round(t.min)} to ${Math.round(t.max)} °C`);
  if (Number.isFinite(cond.pressurePa)) bits.push(`${Math.round(cond.pressurePa)} Pa`);
  return {
    tag: 'latest',
    text: `${instrument}: ${bits.join(', ')}.`,
    when: `Latest reading: ${date ?? 'date unknown'} (${ageText(days)})`,
    warn: days != null && days > 7 ? 'Older than the 7-day freshness rule, so the Go/No-Go shows CAUTION.' : null,
  };
}

function solarCell(cond, now) {
  if (!cond) return { tag: 'missing', text: 'Solar snapshot not loaded.' };
  const src = (cond.sources ?? []).find((s) => /DONKI/.test(s.name));
  const status = cond.sep?.status ?? 'unknown';
  return {
    tag: 'latest',
    text: `NASA DONKI: ${status === 'quiet' ? 'quiet, no recent solar particle event' : status}. Seen from Earth, used as a stand-in for Mars.`,
    when: `Checked ${src?.retrieved?.slice(0, 10) ?? 'date unknown'} (${ageText(daysOld(src?.retrieved, now))})`,
  };
}

/** All rows: [label, gale cell, jezero cell]. Exported for tests. */
export function buildRows(d, now = Date.now()) {
  const g = stopsSummary(d.galeTargets);
  const j = stopsSummary(d.realTargets);
  const chemStops = d.galeChem?.byStop ? Object.keys(d.galeChem.byStop).length : 0;
  return [
    ['Ground shape (3D)',
      { tag: 'orbit', text: 'USGS Gale elevation map, 1 m detail, made from pairs of HiRISE photos taken from orbit.', when: 'History: orbital photos' },
      { tag: 'orbit', text: 'USGS Jezero elevation map, 1 m detail, from HiRISE photo pairs. Made to land Perseverance in 2021.', when: 'History: orbital photos' }],
    ['Map picture',
      { tag: 'orbit', text: 'One fixed HiRISE colour picture, 2 m per pixel: it gets blurry when you zoom in.', when: 'History' },
      { tag: 'orbit', text: 'Live NASA Mars Trek tiles, down to 25 cm per pixel: stays sharp when you zoom in.', when: 'History, loaded live' }],
    ['Sand and soft ground',
      { tag: 'missing', text: 'No ground-hardness map for Gale: every cell counts as firm ground, so sand is not priced.' },
      { tag: 'orbit', text: 'THEMIS thermal-inertia map (Zenodo, CC BY 4.0): soft sand costs more effort.', when: 'History' }],
    ['No-go ground (over 20° or too rough)',
      { tag: 'calc', text: '26% of the area: Mount Sharp’s ridges and buttes. This is the red on the map.' },
      { tag: 'calc', text: '4.8% of the area, so most of the delta front is walkable.' }],
    ['Rover’s driven path',
      { tag: 'here', text: 'Curiosity’s real path (NASA/JPL MMGIS), saved with the app.', when: 'History' },
      { tag: 'here', text: 'Perseverance’s real path (NASA/JPL MMGIS), loaded live from NASA.', when: 'History, loaded live' }],
    ['Science stops and photos', stopsCell(g, 'Curiosity'), stopsCell(j, 'Perseverance')],
    ['Rock chemistry',
      chemStops
        ? { tag: 'here', text: `APXS readings next to ${chemStops} of the ${g.stops} stops (Canadian Space Agency instrument).`, when: 'History: NASA PDS science archive' }
        : { tag: 'missing', text: 'Chemistry file not loaded.' },
      { tag: 'missing', text: 'No rock chemistry prepared for Jezero.' }],
    ['Radiation',
      { tag: 'here', text: 'Curiosity’s RAD measured 0.64 mSv per day on the ground here (Hassler et al. 2014).', when: 'History: measured 2012–2013' },
      { tag: 'borrowed', text: 'Gale’s number reused: Perseverance has no radiation sensor.' }],
    ['Weather', weatherCell(d.galeCond, 'Curiosity REMS', now), weatherCell(d.realCond, 'Perseverance MEDA', now)],
    ['Solar storms', solarCell(d.galeCond, now), solarCell(d.realCond, now)],
    ['Dust forecast',
      { tag: 'missing', text: 'Mars Climate Database (ESA / LMD) values are not filled in; they can be typed in by hand.' },
      { tag: 'missing', text: 'Same as Gale: not filled in.' }],
  ];
}

/** Counts per tag for one column (0 = Gale, 1 = Jezero). */
export function tally(rows, col) {
  const n = {};
  for (const r of rows) { const t = r[col + 1].tag; n[t] = (n[t] ?? 0) + 1; }
  return n;
}

async function loadAll() {
  const out = {};
  await Promise.all(Object.entries(FILES).map(async ([k, url]) => {
    try { const r = await fetch(url); out[k] = r.ok ? await r.json() : null; } catch { out[k] = null; }
  }));
  return out;
}

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

function cellEl(c, site, current) {
  return h('div', { role: 'cell', class: 'sd-cell' + (site === current ? ' is-current' : ''), 'data-site': site === 'gale' ? 'Gale' : 'Jezero' },
    h('span', { class: `sd-tag sd-${c.tag}` }, TAGS[c.tag]),
    h('span', { class: 'sd-text' }, c.text),
    c.when ? h('span', { class: 'sd-when' }, c.when) : null,
    c.warn ? h('span', { class: 'sd-warn' }, c.warn) : null);
}

let loading = null;

/** Fills the "Site data" panel once (files are small; the 2 MB terrain files are not loaded again). */
export async function renderSiteData(box, current) {
  if (box.dataset.ready) return;
  loading ??= loadAll();
  const d = await loading;
  const rows = buildRows(d);
  const gt = tally(rows, 0), jt = tally(rows, 1);
  box.replaceChildren(
    h('p', { class: 'sd-intro' },
      'What the planner knows about each site, where it comes from and how old it is. ',
      h('strong', {}, 'History'), ' was recorded in the past by rovers and orbiters; ',
      h('strong', {}, 'latest'), ' is the newest reading we pulled for this snapshot.'),
    h('p', { class: 'sd-intro' },
      h('strong', {}, `Gale: ${gt.here ?? 0} measured on the ground here, ${gt.missing ?? 0} not available. `),
      h('strong', {}, `Jezero: ${jt.here ?? 0} measured here, ${jt.borrowed ?? 0} borrowed from Gale, ${jt.missing ?? 0} not available. `),
      'Curiosity has worked at Gale since 2012, so more science exists there; Jezero has the sand map and the sharper picture.'),
    h('div', { class: 'sd-grid', role: 'table', 'aria-label': 'Data per site' },
      h('div', { class: 'sd-row sd-head', role: 'row' },
        h('span', { role: 'columnheader' }, 'Data'),
        h('span', { role: 'columnheader', class: current === 'gale' ? 'is-current' : null }, 'Gale Crater (Curiosity)'),
        h('span', { role: 'columnheader', class: current === 'real' ? 'is-current' : null }, 'Jezero Crater (Perseverance)')),
      rows.map(([label, gc, jc]) => h('div', { class: 'sd-row', role: 'row' },
        h('span', { class: 'sd-label', role: 'rowheader' }, label),
        cellEl(gc, 'gale', current), cellEl(jc, 'real', current)))),
    h('p', { class: 'sd-foot' }, 'Dates come from the data files this page loaded; ages are counted from today.'));
  box.dataset.ready = '1';
}
