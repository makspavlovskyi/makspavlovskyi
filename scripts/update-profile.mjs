// Daily profile refresh, run by .github/workflows/update-profile.yml.
// 1. Draws the 5 most recently pushed repos as an activity card.
// 2. Measures what the public repos actually use and draws it as SVGs:
//    - languages: GitHub's own byte counts per repo, summed
//    - frameworks & tools: detected from package.json, requirements.txt,
//      pyproject.toml and config files, counted per repo
// No dependencies. Set FIXTURE=path.json to render from saved data instead of the API.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const USER = process.env.GH_USER ?? "makspavlovskyi";
const ROOT = new URL("../", import.meta.url);
const OUT = new URL("assets/generated/", ROOT);
const API = "https://api.github.com";
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": `${USER}-profile`,
  ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
};

async function gh(path) {
  const res = await fetch(API + path, { headers });
  if (res.status === 404 || res.status === 409) return null; // missing or empty repo
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

async function ghAll(path) {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!batch?.length) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

const MANIFEST = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml)$/;
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|\.next)\//;

async function collect() {
  if (process.env.FIXTURE) return JSON.parse(await readFile(process.env.FIXTURE, "utf8"));
  const repos = (await ghAll(`/users/${USER}/repos?type=owner&sort=pushed`))
    .filter((r) => !r.fork && !r.archived && r.name.toLowerCase() !== USER.toLowerCase());
  const out = [];
  for (const r of repos) {
    const languages = (await gh(`/repos/${r.full_name}/languages`)) ?? {};
    const tree = await gh(`/repos/${r.full_name}/git/trees/${r.default_branch}?recursive=1`);
    const files = (tree?.tree ?? []).filter((f) => f.type === "blob" && !SKIP_DIR.test(f.path)).map((f) => f.path);
    const manifests = {};
    for (const path of files.filter((p) => MANIFEST.test(p)).slice(0, 8)) {
      const c = await gh(`/repos/${r.full_name}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${r.default_branch}`);
      if (c?.content) manifests[path] = Buffer.from(c.content, "base64").toString("utf8");
    }
    out.push({ name: r.name, html_url: r.html_url, description: r.description, pushed_at: r.pushed_at, languages, files, manifests });
  }
  return out;
}

// ---------- detection ----------
const NPM = {
  react: "React", next: "Next.js", vue: "Vue", svelte: "Svelte", "@angular/core": "Angular",
  express: "Express", fastify: "Fastify", "@nestjs/core": "NestJS", koa: "Koa",
  tailwindcss: "Tailwind CSS", "styled-components": "styled-components", sass: "Sass",
  redux: "Redux", "@reduxjs/toolkit": "Redux", "@tanstack/react-query": "TanStack Query", zustand: "Zustand",
  graphql: "GraphQL", "@apollo/server": "GraphQL", "@apollo/client": "GraphQL",
  prisma: "Prisma", "@prisma/client": "Prisma", mongoose: "MongoDB", mongodb: "MongoDB",
  pg: "PostgreSQL", postgres: "PostgreSQL", mysql: "MySQL", mysql2: "MySQL", "drizzle-orm": "Drizzle", sequelize: "Sequelize",
  redis: "Redis", ioredis: "Redis", bullmq: "BullMQ", kafkajs: "Kafka", "socket.io": "Socket.IO",
  "@clerk/nextjs": "Clerk", "@clerk/express": "Clerk", "@clerk/clerk-sdk-node": "Clerk", "next-auth": "NextAuth",
  firebase: "Firebase", "firebase-admin": "Firebase", "@supabase/supabase-js": "Supabase", stripe: "Stripe", minio: "MinIO",
  jest: "Jest", vitest: "Vitest", "@playwright/test": "Playwright", cypress: "Cypress", mocha: "Mocha",
  vite: "Vite", webpack: "webpack", electron: "Electron", three: "Three.js", zod: "Zod",
  commander: "Commander", inquirer: "Inquirer", openai: "OpenAI API", "@anthropic-ai/sdk": "Claude API",
  remotion: "Remotion", "react-native": "React Native", expo: "Expo",
};
const PY = {
  fastapi: "FastAPI", django: "Django", flask: "Flask", sqlalchemy: "SQLAlchemy", pydantic: "Pydantic",
  pandas: "pandas", numpy: "NumPy", "scikit-learn": "scikit-learn", torch: "PyTorch", tensorflow: "TensorFlow",
  transformers: "Hugging Face", "opencv-python": "OpenCV", streamlit: "Streamlit", celery: "Celery", pytest: "pytest",
};
const FILES = [
  [/(^|\/)Dockerfile[^/]*$/, "Docker"],
  [/(^|\/)(docker-)?compose\.ya?ml$/, "Docker Compose"],
  [/^\.github\/workflows\/[^/]+\.ya?ml$/, "GitHub Actions"],
  [/(^|\/)nginx[^/]*\.conf$/, "Nginx"],
  [/\.tf$/, "Terraform"],
  [/(^|\/)vercel\.json$/, "Vercel"],
  [/(^|\/)(k8s|kubernetes)\/|(^|\/)Chart\.yaml$/, "Kubernetes"],
];

