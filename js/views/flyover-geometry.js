// Generated with AI assistance for NASA Space Apps 2026; reviewed by the team
import { clampProgress } from './geometry.js';

export const ELEVATION_SCALE = 2;
const blend = (a, b, t) => a + (b - a) * t;
const NEIGHBORS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

export function elevationAt(terrain, x, y) {
  const col = Math.max(0, Math.min(terrain.width - 1, x));
  const row = Math.max(0, Math.min(terrain.height - 1, y));
  const x0 = Math.floor(col);
  const y0 = Math.floor(row);
  const x1 = Math.min(x0 + 1, terrain.width - 1);
  const y1 = Math.min(y0 + 1, terrain.height - 1);
  const values = terrain.layers.elevation;
  const corners = [values[y0 * terrain.width + x0], values[y0 * terrain.width + x1],
    values[y1 * terrain.width + x0], values[y1 * terrain.width + x1]];
  const valid = corners.filter(Number.isFinite);
  if (!valid.length) return null;
  const fallback = valid.reduce((sum, height) => sum + height, 0) / valid.length;
  const [a, b, c, d] = corners.map((height) => height ?? fallback);
  return blend(blend(a, b, col - x0), blend(c, d, col - x0), row - y0);
}

export function decimateTerrain(terrain, limit = 200) {
  const columns = Math.min(limit, terrain.width + 1);
  const rows = Math.min(limit, terrain.height + 1);
  const points = [];
  let lowest = Infinity;
  let highest = -Infinity;
  for (let row = 0; row < rows; row++) {
    const y = row * terrain.height / (rows - 1) - 0.5;
    for (let col = 0; col < columns; col++) {
      const x = col * terrain.width / (columns - 1) - 0.5;
      const height = elevationAt(terrain, x, y);
      let slope = 0;
      if (height !== null) {
        lowest = Math.min(lowest, height);
        highest = Math.max(highest, height);
        const cellX = Math.min(terrain.width - 1, Math.round(x));
        const cellY = Math.min(terrain.height - 1, Math.round(y));
        const cellHeight = terrain.layers.elevation[cellY * terrain.width + cellX];
        for (const [dx, dy] of NEIGHBORS) {
          const nx = cellX + dx;
          const ny = cellY + dy;
          if (nx < 0 || nx >= terrain.width || ny < 0 || ny >= terrain.height) continue;
          const neighbor = terrain.layers.elevation[ny * terrain.width + nx];
          if (Number.isFinite(neighbor) && Number.isFinite(cellHeight)) {
            slope = Math.max(slope, Math.atan(Math.abs(neighbor - cellHeight) / (terrain.cellSize * Math.hypot(dx, dy))) * 180 / Math.PI);
          }
        }
      }
      points.push({ x, y, height, slope });
    }
  }
  return { columns, rows, points, lowest, highest };
}

export function cameraKeyframes(path, pointAt) {
  const points = path.map(([x, y]) => pointAt(x, y));
  return points.map((walker, i) => {
    const back = points[Math.max(0, i - 8)];
    const ahead = points[Math.min(points.length - 1, i + 8)];
    const dx = ahead[0] - back[0];
    const dz = ahead[2] - back[2];
    const span = Math.hypot(dx, dz);
    const ux = span ? dx / span : 0;
    const uz = span ? dz / span : -1;
    return {
      walker,
      eye: [walker[0] - ux * 78 - uz * 38, walker[1] + 100, walker[2] - uz * 78 + ux * 38],
      target: [walker[0] + ux * 29, (2 * walker[1] + ahead[1]) / 3 + 5, walker[2] + uz * 29],
    };
  });
}

export function cameraAt(frames, progress) {
  const index = clampProgress(progress) * (frames.length - 1);
  const first = frames[Math.floor(index)];
  const second = frames[Math.min(frames.length - 1, Math.floor(index) + 1)];
  const vector = (key) => first[key].map((value, axis) => blend(value, second[key][axis], index % 1));
  return { walker: vector('walker'), eye: vector('eye'), target: vector('target') };
}
