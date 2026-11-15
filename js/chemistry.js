// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
// APXS context is kept separate from the route model and science-score assumptions.

const COMPONENTS = ['SiO2', 'FeO(T)', 'MgO', 'CaO', 'SO3', 'Na2O', 'Al2O3', 'Cl'];
const CREDIT = 'APXS · Canadian Space Agency / NASA';
const validPct = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
const validSol = (v) => Number.isInteger(v) && v >= 0;

/** Gale has a curated APXS file. Other sites return null without making a request. */
export async function loadChemistry(site) {
  if (site !== 'gale') return null;
  const response = await fetch(new URL('../data/gale/chemistry.json', import.meta.url));
  if (!response.ok) throw new Error(`APXS chemistry HTTP ${response.status}`);
  const chem = await response.json();
  if (chem?.site !== 'gale' || !chem.byStop || typeof chem.byStop !== 'object' || Array.isArray(chem.byStop)) {
    throw new Error('Invalid Gale chemistry file');
  }
  return chem;
}

const STYLE = `
.apxs-card { margin-top: 12px; padding-top: 10px; border-top: 1px solid #8b796655;
  font: inherit; color: inherit; min-width: 0; }
.apxs-card h3 { margin: 0 0 6px; font-size: 14px; }
.apxs-meta, .apxs-note, .apxs-credit, .apxs-scale { margin: 5px 0; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.apxs-bars { margin: 8px 0; padding: 0; list-style: none; }
.apxs-row { display: grid; grid-template-columns: 58px minmax(0, 1fr) 92px; align-items: center; gap: 7px; margin: 5px 0; font-size: 12px; }
.apxs-track { display: block; height: 7px; border-radius: 4px; background: #8b796633; overflow: hidden; }
.apxs-fill { display: block; height: 100%; background: #e8a25f; }
.apxs-value { text-align: right; font-variant-numeric: tabular-nums; }
.apxs-credit a { color: inherit; text-decoration: underline; }
.apxs-notes summary { cursor: pointer; font-size: 12px; min-height: 44px; padding: 12px 0; box-sizing: border-box; }
`;

function injectStyle(doc) {
  if (doc.getElementById('apxs-style')) return;
  const style = doc.createElement('style');
  style.id = 'apxs-style';
  style.textContent = STYLE;
  doc.head.append(style);
}

function node(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function sourceLink(doc, url, label) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    const a = node(doc, 'a', '', label);
    a.setAttribute('href', parsed.href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    return a;
  } catch { return null; }
}

/** Replace a stop's chemistry card. Passing null shows an explicit unavailable state. */
export function renderChemistry(container, stopId, chem) {
  if (!container) return;
  const doc = container.ownerDocument || globalThis.document;
  injectStyle(doc);
  container.replaceChildren();
  const root = node(doc, 'section', 'apxs-card');
  root.setAttribute('aria-label', 'APXS rock chemistry');
  root.append(node(doc, 'h3', '', 'Rock chemistry · APXS'));
  container.append(root);
  const record = chem?.site === 'gale' && Object.hasOwn(chem.byStop || {}, stopId) ? chem.byStop[stopId] : null;
  if (!record || typeof record !== 'object') {
    const message = !chem ? 'APXS chemistry is unavailable or has not loaded.'
      : chem.site !== 'gale' ? 'No APXS chemistry is provided for this site.'
      : 'No published APXS association is available for this stop.';
    root.append(node(doc, 'p', 'apxs-note', message),
      node(doc, 'p', 'apxs-credit', CREDIT));
    return;
  }

  root.append(node(doc, 'p', 'apxs-meta', typeof record.target === 'string'
    ? record.target.replaceAll('_', ' ') : 'Target name unavailable'));
  const sol = validSol(record.sol) ? `Sol ${record.sol}` : 'Measurement sol unknown';
  const distance = typeof record.distanceM === 'number' && Number.isFinite(record.distanceM) && record.distanceM >= 0
    ? `~${Math.round(record.distanceM)} m to rover station` : 'Distance unknown';
  const offset = validSol(record.stopSol) && validSol(record.sol)
    ? ` · ${Math.abs(record.sol - record.stopSol)} sols ${record.sol <= record.stopSol ? 'before' : 'after'} stop` : '';
  root.append(node(doc, 'p', 'apxs-meta', `${sol}${offset} · ${distance}`));
  if (record.exactStopAvailable === false) {
    root.append(node(doc, 'p', 'apxs-note', 'Nearby context only; exact-stop APXS data is not yet released.'));
  }
  root.append(node(doc, 'p', 'apxs-scale', 'Oxides and chlorine · wt% · fixed 0–100% scale'));
  const list = node(doc, 'ul', 'apxs-bars');
  for (const key of COMPONENTS) {
    const value = record.oxidesWtPct?.[key];
    const precision = record.precisionWtPct?.[key];
    const row = node(doc, 'li', 'apxs-row');
    const label = node(doc, 'span', '', key);
    const track = node(doc, 'span', 'apxs-track');
    track.setAttribute('aria-hidden', 'true'); // The adjacent text gives the complete accessible value.
    const fill = node(doc, 'span', 'apxs-fill');
    const shown = validPct(value);
    if (shown) fill.style.width = `${value}%`;
    else track.hidden = true;
    track.append(fill);
    const text = shown ? `${value.toFixed(2)}${validPct(precision) ? ` ± ${precision.toFixed(2)}` : ''}` : 'Not reported';
    row.append(label, track, node(doc, 'span', 'apxs-value', text));
    list.append(row);
  }
  root.append(list, node(doc, 'p', 'apxs-scale', '± statistical precision · subset not renormalised'));
  const notes = node(doc, 'details', 'apxs-notes');
  notes.append(node(doc, 'summary', '', 'Sample match and units'));
  if (record.note) notes.append(node(doc, 'p', 'apxs-note', String(record.note)));
  notes.append(node(doc, 'p', 'apxs-note', 'Cl is elemental chlorine; FeO(T) uses the published FeO column. The eight components are not a complete mineral composition.'),
    node(doc, 'p', 'apxs-note', 'Distance locates the rover station; the exact APXS contact point is unknown. Nearby chemistry is context for this stop.'));
  root.append(notes);
  const credit = node(doc, 'p', 'apxs-credit', CREDIT);
  const link = sourceLink(doc, record.url, 'PDS abundance data');
  if (link) credit.append(doc.createTextNode(' · '), link);
  root.append(credit);
}
