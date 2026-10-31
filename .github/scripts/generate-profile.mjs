/**
 * Generates the animated profile graphics (hero, section headers, cards, diagram, footer).
 * Zero dependencies, Node 18+.  Output goes to OUT_DIR (default "dist").
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = process.env.OUT_DIR || "dist";
mkdirSync(OUT, { recursive: true });

const FONT = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const C = { bg: "#060913", panel: "#0b1120", line: "#1e293b", cyan: "#22d3ee", violet: "#8b5cf6", pink: "#f472b6", amber: "#fbbf24", green: "#4ade80", text: "#f8fafc", soft: "#cbd5e1", mute: "#64748b" };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const short = (h) => `0x${h.slice(0, 4)}...${h.slice(-4)}`;
const wrap = (t, n) => {
  const lines = []; let cur = "";
  for (const w of t.split(" ")) {
    if ((cur + " " + w).trim().length > n) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
};
const svg = (w, h, label, inner) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">\n${inner}\n</svg>\n`;
const grad = (id) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.cyan}"/><stop offset=".5" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}"/></linearGradient>`;
const save = (name, content) => writeFileSync(`${OUT}/${name}`, content, "utf8");

/* ---------------------------------------------------- section headers (a real hash chain) */
const sections = [
  ["about", "About Me"], ["focus", "System Design Focus"], ["build", "What I Build"], ["stack", "Technology Arsenal"],
  ["featured", "Featured Engineering"], ["architecture", "Architecture Case Study"], ["open", "Open To"],
  ["stats", "GitHub Stats"], ["snake", "Contribution Snake"], ["trophies", "GitHub Trophies"],
];
let prev = "0".repeat(64);
sections.forEach(([slug, title], i) => {
  const n = i + 1;
  const hash = sha(prev + title + n);
  const body = `<defs>${grad("a")}</defs>
<style>
text{font-family:${FONT}}
.ln{stroke-dasharray:872;animation:draw 1.4s ease-out both}
@keyframes draw{from{stroke-dashoffset:872}to{stroke-dashoffset:0}}
.dot{animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{50%{opacity:.2}}
</style>
<rect x=".5" y="8.5" width="899" height="66" rx="14" fill="${C.panel}" stroke="${C.line}"/>
<line x1="90" y1="0" x2="90" y2="22" stroke="${C.cyan}" stroke-width="2" stroke-opacity=".7"/>
<circle cx="90" cy="9" r="3" fill="${C.cyan}"/>
<rect x="34" y="24" width="112" height="30" rx="8" fill="${C.cyan}" fill-opacity=".1" stroke="${C.cyan}" stroke-opacity=".55"/>
<text x="90" y="44" text-anchor="middle" font-size="13" font-weight="700" fill="${C.cyan}">BLOCK #${String(n).padStart(3, "0")}</text>
<text x="168" y="52" font-size="26" font-weight="800" fill="${C.text}">${esc(title)}</text>
<circle class="dot" cx="620" cy="35" r="3.5" fill="${C.green}"/>
<text x="630" y="39" font-size="11" fill="${C.green}">validated</text>
<text x="766" y="37" text-anchor="end" font-size="11" fill="${C.mute}">hash</text><text x="876" y="37" text-anchor="end" font-size="11" fill="#94a3b8">${short(hash)}</text>
<text x="766" y="56" text-anchor="end" font-size="11" fill="${C.mute}">prev</text><text x="876" y="56" text-anchor="end" font-size="11" fill="#94a3b8">${short(prev)}</text>
<path class="ln" d="M16 74 H884" stroke="url(#a)" stroke-width="2.5" stroke-linecap="round" fill="none"/>`;
  save(`block-${String(n).padStart(2, "0")}-${slug}.svg`, svg(900, 80, title, body));
  prev = hash;
});

