// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
import { cellToLatLon } from '../engine.js';
import { MODE_LABELS } from '../routes.js';
import { outOfSightAt } from './geometry.js';
import { bindProgress, byId, loadWalk } from './walk.js';
import { cameraAt, cameraKeyframes, decimateTerrain, ELEVATION_SCALE, elevationAt } from './flyover-geometry.js';

const PALETTE = {
  low: 0x78412e, high: 0xf1c597, steep: 0xc13849,
  route: 0xffce64, exceeded: 0xff747d, habitat: 0x8cf1d3, contingency: 0xffa95e,
};

async function galeOverlay(THREE, terrain) {
  const dir = new URL('../../data/gale/', import.meta.url);
  const response = await fetch(new URL('area.json', dir));
  if (!response.ok) throw new Error('Gale imagery bounds could not be loaded.');
  const { bounds } = await response.json();
  const texture = await new THREE.TextureLoader().loadAsync(new URL('imagery.png', dir).href);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const corner = cellToLatLon(terrain, -0.5, -0.5);
  const next = cellToLatLon(terrain, 0.5, 0.5);
  const lonStep = next.lon - corner.lon;
  const latStep = corner.lat - next.lat;
  return {
    texture,
    uv: (x, y) => [(corner.lon + (x + 0.5) * lonStep - bounds.west) / (bounds.east - bounds.west),
      (corner.lat - (y + 0.5) * latStep - bounds.south) / (bounds.north - bounds.south)],
  };
}

function buildGround(THREE, grid, overlay, pointAt) {
  const { points, columns, rows, lowest, highest } = grid;
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const low = new THREE.Color(PALETTE.low);
  const high = new THREE.Color(PALETTE.high);
  const steep = new THREE.Color(PALETTE.steep);
  const color = new THREE.Color();
  for (const { x, y, height, slope } of points) {
    positions.push(...pointAt(x, y, height));
    const elevation = ((height ?? lowest) - lowest) / Math.max(1, highest - lowest);
    color.copy(low).lerp(high, elevation);
    if (slope > 20) color.lerp(steep, 0.8);
    colors.push(color.r, color.g, color.b);
    if (overlay) uvs.push(...overlay.uv(x, y));
  }
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < columns - 1; col++) {
      const nw = row * columns + col;
      const sw = nw + columns;
      indices.push(nw, sw, nw + 1, nw + 1, sw, sw + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (overlay) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  else geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({
    map: overlay?.texture ?? null, vertexColors: !overlay,
  }));
}

function addRoute(THREE, scene, points, plan) {
  if (points.length < 2) return;
  const positions = [];
  const colors = [];
  const route = new THREE.Color(PALETTE.route);
  const exceeded = new THREE.Color(PALETTE.exceeded);
  const dim = new THREE.Color(0x7e716a);
  const color = new THREE.Color();
  const normals = points.slice(1).map((b, i) => {
    const a = points[i];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const length = Math.hypot(dx, dz) || 1;
    return [-dz / length, dx / length];
  });
  const sides = points.map(([x, y, z], i) => {
    const before = normals[Math.max(0, i - 1)];
    const after = normals[Math.min(normals.length - 1, i)];
    const length = Math.hypot(before[0] + after[0], before[1] + after[1]);
    const nx = length ? (before[0] + after[0]) / length : after[0];
    const nz = length ? (before[1] + after[1]) / length : after[1];
    const width = 2.5 / Math.max(0.55, nx * after[0] + nz * after[1]);
    return [[x + nx * width, y + 5, z + nz * width], [x - nx * width, y + 5, z - nz * width]];
  });
  for (let i = 1; i < points.length; i++) {
    const [left, right] = sides[i - 1];
    const [endLeft, endRight] = sides[i];
    positions.push(...left, ...right, ...endLeft, ...right, ...endRight, ...endLeft);
    color.copy(plan.turnBack && i > plan.turnBack.pathIndex ? exceeded : route);
    if (outOfSightAt(plan, i)) color.lerp(dim, 0.57);
    for (let vertex = 0; vertex < 6; vertex++) colors.push(color.r, color.g, color.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
}

function makePin(THREE, scene, point, title, kind) {
  const radius = kind === 'habitat' ? 6 : 4;
  const color = PALETTE[kind];
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 25, 6), new THREE.MeshBasicMaterial({ color }));
  stem.position.set(point[0], point[1] + 12.5, point[2]);
  const head = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), new THREE.MeshBasicMaterial({ color }));
  head.position.set(point[0], point[1] + 25, point[2]);
  scene.add(stem, head);
  const label = document.createElement('span');
  label.dataset.kind = kind;
  label.textContent = title;
  byId('flyover-pins').append(label);
  return { world: head.position, label };
}

