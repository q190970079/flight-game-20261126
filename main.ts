// Alpine Courier — hand-in program (Node 22, standard library only).
//
// The game is plain static files under game/ (index.html plus ES modules,
// no build step, no network request) and 3 or 4 screenshots under
// screenshots/. This program copies both into /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library. Outside the grader, MAKEFUN_OUTPUT_DIR stands in for
// /output:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fail loudly instead of handing in a broken entry: the game and at least
// one screenshot must exist, and no screenshot may exceed the scorer's
// 256 KiB cap — buildDossier would refuse them anyway, but only after the
// copy, and a silent missing screenshots/ is worse than a loud failure.
if (!existsSync(join(here, 'game', 'index.html'))) {
  throw new Error('game/index.html is missing — nothing to hand in');
}
const shotsDir = join(here, 'screenshots');
if (!existsSync(shotsDir) || readdirSync(shotsDir).length === 0) {
  throw new Error('screenshots/ is empty — take the screenshots first');
}
for (const name of readdirSync(shotsDir)) {
  const size = statSync(join(shotsDir, name)).size;
  if (size > 262144) {
    throw new Error(`${name} is ${size} bytes — over the 256 KiB screenshot cap`);
  }
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes
// the bytes; the others refuse an entry the scorer would refuse (more than
// 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB
// of game files, in all, or a path under game/ over 1000 bytes).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
