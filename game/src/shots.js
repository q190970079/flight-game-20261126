// Screenshot staging: fixed moments of the real game, driven by ?shot=.
// Each preset puts the live game (same physics, same renderer, same HUD)
// at a chosen point of a flight so the entry's screenshots are real renders
// of the game's own code, not composites.

import { RUNWAY, RINGS } from './config.js';
import { terrainHeight } from './terrain.js';

const SHOTS = {
  // Lifting off runway 09 at full throttle, mountains ahead.
  takeoff(state, world) {
    state.mode = 'rings';
    state.screen = 'flying';
    state.ringIndex = 0;
    world.ringIndex = 0;
    state.score = 0;
    state.elapsed = 8;
    const p = state.plane;
    p.pos = [-200, RUNWAY.groundY + 12, RUNWAY.z];
    p.yaw = 90;
    p.pitch = 6;
    p.roll = 0;
    p.speed = 58;
    p.throttle = 1.0;
    p.fuel = 100;
    p.onGround = false;
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('screen-title').classList.add('hidden');
  },
  // Mid-flight: chasing ring 3 over the ridge, HUD lit, ring dead ahead.
  rings(state, world) {
    state.mode = 'rings';
    state.screen = 'flying';
    state.ringIndex = 2;
    world.ringIndex = 2;
    state.score = 200;
    state.elapsed = 74;
    const p = state.plane;
    p.pos = [1355, 219, -510];
    p.yaw = 17;
    p.pitch = 2;
    p.roll = -8;
    p.speed = 82;
    p.throttle = 0.85;
    p.fuel = 71;
    p.onGround = false;
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('screen-title').classList.add('hidden');
  },
  // Low pass over the lake, runway 09 ahead in the distance.
  lake(state, world) {
    state.mode = 'rings';
    state.screen = 'flying';
    state.ringIndex = 4;
    world.ringIndex = 4;
    state.score = 400;
    state.elapsed = 148;
    const p = state.plane;
    p.pos = [-1750, 110, -900];
    p.yaw = 90;
    p.pitch = -1;
    p.roll = 0;
    p.speed = 80;
    p.throttle = 0.9;
    p.fuel = 58;
    p.onGround = false;
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('screen-title').classList.add('hidden');
  },
  // Final approach: low over the threshold, gear-down mindset, runway filling
  // the view, all eight rings already cleared.
  landing(state, world) {
    state.mode = 'rings';
    state.screen = 'flying';
    state.ringIndex = 8;
    world.ringIndex = 8;
    state.score = 800;
    state.elapsed = 312;
    const p = state.plane;
    p.pos = [-480, 82, 420];
    p.yaw = 90;
    p.pitch = -3;
    p.roll = 0;
    p.speed = 52;
    p.throttle = 0.35;
    p.fuel = 34;
    p.onGround = false;
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('screen-title').classList.add('hidden');
  },
};

export function applyShot(state, world, resetRun) {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (!shot || !SHOTS[shot]) return;
  // The staged plane must sit above the terrain, never inside it.
  SHOTS[shot](state, world, resetRun);
  const p = state.plane.pos;
  const ground = terrainHeight(p[0], p[2]);
  if (p[1] < ground + 12) p[1] = ground + 12;
}