function buildScene(THREE, walk, grid, overlay, renderer, OrbitControls) {
  const { terrain, plan, habitat } = walk;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d1414);
  const pointAt = (x, y, height = elevationAt(terrain, x, y)) => [
    (x + 0.5 - terrain.width / 2) * terrain.cellSize,
    ((height ?? grid.lowest) - grid.lowest) * ELEVATION_SCALE,
    (y + 0.5 - terrain.height / 2) * terrain.cellSize,
  ];
  scene.add(buildGround(THREE, grid, overlay, pointAt));
  const sun = new THREE.DirectionalLight(0xffdfbd, 2.25);
  sun.position.set(-520, 500, -350);
  scene.add(sun, new THREE.HemisphereLight(0xffe2cc, 0x814851, 1.65));

  const frames = cameraKeyframes(plan.path, pointAt);
  const route = frames.map(({ walker }) => walker);
  const turn = plan.turnBack;
  addRoute(THREE, scene, route, plan);
  const pins = [makePin(THREE, scene, pointAt(habitat.x, habitat.y), 'H · Habitat', 'habitat')];
  if (turn) {
    pins.push(makePin(THREE, scene, pointAt(turn.x, turn.y), 'Turn back', 'exceeded'));
  } else if (plan.turnBackLatest) {
    const { x, y } = plan.turnBackLatest;
    pins.push(makePin(THREE, scene, pointAt(x, y), 'Dust-storm turn-back', 'contingency'));
  }
  for (const stop of plan.stops) {
    pins.push(makePin(THREE, scene, pointAt(stop.x, stop.y), `${stop.id} · ${stop.name}`, 'route'));
  }
  const walker = new THREE.Mesh(new THREE.SphereGeometry(5.5, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xfff4df }));
  scene.add(walker);
  const camera = new THREE.PerspectiveCamera(52, 1, 2, 12500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 50;
  controls.maxDistance = Math.max(4800, terrain.width * terrain.cellSize * 2.6);
  const projection = new THREE.Vector3();

  function draw() {
    const { clientWidth: width, clientHeight: height } = renderer.domElement;
    renderer.render(scene, camera);
    const shown = [];
    for (const { world, label } of pins) {
      projection.copy(world).project(camera);
      const x = (projection.x + 1) * width / 2;
      const y = (1 - projection.y) * height / 2;
      const visible = projection.z > -1 && projection.z < 1 && x > 45 && x < width - 45 && y > 85 && y < height - 100
        && shown.every(([px, py]) => Math.abs(x - px) > 165 || Math.abs(y - py) > 30);
      label.hidden = !visible;
      if (visible) {
        shown.push([x, y]);
        label.style.left = `${x}px`;
        label.style.top = `${y}px`;
      }
    }
  }
  controls.addEventListener('change', () => { if (controls.enabled) draw(); });

  function follow(progress) {
    const { walker: position, eye, target } = cameraAt(frames, progress);
    walker.position.set(position[0], position[1] + 8, position[2]);
    // Keep the camera above the rendered terrain, including steep ground behind the route.
    const x = eye[0] / terrain.cellSize + terrain.width / 2 - 0.5;
    const y = eye[2] / terrain.cellSize + terrain.height / 2 - 0.5;
    const ground = pointAt(x, y)[1];
    camera.position.set(eye[0], Math.max(eye[1], ground + 35), eye[2]);
    controls.target.set(...target);
    controls.update();
    draw();
  }

  function overview() {
    const [x, y, z] = pointAt(habitat.x, habitat.y);
    const span = Math.max(terrain.width, terrain.height) * terrain.cellSize;
    const focusX = route.reduce((sum, position) => sum + position[0], 0) / route.length;
    const focusZ = route.reduce((sum, position) => sum + position[2], 0) / route.length;
    walker.position.set(x, y + 8, z);
    controls.target.set(focusX, y + 20, focusZ);
    const rangeX = Math.max(...route.map((point) => Math.abs(point[0] - focusX)));
    const rangeZ = Math.max(...route.map((point) => Math.abs(point[2] - focusZ)));
    const distance = Math.max(span * 0.44, 2.3 * Math.max(rangeX, rangeZ));
    camera.position.set(focusX + distance * 0.65, y + distance * 0.85, focusZ + distance * 0.78);
    controls.update();
    draw();
  }
  return { controls, camera, draw, follow, overview };
}