function detect(repo) {
  const found = new Set();
  for (const [path, text] of Object.entries(repo.manifests ?? {})) {
    if (path.endsWith("package.json")) {
      let pkg = {};
      try { pkg = JSON.parse(text); } catch { continue; }
      const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      for (const d of Object.keys(deps)) if (NPM[d]) found.add(NPM[d]);
    } else {
      for (const [key, label] of Object.entries(PY)) {
        if (new RegExp(`(^|["'\\s])${key.replace(/[-]/g, "[-_]")}([<>=~!\\[\\s"';,]|$)`, "mi").test(text)) found.add(label);
      }
    }
  }
  for (const f of repo.files ?? []) for (const [re, label] of FILES) if (re.test(f)) found.add(label);
  return found;
}

// ---------- drawing ----------
const SANS = '-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,&quot;Noto Sans&quot;,Helvetica,Arial,sans-serif';
const THEME = {
  light: { bg: "#ffffff", soft: "#eff2f5", border: "#d0d7de", fg: "#1f2328", muted: "#59636e", bar: "#c2410c", link: "#0969da" },
  dark: { bg: "#0d1117", soft: "#21262d", border: "#30363d", fg: "#e6edf3", muted: "#9198a1", bar: "#e0703f", link: "#4493f8" },
};
const LANG_COLOR = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5", HTML: "#e34c26", CSS: "#563d7c", SCSS: "#c6538c",
  Java: "#b07219", "C++": "#f34b7d", C: "#555555", "C#": "#178600", Go: "#00ADD8", Rust: "#dea584", PHP: "#4F5D95",
  Shell: "#89e051", Dockerfile: "#384d54", GDScript: "#355570", "Jupyter Notebook": "#DA5B0B", Vue: "#41b883",
  Svelte: "#ff3e00", Kotlin: "#A97BFF", Swift: "#F05138", Dart: "#00B4AB", Makefile: "#427819", PLpgSQL: "#336790",
};

