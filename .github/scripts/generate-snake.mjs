/**
 * Contribution Snake GAME generator (zero dependencies, Node 18+)
 *
 * Rules
 *  - Every day with contributions is food.
 *  - The snake eats from the LOWEST contribution count upwards:
 *    first the 1s, then a little higher, then higher ... stars last.
 *  - Days with "a lot" of contributions are 3D rotating STARS.
 *  - Eating normal food -> snake grows by GROW_NORMAL (default 1)
 *  - Eating a star      -> snake grows by GROW_STAR   (default 2x normal)
 *  - The snake never runs into itself (path-finding around its own body).
 *  - Finale: the snake bursts into pieces that scatter over the grid, the
 *    TOTAL contribution count pops up, then everything restarts.
 *
 * Env vars (all optional except GH_USER + GITHUB_TOKEN, unless MOCK=1)
 *   GH_USER, GITHUB_TOKEN   who to fetch / auth for the GraphQL API
 *   STAR_MIN                min contributions/day to become a star (default: auto, top ~15% of active days, at least 3)
 *   GROW_NORMAL, GROW_STAR  growth per food (default 1 / 2)
 *   MAX_SNAKE_LENGTH        cap on snake length (default 30)
 *   TARGET_SECONDS          aim for the eating phase to last about this long (default 35)
 *   STEP_SECONDS            force seconds per grid step (overrides TARGET_SECONDS)
 *   OUT_DIR                 output folder (default dist)
 *   MOCK=1                  use random fake data (for local preview)
 */
import { mkdir, writeFile } from "node:fs/promises";

const env = process.env;
const USER = env.GH_USER || env.GITHUB_REPOSITORY_OWNER || "";
const TOKEN = env.GITHUB_TOKEN || env.GH_TOKEN || "";
const OUT_DIR = env.OUT_DIR || "dist";
const MAX_LEN = Math.max(2, Number(env.MAX_SNAKE_LENGTH || 30));
const GROW_NORMAL = Number(env.GROW_NORMAL || 1);
const GROW_STAR = Number(env.GROW_STAR || GROW_NORMAL * 2);
const TARGET_SECONDS = Number(env.TARGET_SECONDS || 35);

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

