// HUD: digital instruments, fuel and throttle bars, ring tracker, messages
// and a small artificial horizon. All DOM, updated from the game state.

const M_PER_FT = 3.28084;
const MS_PER_KT = 1.94384;

export function makeHud() {
  const $ = (id) => document.getElementById(id);
  return {
    alt: $('hud-alt'),
    spd: $('hud-spd'),
    hdg: $('hud-hdg'),
    fuel: $('hud-fuel-fill'),
    fuelText: $('hud-fuel-text'),
    throttle: $('hud-thr-fill'),
    ring: $('hud-ring'),
    score: $('hud-score'),
    time: $('hud-time'),
    msg: $('hud-msg'),
    mode: $('hud-mode'),
    horizon: $('hud-horizon'),
  };
}

function compass(deg) {
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return `${String(Math.round(deg)).padStart(3, '0')}° ${pts[i]}`;
}

export function updateHud(hud, s) {
  const altFt = Math.max(0, Math.round((s.plane.pos[1] - 34) * M_PER_FT));
  hud.alt.textContent = `${altFt.toLocaleString('en-US')} ft`;
  hud.spd.textContent = `${Math.round(s.plane.speed * MS_PER_KT)} kt`;
  hud.hdg.textContent = compass(s.plane.yaw);
  hud.fuel.style.width = `${Math.max(0, s.plane.fuel)}%`;
  hud.fuel.classList.toggle('low', s.plane.fuel < 25);
  hud.fuelText.textContent = `FUEL ${Math.round(s.plane.fuel)}%`;
  hud.throttle.style.width = `${Math.round(s.plane.throttle * 100)}%`;
  hud.score.textContent = `SCORE ${s.score}`;
  const t = Math.floor(s.elapsed);
  hud.time.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  if (s.mode === 'rings') {
    if (s.ringIndex < s.ringCount) {
      hud.ring.textContent = `RING ${s.ringIndex + 1}/${s.ringCount} · ${Math.round(s.nextRingDist)} m`;
    } else {
      hud.ring.textContent = 'ALL RINGS CLEAR — LAND ON RUNWAY 09';
    }
  } else {
    hud.ring.textContent = 'FREE FLIGHT — LAND ANY TIME';
  }
  drawHorizon(hud.horizon, s.plane.pitch, s.plane.roll);
}

function drawHorizon(canvas, pitch, roll) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-roll * Math.PI) / 180);
  const dy = (pitch / 24) * (h / 2);
  ctx.fillStyle = '#2f6fb8';
  ctx.fillRect(-w, -h + dy, w * 2, h);
  ctx.fillStyle = '#8a6b46';
  ctx.fillRect(-w, dy, w * 2, h);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w, dy);
  ctx.lineTo(w, dy);
  ctx.stroke();
  ctx.restore();
  // Fixed wings marker.
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 26, h / 2);
  ctx.lineTo(w / 2 - 8, h / 2);
  ctx.moveTo(w / 2 + 8, h / 2);
  ctx.lineTo(w / 2 + 26, h / 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();
}

let msgTimer = 0;
export function showMessage(hud, text, seconds = 2.5) {
  hud.msg.textContent = text;
  hud.msg.classList.add('show');
  msgTimer = seconds;
}

export function tickMessage(hud, dt) {
  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) hud.msg.classList.remove('show');
  }
}