/* ------------------------------------------------------------------------------------- hero */
{
  const taglines = [
    "Designing scalable and reliable backend systems",
    "Studying distributed systems, one trade-off at a time",
    "Case study: BBSNS - gasless relay, workers, multi-sig governance",
    "Replace legacy trust with cryptographic proof.",
  ];
  let h = sha("genesis");
  const hs = Array.from({ length: 7 }, (_, i) => (h = sha(h + i)).slice(0, 6));
  const ticker = Array.from({ length: 40 }, (_, i) => "0x" + sha("t" + i).slice(0, 8)).join("   ");
  const tw = Math.round(ticker.length * 6.6);
  const blocks = hs.map((x, i) => {
    const bx = 90 + i * 116, last = i === 6;
    const col = [C.cyan, C.violet, C.pink][i % 3];
    return `<g class="blk" style="animation-delay:${(i * 0.28).toFixed(2)}s">
<rect x="${bx}" y="252" width="84" height="38" rx="9" fill="#0f172a" stroke="${col}" stroke-opacity="${last ? 0.9 : 0.75}" ${last ? 'stroke-dasharray="5 4"' : ""}/>
<text x="${bx + 42}" y="267" text-anchor="middle" font-size="10" font-weight="700" fill="${col}">#${String(i + 1).padStart(4, "0")}</text>
<text class="${last ? "mine" : ""}" x="${bx + 42}" y="281" text-anchor="middle" font-size="10" fill="#94a3b8">${last ? "mining..." : "0x" + x}</text>
</g>`;
  }).join("\n");
  const links = Array.from({ length: 6 }, (_, i) => `<line class="lk" x1="${90 + i * 116 + 84}" y1="271" x2="${90 + (i + 1) * 116}" y2="271" stroke="#334155" stroke-width="2" stroke-dasharray="4 4"/>`).join("\n");
  const tag = taglines.map((t, k) => {
    const cursorX = 450 + ((("> " + t).length * 9.6) / 2) + 5;
    return `<g class="tg t${k}" style="animation-delay:${k * 4}s"><text x="450" y="214" text-anchor="middle" font-size="16" fill="#7dd3fc"><tspan fill="${C.cyan}">&gt; </tspan>${esc(t)}</text><rect class="cur" x="${cursorX.toFixed(1)}" y="201" width="9" height="16" fill="${C.cyan}"/></g>`;
  }).join("\n");
  const body = `<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0f24"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
<linearGradient id="tg" x1="0" y1="0" x2="1" y2="0" spreadMethod="reflect"><stop offset="0" stop-color="${C.cyan}"/><stop offset=".5" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}"/><animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="1 0" dur="7s" repeatCount="indefinite"/></linearGradient>
<radialGradient id="gv"><stop offset="0" stop-color="${C.violet}" stop-opacity=".35"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></radialGradient>
<radialGradient id="gc"><stop offset="0" stop-color="${C.cyan}" stop-opacity=".25"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/></radialGradient>
<pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#131c36" stroke-width="1"/></pattern>
<clipPath id="tk"><rect x="20" y="298" width="860" height="22"/></clipPath>
<clipPath id="card"><rect width="900" height="336" rx="18"/></clipPath>
</defs>
<style>
text{font-family:${FONT}}
.glow{animation:breathe 6s ease-in-out infinite}
@keyframes breathe{50%{opacity:.55}}
.blk{animation:pop .55s ease-out both}
@keyframes pop{from{opacity:0;transform:translateY(10px)}}
.lk{animation:flow 1.2s linear infinite}
@keyframes flow{to{stroke-dashoffset:-8}}
.pulse{animation:run 5s linear infinite}
@keyframes run{0%{transform:translateX(0);opacity:0}6%{opacity:1}94%{opacity:1}100%{transform:translateX(780px);opacity:0}}
.mine{animation:blink 1s steps(2,start) infinite}
@keyframes blink{50%{opacity:.25}}
.tg{opacity:0;animation:cyc 16s infinite both}.t0{opacity:1}
@keyframes cyc{0%{opacity:0;transform:translateY(7px)}3%{opacity:1;transform:translateY(0)}22%{opacity:1;transform:translateY(0)}25%{opacity:0;transform:translateY(-7px)}100%{opacity:0}}
.cur{animation:blink 1s steps(2,start) infinite}
.scan{animation:scan 5s linear infinite}
@keyframes scan{from{transform:translateY(40px)}to{transform:translateY(336px)}}
.tick{animation:tick 40s linear infinite}
@keyframes tick{to{transform:translateX(-${tw + 80}px)}}
.live{animation:blink 1.6s ease-in-out infinite}
</style>
<g clip-path="url(#card)">
<rect width="900" height="336" fill="url(#bg)"/>
<rect width="900" height="336" fill="url(#grid)" opacity=".6"/>
<circle class="glow" cx="790" cy="90" r="210" fill="url(#gv)"/>
<circle class="glow" cx="90" cy="300" r="230" fill="url(#gc)" style="animation-delay:-3s"/>
<rect class="scan" x="0" y="0" width="900" height="2" fill="${C.cyan}" opacity=".07"/>
<line x1="0" y1="40.5" x2="900" y2="40.5" stroke="${C.line}"/>
<circle cx="28" cy="20" r="6" fill="#ff5f57"/><circle cx="48" cy="20" r="6" fill="#febc2e"/><circle cx="68" cy="20" r="6" fill="#28c840"/>
<text x="450" y="24" text-anchor="middle" font-size="12" fill="${C.mute}">design.md  -  shubham@systems:~$</text>
<circle class="live" cx="684" cy="20" r="3.5" fill="${C.green}"/>
<text x="872" y="24" text-anchor="end" font-size="12" fill="${C.green}">all systems operational</text>
<text x="450" y="134" text-anchor="middle" font-size="62" font-weight="800" letter-spacing="5" fill="url(#tg)">SHUBHAM MATE</text>
<text x="450" y="172" text-anchor="middle" font-size="17" fill="#94a3b8" xml:space="preserve" textLength="585" lengthAdjust="spacing">Software Engineer  |  System Design  |  Blockchain Systems</text>
${tag}
${links}
${blocks}
<circle class="pulse" cx="90" cy="271" r="4.5" fill="${C.cyan}"/>
<g clip-path="url(#tk)"><g class="tick"><text x="20" y="314" font-size="11" fill="#334155" xml:space="preserve" textLength="${tw}" lengthAdjust="spacing">${ticker}</text><text x="${20 + tw + 80}" y="314" font-size="11" fill="#334155" xml:space="preserve" textLength="${tw}" lengthAdjust="spacing">${ticker}</text></g></g>
</g>
<rect x=".5" y=".5" width="899" height="335" rx="18" fill="none" stroke="${C.line}"/>`;
  save("hero.svg", svg(900, 336, "Shubham Mate - Software Engineer, System Design, Blockchain Systems", body));
}

