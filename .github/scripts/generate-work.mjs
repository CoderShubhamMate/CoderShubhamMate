/**
 * Work summary graphic: public + private repository counts and contribution counts.
 * Counts only - no private repository names are ever read or shown.
 * Zero dependencies, Node 18+.  Needs GH_USER and a token (a classic PAT with `repo` + `read:user` to see private work).
 */
import { mkdirSync, writeFileSync } from "node:fs";

const env = process.env;
const OUT = env.OUT_DIR || "dist";
const USER = env.GH_USER || env.GITHUB_REPOSITORY_OWNER || "";
const TOKEN = env.GITHUB_TOKEN || env.GH_TOKEN || "";
mkdirSync(OUT, { recursive: true });

const FONT = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
const C = { panel: "#0b1120", line: "#1e293b", cyan: "#22d3ee", violet: "#8b5cf6", pink: "#f472b6", text: "#f8fafc", soft: "#cbd5e1", mute: "#64748b" };
const fmt = (n) => Number(n).toLocaleString("en-US");

async function fetchWork() {
  if (env.MOCK === "1") return { pubRepos: 6, privRepos: 11, total: 842, privContribs: 517 };
  if (!USER || !TOKEN) throw new Error("GH_USER and GITHUB_TOKEN are required");
  const byRepo = (f) => `${f}(maxRepositories:100){repository{isPrivate} contributions{totalCount}}`;
  const query = `query($login:String!){user(login:$login){
    pub:repositories(privacy:PUBLIC,ownerAffiliations:OWNER,isFork:false){totalCount}
    priv:repositories(privacy:PRIVATE,ownerAffiliations:OWNER,isFork:false){totalCount}
    contributionsCollection{
      restrictedContributionsCount
      contributionCalendar{totalContributions}
      ${byRepo("commitContributionsByRepository")}
      ${byRepo("issueContributionsByRepository")}
      ${byRepo("pullRequestContributionsByRepository")}
      ${byRepo("pullRequestReviewContributionsByRepository")}
    }}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "work-summary" },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const u = json.data.user, cc = u.contributionsCollection;
  let priv = cc.restrictedContributionsCount || 0; // contributions GitHub hides from the viewer
  for (const k of ["commitContributionsByRepository", "issueContributionsByRepository", "pullRequestContributionsByRepository", "pullRequestReviewContributionsByRepository"])
    for (const r of cc[k]) if (r.repository.isPrivate) priv += r.contributions.totalCount;
  return { pubRepos: u.pub.totalCount, privRepos: u.priv.totalCount, total: cc.contributionCalendar.totalContributions, privContribs: priv };
}

let w = null;
try {
  w = await fetchWork();
  if (w.privRepos === 0 && env.MOCK !== "1")
    console.warn("NOTE: 0 private repositories found. If you do have private repos, GH_PAT must be a classic token with the `repo` and `read:user` scopes.");
} catch (e) {
  console.warn("WARNING: could not load work summary:", e.message);
}

const H = 214;
let body;
if (!w) {
  body = `<text x="450" y="${H / 2 + 4}" text-anchor="middle" font-size="12" fill="${C.mute}">// work summary unavailable right now - it refreshes on the next run</text>`;
} else {
  const privC = Math.min(w.privContribs, w.total), pubC = w.total - privC;
  const lock = (x, y, col) => `<g transform="translate(${x},${y})"><rect x="0" y="5" width="12" height="9" rx="2" fill="${col}"/><path d="M3 5V3.5a3 3 0 0 1 6 0V5" fill="none" stroke="${col}" stroke-width="1.8"/></g>`;
  const card = (x, title, total, sub, a, b) => {
    const BW = 392, f = total > 0 ? a / total : 1, wa = Math.round(BW * f), wb = BW - wa;
    return `<g transform="translate(${x},0)" class="cd">
<rect x=".5" y=".5" width="439" height="${H - 36}" rx="16" fill="${C.panel}" stroke="${C.line}"/>
<rect x="24" y="0" width="392" height="3" rx="1.5" fill="url(#g)"/>
<text x="24" y="34" font-size="11" font-weight="700" letter-spacing="2" fill="${C.cyan}">${title}</text>
<text x="24" y="86" font-size="46" font-weight="800" fill="url(#g)">${fmt(total)}</text>
<text x="${24 + String(fmt(total)).length * 28 + 12}" y="84" font-size="12" fill="${C.mute}">${sub}</text>
<g transform="translate(24,104)"><rect width="${BW}" height="12" rx="6" fill="${C.line}"/>
<rect class="bar" width="${wa}" height="12" rx="6" fill="${C.cyan}"/>${wb > 0 ? `<rect class="bar" x="${wa}" width="${wb}" height="12" rx="6" fill="${C.violet}"/>` : ""}</g>
<circle cx="30" cy="146" r="4.5" fill="${C.cyan}"/><text x="42" y="150" font-size="13" fill="${C.text}">${fmt(a)} <tspan fill="${C.mute}">public</tspan></text>
${lock(196, 138, C.violet)}<text x="214" y="150" font-size="13" fill="${C.text}">${fmt(b)} <tspan fill="${C.mute}">private</tspan></text>
</g>`;
  };
  body = `${card(0, "REPOSITORIES", w.pubRepos + w.privRepos, "public + private", w.pubRepos, w.privRepos)}
${card(460, "CONTRIBUTIONS - LAST 12 MONTHS", w.total, "public + private", pubC, privC)}
<text x="450" y="${H - 8}" text-anchor="middle" font-size="11" fill="${C.mute}">// counts only - private repository names and code stay private</text>`;
}

const label = w
  ? `Work summary: ${w.pubRepos + w.privRepos} repositories (${w.pubRepos} public, ${w.privRepos} private); ${w.total} contributions in the last 12 months, ${Math.min(w.privContribs, w.total)} of them in private repositories`
  : "Work summary unavailable";
writeFileSync(`${OUT}/work.svg`, `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 ${H}" width="900" height="${H}" role="img" aria-label="${label}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.cyan}"/><stop offset=".5" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}"/></linearGradient></defs>
<style>text{font-family:${FONT}}.cd{animation:rise .6s ease-out both}@keyframes rise{from{opacity:0;transform:translateY(10px)}}.bar{transform-box:fill-box;transform-origin:left center;animation:grow 1.3s ease-out .3s both}@keyframes grow{from{transform:scaleX(0)}}</style>
${body}
</svg>
`, "utf8");
console.log("work.svg written to " + OUT + (w ? ` (${w.pubRepos} public + ${w.privRepos} private repos, ${w.privContribs} private contributions)` : " (placeholder)"));
