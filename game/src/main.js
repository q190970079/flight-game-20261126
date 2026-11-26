// Alpine Courier — game loop, states, camera, scoring and screenshot staging.
// States: title → flying → paused / crashed / landed / complete.

import { RINGS, RUNWAY } from './config.js';
import { buildTerrain, buildTrees, buildWater, terrainHeight } from './terrain.js';
import { Renderer } from './render.js';
import {
  makePlaneState,
  planeBasis,
  stepFlight,
  ringHit,
  nextRingTarget,
  distanceTo,
} from './physics.js';
import { makeInput, attachInput, pollInput, consumePress } from './input.js';
import { makeHud, updateHud, showMessage, tickMessage } from './hud.js';
import {
  makeAudio,
  unlockAudio,
  updateEngineSound,
  playRing,
  playCrash,
  playLand,
} from './audio.js';
import { applyShot } from './shots.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const hud = makeHud();
const input = makeInput();
const audio = makeAudio();
attachInput(input, canvas);

const world = {
  terrain: [...buildTerrain(), ...buildWater()],
  trees: buildTrees(),
  rings: RINGS.map((r, i) => ({ ...r, label: i + 1 })),
  ringIndex: 0,
};

const state = {
  mode: 'rings',
  screen: 'title',
  plane: makePlaneState(),
  ringIndex: 0,
  ringCount: RINGS.length,
  score: 0,
  elapsed: 0,
  nextRingDist: 0,
  touchdown: false,
  best: Number(window.localStorage.getItem('alpine-courier-best') || 0),
  startedAt: 0,
};

let camEye = [0, 120, 900];
let camTarget = [0, 60, 0];
let frames = 0;
let shotReadyAt = 0;

function resetRun(mode) {
  state.mode = mode;
  state.screen = 'flying';
  state.plane = makePlaneState();
  state.plane.throttle = 0.55;
  state.ringIndex = 0;
  state.score = 0;
  state.elapsed = 0;
  state.touchdown = false;
  state.startedAt = performance.now();
  world.ringIndex = 0;
  document.getElementById('screen-title').classList.add('hidden');
  document.getElementById('screen-end').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  showMessage(hud, mode === 'rings' ? 'FLY THROUGH RING 1 — THEN LAND ON 09' : 'FREE FLIGHT — ENJOY THE VALLEY', 4);
  unlockAudio(audio);
}

function endRun(title, lines, score) {
  state.screen = title === 'CRASHED' || title === 'DITCHED' ? 'crashed' : 'landed';
  if (title === 'COURSE COMPLETE') state.screen = 'complete';
  const end = document.getElementById('screen-end');
  document.getElementById('end-title').textContent = title;
  document.getElementById('end-lines').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  document.getElementById('end-score').textContent = `SCORE ${score}`;
  end.classList.remove('hidden');
  if (score > state.best) {
    state.best = score;
    window.localStorage.setItem('alpine-courier-best', String(score));
  }
  document.getElementById('end-best').textContent = `BEST ${state.best}`;
}

function completeCourse() {
  const timeBonus = Math.max(0, 900 - Math.floor(state.elapsed)) ;
  const fuelBonus = Math.round(state.plane.fuel) * 2;
  const total = state.score + 500 + timeBonus + fuelBonus;
  state.score = total;
  playLand(audio);
  endRun('COURSE COMPLETE', [
    `All ${state.ringCount} rings flown, wheels down on runway 09.`,
    `Landing bonus +500 · time bonus +${timeBonus} · fuel bonus +${fuelBonus}`,
    `Time ${formatTime(state.elapsed)} · fuel ${Math.round(state.plane.fuel)}% left`,
  ], total);
}