/* ------------------------------------------------------------------- system design focus chips */
{
  const rows = [
    ["// CORE", ["Scalability", "Reliability", "Fault Tolerance", "Consistency & Trade-offs"]],
    ["// BUILDING BLOCKS", ["Caching", "Load Balancing", "Message Queues", "Database Design", "API Design"]],
    ["// OPERATE & SECURE", ["Observability", "Zero-Trust Security", "Cloud-Native & Microservices"]],
  ];
  const H = 3 * 48 + 56;
  let idx = 0;
  const parts = rows.map(([label, chips], r) => {
    const y = 26 + r * 48, col = [C.cyan, C.violet, C.pink][r];
    let x = 210;
    const cs = chips.map((t) => {
      const w = Math.round(t.length * 7.2 + 26);
      const s = `<g class="c" style="animation-delay:${(idx++ * 0.07).toFixed(2)}s"><rect x="${x}" y="${y}" width="${w}" height="30" rx="15" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-opacity=".55"/><text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-size="12" fill="${C.text}">${esc(t)}</text></g>`;
      x += w + 10;
      return s;
    }).join("");
    return `<text x="28" y="${y + 20}" font-size="11" font-weight="700" fill="${col}">${esc(label)}</text>${cs}`;
  }).join("\n");
  save("focus.svg", svg(900, H, "System design focus: scalability, reliability, fault tolerance, caching, load balancing, message queues, database design, API design, observability, zero-trust security, cloud-native and microservices",
    `<style>text{font-family:${FONT}}.c{animation:rise .5s ease-out both}@keyframes rise{from{opacity:0;transform:translateY(8px)}}</style>
<rect x=".5" y=".5" width="899" height="${H - 1}" rx="16" fill="${C.panel}" stroke="${C.line}"/>
${parts}
<text x="28" y="${H - 16}" font-size="11" fill="${C.mute}">// what I am studying and applying in my projects</text>`));
}

