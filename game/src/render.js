// Software 3D renderer: perspective projection, painter's algorithm, sky,
// sun, clouds, terrain, lake, runway, rings, trees and the player's plane.
// Everything is drawn on one 2D canvas; no WebGL, no libraries.

import { COLOURS, WORLD, RUNWAY, RINGS } from './config.js';
import { terrainHeight } from './terrain.js';
import { mulberry32 } from './random.js';

export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const SKY_TOP = hexRgb(COLOURS.skyTop);
const SKY_LOW = hexRgb(COLOURS.skyLow);

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function rgb(c) {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.focal = 600;
    // Fixed afternoon sun, west-south-west, high enough to light the valley.
    this.sunDir = norm([-0.55, 0.62, -0.35]);
    this.clouds = [];
    const rand = mulberry32(777);
    for (let i = 0; i < 26; i += 1) {
      this.clouds.push({
        x: (rand() * 2 - 1) * 2000,
        y: 380 + rand() * 160,
        z: (rand() * 2 - 1) * 2000,
        r: 90 + rand() * 130,
      });
    }
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.focal = (h / 2) / Math.tan((68 * Math.PI) / 360);
  }

  // Build a camera basis from eye and look-target.
  camera(eye, target) {
    const fwd = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    return { eye, fwd, right, up };
  }

  // World point -> camera space [right, up, forward].
  toCamera(cam, p) {
    const dx = p[0] - cam.eye[0];
    const dy = p[1] - cam.eye[1];
    const dz = p[2] - cam.eye[2];
    return [
      dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2],
      dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2],
      dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2],
    ];
  }

  // Camera-space point (z >= near) -> screen point.
  toScreen(p) {
    return {
      x: this.width / 2 + (p[0] / p[2]) * this.focal,
      y: this.height / 2 - (p[1] / p[2]) * this.focal,
      z: p[2],
    };
  }

  project(cam, p) {
    const c = this.toCamera(cam, p);
    if (c[2] < 2) return null;
    return this.toScreen(c);
  }

  // Clip a polygon (camera-space points) against the near plane z >= near.
  // Sutherland–Hodgman: a triangle straddling the plane keeps its visible
  // part instead of vanishing and leaving a hole at the frame's edge —
  // the ground right under a low camera is exactly such a triangle.
  clipNear(poly, near) {
    const out = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const aIn = a[2] >= near;
      const bIn = b[2] >= near;
      if (aIn) out.push(a);
      if (aIn !== bIn) {
        const t = (near - a[2]) / (b[2] - a[2]);
        out.push([
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          near,
        ]);
      }
    }
    return out;
  }

  // World polygon -> clipped screen polygon, or null when fully behind
  // the near plane.
  projectPoly(cam, pts, near = 2) {
    const clipped = this.clipNear(
      pts.map((p) => this.toCamera(cam, p)),
      near,
    );
    if (clipped.length < 3) return null;
    return clipped.map((p) => this.toScreen(p));
  }

  drawSky(cam) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.height);
    g.addColorStop(0, COLOURS.skyTop);
    g.addColorStop(0.55, COLOURS.skyMid);
    g.addColorStop(1, COLOURS.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
    // Sun disc, placed far along its direction.
    const sunPos = [
      cam.eye[0] + this.sunDir[0] * 3000,
      cam.eye[1] + this.sunDir[1] * 3000,
      cam.eye[2] + this.sunDir[2] * 3000,
    ];
    const s = this.project(cam, sunPos);
    if (s) {
      const glow = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, 130);
      glow.addColorStop(0, 'rgba(255, 246, 200, 0.95)');
      glow.addColorStop(0.25, 'rgba(255, 240, 180, 0.55)');
      glow.addColorStop(1, 'rgba(255, 240, 180, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 130, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // One frame: terrain, lake, runway, rings, trees, clouds, plane.
  draw(cam, world, plane, time) {
    const ctx = this.ctx;
    this.drawSky(cam);
    const items = [];
    // Ground-hugging surfaces (lake, runway) are drawn in a late pass: at a
    // grazing angle the painter's sort lets near dirt cover them in bands.
    // Each late piece first proves no hill stands between it and the camera.
    const late = [];
    const fogTop = 2400;
    const fogOf = (d) => Math.min(0.82, Math.max(0, (d - 500) / fogTop));

    // Terrain triangles, frustum- and distance-culled.
    for (const tri of world.terrain) {
      const dx = tri.cx - cam.eye[0];
      const dy = tri.cy - cam.eye[1];
      const dz = tri.cz - cam.eye[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 2300) continue;
      const fwdDot = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
      if (fwdDot < -60) continue;
      const pts = this.projectPoly(cam, tri.pts);
      if (!pts) continue;
      if (
        Math.max(...pts.map((p) => p.x)) < -40 ||
        Math.min(...pts.map((p) => p.x)) > this.width + 40 ||
        Math.max(...pts.map((p) => p.y)) < -40 ||
        Math.min(...pts.map((p) => p.y)) > this.height + 40
      ) {
        continue;
      }
      const fog = fogOf(dist);
      const shaded = shadeTri(tri, this.sunDir);
      const base = tri.rgb;
      // Flat shading first, then distance fog toward the sky colour.
      const col = mix(
        [base[0] * shaded, base[1] * shaded, base[2] * shaded],
        SKY_LOW,
        fog,
      );
      const fill = rgb(col);
      items.push({
        depth: dist,
        draw: () => {
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
          ctx.fill();
        },
      });
    }

    // The lake's water triangles ride in world.terrain (see buildWater), so
    // the shoreline follows the mesh and needs no painted quad here.

    // Runway, markings, windsock, hangar and tower.
    this.pushAirfield(items, late, cam, time);

    // Rings: next one gold and pulsing, later ones pale, done ones green.
    world.rings.forEach((ring, i) => {
      const state = i < world.ringIndex ? 'done' : i === world.ringIndex ? 'next' : 'far';
      this.pushRing(items, cam, ring, state, time);
    });

    // Trees as simple two-cone pines, near ones only.
    for (const t of world.trees) {
      const d = Math.hypot(t.x - cam.eye[0], t.z - cam.eye[2]);
      if (d > 900) continue;
      const top = this.project(cam, [t.x, t.y + t.s * 2.1, t.z]);
      const base = this.project(cam, [t.x, t.y, t.z]);
      if (!top || !base) continue;
      const w = Math.max(2, ((base.y - top.y) * 0.42) | 0);
      items.push({
        depth: d,
        draw: () => {
          ctx.fillStyle = '#2e6b34';
          ctx.beginPath();
          ctx.moveTo(top.x, top.y);
          ctx.lineTo(base.x - w, base.y);
          ctx.lineTo(base.x + w, base.y);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#5d3f24';
          ctx.fillRect(base.x - 1.5, base.y - (base.y - top.y) * 0.12, 3, (base.y - top.y) * 0.12);
        },
      });
    }

    // Clouds, soft and far.
    for (const c of this.clouds) {
      const d = dist3([c.x, c.y, c.z], cam.eye);
      const p = this.project(cam, [c.x, c.y, c.z]);
      if (!p) continue;
      const r = (c.r / p.z) * this.focal;
      if (r < 4) continue;
      items.push({
        depth: d,
        draw: () => {
          const g2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g2.addColorStop(0, 'rgba(255,255,255,0.85)');
          g2.addColorStop(0.7, 'rgba(255,255,255,0.45)');
          g2.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g2;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r, r * 0.42, 0, 0, Math.PI * 2);
          ctx.fill();
        },
      });
    }

    items.sort((a, b) => b.depth - a.depth);
    for (const item of items) item.draw();
    late.sort((a, b) => b.depth - a.depth);
    for (const item of late) item.draw();

    // The player's plane, always drawn last: it is the subject.
    if (plane.visible) this.drawPlane(cam, plane, time);
  }

  // True when a hill stands between the camera and the target point.
  occluded(cam, target) {
    const steps = 14;
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const x = cam.eye[0] + (target[0] - cam.eye[0]) * t;
      const y = cam.eye[1] + (target[1] - cam.eye[1]) * t;
      const z = cam.eye[2] + (target[2] - cam.eye[2]) * t;
      if (terrainHeight(x, z) > y + 1) return true;
    }
    return false;
  }

  pushAirfield(items, late, cam, time) {
    const ctx = this.ctx;
    const halfL = RUNWAY.length / 2;
    const halfW = RUNWAY.width / 2;
    const gy = RUNWAY.groundY + 0.4;
    // The asphalt in lengthwise segments, so a corner behind the camera never
    // hides the whole runway, and the strip reads over its bed.
    const SEG = 8;
    for (let s = 0; s < SEG; s += 1) {
      const xa = RUNWAY.x - halfL + (s * RUNWAY.length) / SEG;
      const xb = RUNWAY.x - halfL + ((s + 1) * RUNWAY.length) / SEG;
      const corners = [
        [xa, gy, RUNWAY.z - halfW],
        [xb, gy, RUNWAY.z - halfW],
        [xb, gy, RUNWAY.z + halfW],
        [xa, gy, RUNWAY.z + halfW],
      ];
      const pts = this.projectPoly(cam, corners);
      if (!pts) continue;
      const sc = [(xa + xb) / 2, gy, RUNWAY.z];
      if (this.occluded(cam, sc)) continue;
      late.push({
        depth: dist3(sc, cam.eye),
        draw: () => {
          ctx.fillStyle = COLOURS.asphalt;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
          ctx.fill();
        },
      });
    }
    // Markings, drawn as their own late item with per-dash projection.
    if (!this.occluded(cam, [RUNWAY.x, gy, RUNWAY.z])) late.push({
      depth: dist3([RUNWAY.x, gy, RUNWAY.z], cam.eye),
      draw: () => {
        ctx.fillStyle = '#f2f2f2';
        for (let x = RUNWAY.x - halfL + 40; x < RUNWAY.x + halfL - 30; x += 60) {
          const a = this.project(cam, [x, gy + 0.05, RUNWAY.z - 1.5]);
          const b = this.project(cam, [x + 30, gy + 0.05, RUNWAY.z + 1.5]);
          if (!a || !b) continue;
          ctx.fillRect(a.x, a.y, b.x - a.x, Math.max(1.5, b.y - a.y + 2));
        }
        // Threshold bars at both ends.
        for (const end of [-1, 1]) {
          const tx = RUNWAY.x + end * (halfL - 18);
          for (let k = -2; k <= 2; k += 1) {
            const a = this.project(cam, [tx - 8, gy + 0.05, RUNWAY.z + k * 8 - 2]);
            const b = this.project(cam, [tx + 8, gy + 0.05, RUNWAY.z + k * 8 + 2]);
            if (!a || !b) continue;
            ctx.fillRect(a.x, a.y, b.x - a.x, Math.max(1.5, b.y - a.y + 2));
          }
        }
        // Runway number 09 at the western threshold.
        const num = this.project(cam, [RUNWAY.x - halfL + 55, gy + 0.05, RUNWAY.z]);
        if (num && num.z < 900) {
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.max(10, (900 - num.z) / 14)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('09', num.x, num.y);
        }
      },
    });
    // Windsock beside the runway, waving gently.
    const sockBase = [RUNWAY.x - 120, terrainHeight(RUNWAY.x - 120, RUNWAY.z + 70), RUNWAY.z + 70];
    const sockTop = this.project(cam, [sockBase[0], sockBase[1] + 9, sockBase[2]]);
    const sockBaseP = this.project(cam, sockBase);
    if (sockTop && sockBaseP) {
      const wave = Math.sin(time * 2.2) * 2;
      items.push({
        depth: dist3(sockBase, cam.eye),
        draw: () => {
          ctx.strokeStyle = '#888';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sockBaseP.x, sockBaseP.y);
          ctx.lineTo(sockTop.x, sockTop.y);
          ctx.stroke();
          ctx.fillStyle = '#ff7a1a';
          ctx.beginPath();
          ctx.moveTo(sockTop.x, sockTop.y);
          ctx.lineTo(sockTop.x + 16 + wave, sockTop.y + 3);
          ctx.lineTo(sockTop.x, sockTop.y + 6);
          ctx.closePath();
          ctx.fill();
        },
      });
    }
    // Hangar and tower as shaded boxes, sitting on the ground where they stand.
    this.pushBox(items, cam, [RUNWAY.x - 180, terrainHeight(RUNWAY.x - 180, RUNWAY.z + 110), RUNWAY.z + 110], 46, 16, 30, '#b8433a');
    this.pushBox(items, cam, [RUNWAY.x + 210, terrainHeight(RUNWAY.x + 210, RUNWAY.z + 95), RUNWAY.z + 95], 14, 34, 14, '#e8e2d4');
  }

  pushBox(items, cam, centre, w, h, dpt, colour) {
    const ctx = this.ctx;
    const [cx, cy, cz] = centre;
    const y0 = cy;
    const y1 = cy + h;
    const faces = [
      { pts: [[cx - w / 2, y1, cz - dpt / 2], [cx + w / 2, y1, cz - dpt / 2], [cx + w / 2, y0, cz - dpt / 2], [cx - w / 2, y0, cz - dpt / 2]], shade: 0.92 },
      { pts: [[cx + w / 2, y1, cz - dpt / 2], [cx + w / 2, y1, cz + dpt / 2], [cx + w / 2, y0, cz + dpt / 2], [cx + w / 2, y0, cz - dpt / 2]], shade: 0.75 },
      { pts: [[cx - w / 2, y1, cz + dpt / 2], [cx + w / 2, y1, cz + dpt / 2], [cx + w / 2, y1, cz - dpt / 2], [cx - w / 2, y1, cz - dpt / 2]], shade: 1.0 },
    ];
    const base = hexRgb(colour);
    for (const face of faces) {
      const pp = this.projectPoly(cam, face.pts);
      if (!pp) continue;
      items.push({
        depth: dist3(centre, cam.eye),
        draw: () => {
          ctx.fillStyle = rgb(base.map((v) => (v * face.shade) | 0));
          ctx.beginPath();
          ctx.moveTo(pp[0].x, pp[0].y);
          for (let i = 1; i < pp.length; i += 1) ctx.lineTo(pp[i].x, pp[i].y);
          ctx.closePath();
          ctx.fill();
        },
      });
    }
  }

  pushRing(items, cam, ring, state, time) {
    const ctx = this.ctx;
    const centre = [ring.x, ring.y, ring.z];
    const d = dist3(centre, cam.eye);
    if (d > 2600) return;
    // Cleared rings fade out once they are far behind; distant unflown rings
    // stay visible but never clutter the sky with tiny circles.
    if (state === 'done' && d > 700) return;
    if (state === 'far' && d > 1600) return;
    // The ring faces the incoming pilot: its normal points at the previous
    // ring (or along the runway for the first ring).
    const prev = state === 'next' || state === 'far' ? ring : ring;
    void prev;
    const normal = norm([cam.eye[0] - ring.x, 0, cam.eye[2] - ring.z]);
    const up = [0, 1, 0];
    const side = norm(cross(up, normal));
    const colour = state === 'next' ? COLOURS.ringNext : state === 'done' ? COLOURS.ringDone : COLOURS.ringFar;
    const pulse = state === 'next' ? 1 + Math.sin(time * 4) * 0.08 : 1;
    const segs = [];
    const N = 28;
    for (let i = 0; i <= N; i += 1) {
      const a = (i / N) * Math.PI * 2;
      const px = ring.x + (side[0] * Math.cos(a) + 0) * ring.r * pulse;
      const py = ring.y + Math.sin(a) * ring.r * pulse;
      const pz = ring.z + side[2] * Math.cos(a) * ring.r * pulse;
      const p = this.project(cam, [px, py, pz]);
      if (p) segs.push(p);
    }
    if (segs.length < 8) return;
    items.push({
      depth: d,
      draw: () => {
        ctx.strokeStyle = colour;
        ctx.lineWidth = Math.max(2, 420 / d);
        ctx.lineJoin = 'round';
        if (state === 'next') {
          ctx.shadowColor = 'rgba(255,194,51,0.9)';
          ctx.shadowBlur = 18;
        }
        ctx.beginPath();
        ctx.moveTo(segs[0].x, segs[0].y);
        for (let i = 1; i < segs.length; i += 1) ctx.lineTo(segs[i].x, segs[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (state === 'next') {
          const c = this.project(cam, centre);
          if (c) {
            ctx.fillStyle = colour;
            ctx.font = `bold ${Math.max(12, 300 / d)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(`RING ${ring.label}`, c.x, c.y - ring.r * 0.4 * (this.focal / d));
          }
        }
      },
    });
  }

  // The player's aircraft, modelled from flat-shaded polygons in plane space.
  drawPlane(cam, plane, time) {
    const ctx = this.ctx;
    const { right, up, fwd } = plane.basis;
    const P = plane.pos;
    const S = 1.3; // the courier reads better slightly larger than life
    const toWorld = (lx, ly, lz) => [
      P[0] + right[0] * lx * S + up[0] * ly * S + fwd[0] * lz * S,
      P[1] + right[1] * lx * S + up[1] * ly * S + fwd[1] * lz * S,
      P[2] + right[2] * lx * S + up[2] * ly * S + fwd[2] * lz * S,
    ];
    const polys = buildPlanePolys(plane.propAngle);
    const drawn = [];
    for (const poly of polys) {
      const pts = poly.pts.map((q) => this.project(cam, toWorld(q[0], q[1], q[2])));
      if (!pts.every(Boolean)) continue;
      const depth = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      drawn.push({ pts, depth, colour: poly.colour, shade: poly.shade });
    }
    drawn.sort((a, b) => b.depth - a.depth);
    for (const poly of drawn) {
      ctx.fillStyle = poly.colour;
      ctx.globalAlpha = poly.shade;
      ctx.beginPath();
      ctx.moveTo(poly.pts[0].x, poly.pts[0].y);
      for (let i = 1; i < poly.pts.length; i += 1) ctx.lineTo(poly.pts[i].x, poly.pts[i].y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// Flat shading for a terrain triangle from its normal and the sun.
function shadeTri(tri, sunDir) {
  if (!tri.shade) {
    const [a, b, c] = tri.pts;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = norm(cross(u, v));
    const lam = Math.abs(n[0] * sunDir[0] + n[1] * sunDir[1] + n[2] * sunDir[2]);
    tri.shade = 0.72 + lam * 0.28;
    tri.rgb = hexRgb(tri.colour);
  }
  return tri.shade;
}

export function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// A small single-prop courier plane: cream fuselage, red wings and tail,
// dark canopy, spinning propeller. Local axes: x right, y up, z nose.
export function buildPlanePolys(propAngle) {
  const cream = '#f3e6c8';
  const red = '#c23b2e';
  const dark = '#2c343c';
  const glass = '#1d4e6b';
  const polys = [];
  const quad = (pts, colour, shade = 1) => polys.push({ pts, colour, shade });
  // Fuselage: tapered box from tail (-4.6) to nose (4.4).
  quad([[-0.7, -0.4, -4.6], [0.7, -0.4, -4.6], [0.7, 0.5, 1.5], [-0.7, 0.5, 1.5]], cream, 0.95);
  quad([[-0.7, 0.5, 1.5], [0.7, 0.5, 1.5], [0.55, 0.35, 4.4], [-0.55, 0.35, 4.4]], cream, 1);
  quad([[-0.7, -0.4, -4.6], [-0.7, 0.5, 1.5], [-0.55, 0.35, 4.4], [-0.55, -0.35, 4.4]], red, 0.9);
  quad([[0.7, -0.4, -4.6], [0.55, -0.35, 4.4], [0.55, 0.35, 4.4], [0.7, 0.5, 1.5]], red, 0.9);
  quad([[-0.55, -0.35, 4.4], [0.55, -0.35, 4.4], [0.55, 0.35, 4.4], [-0.55, 0.35, 4.4]], dark, 1);
  // Canopy.
  quad([[-0.55, 0.5, 1.8], [0.55, 0.5, 1.8], [0.4, 0.95, 0.4], [-0.4, 0.95, 0.4]], glass, 1);
  quad([[-0.55, 0.5, 1.8], [-0.4, 0.95, 0.4], [-0.4, 0.95, -0.6], [-0.55, 0.5, -0.6]], glass, 0.85);
  quad([[0.55, 0.5, 1.8], [0.55, 0.5, -0.6], [0.4, 0.95, -0.6], [0.4, 0.95, 0.4]], glass, 0.85);
  // Main wings.
  quad([[-5.6, 0.05, 0.9], [5.6, 0.05, 0.9], [5.6, 0.05, -0.9], [-5.6, 0.05, -0.9]], red, 1);
  quad([[-5.6, 0.05, 0.9], [-5.0, 0.28, 0.9], [-5.0, 0.28, -0.9], [-5.6, 0.05, -0.9]], '#e8e2d4', 0.9);
  quad([[5.6, 0.05, 0.9], [5.6, 0.05, -0.9], [5.0, 0.28, -0.9], [5.0, 0.28, 0.9]], '#e8e2d4', 0.9);
  // Tailplane and fin.
  quad([[-1.9, 0.25, -4.4], [1.9, 0.25, -4.4], [1.9, 0.25, -3.5], [-1.9, 0.25, -3.5]], red, 1);
  quad([[-0.06, 0.4, -4.5], [0.06, 0.4, -4.5], [0.06, 2.0, -3.6], [-0.06, 2.0, -3.6]], red, 1);
  // Propeller: two blades spinning around the nose axis.
  const ca = Math.cos(propAngle);
  const sa = Math.sin(propAngle);
  const blade = (sign) => {
    const bx = Math.cos(propAngle + sign * Math.PI) * 1.7;
    const by = Math.sin(propAngle + sign * Math.PI) * 1.7;
    return [
      [0, 0, 4.55],
      [bx * 0.92, by * 0.92, 4.55],
      [bx, by, 4.55],
    ];
  };
  void ca;
  void sa;
  quad([[0, 0, 4.5], blade(0)[1], blade(0)[2]], '#222222', 0.55);
  quad([[0, 0, 4.5], blade(1)[1], blade(1)[2]], '#222222', 0.55);
  return polys;
}
