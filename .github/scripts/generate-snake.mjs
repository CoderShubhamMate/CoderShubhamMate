/**
 * Contribution Snake GAME generator (zero dependencies, Node 18+)
 *
 *  1. The snake starts with a body of 3 and slides in from the left edge.
 *  2. It eats contribution by contribution, strictly from the LOWEST count to the
 *     HIGHEST (all 1s, then all 2s, then 3s ...). Stars (big days) come last.
 *  3. Normal food grows it by GROW_NORMAL (1), a star by GROW_STAR (2x).
 *  4. It never runs into itself (path-finding around its own body).
 *  5. After the last contribution it runs to the nearest border, blinks twice and
 *     explodes. The snake's own boxes bounce around inside the grid border and,
 *     one by one, drop into grid squares that light up like a digital clock:
 *     the TOTAL contribution count, drawn with the graph's own pixels.
 *
 * Env vars (all optional except GH_USER + GITHUB_TOKEN, unless MOCK=1)
 *   GH_USER, GITHUB_TOKEN   who to fetch / auth for the GraphQL API
 *   STAR_MIN                min contributions/day to become a star (default: auto, top ~15% of active days, at least 3)
 *   GROW_NORMAL, GROW_STAR  growth per food (default 1 / 2)
 *   MAX_SNAKE_LENGTH        cap on snake length (default 30)
 *   TARGET_SECONDS          aim for the eating phase to last about this long (default 60)
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
const TARGET_SECONDS = Number(env.TARGET_SECONDS || 60);

/* ------------------------------------------------------------------ data */