/* ------------------------------------------------------------------------- what-I-build cards */
{
  const cards = [
    { t: "Full-Stack Platforms", col: C.cyan, d: "Complex, multi-actor web platforms with Next.js & Node.js - real-time state machines, role-based access control, and seamless UX at scale.", k: "next.js  .  node.js  .  rbac",
      icon: `<circle cx="14" cy="14" r="11" fill="none" stroke="COL" stroke-width="2"/><ellipse cx="14" cy="14" rx="5" ry="11" fill="none" stroke="COL" stroke-width="2"/><path d="M3 14H25" stroke="COL" stroke-width="2"/>` },
    { t: "Blockchain Protocols", col: C.violet, d: "On-chain infrastructure using Solidity - custom token economies, multi-sig governance contracts, and gasless EIP-712 meta-transaction relay systems.", k: "solidity  .  eip-712  .  multi-sig",
      icon: `<rect x="1" y="8" width="15" height="11" rx="5.5" fill="none" stroke="COL" stroke-width="2"/><rect x="12" y="8" width="15" height="11" rx="5.5" fill="none" stroke="COL" stroke-width="2"/>` },
    { t: "Desktop Applications", col: C.pink, d: "Secure, sandboxed Electron desktop consoles bridging hardware wallets with cloud backends for enterprise-grade authenticated workflows.", k: "electron  .  wallets  .  cloud",
      icon: `<rect x="2" y="3" width="24" height="16" rx="3" fill="none" stroke="COL" stroke-width="2"/><path d="M9 25H19M14 19V25" stroke="COL" stroke-width="2"/>` },
  ];
  const parts = cards.map((c, i) => {
    const lines = wrap(c.d, 32).map((l, j) => `<text x="24" y="${100 + j * 19}" font-size="12" fill="${C.soft}">${esc(l)}</text>`).join("");
    return `<g transform="translate(${i * 308},0)" class="cd" style="animation-delay:${i * 0.15}s">
<rect x=".5" y=".5" width="283" height="259" rx="16" fill="${C.panel}" stroke="${C.line}"/>
<rect x="24" y="0" width="236" height="3" rx="1.5" fill="${c.col}"/>
<g transform="translate(24,26)">${c.icon.replace(/COL/g, c.col)}</g>
<text x="64" y="48" font-size="17" font-weight="800" fill="${C.text}">${esc(c.t)}</text>
<line x1="24" y1="68" x2="260" y2="68" stroke="${C.line}"/>
${lines}
<text x="24" y="240" font-size="11" fill="${C.mute}">// ${esc(c.k)}</text>
</g>`;
  }).join("\n");
  save("build-cards.svg", svg(900, 262, "What I build: full-stack platforms, blockchain protocols, desktop applications",
    `<style>text{font-family:${FONT}}.cd{animation:rise .6s ease-out both}@keyframes rise{from{opacity:0;transform:translateY(12px)}}</style>\n${parts}`));
}

