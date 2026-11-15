// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
import { PHOTO_CREDIT } from '../photos.js';
import { fmtDuration, fmtMSv } from '../render.js';
import {
  compassTicks, deviceHeadingDeg, relativeBearingDeg, smoothHeadingDeg, stereoEyes, wrapHeadingDeg,
} from './geometry.js';
import { bindProgress, byId, headingText, instructionText } from './walk.js';

const SVG = 'http://www.w3.org/2000/svg';
const STORM_MESSAGES = {
  approaching: 'Dust storm · Turn back ahead',
  past: 'Past dust-storm turn-back',
  safe: 'Dust-storm safe',
};

function drawHeading(eye, heading, bearing) {
  eye.heading.textContent = headingText(heading);
  eye.arrow.toggleAttribute('hidden', bearing === null);
  if (bearing !== null) eye.arrow.setAttribute('transform', `rotate(${relativeBearingDeg(bearing, heading)})`);
  const marks = [];
  for (const { offset, label } of compassTicks(heading)) {
    const x = offset * 2.35;
    const line = document.createElementNS(SVG, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.setAttribute('y2', label ? 8 : 4);
    marks.push(line);
    if (label) {
      const text = document.createElementNS(SVG, 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', -7);
      text.textContent = label;
      marks.push(text);
    }
  }
  eye.ticks.replaceChildren(...marks);
}

function mountEyes(container) {
  const template = byId('helmet-eye');
  const eyes = ['Left eye', 'Right eye'].map((label, index) => {
    const root = template.content.firstElementChild.cloneNode(true);
    root.setAttribute('aria-label', label);
    if (index === 1) root.setAttribute('aria-hidden', 'true');
    container.append(root);
    const elements = Object.fromEntries([...root.querySelectorAll('[data-eye]')].map((el) => [el.dataset.eye, el]));
    const photo = root.querySelector('img');
    photo.addEventListener('load', () => {
      if (!photo.hasAttribute('src')) return;
      photo.hidden = false;
      elements.credit.hidden = false;
    });
    photo.addEventListener('error', () => { photo.hidden = true; elements.credit.hidden = true; });
    return { root, photo, ...elements };
  });
  new ResizeObserver(() => {
    const width = container.clientWidth;
    if (!width) return;
    stereoEyes(width).forEach((layout, index) => {
      const style = eyes[index].root.style;
      style.left = `${layout.left}px`;
      style.width = `${layout.width}px`;
      style.setProperty('--eye-offset', `${layout.offset}px`);
    });
  }).observe(container);
  return eyes;
}

async function enterFullscreen(stage, hint) {
  try {
    await stage.requestFullscreen();
  } catch {
    hint.textContent = 'Rotate your phone and add it to the home screen for full screen.';
    byId('helmet-landscape-hint').textContent = hint.textContent;
  }
  try {
    await screen.orientation.lock('landscape');
  } catch {
    // The rotate hint still works when the browser cannot lock the screen.
  }
}

async function enableCompass(onHeading) {
  try {
    const orientationEvent = window.DeviceOrientationEvent;
    if (typeof orientationEvent?.requestPermission === 'function'
        && await orientationEvent.requestPermission(true) !== 'granted') return;
    window.addEventListener('deviceorientation', (event) => {
      if (Number.isFinite(event.webkitCompassHeading) && event.webkitCompassHeading >= 0
          && !(event.webkitCompassAccuracy < 0)) {
        onHeading(event.webkitCompassHeading);
      }
    });
    window.addEventListener('deviceorientationabsolute', ({ alpha, beta, gamma }) => {
      const heading = deviceHeadingDeg(alpha, beta, gamma);
      if (heading !== null) onHeading(heading);
    });
  } catch {
    // Manual controls work even if orientation data or permission is unavailable.
  }
}

export function mountHelmet(walk) {
  const stage = document.querySelector('.hud-stage');
  const stereo = byId('helmet-stereo');
  const entry = byId('helmet-entry');
  const entryButton = byId('helmet-enter');
  const fullscreenHint = byId('helmet-fullscreen-hint');
  const tapHint = byId('helmet-tap-hint');
  const eyes = mountEyes(stereo);
  const rover = walk.dataset === 'gale' ? 'Curiosity' : 'Perseverance';
  const rotate = byId('hud-rotate');
  let frame;
  let heading = null;
  let sensorHeading = null;
  let shownPhoto;
  let pointer;

  stage.classList.add('helmet-mode');
  entry.hidden = false;
  fullscreenHint.hidden = typeof stage.requestFullscreen === 'function' && typeof screen.orientation?.lock === 'function';
  tapHint.hidden = !walk.playMs;

  const pointAt = (next) => {
    heading = wrapHeadingDeg(next);
    for (const eye of eyes) drawHeading(eye, heading, frame.heading);
  };
  const playback = bindProgress(walk, (current, instruction) => {
    frame = current;
    if (heading === null) pointAt(frame.heading ?? 0);
    const nextPhoto = walk.targets.get(frame.upcoming?.id)?.photos?.[0];
    const warning = frame.turnBack ? 'Turn back · O₂ reserve' : STORM_MESSAGES[frame.storm];
    const target = frame.complete ? 'EVA complete' : frame.upcoming?.name ?? 'Habitat';
    for (const eye of eyes) {
      eye.arrow.toggleAttribute('hidden', frame.heading === null);
      if (frame.heading !== null) eye.arrow.setAttribute('transform', `rotate(${relativeBearingDeg(frame.heading, heading)})`);
      eye.warning.hidden = !warning;
      eye.warning.dataset.state = frame.turnBack ? 'active' : frame.storm ?? '';
      eye.warning.textContent = warning ?? '';
      eye.stop.textContent = target;
      eye.range.textContent = frame.complete ? '' : `${Math.round(frame.rangeM)} m direct`;
      eye.instruction.textContent = instructionText(instruction, { includeDestination: false });
      eye.oxygen.textContent = `${frame.o2MarginKg.toFixed(3)} kg`;
      const critical = frame.o2MarginKg < 0 || frame.turnBack;
      eye.oxygen.classList.toggle('helmet-critical', critical);
      eye.gauge.classList.toggle('helmet-critical', critical);
      eye.gauge.style.width = `${100 * frame.o2MarginFraction}%`;
      eye.time.textContent = fmtDuration(frame.remainingS);
      eye.slope.textContent = frame.slopeDeg === null ? '—' : `${frame.slopeDeg.toFixed(1)}°`;
      eye.dose.textContent = `${fmtMSv(frame.doseMSv)} mSv`;
      eye.site.textContent = walk.label;
      eye.conditions.textContent = walk.verdict?.level ?? '';
      eye.sight.hidden = !frame.outOfSight;
      eye.radiation.textContent = walk.dataset === 'gale' ? 'Curiosity RAD · Gale' : 'Curiosity RAD · Gale proxy for Jezero';
      if (nextPhoto?.url !== shownPhoto) {
        eye.photo.hidden = true;
        eye.credit.hidden = true;
        if (nextPhoto?.url) {
          eye.credit.textContent = `${rover} · ${nextPhoto.credit ?? PHOTO_CREDIT}`;
          eye.photo.src = nextPhoto.url;
        } else {
          eye.photo.removeAttribute('src');
        }
      }
    }
    shownPhoto = nextPhoto?.url;
  }, { autoplay: false });

  if (walk.playMs) {
    for (const stop of walk.plan.stops) {
      const url = walk.targets.get(stop.id)?.photos?.[0]?.url;
      if (url) new Image().src = url;
    }
  }

  const portrait = matchMedia('(orientation: portrait)');
  let resumeOnLandscape = Boolean(walk.playMs);
  const updateOrientation = () => {
    if (!entry.hidden) return;
    if (portrait.matches) {
      resumeOnLandscape = playback.isPlaying() || resumeOnLandscape;
      playback.pause();
    } else if (resumeOnLandscape) {
      resumeOnLandscape = false;
      playback.play();
    }
  };
  portrait.addEventListener('change', updateOrientation);

  entryButton.addEventListener('click', () => {
    void enableCompass((next) => {
      sensorHeading = smoothHeadingDeg(sensorHeading, next, 0.22);
      pointAt(sensorHeading);
    });
    void enterFullscreen(stage, rotate);
    entry.hidden = true;
    stereo.hidden = false;
    byId('helmet-exit').hidden = false;
    rotate.hidden = false;
    updateOrientation();
  }, { once: true });

  stereo.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, heading, dragged: false };
    stereo.setPointerCapture(event.pointerId);
  });
  stereo.addEventListener('pointermove', (event) => {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    pointer.dragged ||= Math.hypot(dx, event.clientY - pointer.y) > 8;
    if (pointer.dragged && sensorHeading === null) pointAt(pointer.heading - dx * 0.45);
  });
  stereo.addEventListener('pointerup', (event) => {
    if (pointer?.id !== event.pointerId) return;
    if (!pointer.dragged && walk.playMs) {
      if (playback.isPlaying()) playback.pause();
      else playback.play();
    }
    pointer = null;
  });
  stereo.addEventListener('pointercancel', () => { pointer = null; });
  window.addEventListener('keydown', (event) => {
    if (stereo.hidden || sensorHeading !== null || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    pointAt(heading + (event.key === 'ArrowLeft' ? -8 : 8));
  });
}
