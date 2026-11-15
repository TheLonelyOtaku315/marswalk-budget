// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
import { resolveTargets } from '../engine.js';
import { ROUTE_MODES, planRoute } from '../routes.js';
import { buildSteps } from '../steps.js';
import { clampProgress, currentInstruction, walkSnapshot } from './geometry.js';

export const byId = (id) => document.getElementById(id);

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname.split('/').at(-1)} returned HTTP ${response.status}`);
  return response.json();
}

async function loadSnapshot(name) {
  try {
    const { loadConditions, toToggles, verdict } = await import('../conditions.js');
    const snapshot = await loadConditions(name);
    return { snapshot, suggested: toToggles(snapshot), verdict: (plan) => verdict(snapshot, plan) };
  } catch {
    return { suggested: {}, verdict: () => null };
  }
}

export async function loadWalk() {
  const url = new URL(location.href);
  const params = url.searchParams;
  const requestedData = params.get('data');
  const dataset = ['real', 'demo'].includes(requestedData) ? requestedData : 'gale';
  const directory = new URL(`../../data/${dataset}/`, import.meta.url);
  const localSnapshot = dataset === 'gale' ? 'real-gale' : 'real';
  const allowedSnapshots = [localSnapshot, 'demo-quiet', 'demo-dusty', 'demo-solar'];
  const requestedSnapshot = params.get('cond');
  const conditionFile = allowedSnapshots.includes(requestedSnapshot)
    ? requestedSnapshot : dataset === 'demo' ? 'demo-quiet' : localSnapshot;
  const snapshot = loadSnapshot(conditionFile);
  const stopIds = params.get('stops')?.split(',').map((id) => id.trim()).filter(Boolean);
  let terrain, targetsFile;
  try {
    [terrain, targetsFile] = await Promise.all([
      loadJson(new URL('terrain.json', directory)),
      loadJson(new URL('targets.json', directory)),
    ]);
  } catch (error) {
    const hint = dataset === 'demo' ? ' Open this page through the project’s local server.' : ' Try ?data=demo.';
    throw new Error(`Could not load ${dataset} data. ${error.message}.${hint}`);
  }
  const { snapshot: conditionsSnapshot, suggested, verdict } = await snapshot;
  const enabled = (param, fallback) => params.get(param) === '1' || (params.get(param) !== '0' && fallback === true);
  const conditions = {
    dustStorm: enabled('dust', suggested.dustStorm),
    solarEvent: enabled('solar', suggested.solarEvent),
    heavyKit: enabled('kit'),
  };
  const { habitat, targets } = resolveTargets(terrain, targetsFile);
  const requestedRoute = params.get('route');
  const mode = ROUTE_MODES.includes(requestedRoute) ? requestedRoute : 'eco';
  const plan = planRoute(mode, terrain, { habitat, targets }, { stopIds, conditions });
  const playSeconds = Number(params.get('play'));
  return {
    url, dataset, terrain, habitat, plan,
    targets: new Map(targets.map((target) => [target.id, target])),
    routeSteps: buildSteps(plan, terrain, new Map(targets.map(({ id, name }) => [id, name]))),
    progress: clampProgress(Number(params.get('p'))),
    playMs: Number.isFinite(playSeconds * 1000) && playSeconds > 0 ? playSeconds * 1000 : 0,
    verdict: verdict(plan),
    conditionsSnapshot,
    label: terrain.synthetic ? 'Synthetic demo terrain' : dataset === 'gale' ? 'Gale Crater' : 'Jezero Crater',
  };
}

export function bindProgress(walk, draw, { autoplay = true, startAt = walk.playMs ? 0 : walk.progress } = {}) {
  const slider = byId('progress');
  const output = byId('progress-value');
  let animation = null;
  let started = null;
  let elapsed = startAt * walk.playMs;
  const canPlay = walk.playMs > 0 && walk.plan.totals.totalTimeS > 0;
  slider.value = startAt;
  const update = (progress) => {
    output.value = `${Math.round(progress * 100)}%`;
    slider.setAttribute('aria-valuetext', output.value);
    const frame = walkSnapshot(walk.plan, walk.terrain, walk.habitat, progress);
    const instruction = frame.complete ? null : currentInstruction(walk.routeSteps, frame.routeIndex, walk.plan);
    draw(frame, instruction, progress);
  };
  const advance = (now) => {
    started ??= now;
    const progress = clampProgress((elapsed + now - started) / walk.playMs);
    slider.value = progress;
    update(progress);
    animation = progress < 1 ? requestAnimationFrame(advance) : null;
    if (progress === 1) {
      elapsed = walk.playMs;
      started = null;
    }
  };
  const play = () => {
    if (!canPlay || elapsed >= walk.playMs || animation !== null) return;
    animation = requestAnimationFrame(advance);
  };
  const pause = () => {
    if (animation === null) return;
    cancelAnimationFrame(animation);
    animation = null;
    if (started !== null) elapsed += performance.now() - started;
    started = null;
  };
  const seek = (progress) => {
    pause();
    slider.value = progress;
    elapsed = slider.valueAsNumber * walk.playMs;
    update(slider.valueAsNumber);
  };
  slider.addEventListener('input', () => seek(slider.valueAsNumber));
  // A committed slider change updates the shareable link without adding a history entry.
  slider.addEventListener('change', () => {
    walk.url.searchParams.set('p', slider.value);
    walk.url.searchParams.delete('play');
    history.replaceState(history.state, '', walk.url);
  });
  update(slider.valueAsNumber);
  if (autoplay) play();
  return { play, pause, seek, isPlaying: () => animation !== null };
}

export function instructionText(instruction, { includeDestination = true } = {}) {
  if (!instruction) return '';
  const { step, destination, remainingM } = instruction;
  const distance = `${step.text} · ${Math.round(remainingM)} m`;
  return includeDestination ? `${distance} toward ${destination}` : distance;
}

export function showLoadError(error) {
  const status = byId('load-status');
  status.textContent = error.message;
  status.classList.add('load-error');
  status.hidden = false;
}

export const headingText = (angle) => `${String(Math.round(angle) % 360).padStart(3, '0')}°`;