function formatTime(s) {
  const t = Math.floor(s);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function step(dt, now) {
  pollInput(input);
  if (consumePress(input, 'KeyM')) {
    audio.muted = !audio.muted;
    showMessage(hud, audio.muted ? 'SOUND OFF' : 'SOUND ON', 1.5);
  }
  if (consumePress(input, 'KeyR') && state.screen !== 'title') resetRun(state.mode);

  if (state.screen === 'title') {
    if (
      consumePress(input, 'Enter') ||
      consumePress(input, 'Space')
    ) {
      resetRun('rings');
    }
    // Slow orbit around the parked plane for the title backdrop.
    const t = now / 1000;
    const p = state.plane.pos;
    camEye = [
      p[0] + Math.cos(t * 0.12) * 42,
      p[1] + 12 + Math.sin(t * 0.2) * 2,
      p[2] + Math.sin(t * 0.12) * 42,
    ];
    camTarget = [p[0] + 6, p[1] + 2, p[2]];
    return;
  }

  if (state.screen === 'flying') {
    if (consumePress(input, 'KeyP')) {
      state.screen = 'paused';
      showMessage(hud, 'PAUSED — P TO RESUME', 60);
      return;
    }
    state.elapsed += dt;
    const result = stepFlight(state.plane, input, dt, state.mode);
    if (result === 'crashed' || result === 'ditched') {
      playCrash(audio);
      endRun(
        result === 'ditched' ? 'DITCHED IN THE LAKE' : 'CRASHED',
        [
          result === 'ditched'
            ? 'The courier went swimming. The lake is cold and the cargo is wet.'
            : 'Terrain 1, courier 0. Watch your altitude over the ridges.',
          `Rings cleared ${state.ringIndex}/${state.ringCount} · time ${formatTime(state.elapsed)}`,
        ],
        state.score,
      );
      return;
    }
    if (result === 'landed') {
      if (state.mode === 'rings' && state.ringIndex >= state.ringCount) {
        completeCourse();
        return;
      }
      if (!state.touchdown) {
        state.touchdown = true;
        showMessage(hud, 'TOUCHDOWN — THROTTLE UP AND PULL UP TO GO AGAIN', 4);
      }
    } else {
      state.touchdown = false;
    }
    // Rings.
    const target = nextRingTarget(state.ringIndex);
    if (target && state.mode === 'rings') {
      state.nextRingDist = distanceTo(state.plane, target);
      if (ringHit(state.plane, target)) {
        state.ringIndex += 1;
        world.ringIndex = state.ringIndex;
        state.score += 100;
        state.plane.fuel = Math.min(100, state.plane.fuel + 12);
        playRing(audio);
        if (state.ringIndex < state.ringCount) {
          showMessage(hud, `RING ${state.ringIndex} CLEAR! +100 · NEXT RING AHEAD`, 2.5);
        } else {
          showMessage(hud, 'ALL RINGS CLEAR! BRING HER HOME — LAND ON RUNWAY 09', 4);
        }
      }
    }
    if (state.plane.fuel <= 0 && state.plane.speed < 30 && state.plane.pos[1] < terrainHeight(state.plane.pos[0], state.plane.pos[2]) + 30) {
      showMessage(hud, 'OUT OF FUEL — GLIDING', 2);
    }
    updateEngineSound(audio, state.plane.throttle, state.plane.speed, true);
    tickMessage(hud, dt);
  } else if (state.screen === 'paused') {
    if (consumePress(input, 'KeyP')) {
      state.screen = 'flying';
      showMessage(hud, 'RESUMED', 1.5);
    }
    updateEngineSound(audio, 0, 0, false);
    return;
  } else {
    updateEngineSound(audio, 0, 0, false);
  }

  // Chase camera, smoothed so it never fights the pilot: close enough that
  // the courier fills the frame, offset slightly to the side so its 3D shape
  // reads instead of a flat silhouette from dead behind.
  const basis = planeBasis(state.plane);
  const p = state.plane.pos;
  const desiredEye = [
    p[0] - basis.fwd[0] * 17 + basis.up[0] * 5.5 + basis.right[0] * 3.5,
    p[1] - basis.fwd[1] * 17 + basis.up[1] * 5.5 + basis.right[1] * 3.5,
    p[2] - basis.fwd[2] * 17 + basis.up[2] * 5.5 + basis.right[2] * 3.5,
  ];
  const desiredTarget = [
    p[0] + basis.fwd[0] * 30,
    p[1] + basis.fwd[1] * 30 + 1,
    p[2] + basis.fwd[2] * 30,
  ];
  const k = 1 - Math.exp(-6 * dt);
  for (let i = 0; i < 3; i += 1) {
    camEye[i] += (desiredEye[i] - camEye[i]) * k;
    camTarget[i] += (desiredTarget[i] - camTarget[i]) * k;
  }
  updateHud(hud, state);
}

function frame(now) {
  const dt = Math.min(0.05, (now - (frame.last || now)) / 1000 || 0.016);
  frame.last = now;
  step(dt, now);
  const cam = renderer.camera(camEye, camTarget);
  const plane = {
    pos: state.plane.pos,
    basis: planeBasis(state.plane),
    propAngle: state.plane.propAngle,
    visible: true,
  };
  renderer.draw(cam, world, plane, now / 1000);
  frames += 1;
  if (frames === 3) shotReadyAt = now + 1400;
  if (shotReadyAt && now >= shotReadyAt && !window.__shotReady) {
    window.__shotReady = true;
  }
  requestAnimationFrame(frame);
}

function resize() {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

// Buttons.
document.getElementById('btn-rings').addEventListener('click', () => resetRun('rings'));
document.getElementById('btn-free').addEventListener('click', () => resetRun('free'));
document.getElementById('btn-again').addEventListener('click', () => resetRun(state.mode));
document.getElementById('btn-title').addEventListener('click', () => {
  state.screen = 'title';
  state.plane = makePlaneState();
  document.getElementById('screen-end').classList.add('hidden');
  document.getElementById('screen-title').classList.remove('hidden');
  document.getElementById('hud').classList.add('hidden');
});
document.getElementById('best-line').textContent =
  state.best > 0 ? `Best score ${state.best}` : 'First flight? Rings pay 100 each. Land it clean.';

// Screenshot staging: ?shot=takeoff|rings|lake|landing renders a fixed moment
// of the real game for the entry's screenshots.
applyShot(state, world, resetRun);

window.__game = { state, world };
requestAnimationFrame(frame);
