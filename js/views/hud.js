// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
import { PHOTO_CREDIT } from '../photos.js';
import { fmtDuration, fmtMSv } from '../render.js';
import { compassTicks, relativeBearingDeg } from './geometry.js';
import { mountHelmet } from './helmet.js';
import { rememberFieldPlan, startOffline } from './offline.js';
import { bindProgress, byId, headingText, instructionText, loadWalk, showLoadError } from './walk.js';

const svgNS = 'http://www.w3.org/2000/svg';
const stormLabels = {
  approaching: 'Dust storm · Turn-back point ahead',
  past: 'Past dust-storm turn-back point',
  safe: 'Dust-storm safe',
};

function drawCompass(heading) {
  byId('compass').toggleAttribute('hidden', heading === null);
  if (heading === null) return;
  byId('heading-value').textContent = headingText(heading);
  const ticks = compassTicks(heading).map(({ offset, label }) => {
    const group = document.createElementNS(svgNS, 'g');
    group.setAttribute('transform', `translate(${offset * 4} 0)`);
    const tick = document.createElementNS(svgNS, 'line');
    tick.setAttribute('y2', label ? '10' : '5');
    group.append(tick);
    if (label) {
      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('y', '-9');
      text.textContent = label;
      group.append(text);
    }
    return group;
  });
  byId('compass-ticks').replaceChildren(...ticks);
}

function drawConditions({ verdict, conditionsSnapshot }) {
  if (!verdict) return;
  const badge = byId('conditions-badge');
  badge.dataset.level = verdict.level;
  byId('conditions-level').textContent = verdict.level;
  byId('conditions-source').textContent = conditionsSnapshot.synthetic
    ? 'Simulated conditions'
    : conditionsSnapshot.site === 'gale' ? 'Gale · REMS' : 'Jezero · MEDA';
  badge.removeAttribute('hidden');
}

async function start() {
  startOffline();
  const walk = await loadWalk();
  // One helmet page, two modes: the flat HUD and the stereo Cardboard view (?vr=1). Each links to the other with the same plan.
  const modeUrl = (vr) => {
    const next = new URL(location.href);
    if (vr) next.searchParams.set('vr', '1');
    else next.searchParams.delete('vr');
    return next.href;
  };
  byId('hud-to-vr').href = modeUrl(true);
  byId('helmet-to-flat').href = modeUrl(false);
  byId('helmet-exit').href = modeUrl(false);
  if (walk.url.searchParams.get('vr') === '1') {
    mountHelmet(walk);
    rememberFieldPlan(walk);
    byId('load-status').hidden = true;
    return;
  }
  const overlay = byId('hud-overlay');
  const controls = byId('hud-controls');
  const photo = byId('hud-photo');
  const credit = byId('hud-photo-credit');
  const storm = byId('hud-storm');
  const maneuver = byId('hud-instruction');
  let shownPhoto;
  photo.addEventListener('error', () => {
    photo.hidden = true;
    credit.setAttribute('hidden', '');
  });
  photo.addEventListener('load', () => {
    photo.hidden = false;
    credit.removeAttribute('hidden');
  });
  byId('hud-dataset').textContent = walk.label;
  byId('hud-dose-note').textContent = walk.dataset === 'gale' ? 'Curiosity RAD · Gale Crater' : 'Curiosity RAD · Gale proxy for Jezero';

  if (walk.playMs) {
    // Request upcoming backgrounds before the fast playback reaches those stops.
    for (const stop of walk.plan.stops) {
      const url = walk.targets.get(stop.id)?.photos?.[0]?.url;
      if (url) new Image().src = url;
    }
  }
  bindProgress(walk, (frame, instruction) => {
    const target = walk.targets.get(frame.upcoming?.id);
    const nextPhoto = target?.photos?.[0];
    if (nextPhoto?.url !== shownPhoto) {
      shownPhoto = nextPhoto?.url;
      photo.hidden = true;
      credit.setAttribute('hidden', '');
      if (shownPhoto) {
        const rover = walk.dataset === 'gale' ? 'Curiosity' : 'Perseverance';
        credit.textContent = `${rover} · ${nextPhoto.credit ?? PHOTO_CREDIT}`;
        photo.src = shownPhoto;
      } else {
        photo.removeAttribute('src');
      }
    }

    drawCompass(frame.heading);
    const chevron = byId('chevron');
    chevron.toggleAttribute('hidden', frame.heading === null);
    if (frame.heading !== null) {
      chevron.setAttribute('transform', `translate(640 312) rotate(${relativeBearingDeg(frame.bearing, frame.heading)})`);
    }
    byId('hud-warning').toggleAttribute('hidden', !frame.turnBack);
    byId('hud-sight').toggleAttribute('hidden', !frame.outOfSight);
    const stormLabel = frame.turnBack ? '' : stormLabels[frame.storm] ?? '';
    storm.toggleAttribute('hidden', !stormLabel);
    storm.dataset.state = frame.storm ?? '';
    byId('hud-storm-text').textContent = stormLabel;
    const warning = frame.turnBack ? 'Turn back. Oxygen reserve at risk.' : '';
    const alert = byId('turn-back-alert');
    if (alert.textContent !== warning) alert.textContent = warning;

    byId('hud-destination-label').textContent = frame.complete ? 'EVA complete' : frame.returning ? 'Return to habitat' : 'Next stop';
    byId('hud-destination').textContent = frame.complete || frame.returning ? 'Habitat' : frame.destination.name;
    byId('hud-distance').textContent = frame.complete ? '' : `${Math.round(frame.rangeM)} m direct`;
    maneuver.toggleAttribute('hidden', !instruction);
    maneuver.textContent = instructionText(instruction);
    byId('hud-time').textContent = fmtDuration(frame.remainingS);
    byId('hud-slope').textContent = frame.slopeDeg === null ? '—' : `${frame.slopeDeg > 0 ? '+' : ''}${frame.slopeDeg.toFixed(1)}°`;
    byId('hud-dose').textContent = `${fmtMSv(frame.doseMSv)} mSv`;
    byId('hud-oxygen-label').textContent = frame.o2ToHomeKg === null ? 'O₂ left above reserve' : 'O₂ margin after return';
    byId('hud-oxygen').textContent = `${frame.o2MarginKg.toFixed(3)} kg`;
    const bar = byId('hud-oxygen-bar');
    bar.setAttribute('width', 385 * frame.o2MarginFraction);
    bar.classList.toggle('is-critical', frame.o2MarginKg < 0 || frame.turnBack);
    byId('hud-oxygen').classList.toggle('is-critical', frame.o2MarginKg < 0 || frame.turnBack);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'h' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
      controls.hidden = !controls.hidden;
    }
  });
  controls.hidden = false;
  overlay.removeAttribute('hidden');
  byId('hud-rotate').hidden = false;
  byId('load-status').hidden = true;
  drawConditions(walk);
  rememberFieldPlan(walk);
}

start().catch(showLoadError);