async function fetchCalendar() {
  if (env.MOCK === "1") return mockCalendar();
  if (!USER || !TOKEN) throw new Error("GH_USER and GITHUB_TOKEN are required (or set MOCK=1).");

  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{
    totalContributions restrictedContributionsCount weeks{contributionDays{date contributionCount contributionLevel weekday}}}}}}`;

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
    restricted: cal.restrictedContributionsCount,
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

const { total, weeks, restricted = 0 } = await fetchCalendar();
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
// groups: all the 1s, then all the 2s, then 3s ... Inside a group the snake
// always goes for the nearest food.
const foods = allDays
  .filter((d) => d.count > 0)
  .sort((a, b) => a.count - b.count || a.c - b.c || a.row - b.row);
if (foods.length < 2) throw new Error("Not enough contribution data to build a game.");
const BUCKET_MIN = 1; // groups = exact contribution counts
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
  const tailCell = full[Math.max(0, full.length - l)];
  return l <= 2 || !grid[tailCell.c]?.[tailCell.r] || seen.has(tailK);
}

const legStats = { timed: 0, static: 0, wander: 0, ghost: 0 };

// Prefer routes that never touch food that is not due yet; only if there is no
// such route is the snake allowed to cross (and eat) higher food early.
function planLeg(cands, allowCross = true) {
  const modes = [["timed", true], ["static", true]];
  if (allowCross) modes.push(["timed", false], ["static", false]);
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
  // The snake slides in from the left edge with a body of 3.
  const lows = buckets[0];
  let entryRow = -1, bestD = Infinity;
  for (const emptyOnly of [true, false]) {
    for (let r = 0; r < 7; r++) {
      const cell = grid[0]?.[r];
      if (!cell || (emptyOnly && cell.count > 0)) continue;
      const d = Math.min(...lows.map((f) => f.c + Math.abs(f.row - r)));
      if (d < bestD) { bestD = d; entryRow = r; }
    }
    if (entryRow >= 0) break;
  }
  if (entryRow < 0) entryRow = grid[0].findIndex(Boolean);
  len = 3;
  route.push({ c: -1, r: entryRow }); L.push(len); // off-grid entry cell
  pushStep(0, entryRow);

  let guard = 0, stuck = 0;
  const CROSS_AFTER = Number(env.CROSS_AFTER ?? 0); // (optional) steps to wait before eating a higher day early
  for (const bucket of buckets) {
    const remaining = new Set(bucket);
    for (;;) {
      for (const cell of [...remaining]) if (eaten.has(cell)) remaining.delete(cell);
      if (!remaining.size || ++guard > 8000) break;
      let leg = planLeg(remaining, stuck >= CROSS_AFTER);
      if (leg) stuck = 0;
      else { leg = wanderStep(); stuck++; }
      if (!leg) leg = ghostLeg(remaining);
      if (!leg) break;
      for (const s of leg) pushStep(s.c, s.r);
    }
  }
}

// Finale: after the highest contribution the snake runs to the nearest border and stops there.
const isBorder = (c, r) => DIRS.some(([dc, dr]) => !grid[c + dc]?.[r + dr]);
{
  const head = route[route.length - 1];
  if (!isBorder(head.c, head.r)) {
    const borderCells = allDays.filter((d) => isBorder(d.c, d.row));
    for (const body of ["timed", "static"]) {
      const res = search({ body, allowed: new Set() });
      let done = false;
      for (const { k } of rankedTargets(res, borderCells)) {
        const p = reconstruct(res, k);
        if (body === "timed" && !legOk(p)) continue;
        for (const s of p) pushStep(s.c, s.r);
        done = true;
        break;
      }
      if (done) break;
    }
  }
}

const N = route.length;
const T = []; // T[i] = first step at which body segment i exists
for (let k = 0; k < N; k++) for (let i = T.length; i < L[k]; i++) T[i] = k;
const maxL = L[N - 1];

/* -------------------------------------------------------------- rendering */

// slower than before: ~0.1s per grid step (never faster than 0.05s, never slower than 0.12s)
const STEP = env.STEP_SECONDS ? Number(env.STEP_SECONDS) : Math.min(0.12, Math.max(0.05, TARGET_SECONDS / N));

const CELL = 12, GAP = 3, PITCH = CELL + GAP, PAD = 20, TOP = 44, BOTTOM = 36;
const gridW = W * PITCH - GAP, gridH = 7 * PITCH - GAP;
const WIDTH = PAD * 2 + gridW, HEIGHT = TOP + gridH + BOTTOM;
const cx = (c) => PAD + c * PITCH + CELL / 2;
const cy = (r) => TOP + r * PITCH + CELL / 2;

let P = 1; // loop length, set below
const pct = (t) => (t / P) * 100;
const num = (v) => +v.toFixed(4);
const n1 = (v) => +v.toFixed(1);
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

const segSize = (i) => (i === 0 ? CELL + 1 : Math.max(6, CELL - 1 - i * 0.15));
const segCol = (pal, i) => mix(pal.head, pal.tail, maxL > 1 ? i / (maxL - 1) : 0);

/* ---- finale: the total, drawn with the graph's own squares (5x7 digital-clock font) ---- */

const GLYPH = {
  0: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  3: [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  6: ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ",": ["..", "..", "..", "..", "..", ".#", "#."],
};

const totalStr = total.toLocaleString("en-US");
const numberCells = (() => {
  const glyphs = [...totalStr].map((ch) => GLYPH[ch]).filter(Boolean);
  const cols = glyphs.reduce((a, g) => a + g[0].length, 0) + glyphs.length - 1;
  const c0 = Math.max(0, Math.floor((W - cols) / 2));
  const out = [];
  let cc = 0;
  for (const g of glyphs) {
    g.forEach((row, r) => [...row].forEach((ch, x) => {
      if (ch === "#" && grid[c0 + cc + x]?.[r]) out.push({ c: c0 + cc + x, r });
    }));
    cc += g[0].length + 1;
  }
  return out.sort((a, b) => a.c - b.c || a.r - b.r); // they will land left -> right
})();

/* ---- timeline (seconds): run -> touch border -> blink x2 -> BOOM -> bounce -> drop in one by one -> hold -> fade -> restart ---- */

const tTouch = (N - 1) * STEP;
const BL = 0.16;
const tB0 = tTouch + 0.2;
const tBlast = tB0 + 4 * BL + 0.1;
const BOUNCE_MIN = 1.5, APPROACH = 0.55;
const FR = numberCells.length;
const PN = Math.max(FR, maxL);                                   // pieces = the snake's boxes (+ splits if the number needs more)
const stagger = Math.min(0.12, Math.max(0.03, 3.6 / Math.max(1, FR)));
const tFirst = tBlast + BOUNCE_MIN + APPROACH;
const landNumber = (rank) => tFirst + rank * stagger;
const landSurplus = (k) => tFirst - 0.3 + k * 0.03;
const tLastLand = FR ? landNumber(FR - 1) : tFirst;
const tSettleEnd = tLastLand + 0.2;
const tFadeStart = tSettleEnd + 4;
const tFadeEnd = tFadeStart + 0.7;
P = tFadeEnd + 0.6;

// where each body segment sits when the snake stops (head at index 0)
const formation = [];
for (let i = 0; i < maxL; i++) formation.push({ x: cx(route[N - 1 - i].c), y: cy(route[N - 1 - i].r) });

// bounce box = the graph's border (centres of the outermost squares)
const bx0 = cx(0), bx1 = cx(W - 1), by0 = cy(0), by1 = cy(6);

// ballistic-free ricochet: constant speed, perfect reflection, one keyframe per wall hit
function bounce(x, y, vx, vy, Tmax) {
  const out = [];
  let t = 0;
  x = Math.min(bx1, Math.max(bx0, x)); y = Math.min(by1, Math.max(by0, y));
  for (let guard = 0; t < Tmax - 1e-9 && guard < 600; guard++) {
    const tx = vx > 0 ? (bx1 - x) / vx : vx < 0 ? (bx0 - x) / vx : Infinity;
    const ty = vy > 0 ? (by1 - y) / vy : vy < 0 ? (by0 - y) / vy : Infinity;
    const dt = Math.max(0, Math.min(tx, ty, Tmax - t));
    x += vx * dt; y += vy * dt; t += dt;
    if (dt === tx) { x = vx > 0 ? bx1 : bx0; vx = -vx; }
    if (dt === ty) { y = vy > 0 ? by1 : by0; vy = -vy; }
    if (dt > 1e-6 || out.length === 0) out.push({ t, x, y });
  }
  return out;
}

const rf = mulberry(777);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rf() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// landing slots: lit squares of the number, plus (if the snake has more boxes than the number needs)
// some plain squares where the spare boxes sink back into the graph
const slots = numberCells.map((p, rank) => ({ x: cx(p.c), y: cy(p.r), lit: true, land: landNumber(rank) }));
{
  const used = new Set(numberCells.map((p) => key(p.c, p.r)));
  const free = shuffle(allDays.filter((d) => !used.has(key(d.c, d.row))));
  for (let k = 0; k < PN - FR; k++) slots.push({ x: cx(free[k % free.length].c), y: cy(free[k % free.length].row), lit: false, land: landSurplus(k) });
}
shuffle(slots);

const pieces = Array.from({ length: PN }, (_, j) => {
  const src = j % maxL;
  const slot = slots[j];
  const sp = 320 + rf() * 380, ang = rf() * Math.PI * 2;
  let vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
  if (Math.abs(vy) < 90) vy = (rf() < 0.5 ? -1 : 1) * (90 + rf() * 80);
  const tt = slot.land - tBlast;                       // blast -> landing
  const w0 = (rf() < 0.5 ? -1 : 1) * (300 + rf() * 400);
  const R = 360 * (Math.round((w0 * tt) / 360) || 1);   // whole turns, so it lands perfectly square
  return { src, slot, tt, R, events: bounce(formation[src].x, formation[src].y, vx, vy, tt - APPROACH), x0: formation[src].x, y0: formation[src].y };
});

function pieceKF(j, pc) {
  const { slot, tt, R } = pc;
  const k = CELL / segSize(pc.src);
  const tr = (x, y, rot, sc) => `transform:translate(${n1(x)}px,${n1(y)}px) rotate(${n1(rot)}deg) scale(${num(sc)})`;
  const st = [];
  st.push([0, `opacity:0;${tr(pc.x0, pc.y0, 0, 1)}`]);
  st.push([Math.max(0, pct(tBlast) - E), `opacity:0;${tr(pc.x0, pc.y0, 0, 1)}`]);
  st.push([pct(tBlast), `opacity:1;${tr(pc.x0, pc.y0, 0, 1)}`]);
  pc.events.forEach((e, i) => {
    const last = i === pc.events.length - 1;
    st.push([pct(tBlast + e.t), `${tr(e.x, e.y, R * (e.t / tt), 1)}${last ? ";animation-timing-function:cubic-bezier(.45,0,.9,.6)" : ""}`]);
  });
  st.push([pct(slot.land), `${tr(slot.x, slot.y, R, k)};animation-timing-function:cubic-bezier(.2,.7,.4,1)`]);
  st.push([pct(slot.land + 0.08), `${tr(slot.x, slot.y - 3, R, k)};animation-timing-function:cubic-bezier(.55,0,1,.45)`]);
  st.push([pct(slot.land + 0.16), `${tr(slot.x, slot.y, R, k)}`]);
  st.push([pct(tFadeStart), "opacity:1"]);
  st.push([pct(tFadeEnd), "opacity:0"]);
  st.push([100, `opacity:0;${tr(slot.x, slot.y, R, k)}`]);
  return `@keyframes px${j}{${st.map(([p, c]) => `${pf(p)}{${c}}`).join("")}}`;
}

function starPoints(R = 1, r = 0.46) {
  const out = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    out.push(`${num(Math.cos(a) * rad)},${num(Math.sin(a) * rad)}`);
  }
  return out.join(" ");
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

// opacity that jumps to the given values at the given times (seconds)
function stepsKF(name, init, trans) {
  let s = `0%{opacity:${init}}`, prev = init;
  for (const [t, v] of trans) {
    const p = pct(t);
    s += `${pf(Math.max(0, p - E))}{opacity:${prev}}${pf(p)}{opacity:${v}}`;
    prev = v;
  }
  return `@keyframes ${name}{${s}100%{opacity:${prev}}}`;
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

  css.push(
    `text{font:600 11px -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;fill:${pal.text}}`,
    `.e,.n,.sp,.b,.pb,.w,.m,.bb,.f,.fc,.lab{animation-iteration-count:infinite;animation-timing-function:linear}`,
    `.e,.n,.b,.pb,.w,.m,.bb,.f,.fc,.lab{animation-duration:${num(P)}s}`,
    `.m{animation-name:mvA}`,
    `.m,.bb{animation-fill-mode:both}`,
    `.n,.f,.lab{opacity:0}`,
    `.sp{animation-duration:2.8s}`,
    `.b{opacity:0;transform-box:fill-box;transform-origin:center}`,
    `.pb{transform-box:fill-box;transform-origin:left center;animation-name:pg}`,
    `.lab{animation-name:lab}`
  );

  // --- snake head path. Part A (shared): the route up to step kA. Part B (per segment):
  //     the last few steps, so every segment stops exactly where the body ends up (snake stays intact).
  const kA = Math.max(0, N - maxL);
  const dirChange = (k) => {
    const a = route[k - 1], b = route[k], c = route[k + 1];
    return b.c - a.c !== c.c - b.c || b.r - a.r !== c.r - b.r;
  };
  const mvA = [];
  for (let k = 0; k <= kA; k++) {
    if (k === 0 || k === kA || dirChange(k)) mvA.push(`${pf(pct(k * STEP))}{transform:translate(${cx(route[k].c)}px,${cy(route[k].r)}px)}`);
  }
  mvA.push(`100%{transform:translate(${cx(route[kA].c)}px,${cy(route[kA].r)}px)}`);
  css.push(`@keyframes mvA{${mvA.join("")}}`);

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

  // --- the graph (these squares are the "pixels")
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

  // --- snake. Every segment follows the head's path, i steps later.
  //     w = appear / blink / hand over at the blast, m = shared route (A), bb = last steps (B), rect = the segment box
  for (let i = maxL - 1; i >= 0; i--) {
    const size = segSize(i);
    const a = T[i] * STEP;
    css.push(stepsKF(`v${i}`, a <= 0 ? 1 : 0, [
      ...(a > 0 ? [[a, 1]] : []),
      [tB0, 0.1], [tB0 + BL, 1], [tB0 + 2 * BL, 0.1], [tB0 + 3 * BL, 1], // blink twice
      [tBlast, 0],                                                        // boom: the boxes below take over at the same spot
    ]));
    const fi = N - 1 - i;
    const sb = [];
    if (fi > kA) {
      sb.push(`0%,${pf(pct(kA * STEP))}{transform:translate(0px,0px)}`);
      for (let k = kA + 1; k <= fi; k++) {
        if (k === fi || dirChange(k))
          sb.push(`${pf(pct(k * STEP))}{transform:translate(${cx(route[k].c) - cx(route[kA].c)}px,${cy(route[k].r) - cy(route[kA].r)}px)}`);
      }
      sb.push(`100%{transform:translate(${cx(route[fi].c) - cx(route[kA].c)}px,${cy(route[fi].r) - cy(route[kA].r)}px)}`);
    } else {
      sb.push("0%,100%{transform:translate(0px,0px)}");
    }
    css.push(`@keyframes sb${i}{${sb.join("")}}`);
    body.push(
      `<g class="w" style="animation-name:v${i}"><g class="m" style="animation-delay:${num(i * STEP)}s">` +
        `<g class="bb" style="animation-name:sb${i};animation-delay:${num(i * STEP)}s">` +
        `<rect x="${num(-size / 2)}" y="${num(-size / 2)}" width="${num(size)}" height="${num(size)}" rx="${num(size * 0.32)}" fill="${segCol(pal, i)}"/></g></g></g>`
    );
  }

  // --- BOOM: flash at the head
  css.push(
    `@keyframes flash{0%,${pf(pct(tBlast))}{opacity:0;transform:scale(.3)}${pf(pct(tBlast) + E)}{opacity:1;transform:scale(.3)}${pf(pct(tBlast + 0.45))},100%{opacity:0;transform:scale(6)}}`
  );
  body.push(`<circle class="b" style="animation-name:flash" cx="${formation[0].x}" cy="${formation[0].y}" r="9" fill="${pal.ring}"/>`);

  // --- the snake's boxes: blast apart, ricochet around the graph's border, then drop one by one into the number
  pieces.forEach((pc, j) => {
    const size = segSize(pc.src);
    const lit = pc.slot.lit ? pal.levels[4] : pal.empty;
    css.push(pieceKF(j, pc));
    css.push(`@keyframes gc${j}{0%,${pf(pct(pc.slot.land - 0.2))}{fill:${segCol(pal, pc.src)}}${pf(pct(pc.slot.land))},100%{fill:${lit}}}`);
    body.push(
      `<g class="f" style="animation-name:px${j}"><rect class="fc" style="animation-name:gc${j}" x="${num(-size / 2)}" y="${num(-size / 2)}" width="${num(size)}" height="${num(size)}" rx="${num(size * 0.32)}"/></g>`
    );
  });

  // --- caption under the graph (not on top of it)
  css.push(`@keyframes lab{0%,${pf(pct(tSettleEnd))}{opacity:0}${pf(pct(tSettleEnd + 0.4))},${pf(pct(tFadeStart))}{opacity:1}${pf(pct(tFadeEnd))},100%{opacity:0}}`);
  body.push(`<text class="lab" x="${WIDTH / 2}" y="${TOP + gridH + 32}" text-anchor="middle">CONTRIBUTIONS IN THE LAST YEAR</text>`);

  // --- HUD: legend + live length counter + progress bar
  body.push(`<text x="${PAD}" y="26">★ = days with ${STAR_MIN === Infinity ? "-" : STAR_MIN}+ contributions (grow x${GROW_STAR / GROW_NORMAL})  ·  ${starCount} stars</text>`);
  body.push(`<text x="${WIDTH - PAD - 30}" y="26" text-anchor="end">SNAKE LENGTH</text>`);
  for (let n = 3; n <= maxL; n++) {
    css.push(windowKF(`l${n}`, n === 3 ? 0 : pct(T[n - 1] * STEP), n < maxL ? pct(T[n] * STEP) : 100));
    body.push(`<text class="n" style="animation-name:l${n}" x="${WIDTH - PAD - 24}" y="26" fill="${pal.ring}">${n}</text>`);
  }
  const barY = TOP + gridH + 12;
  css.push(`@keyframes pg{0%{transform:scaleX(.001)}${pf(pct(tTouch))}{transform:scaleX(1)}100%{transform:scaleX(1)}}`);
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
if (env.DEBUG) {
  await writeFile(
    `${OUT_DIR}/debug.json`,
    JSON.stringify({
      route, L, total, W, bounds: [bx0, bx1, by0, by1], STEP,
      eatOrder: [...eatStep].sort((a, b) => a[1] - b[1]).map(([c, k]) => ({ count: c.count, star: c.star, k })),
      numberCells,
      slots: slots.map((q) => ({ x: q.x, y: q.y, lit: q.lit, land: q.land })),
      events: pieces.map((p) => p.events.map((e) => [e.t, e.x, e.y])),
    })
  );
}

const last = route[N - 1];
const sumDays = allDays.reduce((a, d) => a + d.count, 0);
console.log(
  `Snake game built: ${eatStep.size}/${foods.length} food eaten (${starCount} stars, threshold ${STAR_MIN}), ${buckets.length} count-groups, ` +
    `legs ${JSON.stringify(legStats)}, route ${N} steps @ ${STEP.toFixed(3)}s, length 3 -> ${maxL}, ends on border cell (${last.c},${last.r}): ${isBorder(last.c, last.r)}, ` +
    `${PN} pieces -> "${totalStr}", loop ${P.toFixed(1)}s -> ${OUT_DIR}/`
);
console.log(
  `Contribution check: API total = ${total} (private/restricted part: ${restricted}), sum of the ${allDays.length} days = ${sumDays}. ` +
    `Compare with the number on your profile page.`
);
