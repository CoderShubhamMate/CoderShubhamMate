
#!/usr/bin/env node
/**
 * Contribution Snake GAME generator (zero dependencies, Node 18+)
 *
 * Rules
 *  - Every day with contributions is food.
 *  - Days with "a lot" of contributions turn into 3D rotating STARS.
 *  - Eating normal food  -> snake grows by GROW_NORMAL (default 1)
 *  - Eating a star       -> snake grows by GROW_STAR   (default 2x normal)
 *  - The snake sweeps the grid column by column, so it never hits itself.
 *
 * Env vars (all optional except GH_USER + GITHUB_TOKEN, unless MOCK=1)
 *   GH_USER, GITHUB_TOKEN      who to fetch / auth for the GraphQL API
 *   STAR_MIN                   min contributions/day to become a star (default: auto, top ~15% of active days, at least 3)
 *   GROW_NORMAL, GROW_STAR     growth per food (default 1 / 2)
 *   MAX_SNAKE_LENGTH           visual cap on snake length (default 40)
 *   STEP_SECONDS               seconds per grid step (default 0.09)
 *   OUT_DIR                    output folder (default dist)
 *   MOCK=1                     use random fake data (for local preview)
 */
import { mkdir, writeFile } from "node:fs/promises";

const env = process.env;
const USER = env.GH_USER || env.GITHUB_REPOSITORY_OWNER || "";
const TOKEN = env.GITHUB_TOKEN || env.GH_TOKEN || "";
const OUT_DIR = env.OUT_DIR || "dist";
const STEP = Number(env.STEP_SECONDS || 0.09);
const MAX_LEN = Math.max(2, Number(env.MAX_SNAKE_LENGTH || 40));
const GROW_NORMAL = Number(env.GROW_NORMAL || 1);
const GROW_STAR = Number(env.GROW_STAR || GROW_NORMAL * 2);

/* ------------------------------------------------------------------ data */

async function fetchCalendar() {
  if (env.MOCK === "1") return mockCalendar();
  if (!USER || !TOKEN) throw new Error("GH_USER and GITHUB_TOKEN are required (or set MOCK=1).");

  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{
    totalContributions weeks{contributionDays{date contributionCount contributionLevel weekday}}}}}}`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "contribution-snake-game",
    },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GitHub API error: ${JSON.stringify(json.errors)}`);

  const cal = json.data.user.contributionsCollection.contributionCalendar;
  const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
  return {
    total: cal.totalContributions,
    weeks: cal.weeks.map((w) =>
      w.contributionDays.map((d) => ({
        date: d.date,
        row: d.weekday,
        count: d.contributionCount,
        level: LEVEL[d.contributionLevel] ?? 0,
      }))
    ),
  };
}

function mockCalendar() {
  let s = 42;
  const rnd = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const weeks = [];
  let total = 0;
  for (let c = 0; c < 53; c++) {
    const days = [];
    const n = c === 52 ? 3 : 7;
    for (let r = 0; r < n; r++) {
      const active = rnd() < (c > 30 ? 0.6 : 0.35);
      let count = active ? 1 + Math.floor(rnd() ** 2 * 14) : 0;
      if (rnd() < 0.03) count += 15;
      total += count;
      days.push({ row: r, count, level: count === 0 ? 0 : count < 4 ? 1 : count < 8 ? 2 : count < 12 ? 3 : 4 });
    }
    weeks.push(days);
  }
  return { total, weeks };
}

function starThreshold(days) {
  if (env.STAR_MIN) return Number(env.STAR_MIN);
  const counts = days.filter((d) => d.count > 0).map((d) => d.count).sort((a, b) => a - b);
  if (!counts.length) return Infinity;
  const p85 = counts[Math.min(counts.length - 1, Math.floor(counts.length * 0.85))];
  return Math.max(3, p85);
}

/* ------------------------------------------------------------------ game */

