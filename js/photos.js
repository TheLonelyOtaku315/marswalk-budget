// Real rover photos (Perseverance at Jezero, Curiosity at Gale) for a science stop. Owner: photos lane (Claude 2).
// Contract: CONTRACTS.md §5. `stop.photos` is filled by scripts/fetch_photos.mjs (CONTRACTS §2).
//
// The image files are loaded straight from mars.nasa.gov with <img>, which needs no CORS.
// Styles are injected once and scoped under `.pb-` so they don't touch the UI lane's CSS.

const CREDIT = 'NASA/JPL-Caltech/ASU';
const CAMERA_NAMES = {
  MCZ_LEFT: 'Mastcam-Z (left)',
  MCZ_RIGHT: 'Mastcam-Z (right)',
  NAVCAM_LEFT: 'Navcam (left)',
  NAVCAM_RIGHT: 'Navcam (right)',
  // Curiosity (Gale)
  NAV_LEFT_A: 'Navcam (left)', NAV_LEFT_B: 'Navcam (left)',
  NAV_RIGHT_A: 'Navcam (right)', NAV_RIGHT_B: 'Navcam (right)',
  MAST_LEFT: 'Mastcam (left)', MAST_RIGHT: 'Mastcam (right)',
  MAHLI: 'MAHLI (hand lens)', MARDI: 'MARDI (descent camera)',
  CHEMCAM_RMI: 'ChemCam RMI',
  FHAZ_LEFT_A: 'Front Hazcam', FHAZ_LEFT_B: 'Front Hazcam', RHAZ_LEFT_A: 'Rear Hazcam', RHAZ_LEFT_B: 'Rear Hazcam',
};

/** Which rover took a photo: Curiosity images live under /msl-raw-images/, Perseverance's under /mars2020. */
export function roverOf(p) {
  return /\/msl(-raw-images)?\//.test(String(p?.url ?? '')) ? 'Curiosity' : 'Perseverance';
}
const creditOf = (p) => p?.credit || CREDIT;

const STYLE = `
.pb-photos { font: inherit; color: inherit; }
.pb-main { position: relative; margin: 0; background: #1a1210; border-radius: 6px; overflow: hidden;
  aspect-ratio: 4 / 3; }
.pb-main img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pb-main a { display: block; height: 100%; }
.pb-main figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 6px 8px;
  font-size: 12px; line-height: 1.35; color: #fff; background: linear-gradient(transparent, rgba(0,0,0,.75)); }
.pb-credit { opacity: .8; }
.pb-thumbs { display: flex; gap: 6px; margin-top: 6px; }
.pb-thumbs button { flex: 1 1 0; padding: 0; border: 2px solid transparent; border-radius: 4px;
  background: #1a1210; cursor: pointer; overflow: hidden; aspect-ratio: 4 / 3; min-width: 0; }
.pb-thumbs button[aria-pressed="true"] { border-color: #e8a25f; }
.pb-thumbs img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pb-note { margin: 8px 0 0; font-size: 13px; line-height: 1.45; }
.pb-empty { padding: 14px; border: 1px dashed currentColor; border-radius: 6px; opacity: .75;
  font-size: 13px; text-align: center; }
.pb-marker img { width: 40px; height: 30px; object-fit: cover; border: 2px solid #fff; border-radius: 4px;
  box-shadow: 0 1px 4px rgba(0,0,0,.6); display: block; }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('pb-style')) return;
  const s = document.createElement('style');
  s.id = 'pb-style';
  s.textContent = STYLE;
  document.head.append(s);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

const validPhotos = (stop) =>
  (Array.isArray(stop?.photos) ? stop.photos : []).filter((p) => p && typeof p.url === 'string');

function captionText(p) {
  const cam = CAMERA_NAMES[p.camera] || p.camera || roverOf(p);
  const where = Number.isFinite(p.distanceM) ? `, rover ${p.distanceM} m from stop` : '';
  return `Sol ${p.sol ?? '?'} · ${cam}${where}`;
}

/**
 * Show a stop's Perseverance photos (1 large + thumbnails) and its note in `container`.
 * Works with stops that have no photos (demo data): shows the note and a placeholder.
 */
export function renderPhotos(container, stop) {
  if (!container) return;
  injectStyle();
  container.replaceChildren();
  const root = el('div', { class: 'pb-photos' });
  container.append(root);
  const photos = validPhotos(stop);
  const note = stop?.note ? el('p', { class: 'pb-note' }, stop.note) : null;

  if (!photos.length) {
    const msg = stop?.lat == null
      ? 'No rover photo: this stop is on the synthetic demo terrain.'
      : 'No rover photo was taken near this stop.';
    root.append(...[el('div', { class: 'pb-empty' }, msg), note].filter(Boolean));
    return;
  }

  const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
  const link = el('a', { target: '_blank', rel: 'noopener' }, img);
  const capMain = el('span');
  const capCredit = el('span', { class: 'pb-credit' });
  const caption = el('figcaption', {}, capMain, el('br'), capCredit);
  const figure = el('figure', { class: 'pb-main' }, link, caption);
  const thumbs = el('div', { class: 'pb-thumbs', role: 'group', 'aria-label': 'Photos near this stop' });
  const buttons = [];
  let current = -1;

  function show(i) {
    if (i === current) return;
    current = i;
    const p = photos[i];
    img.src = p.url;
    img.alt = `${roverOf(p)} ${CAMERA_NAMES[p.camera] || p.camera || ''} image, sol ${p.sol}, near ${stop.name}`;
    link.href = p.link || p.full || p.url;
    link.title = 'Open the original on mars.nasa.gov';
    capMain.textContent = captionText(p);
    capCredit.textContent = `Credit: ${creditOf(p)}`;
    buttons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  }

  // A dead link falls back to the next photo, then to the placeholder.
  img.addEventListener('error', () => {
    const failed = photos[current];
    failed._broken = true;
    if (buttons[current]) buttons[current].hidden = true;
    const next = photos.findIndex((p) => !p._broken);
    if (next >= 0) { current = -1; show(next); }
    else root.replaceChildren(...[el('div', { class: 'pb-empty' }, 'Photo could not be loaded from mars.nasa.gov.'), note].filter(Boolean));
  });

  if (photos.length > 1) {
    photos.forEach((p, i) => {
      const b = el('button', { type: 'button', title: captionText(p), onclick: () => show(i) },
        el('img', { src: p.thumb || p.url, alt: `Sol ${p.sol} thumbnail`, loading: 'lazy' }));
      buttons.push(b);
      thumbs.append(b);
    });
  }

  root.append(...[figure, photos.length > 1 ? thumbs : null, note].filter(Boolean));
  show(0);
}

/**
 * Small thumbnail marker for the map (CONTRACTS §5, optional). Returns an L.DivIcon, or null when
 * the stop has no photos or Leaflet isn't loaded, in which case the UI uses its default marker.
 */
export function photoMarkerIcon(stop) {
  const p = validPhotos(stop)[0];
  const L = globalThis.L;
  if (!p || !L?.divIcon) return null;
  injectStyle();
  const src = String(p.thumb || p.url).replace(/"/g, '%22');
  return L.divIcon({
    className: 'pb-marker',
    html: `<img src="${src}" alt="">`,
    iconSize: [44, 34],
    iconAnchor: [22, 17],
  });
}

export const PHOTO_CREDIT = CREDIT;
export { CAMERA_NAMES, captionText };