function fallback(message) {
  byId('flyover-scene').hidden = true;
  byId('flyover-footer').hidden = true;
  byId('flyover-message').hidden = false;
  byId('load-status').textContent = message;
  byId('flyover-hud').hidden = false;
}

async function start() {
  const url = new URL(location.href);
  for (const [id, page] of [['flyover-console', 'index.html'], ['flyover-hud', 'hud.html']]) {
    const link = new URL(page, url);
    link.search = url.search;
    link.searchParams.delete('play');
    byId(id).href = link.href;
  }

  const canvas = byId('flyover-canvas');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) return fallback('This browser cannot render the 3D terrain. You can follow the same route in the helmet HUD.');
  const [THREE, { OrbitControls }, walk] = await Promise.all([
    import('three'), import('three/addons/controls/OrbitControls.js'), loadWalk(),
  ]);
  const grid = decimateTerrain(walk.terrain);
  const overlay = walk.dataset === 'gale' ? await galeOverlay(THREE, walk.terrain) : null;
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  byId('flyover-scene').hidden = false;
  const view = buildScene(THREE, walk, grid, overlay, renderer, OrbitControls);
  const status = byId('flyover-next');
  const button = byId('flyover-play');
  const startAt = walk.playMs ? 0 : walk.progress;
  let progress = startAt;
  let overview = !walk.playMs && startAt === 0;
  const resize = () => {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    view.camera.aspect = width / height;
    view.camera.updateProjectionMatrix();
    view.draw();
  };
  resize();
  new ResizeObserver(resize).observe(canvas);
  byId('flyover-site').textContent = `${walk.label} · ${MODE_LABELS[walk.plan.mode].name}`;
  byId('flyover-credit').textContent = overlay ? 'USGS HiRISE colour imagery' :
    walk.terrain.synthetic ? 'Synthetic terrain · Red marks slopes over 20°' : 'USGS HiRISE elevation · Red marks slopes over 20°';
  byId('flyover-message').hidden = true;
  byId('flyover-sight-key').hidden = !walk.plan.lineOfSight?.gaps.length;
  byId('flyover-scale').hidden = false;
  byId('flyover-footer').hidden = false;
  const setPlaying = (playing) => {
    view.controls.enabled = !playing;
    button.textContent = playing ? 'Pause' : progress === 1 ? 'Replay' : 'Play';
  };
  const playback = bindProgress({ ...walk, playMs: walk.playMs || 30000 }, (frame, _, nextProgress) => {
    progress = nextProgress;
    if (overview) view.overview();
    else view.follow(progress);
    const destination = frame.complete ? 'Habitat reached' : frame.turnBack ? 'Past the turn-back point' :
      frame.upcoming ? `Next: ${frame.upcoming.name}` : 'Returning to habitat';
    status.textContent = frame.outOfSight ? `${destination} · Out of habitat’s sight` : destination;
    if (progress === 1) setPlaying(false);
  }, { autoplay: false, startAt });
  if (walk.plan.path.length < 2) button.disabled = true;
  const play = () => {
    overview = false;
    if (progress === 1) playback.seek(0);
    playback.play();
    setPlaying(playback.isPlaying());
  };
  button.addEventListener('click', () => {
    if (playback.isPlaying()) {
      playback.pause();
      setPlaying(false);
    } else {
      play();
    }
  });
  byId('progress').addEventListener('input', () => {
    overview = false;
    view.follow(progress);
    setPlaying(false);
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    playback.pause();
    fallback('The 3D display stopped. You can follow the same route in the helmet HUD.');
  });
  if (walk.playMs && !button.disabled) play();
}

start().catch((error) => fallback(`Could not open the fly-through. ${error.message}`));
