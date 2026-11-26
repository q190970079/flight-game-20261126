// Arcade flight model: throttle sets target speed, pitch trades speed for
// altitude, bank turns the heading, and slow flight stalls. All angles in
// degrees in the state, converted where the maths needs radians.

import { PLANE, RUNWAY, RINGS, WORLD } from './config.js';
import { terrainHeight, LAKE } from './terrain.js';

const RAD = Math.PI / 180;

export function makePlaneState() {
  const x = RUNWAY.x - RUNWAY.length / 2 + 30;
  const z = RUNWAY.z;
  return {
    pos: [x, terrainHeight(x, z) + 1.4, z],
    yaw: 90, // east, down runway 09
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: 100,
    propAngle: 0,
    onGround: true,
  };
}

export function planeBasis(p) {
  const yaw = p.yaw * RAD;
  const pitch = p.pitch * RAD;
  const roll = p.roll * RAD;
  const fwd = [
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ];
  const right0 = [Math.cos(yaw), 0, Math.sin(yaw)];
  const up0 = [
    -Math.sin(yaw) * Math.sin(pitch),
    Math.cos(pitch),
    Math.cos(yaw) * Math.sin(pitch),
  ];
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const right = [
    right0[0] * cr + up0[0] * sr,
    right0[1] * cr + up0[1] * sr,
    right0[2] * cr + up0[2] * sr,
  ];
  const up = [
    up0[0] * cr - right0[0] * sr,
    up0[1] * cr - right0[1] * sr,
    up0[2] * cr - right0[2] * sr,
  ];
  return { fwd, right, up };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function approach(v, target, rate, dt) {
  if (v < target) return Math.min(target, v + rate * dt);
  return Math.max(target, v - rate * dt);
}

// Returns 'flying' | 'crashed' | 'landed' | 'ditched'.
export function stepFlight(p, input, dt, mode) {
  p.propAngle += (2 + p.throttle * 26) * dt;
  p.throttle = clamp(p.throttle + (input.throttleDelta || 0) * dt, 0, 1);
  const boosting = input.boost && p.fuel > 0;
  const targetSpeed = p.throttle * PLANE.cruiseSpeed + (boosting ? 34 : 0);
  p.speed = approach(p.speed, targetSpeed, p.onGround ? 14 : 22, dt);

  const targetRoll = clamp((input.roll || 0) * 55, -55, 55);
  p.roll = approach(p.roll, targetRoll, 90, dt);
  let targetPitch = clamp((input.pitch || 0) * 24, -24, 24);
  // On the ground the plane stays level until the pilot pulls up at speed.
  if (p.onGround && !(input.pitch > 0.3 && p.speed > 42)) targetPitch = 0;
  p.pitch = approach(p.pitch, targetPitch, 60, dt);

  // Banking turns the heading; the turn tightens with speed.
  p.yaw += Math.sin(p.roll * RAD) * PLANE.turnRate * (p.speed / PLANE.cruiseSpeed) * dt * 0.9;
  p.yaw = ((p.yaw % 360) + 360) % 360;

  // Stall: below stall speed the nose drops and the sink grows.
  const stalling = p.speed < PLANE.stallSpeed && !p.onGround;
  if (stalling) p.pitch = approach(p.pitch, -14, 30, dt);

  const basis = planeBasis(p);
  const sink = stalling ? (PLANE.stallSpeed - p.speed) * 0.55 : 0;
  const vy = basis.fwd[1] * p.speed - sink;
  p.pos[0] += basis.fwd[0] * p.speed * dt;
  p.pos[1] += vy * dt;
  p.pos[2] += basis.fwd[2] * p.speed * dt;

  // Fuel: cruise burn, heavier on boost, empty tank means gliding.
  const burn = (p.throttle * PLANE.fuelDrain + (boosting ? PLANE.boostDrain : 0)) * dt;
  p.fuel = Math.max(0, p.fuel - burn);
  if (p.fuel <= 0) p.throttle = Math.max(0, p.throttle - 0.4 * dt);

  // Keep the plane inside the valley.
  const LIM = 2050;
  p.pos[0] = clamp(p.pos[0], -LIM, LIM);
  p.pos[2] = clamp(p.pos[2], -LIM, LIM);
  p.pos[1] = Math.min(p.pos[1], 560);

  const ground = terrainHeight(p.pos[0], p.pos[2]);
  // Ditching: over the lake, the water surface (not the lake bed) is the
  // hazard — the bed sits well below it.
  const lakeDx = (p.pos[0] - LAKE.cx) / LAKE.rx;
  const lakeDz = (p.pos[2] - LAKE.cz) / LAKE.rz;
  if (
    lakeDx * lakeDx + lakeDz * lakeDz < 1 &&
    p.pos[1] <= WORLD.lakeLevel + 1.2
  ) {
    return 'ditched';
  }
  const overRunway =
    Math.abs(p.pos[2] - RUNWAY.z) < RUNWAY.width / 2 - 2 &&
    Math.abs(p.pos[0] - RUNWAY.x) < RUNWAY.length / 2;
  // Lift-off: pull up with enough speed and the wheels leave the ground.
  if (p.onGround && input.pitch > 0.3 && p.speed > 42) {
    p.onGround = false;
    p.pos[1] = ground + 1.6;
    return 'flying';
  }
  // While on the ground the plane taxis on its wheels: it stays glued to
  // the surface instead of being treated as a stalled aircraft in the air
  // (a parked plane is not flying, so the stall sink must not apply).
  // Running off the strip at speed is a crash; creeping off it is not.
  if (p.onGround) {
    if (!overRunway && p.speed > 25) return 'crashed';
    p.pos[1] = ground + 1.4;
    return 'flying';
  }
  if (p.pos[1] <= ground + 1.4) {
    if (ground < 30) return 'ditched'; // into the lake
    const gentle =
      p.speed < 58 && Math.abs(p.pitch) < 10 && vy > -7 && Math.abs(p.roll) < 18;
    if (overRunway && gentle && mode !== 'free') {
      p.pos[1] = ground + 1.4;
      p.onGround = true;
      return 'landed';
    }
    if (overRunway && gentle && mode === 'free') {
      p.pos[1] = ground + 1.4;
      p.onGround = true;
      p.speed = Math.max(0, p.speed - 30 * dt);
      return 'flying';
    }
    return 'crashed';
  }
  p.onGround = false;
  return 'flying';
}

export function ringHit(p, ring) {
  const dx = p.pos[0] - ring.x;
  const dy = p.pos[1] - ring.y;
  const dz = p.pos[2] - ring.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) < ring.r;
}

export function nextRingTarget(ringIndex) {
  return RINGS[ringIndex] || null;
}

export function distanceTo(p, target) {
  if (!target) return 0;
  return Math.hypot(p.pos[0] - target.x, p.pos[1] - target.y, p.pos[2] - target.z);
}