const { total, weeks } = await fetchCalendar();
const W = weeks.length;
const grid = weeks.map((days) => {
  const col = [];
  for (const d of days) col[d.row] = d;
  return col;
});
const allDays = weeks.flat();
const STAR_MIN = starThreshold(allDays);
for (const d of allDays) d.star = d.count > 0 && d.count >= STAR_MIN;
const starCount = allDays.filter((d) => d.star).length;
const cellAt = (p) => grid[p.c]?.[p.r];

// Column-by-column zig-zag route (down, up, down, ...). Never self-intersects.
let path = [];
for (let c = 0; c < W; c++) {
  const rows = c % 2 === 0 ? [0, 1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1, 0];
  for (const r of rows) path.push({ c, r });
}
while (path.length && !cellAt(path[0])) path.shift();
let lastFood = path.map((p) => (cellAt(p)?.count ?? 0) > 0).lastIndexOf(true);
if (lastFood < 0) lastFood = Math.min(path.length - 1, 10);
path = path.slice(0, lastFood + 1);
const N = path.length;
if (N < 2) throw new Error("Not enough contribution data to build a game.");

// Simulate: head position = path[k]; body = path[k], path[k-1], ... (length L[k]).
// Eating at step k queues growth; the tail stays put for the next steps (1 segment/step).
const L = new Array(N);
const eatStep = new Map();
let len = 1, pending = 0;
for (let k = 0; k < N; k++) {
  if (k > 0 && pending > 0 && len < MAX_LEN) { len++; pending--; }
  const cell = cellAt(path[k]);
  if (cell && cell.count > 0) {
    pending += cell.star ? GROW_STAR : GROW_NORMAL;
    eatStep.set(cell, k);
  }
  if (len >= MAX_LEN) pending = 0;
  L[k] = len;
}
const T = []; // T[i] = first step at which segment i exists
for (let k = 0; k < N; k++) for (let i = T.length; i < L[k]; i++) T[i] = k;
const maxL = L[N - 1];

/* -------------------------------------------------------------- rendering */

const CELL = 12, GAP = 3, PITCH = CELL + GAP, PAD = 20, TOP = 44, BOTTOM = 36;
const gridW = W * PITCH - GAP, gridH = 7 * PITCH - GAP;
const WIDTH = PAD * 2 + gridW, HEIGHT = TOP + gridH + BOTTOM;
const cx = (c) => PAD + c * PITCH + CELL / 2;
const cy = (r) => TOP + r * PITCH + CELL / 2;