function mulberry(seed) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockCalendar() {
  const rnd = mulberry(42);
  const weeks = [];
  let total = 0;
  for (let c = 0; c < 53; c++) {
    const days = [];
    const n = c === 52 ? 3 : 7;
    for (let r = 0; r < n; r++) {
      const active = rnd() < (c > 30 ? 0.6 : 0.35) * Number(env.MOCK_DENSITY || 1);
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
const grid = weeks.map((days, c) => {
  const col = [];
  for (const d of days) { d.c = c; col[d.row] = d; }
  return col;
});
const allDays = weeks.flat();
const STAR_MIN = starThreshold(allDays);
for (const d of allDays) d.star = d.count > 0 && d.count >= STAR_MIN;
const starCount = allDays.filter((d) => d.star).length;

// Food sorted from the lowest contribution count upwards, then split into
// buckets ("lowest", "a little higher", "higher", ...). A count is never split
// across two buckets. Inside a bucket the snake always goes for the nearest food.
const foods = allDays
  .filter((d) => d.count > 0)
  .sort((a, b) => a.count - b.count || a.c - b.c || a.row - b.row);
if (foods.length < 2) throw new Error("Not enough contribution data to build a game.");
const BUCKET_MIN = Math.max(4, Math.ceil(foods.length / Number(env.BUCKET_DIV || 12)));
const buckets = [];
{
  let cur = [];
  for (let i = 0; i < foods.length; i++) {
    cur.push(foods[i]);
    const next = foods[i + 1];
    if (!next || (cur.length >= BUCKET_MIN && next.count !== foods[i].count)) { buckets.push(cur); cur = []; }
  }
}

/* ---- snake state + path-finding (body-aware, never self-colliding) ---- */

const NK = 7 * W;
const key = (c, r) => c * 7 + r;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const route = [];          // every cell the head visits, in order
const L = [];              // snake length after each step
const eaten = new Set();
const eatStep = new Map(); // food cell -> step at which it is eaten
let len = 1, pending = 0;

function pushStep(c, r) {
  const k = route.length;
  route.push({ c, r });
  if (k > 0 && pending > 0 && len < MAX_LEN) { len++; pending--; } // tail stays put -> snake grows
  const cell = grid[c][r];
  if (cell.count > 0 && !eaten.has(cell)) {
    eaten.add(cell);
    eatStep.set(cell, k);
    pending += cell.star ? GROW_STAR : GROW_NORMAL;
  }
  if (len >= MAX_LEN) pending = 0;
  L.push(len);
}

const INF = 1e9;
const FOOD_PENALTY = Number(env.FOOD_PENALTY || 60); // stepping on food that is not "due yet" costs this much extra

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(cost, k) {
    const a = this.a; a.push([cost, k]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        let l = 2 * i + 1, r = l + 1, m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

// Cheapest routes from the head to every cell.
// body: "timed"  = tail cells free up as the snake moves (exact, uses growth),
//       "static" = whole body is a wall (always safe),
//       "ignore" = last resort.
// Food that is not in `allowed` (i.e. not due yet) is expensive to cross, so the
// snake only eats out of order when there is really no other way.
function search({ body, allowed, hard = false }) {
  const end = route.length - 1;
  const head = route[end];
  const bodyIdx = new Map();
  for (let i = Math.max(0, end - len + 1); i <= end; i++) bodyIdx.set(key(route[i].c, route[i].r), i);
  const cost = new Float64Array(NK).fill(INF);
  const steps = new Int32Array(NK).fill(-1);
  const par = new Int32Array(NK).fill(-1);
  const hk = key(head.c, head.r);
  cost[hk] = 0; steps[hk] = 0;
  const heap = new Heap();
  heap.push(0, hk);
  while (heap.size) {
    const [cc, k] = heap.pop();
    if (cc > cost[k]) continue;
    const c = (k / 7) | 0, r = k % 7, nd = steps[k] + 1;
    for (const [dc, dr] of DIRS) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= W || nr < 0 || nr > 6) continue;
      const cell = grid[nc]?.[nr];
      if (!cell) continue;
      const nk = key(nc, nr);
      const bi = bodyIdx.get(nk);
      if (bi !== undefined && body !== "ignore") {
        if (body === "static") continue;
        const Ld = Math.min(MAX_LEN, len + Math.min(nd, pending));
        if (bi >= end + nd - Ld + 1) continue; // still occupied by the body at that moment
      }
      const notDue = cell.count > 0 && !eaten.has(cell) && !allowed.has(cell);
      if (notDue && hard) continue;
      const nc2 = cc + 1 + (notDue ? FOOD_PENALTY : 0);
      if (nc2 < cost[nk]) { cost[nk] = nc2; steps[nk] = nd; par[nk] = k; heap.push(nc2, nk); }
    }
  }
  return { cost, steps, par, hk };
}

function reconstruct(res, target) {
  const p = [];
  for (let k = target; k !== res.hk; k = res.par[k]) p.push({ c: (k / 7) | 0, r: k % 7 });
  return p.reverse();
}

function rankedTargets(res, cands) {
  return [...cands]
    .map((cell) => ({ cell, k: key(cell.c, cell.row) }))
    .filter((x) => res.cost[x.k] > 0 && res.cost[x.k] < INF)
    .sort((a, b) => res.cost[a.k] - res.cost[b.k]);
}

// Simulate a planned leg (including growth from food eaten on the way) and make sure the head never bites the body.
function legOk(p) {
  let l = len, pend = pending;
  const recent = route.slice(-MAX_LEN).map((x) => key(x.c, x.r));
  const eatenLocal = new Set();
  for (const s of p) {
    if (pend > 0 && l < MAX_LEN) { l++; pend--; }
    const k = key(s.c, s.r);
    if (l > 1 && recent.slice(recent.length - (l - 1)).includes(k)) return false;
    recent.push(k);
    const cell = grid[s.c][s.r];
    if (cell.count > 0 && !eaten.has(cell) && !eatenLocal.has(cell)) {
      eatenLocal.add(cell);
      pend += cell.star ? GROW_STAR : GROW_NORMAL;
    }
    if (l >= MAX_LEN) pend = 0;
  }
  return true;
}

// After the leg, is there still room around the head? (avoids coiling into a dead end)
function safeAfter(p) {
  let l = len, pend = pending;
  const eatenLocal = new Set();
  for (const s of p) {
    if (pend > 0 && l < MAX_LEN) { l++; pend--; }
    const cell = grid[s.c][s.r];
    if (cell.count > 0 && !eaten.has(cell) && !eatenLocal.has(cell)) {
      eatenLocal.add(cell);
      pend += cell.star ? GROW_STAR : GROW_NORMAL;
    }
    if (l >= MAX_LEN) pend = 0;
  }
  l = Math.min(MAX_LEN, l + pend);
  const full = route.concat(p);
  const tailK = key(full[Math.max(0, full.length - l)].c, full[Math.max(0, full.length - l)].r);
  const wall = new Set();
  for (let i = Math.max(0, full.length - l); i < full.length; i++) wall.add(key(full[i].c, full[i].r));
  wall.delete(tailK); // the tail cell frees up as soon as the snake moves
  const hk = key(p[p.length - 1].c, p[p.length - 1].r);
  const seen = new Set([hk]);
  const stack = [hk];
  while (stack.length) {
    const x = stack.pop(), c = (x / 7) | 0, r = x % 7;
    for (const [dc, dr] of DIRS) {
      const nc = c + dc, nr = r + dr;
      if (!grid[nc]?.[nr]) continue;
      const nk = key(nc, nr);
      if (seen.has(nk) || wall.has(nk)) continue;
      seen.add(nk); stack.push(nk);
    }
  }
  return l <= 2 || seen.has(tailK);
}

const legStats = { timed: 0, static: 0, wander: 0, ghost: 0 };

// Prefer routes that never touch food that is not due yet; only if there is no
// such route is the snake allowed to cross (and eat) higher food early.
function planLeg(cands) {
  const modes = [["timed", true], ["static", true], ["timed", false], ["static", false]];
  for (const [body, hard] of modes) {
    const res = search({ body, allowed: cands, hard });
    for (const { k } of rankedTargets(res, cands)) {
      const p = reconstruct(res, k);
      if (body === "timed" && !legOk(p)) continue;
      if (!safeAfter(p)) continue;
      legStats[body]++;
      return p;
    }
  }
  return null;
}

// Boxed in by its own body: take one step towards the roomiest area and try again.
function wanderStep() {
  const res = search({ body: "timed", allowed: new Set() });
  const end = route.length - 1;
  const wall = new Set();
  for (let i = Math.max(0, end - len + 1); i <= end; i++) wall.add(key(route[i].c, route[i].r));
  let best = null, bestArea = -1;
  for (let k = 0; k < NK; k++) {
    if (res.steps[k] !== 1) continue;
    const seen = new Set([k]);
    const stack = [k];
    while (stack.length) {
      const x = stack.pop(), c = (x / 7) | 0, r = x % 7;
      for (const [dc, dr] of DIRS) {
        const nc = c + dc, nr = r + dr;
        if (!grid[nc]?.[nr]) continue;
        const nk = key(nc, nr);
        if (seen.has(nk) || wall.has(nk)) continue;
        seen.add(nk); stack.push(nk);
      }
    }
    if (seen.size > bestArea) { bestArea = seen.size; best = { c: (k / 7) | 0, r: k % 7 }; }
  }
  if (best) legStats.wander++;
  return best ? [best] : null;
}

function ghostLeg(cands) {
  const res = search({ body: "ignore", allowed: cands });
  const order = rankedTargets(res, cands);
  if (!order.length) return null;
  legStats.ghost++;
  return reconstruct(res, order[0].k);
}

// Plan the whole run
{
  const start = [...buckets[0]].sort((a, b) => a.c - b.c || a.row - b.row)[0];
  pushStep(start.c, start.row);
  let guard = 0;
  for (const bucket of buckets) {
    const remaining = new Set(bucket);
    for (;;) {
      for (const cell of [...remaining]) if (eaten.has(cell)) remaining.delete(cell);
      if (!remaining.size || ++guard > 6000) break;
      let leg = planLeg(remaining);
      if (!leg) leg = wanderStep();
      if (!leg) leg = ghostLeg(remaining);
      if (!leg) break;
      for (const s of leg) pushStep(s.c, s.r);
    }
  }
}

const N = route.length;
const T = []; // T[i] = first step at which body segment i exists
for (let k = 0; k < N; k++) for (let i = T.length; i < L[k]; i++) T[i] = k;
const maxL = L[N - 1];

/* -------------------------------------------------------------- rendering */

const STEP = env.STEP_SECONDS ? Number(env.STEP_SECONDS) : Math.min(0.09, Math.max(0.035, TARGET_SECONDS / N));

const CELL = 12, GAP = 3, PITCH = CELL + GAP, PAD = 20, TOP = 44, BOTTOM = 36;
const gridW = W * PITCH - GAP, gridH = 7 * PITCH - GAP;
const WIDTH = PAD * 2 + gridW, HEIGHT = TOP + gridH + BOTTOM;
const cx = (c) => PAD + c * PITCH + CELL / 2;
const cy = (r) => TOP + r * PITCH + CELL / 2;

// timeline (seconds): run -> scatter -> total number -> hold -> fade -> restart
const tRun = (N - 1) * STEP;
const SC = Math.max(1.6, maxL * STEP + 0.7);
const tScatterEnd = tRun + SC;
const tNum = tRun + SC * 0.55;
const tFadeStart = tScatterEnd + 3.5;
const tFadeEnd = tFadeStart + 0.7;
const P = tFadeEnd + 0.6;

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
    empty: "#161b22", levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"], panel: "#0d1117",
    text: "#8b949e", head: "#d2a8ff", tail: "#6e40c9",
    starFront: "#ffe066", starEdge: "#b8860b", starBack: "#8a6508", ring: "#ffd33d", bar: "#a371f7",
  },
  light: {
    empty: "#ebedf0", levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"], panel: "#ffffff",
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

// visible from a%, fades out between fs% and fe%
function visKF(name, a, fs, fe) {
  const s = [];
  if (a <= 0) s.push("0%{opacity:1}");
  else s.push(`0%,${pf(a - E)}{opacity:0}`, `${pf(a)}{opacity:1}`);
  s.push(`${pf(fs)}{opacity:1}`, `${pf(fe)},100%{opacity:0}`);
  return `@keyframes ${name}{${s.join("")}}`;
}

// food: visible, then fades out just as the head arrives
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
  const EASE_OUT = "cubic-bezier(.1,.8,.25,1)";

  css.push(
    `text{font:600 11px -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;fill:${pal.text}}`,
    `.big{font:800 30px -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;fill:${pal.ring}}`,
    `.e,.n,.sp,.b,.pb,.w,.m,.r,.fin{animation-iteration-count:infinite;animation-timing-function:linear}`,
    `.e,.n,.b,.pb,.w,.m,.r,.fin{animation-duration:${num(P)}s}`,
    `.m{animation-name:mv;animation-fill-mode:both}`,
    `.n{opacity:0}`,
    `.sp{animation-duration:2.8s}`,
    `.b{opacity:0;transform-box:fill-box;transform-origin:center}`,
    `.pb{transform-box:fill-box;transform-origin:left center;animation-name:pg}`,
    `.fin{opacity:0;transform-box:fill-box;transform-origin:center;animation-name:fin}`
  );

  // --- snake head path (only keep corners; linear interpolation does the rest)
  const mv = [];
  for (let k = 0; k < N; k++) {
    let keep = k === 0 || k === N - 1;
    if (!keep) {
      const a = route[k - 1], b = route[k], c = route[k + 1];
      keep = b.c - a.c !== c.c - b.c || b.r - a.r !== c.r - b.r;
    }
    if (keep) mv.push(`${pf(pct(k * STEP))}{transform:translate(${cx(route[k].c)}px,${cy(route[k].r)}px)}`);
  }
  mv.push(`100%{transform:translate(${cx(route[N - 1].c)}px,${cy(route[N - 1].r)}px)}`);
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
  for (const cell of foods) {
    const k = eatStep.get(cell); // undefined only if the planner gave up on it
    const x = PAD + cell.c * PITCH, y = TOP + cell.row * PITCH;
    const anim = k === undefined ? "" : `class="e" style="animation-name:k${id}"`;
    if (k !== undefined) css.push(eatKF(`k${id}`, k * STEP));
    if (cell.star) {
      const X = x + CELL / 2, Y = y + CELL / 2;
      const delay = -((starIdx * 0.37) % 2.8);
      const faces = Z.map(
        (_, li) => `<polygon class="sp" points="${starPts}" fill="${layerFill[li]}" style="animation-name:sp${li};animation-delay:${num(delay)}s"/>`
      ).join("");
      body.push(`<g ${anim} transform="translate(${X},${Y}) scale(${num(starR)})">${faces}</g>`);
      if (k !== undefined) {
        css.push(burstKF(`b${id}`, k * STEP));
        rings.push(`<circle class="b" style="animation-name:b${id}" cx="${X}" cy="${Y}" r="${CELL * 0.6}" fill="none" stroke="${pal.ring}" stroke-width="2"/>`);
      }
      starIdx++;
    } else {
      body.push(`<rect ${anim} x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${pal.levels[cell.level || 1]}"/>`);
    }
    id++;
  }
  body.push(...rings);

  // --- snake. Every segment follows the same head path, delayed by i steps.
  //     w = wrapper (appear / scatter / fade), m = follows the path, r = rect (spins when scattered)
  const rnd = mulberry(1234);
  const endX = cx(route[N - 1].c), endY = cy(route[N - 1].r);
  const a0 = pct(tRun), a1 = pct(tScatterEnd), fs = pct(tFadeStart), fe = pct(tFadeEnd);
  for (let i = maxL - 1; i >= 0; i--) {
    const size = i === 0 ? CELL + 1 : Math.max(6, CELL - 1 - i * 0.15);
    const col = mix(pal.head, pal.tail, maxL > 1 ? i / (maxL - 1) : 0);
    const tx = PAD + 10 + rnd() * (gridW - 20), ty = TOP + 6 + rnd() * (gridH - 12);
    const dx = num(tx - endX), dy = num(ty - endY), rot = Math.round((rnd() - 0.5) * 720);
    css.push(visKF(`v${i}`, pct(T[i] * STEP), fs, fe));
    css.push(`@keyframes x${i}{0%,${pf(a0)}{transform:translate(0px,0px);animation-timing-function:${EASE_OUT}}${pf(a1)},100%{transform:translate(${dx}px,${dy}px)}}`);
    css.push(`@keyframes q${i}{0%,${pf(a0)}{transform:rotate(0deg);animation-timing-function:${EASE_OUT}}${pf(a1)},100%{transform:rotate(${rot}deg)}}`);
    body.push(
      `<g class="w" style="animation-name:v${i},x${i}"><g class="m" style="animation-delay:${num(i * STEP)}s">` +
        `<rect class="r" style="animation-name:q${i}" x="${num(-size / 2)}" y="${num(-size / 2)}" width="${num(size)}" height="${num(size)}" rx="${num(size * 0.32)}" fill="${col}"/></g></g>`
    );
  }

  // --- HUD: stats (static) + live length counter + progress bar
  body.push(`<text x="${PAD}" y="26">${total.toLocaleString("en-US")} contributions  ·  ★ = days with ${STAR_MIN === Infinity ? "-" : STAR_MIN}+ (grow x${GROW_STAR / GROW_NORMAL})  ·  ${starCount} stars</text>`);
  body.push(`<text x="${WIDTH - PAD - 30}" y="26" text-anchor="end">SNAKE LENGTH</text>`);
  for (let n = 1; n <= maxL; n++) {
    css.push(windowKF(`l${n}`, n === 1 ? 0 : pct(T[n - 1] * STEP), n < maxL ? pct(T[n] * STEP) : 100));
    body.push(`<text class="n" style="animation-name:l${n}" x="${WIDTH - PAD - 24}" y="26" fill="${pal.ring}">${n}</text>`);
  }
  const barY = TOP + gridH + 16;
  css.push(`@keyframes pg{0%{transform:scaleX(.001)}${pf(pct(tRun))}{transform:scaleX(1)}100%{transform:scaleX(1)}}`);
  body.push(`<rect x="${PAD}" y="${barY}" width="${gridW}" height="4" rx="2" fill="${pal.empty}"/>`);
  body.push(`<rect class="pb" x="${PAD}" y="${barY}" width="${gridW}" height="4" rx="2" fill="${pal.bar}"/>`);

  // --- finale: total contributions pops up in the middle of the scattered pieces
  const mx = WIDTH / 2, my = TOP + gridH / 2, bw = 270, bh = 66;
  css.push(
    `@keyframes fin{0%,${pf(pct(tNum))}{opacity:0;transform:scale(.6);animation-timing-function:cubic-bezier(.2,1.4,.4,1)}` +
      `${pf(pct(tNum + 0.45))}{opacity:1;transform:scale(1)}${pf(fs)}{opacity:1;transform:scale(1)}${pf(fe)},100%{opacity:0;transform:scale(1)}}`
  );
  body.push(
    `<g class="fin"><rect x="${mx - bw / 2}" y="${my - bh / 2}" width="${bw}" height="${bh}" rx="12" fill="${pal.panel}" fill-opacity=".92" stroke="${pal.empty}" stroke-width="2"/>` +
      `<text x="${mx}" y="${my - 10}" text-anchor="middle">TOTAL CONTRIBUTIONS</text>` +
      `<text class="big" x="${mx}" y="${my + 22}" text-anchor="middle">${total.toLocaleString("en-US")}</text></g>`
  );

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
if (env.DEBUG) {
  await writeFile(
    `${OUT_DIR}/debug.json`,
    JSON.stringify({ route, L, eatOrder: [...eatStep].sort((a, b) => a[1] - b[1]).map(([c, k]) => ({ count: c.count, star: c.star, k })) })
  );
}

console.log(
  `Snake game built: ${eatStep.size}/${foods.length} food eaten (${starCount} stars, threshold ${STAR_MIN}), ` +
    `${buckets.length} buckets, legs ${JSON.stringify(legStats)}, route ${N} steps @ ${STEP.toFixed(3)}s, max length ${maxL}, loop ${P.toFixed(1)}s -> ${OUT_DIR}/`
);
