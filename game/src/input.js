// Keyboard and mouse input. Arrows fly the plane, W/S work the throttle,
// Shift is boost, R restarts, P pauses, M mutes. The mouse steers too: hold
// the left button and move, or just move it — the offset from the centre of
// the screen banks and pitches gently.

export function makeInput() {
  return {
    keys: new Set(),
    pitch: 0, // -1..1, positive = climb
    roll: 0, // -1..1, positive = bank right
    throttleDelta: 0,
    boost: false,
    mouseX: 0,
    mouseY: 0,
    mouseActive: false,
    pressed: new Set(), // edge-triggered keys, consumed by the game
  };
}

export function attachInput(input, canvas) {
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (!e.repeat) input.pressed.add(e.code);
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => input.keys.clear());

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    input.mouseX = ((e.clientX - r.left) / r.width) * 2 - 1;
    input.mouseY = ((e.clientY - r.top) / r.height) * 2 - 1;
    input.mouseActive = true;
  });
  canvas.addEventListener('pointerleave', () => {
    input.mouseActive = false;
  });
}

// Recompute the analogue axes from the current keys and mouse each frame.
export function pollInput(input) {
  const k = input.keys;
  let pitch = 0;
  let roll = 0;
  if (k.has('ArrowUp')) pitch += 1;
  if (k.has('ArrowDown')) pitch -= 1;
  if (k.has('ArrowLeft')) roll -= 1;
  if (k.has('ArrowRight')) roll += 1;
  if (input.mouseActive) {
    // Mouse steers only when no arrow key is held, so the two never fight.
    if (pitch === 0) pitch += Math.max(-1, Math.min(1, -input.mouseY * 0.9));
    if (roll === 0) roll += Math.max(-1, Math.min(1, input.mouseX * 0.9));
  }
  input.pitch = pitch;
  input.roll = roll;
  let throttleDelta = 0;
  if (k.has('KeyW')) throttleDelta += 0.7;
  if (k.has('KeyS')) throttleDelta -= 0.7;
  input.throttleDelta = throttleDelta;
  input.boost = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('Space');
}

export function consumePress(input, code) {
  if (input.pressed.has(code)) {
    input.pressed.delete(code);
    return true;
  }
  return false;
}