// loop length: whole run + time for the tail to drain + a short pause
const P = (N - 1 + maxL + 25) * STEP;
const pct = (t) => (t / P) * 100;
const num = (v) => +v.toFixed(4);
const pf = (v) => `${num(v)}%`;
const E = 0.0005;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const A = hex(a), B = hex(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

const PALETTES = {
  dark: {
    empty: "#161b22", levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    text: "#8b949e", head: "#d2a8ff", tail: "#6e40c9",
    starFront: "#ffe066", starEdge: "#b8860b", starBack: "#8a6508", ring: "#ffd33d", bar: "#a371f7",
  },
  light: {
    empty: "#ebedf0", levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    text: "#57606a", head: "#6639ba", tail: "#b392f0",
    starFront: "#ffcc00", starEdge: "#c28a00", starBack: "#8f6400", ring: "#e0a800", bar: "#8250df",
  },
};

function starPoints(R = 1, r = 0.46) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${num(Math.cos(a) * rad)},${num(Math.sin(a) * rad)}`);
  }
  return pts.join(" ");
}

// opacity 1 only between a% and b% of the loop
function windowKF(name, a, b) {
  const s = [];
  if (a <= 0) s.push("0%{opacity:1}");
  else s.push(`0%,${pf(a - E)}{opacity:0}`, `${pf(a)}{opacity:1}`);
  if (b >= 100) s.push("100%{opacity:1}");
  else s.push(`${pf(b)}{opacity:1}`, `${pf(b + E)},100%{opacity:0}`);
  return `@keyframes ${name}{${s.join("")}}`;
}

// visible, then fades out just as the head arrives
function eatKF(name, tEat) {
  const b = pct(tEat), a = Math.max(0, pct(tEat - STEP * 0.6));
  return `@keyframes ${name}{0%${a > 0 ? "," + pf(a) : ""}{opacity:1}${pf(b)},100%{opacity:0}}`;
}

// expanding ring when a star is eaten
function burstKF(name, tEat) {
  const a = pct(tEat), b = pct(tEat + 0.5);
  return `@keyframes ${name}{0%,${pf(a)}{opacity:0;transform:scale(.5)}${pf(a + E)}{opacity:.95;transform:scale(.5)}${pf(b)},100%{opacity:0;transform:scale(2.8)}}`;
}

function buildSvg(pal) {
  const css = [];
  const body = [];

  // --- shared css
  css.push(
    `text{font:600 11px -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;fill:${pal.text}}`,
    `.s,.e,.n,.sp,.b,.pb{animation-iteration-count:infinite;animation-timing-function:linear}`,
    `.s,.e,.n,.b,.pb{animation-duration:${num(P)}s}`,
    `.s{animation-fill-mode:both}`,
    `.n{opacity:0}`,
    `.sp{animation-duration:2.8s}`,
    `.b{opacity:0;transform-box:fill-box;transform-origin:center}`,
    `.pb{transform-box:fill-box;transform-origin:left center;animation-name:pg}`
  );

  // --- snake head path (only keep corners; linear interpolation does the rest)
  const mv = [];
  for (let k = 0; k < N; k++) {
    let keep = k === 0 || k === N - 1;
    if (!keep) {
      const a = path[k - 1], b = path[k], c = path[k + 1];
      keep = b.c - a.c !== c.c - b.c || b.r - a.r !== c.r - b.r;
    }
    if (keep) mv.push(`${pf(pct(k * STEP))}{transform:translate(${cx(path[k].c)}px,${cy(path[k].r)}px)}`);
  }
  mv.push(`100%{transform:translate(${cx(path[N - 1].c)}px,${cy(path[N - 1].r)}px)}`);
  css.push(`@keyframes mv{${mv.join("")}}`);

  // --- 3D star spin: stacked slabs offset by sin(theta), squashed by cos(theta)
  const SAMPLES = 24, DEPTH = 0.16, Z = [-1, -0.33, 0.33, 1];
  Z.forEach((z, li) => {
    const stops = [];
    for (let j = 0; j <= SAMPLES; j++) {
      const th = (j / SAMPLES) * 2 * Math.PI;
      const cs = Math.cos(th);
      const sx = Math.abs(cs) < 0.02 ? 0.02 * Math.sign(cs || 1) : cs;
      stops.push(`${pf((j / SAMPLES) * 100)}{transform:translateX(${num(z * DEPTH * Math.sin(th))}px) scaleX(${num(sx)})}`);
    }
    css.push(`@keyframes sp${li}{${stops.join("")}}`);
  });
  const layerFill = [pal.starBack, pal.starEdge, pal.starEdge, pal.starFront];
  const starPts = starPoints();
  const starR = CELL * 0.62;

  // --- empty grid
  for (let c = 0; c < W; c++)
    for (let r = 0; r < 7; r++)
      if (grid[c]?.[r])
        body.push(`<rect x="${PAD + c * PITCH}" y="${TOP + r * PITCH}" width="${CELL}" height="${CELL}" rx="2" fill="${pal.empty}"/>`);

  // --- food + stars
  let id = 0, starIdx = 0;
  const rings = [];
  for (const [cell, k] of eatStep) {
    const c = weeks.findIndex((w) => w.includes(cell));
    const x = PAD + c * PITCH, y = TOP + cell.row * PITCH;
    const name = `k${id}`;
    css.push(eatKF(name, k * STEP));
    if (cell.star) {
      const X = x + CELL / 2, Y = y + CELL / 2;
      const delay = -((starIdx * 0.37) % 2.8);
      const faces = Z.map(
        (_, li) => `<polygon class="sp" points="${starPts}" fill="${layerFill[li]}" style="animation-name:sp${li};animation-delay:${num(delay)}s"/>`
      ).join("");
      body.push(`<g class="e" style="animation-name:${name}" transform="translate(${X},${Y}) scale(${num(starR)})">${faces}</g>`);
      css.push(burstKF(`b${id}`, k * STEP));
      rings.push(`<circle class="b" style="animation-name:b${id}" cx="${X}" cy="${Y}" r="${CELL * 0.6}" fill="none" stroke="${pal.ring}" stroke-width="2"/>`);
      starIdx++;
    } else {
      body.push(`<rect class="e" style="animation-name:${name}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${pal.levels[cell.level || 1]}"/>`);
    }
    id++;
  }
  body.push(...rings);

  // --- snake (all segments share the same path, delayed by i steps)
  for (let i = maxL - 1; i >= 0; i--) {
    const size = i === 0 ? CELL + 1 : Math.max(6, CELL - 1 - i * 0.15);
    const col = mix(pal.head, pal.tail, maxL > 1 ? i / (maxL - 1) : 0);
    css.push(windowKF(`o${i}`, pct((T[i] - i) * STEP), pct((N - 1) * STEP)));
    body.push(
      `<rect class="s" x="${num(-size / 2)}" y="${num(-size / 2)}" width="${num(size)}" height="${num(size)}" rx="${num(size * 0.32)}" fill="${col}" style="animation-name:mv,o${i};animation-delay:${num(i * STEP)}s"/>`
    );
  }

  // --- HUD: stats (static) + live length counter + progress bar
  body.push(`<text x="${PAD}" y="26">${total} contributions  ·  ★ = days with ${STAR_MIN === Infinity ? "-" : STAR_MIN}+ (grow x${GROW_STAR / GROW_NORMAL})  ·  ${starCount} stars</text>`);
  body.push(`<text x="${WIDTH - PAD - 30}" y="26" text-anchor="end">SNAKE LENGTH</text>`);
  for (let n = 1; n <= maxL; n++) {
    css.push(windowKF(`l${n}`, n === 1 ? 0 : pct(T[n - 1] * STEP), n < maxL ? pct(T[n] * STEP) : 100));
    body.push(`<text class="n" style="animation-name:l${n}" x="${WIDTH - PAD - 24}" y="26" fill="${pal.ring}">${n}</text>`);
  }
  const barY = TOP + gridH + 16;
  css.push(`@keyframes pg{0%{transform:scaleX(.001)}${pf(pct((N - 1) * STEP))}{transform:scaleX(1)}100%{transform:scaleX(1)}}`);
  body.push(`<rect x="${PAD}" y="${barY}" width="${gridW}" height="4" rx="2" fill="${pal.empty}"/>`);
  body.push(`<rect class="pb" x="${PAD}" y="${barY}" width="${gridW}" height="4" rx="2" fill="${pal.bar}"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">
<title>Contribution Snake Game</title>
<style>${css.join("")}</style>
${body.join("\n")}
</svg>
`;
}

/* ------------------------------------------------------------------ main */

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/github-contribution-grid-snake.svg`, buildSvg(PALETTES.light));
await writeFile(`${OUT_DIR}/github-contribution-grid-snake-dark.svg`, buildSvg(PALETTES.dark));

console.log(
  `Snake game built: ${eatStep.size} food (${starCount} stars, threshold ${STAR_MIN}), ` +
    `route ${N} steps, max length ${maxL}, loop ${P.toFixed(1)}s -> ${OUT_DIR}/`
);