// Theme: colours + background layout come from profile.config.json (same layouts as the README generator).
const CFG = JSON.parse(await readFile(new URL("profile.config.json", ROOT), "utf8"));
const LAYOUT = process.env.PROFILE_LAYOUT ?? CFG.layout;
const PAL = CFG.palettes[process.env.PROFILE_PALETTE ?? CFG.palette];
const [COPPER, TEAL] = PAL.colors;            // first and second colour of the palette
const ACCENT = PAL.accent ?? COPPER;
const EFF = (mode) => (PAL.always_dark ? "dark" : mode); // cards stay dark on GitHub's light theme
const BASE = { light: "#ffffff", dark: PAL.dark?.base ?? "#0d1117" };
for (const [k, v] of Object.entries(PAL.dark ?? {})) if (k in THEME.dark) THEME.dark[k] = v;
THEME.dark.bg = BASE.dark;
if (!PAL.dark?.bar) THEME.light.bar = ACCENT;
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => "#" + hex(a).map((x, i) => Math.round(x + (hex(b)[i] - x) * t).toString(16).padStart(2, "0")).join("");
const tones = (mode) => (EFF(mode) === "light" ? [COPPER, TEAL] : [mix(COPPER, "#ffffff", 0.12), mix(TEAL, "#ffffff", 0.12)]);
const GLOW = { light: { base: BASE.light }, dark: { base: BASE.dark } };
const f1 = (n) => n.toFixed(1);
function lcg(seed) { // mirrors lcg() in the generator; BigInt keeps the maths exact
  let s = BigInt(seed);
  return () => { s = (s * 1103515245n + 12345n) % 2147483648n; return Number(s) / 2147483648; };
}
function pattern(layout, w, h, mode) {
  const [ea, eb] = tones(mode), base = BASE[mode], hh = Math.min(h, 200);
  if (layout === "starlines" || layout === "starlines_bright" || layout === "starlines_glow") {
    const strong = layout !== "starlines";
    const cx = w * 0.82, cy = h * 0.5, rnd = lcg(1241); let out = "";
    const [n, op, sw, reach] = strong ? [160, 0.85, 1.2, 0.6] : [120, 0.5, 0.8, 0.5];
    const ca = strong && EFF(mode) === "dark" ? mix(ea, "#ffffff", 0.25) : ea;
    for (let i = 0; i < n; i++) {
      const ang = rnd() * 2 * Math.PI, ln = hh * (0.12 + rnd() * reach), c = rnd() < 0.5 ? ca : eb;
      out += `<line x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(cx + Math.cos(ang) * ln)}" y2="${f1(cy + Math.sin(ang) * ln)}" stroke="${c}" stroke-opacity="${op}" stroke-width="${sw}" stroke-linecap="round"/>`;
    }
    if (!strong) return ["", out];
    const fx = (cx / w).toFixed(3);
    let defs = `<radialGradient id="core" cx="${fx}" cy=".5" r="${(hh * 0.45 / w).toFixed(3)}" gradientTransform="translate(${fx} .5) scale(1 ${(w / h).toFixed(3)}) translate(-${fx} -.5)">`
      + `<stop offset="0" stop-color="${ca}" stop-opacity=".55"/><stop offset="1" stop-color="${ca}" stop-opacity="0"/></radialGradient>`;
    if (layout === "starlines_glow") {
      defs += `<filter id="sg" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${(hh * 0.012).toFixed(1)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
      out = `<g filter="url(#sg)">${out}</g>`;
    }
    return [defs, `<rect width="${w}" height="${h}" fill="url(#core)"/>` + out + `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${(hh * 0.03).toFixed(1)}" fill="#ffffff" fill-opacity=".9"/>`];
  }
  if (layout === "marble") {
    const [fx, fy] = w > 500 ? [0.006, 0.012] : [0.012, 0.02];
    return [`<linearGradient id="lq" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ea}"/><stop offset=".5" stop-color="${base}"/><stop offset="1" stop-color="${eb}"/></linearGradient>`
      + `<filter id="lf" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${fx} ${fy}" numOctaves="3" seed="4"/>`
      + `<feDisplacementMap in="SourceGraphic" scale="${Math.round(hh * 0.9)}" xChannelSelector="R" yChannelSelector="G"/></filter>`,
      `<rect x="${Math.round(-w * 0.2)}" y="${Math.round(-h * 0.7)}" width="${Math.round(w * 1.4)}" height="${Math.round(h * 2.4)}" fill="url(#lq)" fill-opacity=".75" filter="url(#lf)"/>`];
  }
  if (layout === "stripes") {
    const a = mode === "light" ? mix(COPPER, "#ffffff", 0.62) : mix(COPPER, base, 0.35);
    const b = mode === "light" ? mix(TEAL, "#ffffff", 0.62) : mix(TEAL, base, 0.35);
    const bands = [0.58, 0.68, 0.77, 0.85, 0.92].map((p, i) => `<rect x="${f1(w * p)}" y="${-h}" width="${Math.round(w * 0.06)}" height="${h * 3}" transform="rotate(28 ${f1(w * p)} ${h / 2})" fill="url(#st)" fill-opacity="${((0.55 - i * 0.07) * 0.7).toFixed(2)}"/>`).join("");
    return [`<linearGradient id="st" x1="0" x2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><filter id="sb"><feGaussianBlur stdDeviation="${Math.round(hh * 0.04)}"/></filter>`,
      `<g filter="url(#sb)">${bands}</g>`];
  }
  if (layout === "topographic") {
    const cx = w * 0.8, cy = h * 0.55; let out = "";
    for (let i = 1; i < 14; i++) {
      const rr = i * Math.max(w, hh) * 0.045, pts = [];
      for (let k = 0; k < 48; k++) {
        const tt = (k / 48) * 2 * Math.PI, j = 1 + 0.12 * Math.sin(3 * tt + i * 0.7) + 0.06 * Math.sin(5 * tt - i);
        pts.push(`${f1(cx + Math.cos(tt) * rr * j * 1.5)},${f1(cy + Math.sin(tt) * rr * j)}`);
      }
      out += `<polygon points="${pts.join(" ")}" fill="none" stroke="${i % 2 ? ea : eb}" stroke-opacity="${(0.55 - i * 0.03).toFixed(2)}" stroke-width="1"/>`;
    }
    return ["", out];
  }
  throw new Error(`unknown layout ${layout}`);
}
function surface(w, h, mode, strength = 0.55, rx = 10) {
  const [ea, eb] = tones(mode), base = BASE[mode];
  const [lo, mid, hi] = LAYOUT === "starlines_bright" || LAYOUT === "starlines_glow" ? [0.06, 0.3, 0.65] : [0.05, 0.18, 0.42]; // cards carry text
  const [pdefs, body] = pattern(LAYOUT, w, h, mode);
  return `<defs>${pdefs}<linearGradient id="fd" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="${lo}"/><stop offset=".45" stop-color="#fff" stop-opacity="${mid}"/><stop offset=".7" stop-color="#fff" stop-opacity="${hi}"/></linearGradient>`
    + `<mask id="fm"><rect width="${w}" height="${h}" fill="url(#fd)"/></mask>`
    + `<clipPath id="clip"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${rx}"/></clipPath>`
    + `<linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ea}" stop-opacity=".55"/><stop offset="1" stop-color="${eb}" stop-opacity=".55"/></linearGradient></defs>`
    + `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="${base}"/>`
    + `<g clip-path="url(#clip)"><g mask="url(#fm)">${body}</g></g>`
    + `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="none" stroke="url(#edge)"/>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const W = 880;

function languagesSvg(langs, repoCount, mode) {
  const t = THEME[mode];
  const total = langs.reduce((s, [, b]) => s + b, 0) || 1;
  const top = langs.slice(0, 8);
  const rest = langs.slice(8).reduce((s, [, b]) => s + b, 0);
  if (rest) top.push(["Other", rest]);
  const rows = Math.ceil(top.length / 3);
  const H = 92 + rows * 26;
  let x = 24, bar = "", legend = "";
  const bw = W - 48;
  top.forEach(([name, bytes], i) => {
    const w = Math.max(2, (bytes / total) * bw);
    const color = LANG_COLOR[name] ?? (name === "Other" ? t.muted : "#8b949e");
    bar += `<rect x="${x.toFixed(1)}" y="52" width="${w.toFixed(1)}" height="10" fill="${color}"/>`;
    x += w;
    const col = i % 3, row = Math.floor(i / 3);
    const lx = 24 + col * ((W - 48) / 3), ly = 92 + row * 26;
    const pct = ((bytes / total) * 100).toFixed(1);
    legend += `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${color}"/>`
      + `<text x="${lx + 18}" y="${ly}" fill="${t.fg}" font-family="${SANS}" font-size="13" font-weight="500">${esc(name)}`
      + ` <tspan fill="${t.muted}" font-weight="400" style="font-variant-numeric:tabular-nums">${pct}%</tspan></text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Languages by code size across ${repoCount} public repositories: ${top.map(([n, b]) => `${n} ${((b / total) * 100).toFixed(1)}%`).join(", ")}">`
    + surface(W, H, mode)
    + `<text x="24" y="34" fill="${t.fg}" font-family="${SANS}" font-size="14" font-weight="600">Languages <tspan fill="${t.muted}" font-weight="400">· share of code across ${repoCount} public repos</tspan></text>`
    + `<clipPath id="r"><rect x="24" y="52" width="${bw}" height="10" rx="5"/></clipPath><g clip-path="url(#r)">${bar}</g>`
    + legend + `</svg>\n`;
}

// Rough text width for system sans (no font files in CI): narrow, wide and default glyphs.
const textW = (s, size) => [...s].reduce((w, c) => w + (/[ilj.,:;'|!I]/.test(c) ? 0.28 : /[mwMW]/.test(c) ? 0.86 : /[A-Z]/.test(c) ? 0.66 : 0.55), 0) * size;

function toolsSvg(tools, repoCount, mode) {
  const t = THEME[mode];
  const pad = 24, gap = 8, h = 30, top = 52;
  let x = pad, y = top, chips = "";
  for (const [name, n] of tools) {
    const nameW = textW(name, 13), countW = textW(String(n), 12) + 14;
    const w = Math.round(12 + nameW + 8 + countW + 5);
    if (x + w > W - pad) { x = pad; y += h + gap; }
    chips += `<g transform="translate(${x} ${y})">`
      + `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${h / 2}" fill="${t.bg}" fill-opacity="0.75" stroke="${t.border}"/>`
      + `<text x="12" y="19.5" fill="${t.fg}" font-family="${SANS}" font-size="13" font-weight="500">${esc(name)}</text>`
      + `<rect x="${w - countW - 5}" y="5" width="${countW}" height="20" rx="10" fill="${n > 1 ? t.bar : t.soft}"/>`
      + `<text x="${w - 5 - countW / 2}" y="19" text-anchor="middle" fill="${n > 1 ? t.bg : t.muted}" font-family="${SANS}" font-size="12" font-weight="600" style="font-variant-numeric:tabular-nums">${n}</text>`
      + `</g>`;
    x += w + gap;
  }
  if (!tools.length) chips = `<text x="${pad}" y="${top + 18}" fill="${t.muted}" font-family="${SANS}" font-size="13">No frameworks detected yet.</text>`;
  const H = y + h + 22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Frameworks and tools found in ${repoCount} public repositories, with the number of repos using each: ${tools.map(([n, c]) => `${n} ${c}`).join(", ")}">`
    + surface(W, H, mode)
    + `<text x="${pad}" y="34" fill="${t.fg}" font-family="${SANS}" font-size="14" font-weight="600">Frameworks &amp; tools <tspan fill="${t.muted}" font-weight="400">· number of repos using each, from dependencies and config files</tspan></text>`
    + chips + `</svg>\n`;
}

// ---------- activity card ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fit(s, size, maxW) {
  if (textW(s, size) <= maxW) return s;
  while (s.length > 1 && textW(s + "…", size) > maxW) s = s.slice(0, -1);
  return s.trimEnd() + "…";
}

function activitySvg(recent, mode) {
  const t = THEME[mode];
  const rowH = 58, top = 58, lineX = 128;
  const H = top + (Math.max(1, recent.length) - 1) * rowH + 56;
  let rows = "";
  recent.forEach((r, i) => {
    const y = top + i * rowH;
    const d = new Date(r.active_at);
    const lang = Object.entries(r.languages ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
    const color = LANG_COLOR[lang] ?? "#8b949e";
    const langW = lang ? textW(lang, 12) + 22 : 0;
    const textMax = W - 24 - langW - (lineX + 24) - 16;
    const desc = r.description?.trim() ? fit(r.description.trim(), 13, textMax) : "";
    rows += `<text x="${lineX - 22}" y="${y + 13}" text-anchor="end" fill="${t.fg}" font-family="${SANS}" font-size="13" font-weight="500" style="font-variant-numeric:tabular-nums">${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}</text>`
      + `<text x="${lineX - 22}" y="${y + 31}" text-anchor="end" fill="${t.muted}" font-family="${SANS}" font-size="12" style="font-variant-numeric:tabular-nums">${d.getUTCFullYear()}</text>`
      + `<circle cx="${lineX}" cy="${y + 8}" r="6" fill="${i === 0 ? t.bar : GLOW[mode].base}" stroke="${i === 0 ? t.bar : t.border}" stroke-width="2"/>`
      + `<text x="${lineX + 24}" y="${y + 13}" fill="${t.link}" font-family="${SANS}" font-size="14" font-weight="600">${esc(fit(r.name, 14, textMax))}</text>`
      + (desc ? `<text x="${lineX + 24}" y="${y + 32}" fill="${t.muted}" font-family="${SANS}" font-size="13">${esc(desc)}</text>` : "")
      + (lang ? `<circle cx="${W - 24 - langW + 5}" cy="${y + 9}" r="5" fill="${color}"/><text x="${W - 24}" y="${y + 13}" text-anchor="end" fill="${t.muted}" font-family="${SANS}" font-size="12">${esc(lang)}</text>` : "");
  });
  if (!recent.length) rows = `<text x="24" y="${top + 13}" fill="${t.muted}" font-family="${SANS}" font-size="13">No public activity yet.</text>`;
  const line = recent.length > 1 ? `<path d="M${lineX} ${top + 8} V${top + (recent.length - 1) * rowH + 8}" stroke="${t.border}" stroke-width="2"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Recently worked on: ${recent.map((r) => `${r.name} on ${r.active_at.slice(0, 10)}`).join(", ")}">`
    + surface(W, H, mode)
    + `<text x="24" y="34" fill="${t.fg}" font-family="${SANS}" font-size="14" font-weight="600">Recently pushed <tspan fill="${t.muted}" font-weight="400">· my 5 latest public repos</tspan></text>`
    + line + rows + `</svg>\n`;
}

// README images can't hold links, so the README shows one small card per repo, each wrapped in
// its own link. GitHub leaves ~6px between stacked images; the timeline runs through each card
// so the gaps read as spacing, not cuts.
function activityRowSvg(r, i, count, mode) {
  const t = THEME[mode];
  const H = 66, lineX = 128, dotY = 26;
  const d = new Date(r.active_at);
  const lang = Object.entries(r.languages ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  const color = LANG_COLOR[lang] ?? "#8b949e";
  const langW = lang ? textW(lang, 12) + 22 : 0;
  const textMax = W - 24 - langW - (lineX + 24) - 16;
  const desc = r.description?.trim() ? fit(r.description.trim(), 13, textMax) : "";
  const line = (i > 0 ? `<path d="M${lineX} 0 V${dotY}" stroke="${t.border}" stroke-width="2"/>` : "")
    + (i < count - 1 ? `<path d="M${lineX} ${dotY} V${H}" stroke="${t.border}" stroke-width="2"/>` : "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(r.name)}, last code change ${r.active_at.slice(0, 10)}">`
    + `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${BASE[mode]}" stroke="${t.border}"/>`
    + line
    + `<text x="${lineX - 22}" y="${dotY + 5}" text-anchor="end" fill="${t.fg}" font-family="${SANS}" font-size="13" font-weight="500" style="font-variant-numeric:tabular-nums">${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}</text>`
    + `<text x="${lineX - 22}" y="${dotY + 23}" text-anchor="end" fill="${t.muted}" font-family="${SANS}" font-size="12" style="font-variant-numeric:tabular-nums">${d.getUTCFullYear()}</text>`
    + `<circle cx="${lineX}" cy="${dotY}" r="6" fill="${i === 0 ? t.bar : BASE[mode]}" stroke="${i === 0 ? t.bar : t.border}" stroke-width="2"/>`
    + `<text x="${lineX + 24}" y="${dotY + 5}" fill="${t.link}" font-family="${SANS}" font-size="14" font-weight="600">${esc(fit(r.name, 14, textMax))} <tspan fill="${t.muted}" font-weight="400">↗</tspan></text>`
    + (desc ? `<text x="${lineX + 24}" y="${dotY + 24}" fill="${t.muted}" font-family="${SANS}" font-size="13">${esc(desc)}</text>` : "")
    + (lang ? `<circle cx="${W - 24 - langW + 5}" cy="${dotY + 1}" r="5" fill="${color}"/><text x="${W - 24}" y="${dotY + 5}" text-anchor="end" fill="${t.muted}" font-family="${SANS}" font-size="12">${esc(lang)}</text>` : "")
    + `</svg>\n`;
}

// ---------- main ----------
const repos = await collect();
const langTotals = {};
const toolRepos = {};
for (const r of repos) {
  for (const [l, b] of Object.entries(r.languages ?? {})) langTotals[l] = (langTotals[l] ?? 0) + b;
  for (const tool of detect(r)) (toolRepos[tool] ??= new Set()).add(r.name);
}
const langs = Object.entries(langTotals).sort((a, b) => b[1] - a[1]);
const tools = Object.entries(toolRepos).map(([k, s]) => [k, s.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

// Timeline dates come from the last commit that changed code, not GitHub's pushed_at:
// a README tidy-up or a package.json link fix shouldn't make a repo look worked on today.
const DOC = /(^|\/)[^/]+\.(md|markdown)$|(^|\/)LICENSE[^/]*$/i;
const linksOnly = (f) => /(^|\/)package\.json$/.test(f.filename) && f.patch
  && f.patch.split("\n").filter((l) => /^[+-](?![+-])/.test(l)).every((l) => /"(url|homepage)"\s*:/.test(l));
async function lastCodeChange(r) {
  if (process.env.FIXTURE) return r.pushed_at;
  const full = new URL(r.html_url).pathname.slice(1);
  for (const c of (await gh(`/repos/${full}/commits?per_page=30`)) ?? []) {
    const detail = await gh(`/repos/${full}/commits/${c.sha}`);
    if (detail?.files?.some((f) => !DOC.test(f.filename) && !linksOnly(f))) return c.commit.author.date;
  }
  return r.pushed_at;
}
const EXCLUDE = new Set((CFG.activity_exclude ?? []).map((n) => n.toLowerCase()));
const candidates = repos.filter((r) => !EXCLUDE.has(r.name.toLowerCase()))
  .sort((a, b) => b.pushed_at.localeCompare(a.pushed_at));
const dated = [];
for (const r of candidates) {
  // active_at <= pushed_at, so once 5 are dated, older pushes can't make the list
  const fifth = [...dated].sort((a, b) => b.active_at.localeCompare(a.active_at))[4];
  if (fifth && r.pushed_at < fifth.active_at) break;
  dated.push({ ...r, active_at: await lastCodeChange(r) });
}
const recent = dated.sort((a, b) => b.active_at.localeCompare(a.active_at)).slice(0, 5);
await mkdir(OUT, { recursive: true });
for (const mode of ["light", "dark"]) {
  const m = EFF(mode);
  await writeFile(new URL(`languages-${mode}.svg`, OUT), languagesSvg(langs, repos.length, m));
  await writeFile(new URL(`tools-${mode}.svg`, OUT), toolsSvg(tools, repos.length, m));
  await writeFile(new URL(`activity-${mode}.svg`, OUT), activitySvg(recent, m));
  for (const [i, r] of recent.entries())
    await writeFile(new URL(`activity-${mode}-${i}.svg`, OUT), activityRowSvg(r, i, recent.length, m));
}

const rows = recent.map((r, i) => `<a href="${r.html_url}"><picture>`
  + `<source media="(prefers-color-scheme: dark)" srcset="assets/generated/activity-dark-${i}.svg">`
  + `<img src="assets/generated/activity-light-${i}.svg" alt="${esc(r.name)}, last code change ${r.active_at.slice(0, 10)}" width="100%"></picture></a>`).join("<br>\n");
const activityMd = recent.length
  ? `Recently worked on · last code change in my public repos, click one to open it\n\n${rows}`
  : "No public activity yet.";
const readmeUrl = new URL("README.md", ROOT);
const readme = await readFile(readmeUrl, "utf8");
let filled = readme.replace(/(<!-- activity:start[^>]*-->\n)[\s\S]*?(<!-- activity:end -->)/, `$1${activityMd}\n$2`);
// GitHub caches repo images for 5 minutes; tagging each local SVG with a hash of its content
// makes a changed image a new URL, so edits show up on the profile right away.
const tagged = [];
for (const m of filled.matchAll(/(assets\/[^"?\s]+\.svg)(\?v=[0-9a-f]+)?/g)) tagged.push(m[1]);
for (const path of new Set(tagged)) {
  const hash = createHash("sha1").update(await readFile(new URL(path, ROOT))).digest("hex").slice(0, 8);
  filled = filled.replaceAll(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?v=[0-9a-f]+)?(?=")`, "g"), `${path}?v=${hash}`);
}
if (filled !== readme) await writeFile(readmeUrl, filled);
await writeFile(new URL("stats.json", OUT), JSON.stringify({
  repos: repos.length,
  languages: Object.fromEntries(langs),
  tools: Object.fromEntries(Object.entries(toolRepos).map(([k, s]) => [k, [...s].sort()])),
}, null, 2) + "\n");
console.log(`${repos.length} repos · ${langs.length} languages · ${tools.length} tools`);
