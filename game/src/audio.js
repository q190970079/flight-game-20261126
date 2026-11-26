// Procedural sound: engine hum, wind, ring chime, touchdown and crash.
// Everything is synthesised with WebAudio; the game ships no audio files.
// The context only starts after a real user gesture, so muted screenshots
// and headless runs stay silent.

export function makeAudio() {
  return {
    ctx: null,
    muted: false,
    engineOsc: null,
    engineGain: null,
    windGain: null,
    windFilter: null,
  };
}

function ensure(a) {
  if (a.ctx) return true;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    a.ctx = new Ctx();
    // Engine: two detuned saws through a low-pass, gain follows throttle.
    a.engineOsc = a.ctx.createOscillator();
    a.engineOsc.type = 'sawtooth';
    a.engineOsc.frequency.value = 62;
    const filter = a.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    a.engineGain = a.ctx.createGain();
    a.engineGain.gain.value = 0;
    a.engineOsc.connect(filter).connect(a.engineGain).connect(a.ctx.destination);
    a.engineOsc.start();
    // Wind: looped noise through a band-pass, gain follows airspeed.
    const len = a.ctx.sampleRate;
    const buf = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = a.ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    a.windFilter = a.ctx.createBiquadFilter();
    a.windFilter.type = 'bandpass';
    a.windFilter.frequency.value = 700;
    a.windGain = a.ctx.createGain();
    a.windGain.gain.value = 0;
    noise.connect(a.windFilter).connect(a.windGain).connect(a.ctx.destination);
    noise.start();
    return true;
  } catch {
    return false;
  }
}

export function unlockAudio(a) {
  if (ensure(a) && a.ctx.state === 'suspended') a.ctx.resume().catch(() => {});
}

export function updateEngineSound(a, throttle, speed, flying) {
  if (!a.ctx || a.muted) return;
  const t = a.ctx.currentTime;
  a.engineGain.gain.setTargetAtTime(flying ? 0.02 + throttle * 0.05 : 0, t, 0.1);
  a.engineOsc.frequency.setTargetAtTime(52 + throttle * 70 + speed * 0.25, t, 0.1);
  a.windGain.gain.setTargetAtTime(flying ? Math.min(0.09, speed * 0.0007) : 0, t, 0.15);
  a.windFilter.frequency.setTargetAtTime(400 + speed * 9, t, 0.2);
}

function blip(a, freq, when, dur, type = 'sine', vol = 0.16) {
  if (!a.ctx || a.muted) return;
  const osc = a.ctx.createOscillator();
  const gain = a.ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, a.ctx.currentTime + when);
  gain.gain.linearRampToValueAtTime(vol, a.ctx.currentTime + when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, a.ctx.currentTime + when + dur);
  osc.connect(gain).connect(a.ctx.destination);
  osc.start(a.ctx.currentTime + when);
  osc.stop(a.ctx.currentTime + when + dur + 0.05);
}

export function playRing(a) {
  blip(a, 880, 0, 0.35);
  blip(a, 1318, 0.09, 0.45);
}

export function playCrash(a) {
  blip(a, 70, 0, 0.7, 'sine', 0.4);
  blip(a, 48, 0.05, 0.8, 'triangle', 0.3);
}

export function playLand(a) {
  [523, 659, 784, 1046].forEach((f, i) => blip(a, f, i * 0.11, 0.4));
}