/* ------------------------------------------------------------------------------ project cards */
{
  const projects = [
    { slug: "bbsns", n: "01", t: "BBSNS - Secure Notarization System", d: "Enterprise-grade decentralized infrastructure replacing paper-based notarization with cryptographic finality.",
      b: ["Gasless EIP-712 meta-transaction relay", "Biometric KYC + multi-sig governance", "Self-healing background workers", "Electron desktop console + AWS S3 vault"],
      tags: ["Next.js", "Solidity", "AWS S3", "Electron"], col: C.cyan },
    { slug: "tee", n: "02", t: "Offchain TEE Computing", d: "Research into secure off-chain computation using Trusted Execution Environments.",
      b: ["Hardware-level security meets blockchain verifiability", "Rust-based enclave execution", "On-chain attestation & proof submission", "Cryptographically verifiable off-chain results"],
      tags: ["Rust", "Solidity", "JavaScript"], col: C.violet },
  ];
  const layout = projects.map((p) => ({ p, desc: wrap(p.d, 50), bl: p.b.map((x) => wrap(x, 46)) }));
  const H = Math.max(...layout.map(({ desc, bl }) => 112 + desc.length * 18 + 14 + bl.reduce((a, l) => a + l.length * 18 + 6, 0) + 20 + 24 + 22 + 40 + 18));
  layout.forEach(({ p, desc, bl }) => {
    let y = 112;
    const dsc = desc.map((l, j) => `<text x="24" y="${y + j * 18}" font-size="12" fill="${C.soft}">${esc(l)}</text>`).join("");
    y += desc.length * 18 + 14;
    const bul = bl.map((ls) => {
      const out = ls.map((l, j) => `${j === 0 ? `<text x="24" y="${y + j * 18}" font-size="12" fill="${p.col}">&#9656;</text>` : ""}<text x="42" y="${y + j * 18}" font-size="12" fill="${C.soft}">${esc(l)}</text>`).join("");
      y += ls.length * 18 + 6;
      return out;
    }).join("");
    y += 14;
    let cx = 24;
    const chips = p.tags.map((tg) => {
      const w = Math.round(tg.length * 7 + 22);
      const s = `<rect x="${cx}" y="${y}" width="${w}" height="24" rx="12" fill="${p.col}" fill-opacity=".1" stroke="${p.col}" stroke-opacity=".5"/><text x="${cx + w / 2}" y="${y + 16}" text-anchor="middle" font-size="11" fill="${p.col}">${esc(tg)}</text>`;
      cx += w + 8;
      return s;
    }).join("");
    const btnY = H - 58;
    const body = `<defs>${grad("g")}</defs>
<style>text{font-family:${FONT}}.sh{animation:sh 3.2s ease-in-out infinite}@keyframes sh{50%{opacity:.55}}</style>
<rect x=".5" y=".5" width="439" height="${H - 1}" rx="18" fill="${C.panel}" stroke="${C.line}"/>
<rect x="24" y="0" width="392" height="3" rx="1.5" fill="url(#g)"/>
<rect x="24" y="22" width="132" height="26" rx="8" fill="${p.col}" fill-opacity=".1" stroke="${p.col}" stroke-opacity=".5"/>
<text x="90" y="39" text-anchor="middle" font-size="12" font-weight="700" fill="${p.col}">FEATURED #${p.n}</text>
<text x="416" y="39" text-anchor="end" font-size="11" fill="${C.mute}">tx ${short(sha(p.t))}</text>
<text x="24" y="86" font-size="18" font-weight="800" fill="${C.text}">${esc(p.t)}</text>
${dsc}
${bul}
${chips}
<rect class="sh" x="24" y="${btnY}" width="158" height="34" rx="10" fill="none" stroke="url(#g)" stroke-width="2"/>
<text x="103" y="${btnY + 22}" text-anchor="middle" font-size="12" font-weight="700" fill="${C.text}">VIEW REPO &#8599;</text>`;
    save(`project-${p.slug}.svg`, svg(440, H, p.t, body));
  });
}

/* ------------------------------------------------------------ architecture case study (BBSNS) */
{
  const W = 900, H = 396;
  const css = [];
  const box = (x, y, w, h, col, title, subs) => {
    const cy = y + h / 2, n = subs.length;
    const t0 = n ? cy - 4 - (n - 1) * 8 : cy + 5;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#0f172a" stroke="${col}" stroke-opacity=".75"/>
<circle cx="${x + 14}" cy="${y + 16}" r="3.5" fill="${col}"/>
<text x="${x + w / 2}" y="${t0}" text-anchor="middle" font-size="${w < 150 ? 13 : 15}" font-weight="800" fill="${C.text}">${esc(title)}</text>
${subs.map((s, i) => `<text x="${x + w / 2}" y="${t0 + 19 + i * 16}" text-anchor="middle" font-size="11" fill="${C.mute}">${esc(s)}</text>`).join("")}`;
  };
  let aid = 0;
  const arrow = (x1, y1, x2, y2, col, dashed = false, both = false) => {
    const id = aid++, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const head = (x, y, sx, sy) => `<polygon points="${x},${y} ${x - sx * 8 + -sy * 4},${y - sy * 8 + sx * 4} ${x - sx * 8 - -sy * 4},${y - sy * 8 - sx * 4}" fill="${col}"/>`;
    css.push(`@keyframes pk${id}{0%{transform:translate(0px,0px);opacity:0}15%{opacity:1}85%{opacity:1}100%{transform:translate(${dx}px,${dy}px);opacity:0}}`);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-opacity=".7" stroke-width="2" ${dashed ? 'stroke-dasharray="5 4"' : ""}/>${head(x2, y2, ux, uy)}${both ? head(x1, y1, -ux, -uy) : ""}<circle class="pk" style="animation-name:pk${id};animation-delay:${(id * 0.45).toFixed(2)}s" cx="${x1}" cy="${y1}" r="3.5" fill="${col}"/>`;
  };
  const heads = [["CLIENTS", 150, C.cyan], ["BACKEND", 450, C.violet], ["ON-CHAIN", 750, C.pink]]
    .map(([t, x, c]) => `<text x="${x}" y="40" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="3" fill="${c}">${t}</text>`).join("");
  const parts = [
    box(40, 64, 220, 66, C.cyan, "Web App", ["Next.js"]),
    box(40, 168, 220, 66, C.cyan, "Desktop Console", ["Electron + hardware wallets"]),
    box(340, 64, 220, 170, C.violet, "API", ["Node.js backend"]),
    box(340, 272, 105, 66, C.violet, "Workers", ["self-healing"]),
    box(455, 272, 105, 66, C.violet, "S3 Vault", ["AWS S3"]),
    box(640, 64, 220, 66, C.pink, "Meta-Tx Relay", ["gasless - EIP-712"]),
    box(640, 168, 220, 170, C.pink, "Smart Contracts", ["Solidity", "multi-sig governance"]),
    arrow(260, 97, 340, 97, C.cyan), arrow(260, 201, 340, 201, C.cyan),
    arrow(560, 97, 640, 97, C.violet), arrow(750, 130, 750, 168, C.pink),
    arrow(392, 234, 392, 272, C.violet, true, true), arrow(507, 234, 507, 272, C.violet, true),
  ].join("\n");
  save("architecture.svg", svg(W, H, "BBSNS architecture, simplified: web app and Electron console talk to a Node.js API, which uses background workers, an S3 vault and a gasless EIP-712 relay to Solidity smart contracts",
    `<style>text{font-family:${FONT}}.pk{animation-iteration-count:infinite;animation-duration:2.4s;animation-timing-function:linear}${css.join("")}</style>
<rect x=".5" y=".5" width="899" height="${H - 1}" rx="16" fill="${C.panel}" stroke="${C.line}"/>
${heads}
${parts}
<text x="450" y="${H - 18}" text-anchor="middle" font-size="11" fill="${C.mute}">// simplified, illustrative view - see the repository for the real design</text>`));
}

/* ------------------------------------------------ live GitHub data: activity chart + trophies */
const env = process.env;
const USER = env.GH_USER || env.GITHUB_REPOSITORY_OWNER || "";
const TOKEN = env.GITHUB_TOKEN || env.GH_TOKEN || "";

async function fetchStats() {
  if (env.MOCK === "1") {
    const weeks = Array.from({ length: 53 }, (_, i) => ({
      days: Array.from({ length: 7 }, (_, d) => ({
        n: ((i * 7 + d) * 37) % 11 === 0 ? 5 + (i % 7) : (i + d) % 4 === 0 ? 1 + (i % 3) : 0,
        date: new Date(Date.UTC(2025, 10, 2 + i * 7 + d)).toISOString().slice(0, 10),
      })),
    }));
    return { weeks, total: weeks.flatMap((w) => w.days).reduce((a, d) => a + d.n, 0), commits: 310, prs: 12, issues: 4, stars: 18, followers: 25, repos: 14 };
  }
  if (!USER || !TOKEN) throw new Error("GH_USER and GITHUB_TOKEN are required");
  const query = `query($login:String!){user(login:$login){
    followers{totalCount} pullRequests{totalCount} issues{totalCount}
    repositories(ownerAffiliations:OWNER,privacy:PUBLIC,isFork:false,first:100){totalCount nodes{stargazerCount}}
    contributionsCollection{totalCommitContributions contributionCalendar{totalContributions weeks{contributionDays{contributionCount date}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-graphics" },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const u = json.data.user, cc = u.contributionsCollection;
  return {
    weeks: cc.contributionCalendar.weeks.map((w) => ({ days: w.contributionDays.map((d) => ({ n: d.contributionCount, date: d.date })) })),
    total: cc.contributionCalendar.totalContributions, commits: cc.totalCommitContributions,
    prs: u.pullRequests.totalCount, issues: u.issues.totalCount, followers: u.followers.totalCount,
    repos: u.repositories.totalCount, stars: u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0),
  };
}

let stats = null;
try { stats = await fetchStats(); } catch (e) { console.warn("WARNING: could not load GitHub data:", e.message); }

const unavailable = (name, h) => svg(900, h, `${name} (live GitHub data unavailable right now)`,
  `<style>text{font-family:${FONT}}</style><rect x=".5" y=".5" width="899" height="${h - 1}" rx="16" fill="${C.panel}" stroke="${C.line}"/>
<text x="450" y="${h / 2 + 4}" text-anchor="middle" font-size="12" fill="${C.mute}">// live GitHub data unavailable right now - it refreshes on the next run</text>`);

/* ---- activity: contributions per week ---- */
{
  if (!stats) save("activity.svg", unavailable("Contribution activity", 120));
  else {
    const W = 900, H = 260, L = 58, R = 26, T = 62, B = 46, iw = W - L - R, ih = H - T - B;
    const weekly = stats.weeks.map((w) => w.days.reduce((a, d) => a + d.n, 0));
    const max = Math.max(1, ...weekly), top = Math.max(5, Math.ceil(max / 5) * 5);
    const pts = weekly.map((v, i) => [L + (i * iw) / Math.max(1, weekly.length - 1), T + ih - (v / top) * ih]);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`, len = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], xm = (x0 + x1) / 2;
      d += ` C${xm.toFixed(1)},${y0.toFixed(1)} ${xm.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
      len += Math.hypot(x1 - x0, y1 - y0) * 1.15;
    }
    const area = `${d} L${pts.at(-1)[0].toFixed(1)},${T + ih} L${pts[0][0].toFixed(1)},${T + ih} Z`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const y = T + ih - f * ih;
      return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="${C.line}" stroke-dasharray="3 5"/><text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="10" fill="${C.mute}">${Math.round(top * f)}</text>`;
    }).join("");
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let lastM = -1;
    const months = stats.weeks.map((w, i) => {
      const m = new Date(w.days[0].date + "T00:00:00Z").getUTCMonth();
      if (m === lastM) return "";
      lastM = m;
      return i > weekly.length - 3 ? "" : `<text x="${pts[i][0].toFixed(1)}" y="${H - 20}" font-size="10" fill="${C.mute}">${MON[m]}</text>`;
    }).join("");
    const pi = weekly.indexOf(max), [px, py] = pts[pi];
    const body = `<defs>${grad("al")}<linearGradient id="af" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.violet}" stop-opacity=".45"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></linearGradient></defs>
<style>text{font-family:${FONT}}.ln{stroke-dasharray:${Math.round(len)};animation:dr 2.4s ease-out both}@keyframes dr{from{stroke-dashoffset:${Math.round(len)}}}.ar{animation:fi 1.6s ease-out .8s both}@keyframes fi{from{opacity:0}}.pk{animation:pl 1.8s ease-in-out infinite}@keyframes pl{50%{opacity:.35}}</style>
<rect x=".5" y=".5" width="899" height="${H - 1}" rx="16" fill="${C.panel}" stroke="${C.line}"/>
<text x="${L}" y="34" font-size="12" font-weight="700" fill="${C.cyan}">// contributions per week</text>
<text x="${W - R}" y="34" text-anchor="end" font-size="12" fill="${C.soft}">${stats.total.toLocaleString("en-US")} in the last year</text>
${grid}
<path class="ar" d="${area}" fill="url(#af)"/>
<path class="ln" d="${d}" fill="none" stroke="url(#al)" stroke-width="2.5" stroke-linecap="round"/>
<circle class="pk" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" fill="${C.pink}"/>
<text x="${Math.min(px + 10, W - 70).toFixed(1)}" y="${Math.max(py - 8, T + 8).toFixed(1)}" font-size="11" fill="${C.pink}">peak ${max}</text>
${months}`;
    save("activity.svg", svg(W, H, `Contributions per week over the last year: ${stats.total} in total, peak week ${max}`, body));
  }
}

/* ---- trophies: stat cards with ranks ---- */
{
  if (!stats) save("trophies.svg", unavailable("GitHub trophies", 120));
  else {
    const RANKS = ["C", "B", "A", "AA", "AAA", "S", "SS", "SSS"];
    const RCOL = ["#94a3b8", C.green, C.cyan, "#60a5fa", C.violet, C.amber, "#fb923c", C.pink];
    const TH = { total: [1, 100, 300, 600, 1000, 2000, 4000], commits: [1, 50, 150, 300, 600, 1200, 2500], prs: [1, 5, 15, 40, 100, 250, 600], issues: [1, 5, 15, 40, 100, 250, 600], stars: [1, 5, 15, 40, 100, 300, 1000], followers: [1, 5, 15, 40, 100, 300, 1000], repos: [1, 5, 10, 25, 50, 100, 200] };
    const ICON = {
      total: `<rect x="0" y="0" width="8" height="8" rx="2"/><rect x="11" y="0" width="8" height="8" rx="2"/><rect x="0" y="11" width="8" height="8" rx="2"/><rect x="11" y="11" width="8" height="8" rx="2" opacity=".45"/>`,
      commits: `<circle cx="10" cy="10" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0 10H5M15 10H20" stroke="currentColor" stroke-width="2"/>`,
      prs: `<circle cx="4" cy="4" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="4" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 7V13M16 13V8C16 5 14 4 11 4" fill="none" stroke="currentColor" stroke-width="2"/>`,
      issues: `<circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 5V11" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="14.5" r="1.3"/>`,
      stars: `<polygon points="10,0 12.6,6.8 20,7.3 14.3,12 16.2,19.2 10,15.2 3.8,19.2 5.7,12 0,7.3 7.4,6.8"/>`,
      followers: `<circle cx="10" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M1.5 19C2.5 13 17.5 13 18.5 19" fill="none" stroke="currentColor" stroke-width="2"/>`,
      repos: `<rect x="2" y="1" width="16" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 6H14M6 10H14" stroke="currentColor" stroke-width="2"/>`,
    };
    const items = [
      ["total", "Contributions", stats.total], ["commits", "Commits", stats.commits], ["prs", "Pull Requests", stats.prs], ["issues", "Issues", stats.issues],
      ["stars", "Stars Earned", stats.stars], ["followers", "Followers", stats.followers], ["repos", "Repositories", stats.repos],
    ];
    const cw = 120, gap = 10;
    const cards = items.map(([k, label, v], i) => {
      const ri = v === 0 ? -1 : TH[k].filter((t) => v >= t).length;
      const col = ri < 0 ? C.mute : RCOL[ri];
      return `<g transform="translate(${i * (cw + gap)},0)" class="tc" style="animation-delay:${(i * 0.1).toFixed(1)}s">
<rect x=".5" y=".5" width="${cw - 1}" height="175" rx="14" fill="${C.panel}" stroke="${C.line}"/>
<rect x="18" y="0" width="${cw - 36}" height="3" rx="1.5" fill="${col}"/>
<g transform="translate(${cw / 2 - 10},20)" fill="${col}" color="${col}">${ICON[k]}</g>
<text x="${cw / 2}" y="86" text-anchor="middle" font-size="24" font-weight="800" fill="${C.text}">${Number(v).toLocaleString("en-US")}</text>
<text x="${cw / 2}" y="106" text-anchor="middle" font-size="10" fill="${C.mute}">${esc(label.toUpperCase())}</text>
<rect x="${cw / 2 - 36}" y="126" width="72" height="26" rx="13" fill="${col}" fill-opacity=".12" stroke="${col}" stroke-opacity=".6"/>
<text x="${cw / 2}" y="143" text-anchor="middle" font-size="11" font-weight="700" fill="${col}">${ri < 0 ? "NO RANK" : "RANK " + RANKS[ri]}</text>
</g>`;
    }).join("\n");
    save("trophies.svg", svg(900, 176, "GitHub trophies: " + items.map(([, l, v]) => `${l} ${v}`).join(", "),
      `<style>text{font-family:${FONT}}.tc{animation:rise .6s ease-out both}@keyframes rise{from{opacity:0;transform:translateY(12px)}}</style>\n${cards}`));
  }
}

