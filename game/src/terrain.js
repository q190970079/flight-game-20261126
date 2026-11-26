// Terrain: a seeded heightfield valley with a lake, a flattened airfield and
// scattered pine trees. The mesh is plain triangles with flat shading colours;
// the renderer paints them far-to-near each frame.

import { WORLD, RUNWAY, COLOURS } from './config.js';
import { fbm, mulberry32 } from './random.js';

const HALF = WORLD.size / 2;

function airfieldMask(x, z) {
  // Smooth 0..1 mask: 1 on the runway strip, fading out over ~350 m.
  const dx = Math.abs(x - RUNWAY.x) / 420;
  const dz = Math.abs(z - RUNWAY.z) / 260;
  const d = Math.max(dx, dz);
  if (d >= 1) return 0;
  const t = 1 - d;
  return t * t * (3 - 2 * t);
}

function ridgeMask(x, z) {
  // Mountains rise toward the edges of the map, valley floor stays low.
  const nx = Math.abs(x) / HALF;
  const nz = Math.abs(z) / HALF;
  const edge = Math.max(nx, nz);
  return Math.pow(Math.max(0, edge - 0.35) / 0.65, 1.6);
}

export function terrainHeight(x, z) {
  const base = fbm(x / 620, z / 620, WORLD.seed, 4);
  const detail = fbm(x / 170 + 40, z / 170 - 17, WORLD.seed + 7, 3) * 0.22;
  let h = 78 + base * 95 + detail * 30;
  h += ridgeMask(x, z) * 215;
  // Carve the lake basin in the south-west valley, deep enough that the
  // water surface (26 m) actually shows.
  const lakeDx = (x + 1150) / 620;
  const lakeDz = (z + 900) / 520;
  const lakeD = Math.sqrt(lakeDx * lakeDx + lakeDz * lakeDz);
  if (lakeD < 1) h -= (1 - lakeD) * 110;
  // Flatten the airfield so the runway sits on level ground.
  const m = airfieldMask(x, z);
  h = h * (1 - m) + RUNWAY.groundY * m;
  // A shallow bed under the runway strip itself, so the asphalt reads as a
  // prepared surface instead of fighting the dirt at a grazing angle.
  if (Math.abs(x - RUNWAY.x) < 285 && Math.abs(z - RUNWAY.z) < 24) {
    h = RUNWAY.groundY - 0.8;
  }
  return h;
}

function smoothstep(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mixHex(c1, c2, t) {
  const n1 = parseInt(c1.slice(1), 16);
  const n2 = parseInt(c2.slice(1), 16);
  const r = Math.round(((n1 >> 16) & 255) + (((n2 >> 16) & 255) - ((n1 >> 16) & 255)) * t);
  const g = Math.round(((n1 >> 8) & 255) + (((n2 >> 8) & 255) - ((n1 >> 8) & 255)) * t);
  const b = Math.round((n1 & 255) + ((n2 & 255) - (n1 & 255)) * t);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function groundColour(x, z, h, slope) {
  // Sand only on the lake shore, not on every low dip of the valley.
  const lakeDx = (x + 1150) / 620;
  const lakeDz = (z + 900) / 520;
  if (h < WORLD.lakeLevel + 4 && Math.sqrt(lakeDx * lakeDx + lakeDz * lakeDz) < 1.15) {
    return COLOURS.sand;
  }
  // Valley grass warming into high grass, then rock on steep or high ground,
  // snow only on the highest peaks — all blended, no hard bands.
  let c = mixHex(COLOURS.grassLow, COLOURS.grassHigh, smoothstep(50, 170, h));
  c = mixHex(c, COLOURS.rock, Math.max(smoothstep(185, 250, h), smoothstep(0.55, 1.0, slope) * 0.8));
  c = mixHex(c, COLOURS.snow, smoothstep(248, 285, h));
  return c;
}

// Build the terrain once: triangles with a colour and a centre for sorting.
export function buildTerrain() {
  const n = WORLD.grid;
  const step = WORLD.size / n;
  const rand = mulberry32(WORLD.seed + 99);
  const heights = [];
  for (let j = 0; j <= n; j += 1) {
    heights.push([]);
    for (let i = 0; i <= n; i += 1) {
      heights[j].push(terrainHeight(-HALF + i * step, -HALF + j * step));
    }
  }
  const tris = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x0 = -HALF + i * step;
      const z0 = -HALF + j * step;
      const x1 = x0 + step;
      const z1 = z0 + step;
      const h00 = heights[j][i];
      const h10 = heights[j][i + 1];
      const h01 = heights[j + 1][i];
      const h11 = heights[j + 1][i + 1];
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const slope = Math.abs(h10 - h00) / step + Math.abs(h01 - h00) / step;
      let colour = groundColour(cx, cz, (h00 + h10 + h01 + h11) / 4, slope);
      // A whisper of per-triangle variation so the near ground reads as
      // grass, not a flat green sheet.
      const jit = (rand() - 0.5) * 0.09;
      colour = mixHex(colour, jit > 0 ? '#ffffff' : '#000000', Math.abs(jit));
      tris.push({
        pts: [
          [x0, h00, z0],
          [x1, h10, z0],
          [x0, h01, z1],
        ],
        colour,
        cx,
        cy: (h00 + h10 + h01) / 3,
        cz,
      });
      tris.push({
        pts: [
          [x1, h10, z0],
          [x1, h11, z1],
          [x0, h01, z1],
        ],
        colour,
        cx,
        cy: (h10 + h11 + h01) / 3,
        cz,
      });
    }
  }
  return tris;
}

// Pine trees: trunk + two cones, placed where the ground is grassy and flat
// enough, kept clear of the runway, lake and rings.
export function buildTrees() {
  const rand = mulberry32(WORLD.seed + 31);
  const trees = [];
  let guard = 0;
  while (trees.length < 240 && guard < 4000) {
    guard += 1;
    const x = (rand() * 2 - 1) * (HALF - 120);
    const z = (rand() * 2 - 1) * (HALF - 120);
    const h = terrainHeight(x, z);
    if (h < WORLD.lakeLevel + 6 || h > 185) continue;
    if (airfieldMask(x, z) > 0.05) continue;
    const lakeDx = (x + 1150) / 620;
    const lakeDz = (z + 900) / 520;
    if (Math.sqrt(lakeDx * lakeDx + lakeDz * lakeDz) < 1.05) continue;
    trees.push({ x, y: h, z, s: 7 + rand() * 9 });
  }
  return trees;
}

// The lake: its centre, radii and waterline height.
export const LAKE = {
  cx: -1150,
  cz: -900,
  rx: 620,
  rz: 520,
  y: WORLD.lakeLevel,
};

// The lake surface, built from the terrain mesh itself: every cell whose
// ground lies below the waterline gets a flat water triangle at lake level,
// so the shoreline follows the terrain exactly instead of a painted quad.
export function buildWater() {
  const n = WORLD.grid;
  const step = WORLD.size / n;
  const tris = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x0 = -HALF + i * step;
      const z0 = -HALF + j * step;
      const x1 = x0 + step;
      const z1 = z0 + step;
      const h00 = terrainHeight(x0, z0);
      const h10 = terrainHeight(x1, z0);
      const h01 = terrainHeight(x0, z1);
      const h11 = terrainHeight(x1, z1);
      if (Math.max(h00, h10, h01, h11) > LAKE.y + 2) continue;
      const y = LAKE.y;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      tris.push({
        pts: [
          [x0, y, z0],
          [x1, y, z0],
          [x0, y, z1],
        ],
        colour: COLOURS.lake,
        cx,
        cy: y,
        cz,
      });
      tris.push({
        pts: [
          [x1, y, z0],
          [x1, y, z1],
          [x0, y, z1],
        ],
        colour: COLOURS.lake,
        cx,
        cy: y,
        cz,
      });
    }
  }
  return tris;
}