/* ---------------------------------------------------------------------------------- footer */
{
  const q = "Replace legacy trust assumptions with cryptographic proof.";
  const body = `<defs>${grad("f")}</defs>
<style>text{font-family:${FONT}}.bk{animation:bk 1.2s steps(2,start) infinite}@keyframes bk{50%{opacity:.2}}.fl{stroke-dasharray:872;animation:dr 2s ease-out both}@keyframes dr{from{stroke-dashoffset:872}}</style>
<rect x=".5" y=".5" width="899" height="139" rx="18" fill="${C.panel}" stroke="${C.line}"/>
<path class="fl" d="M16 2 H884" stroke="url(#f)" stroke-width="3" stroke-linecap="round" fill="none"/>
<text x="450" y="44" text-anchor="middle" font-size="12" fill="${C.amber}">BLOCK #&#8734;<tspan fill="${C.mute}">  -  </tspan><tspan class="bk">pending</tspan></text>
<text x="450" y="84" text-anchor="middle" font-size="18" font-weight="700" fill="url(#f)">&quot;${esc(q)}&quot;</text>
<text x="450" y="116" text-anchor="middle" font-size="11" fill="${C.mute}">// signed: Shubham Mate</text>`;
  save("footer.svg", svg(900, 140, q, body));
}

console.log(`profile graphics written to ${OUT}/`);
