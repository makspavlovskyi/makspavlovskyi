// Daily profile refresh, run by .github/workflows/update-profile.yml.
// 1. Draws the 5 most recently pushed repos as an activity card.
// 2. Measures what the public repos actually use and draws it as SVGs:
//    - languages: GitHub's own byte counts per repo, summed
//    - frameworks & tools: detected from package.json, requirements.txt,
//      pyproject.toml and config files, counted per repo
// No dependencies. Set FIXTURE=path.json to render from saved data instead of the API.
import { readFile, writeFile, mkdir } from "node:fs/promises";

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

// Theme: Copper Teal × Stripes (palette 23, layout K), same values as the banner and project cards.
const COPPER = "#c2410c", TEAL = "#0f766e";
const BASE = { light: "#ffffff", dark: "#0d1117" };
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => "#" + hex(a).map((x, i) => Math.round(x + (hex(b)[i] - x) * t).toString(16).padStart(2, "0")).join("");
const tones = (mode) => mode === "light"
  ? [mix(COPPER, "#ffffff", 0.62), mix(TEAL, "#ffffff", 0.62), COPPER, TEAL]
  : [mix(COPPER, BASE.dark, 0.35), mix(TEAL, BASE.dark, 0.35), mix(COPPER, "#ffffff", 0.1), mix(TEAL, "#ffffff", 0.1)];
const GLOW = { light: { base: BASE.light }, dark: { base: BASE.dark } };
function surface(w, h, mode, strength = 0.55, rx = 10) {
  const [a, b, ea, eb] = tones(mode), k = strength >= 1 ? 1 : 0.7;
  const bands = [0.58, 0.68, 0.77, 0.85, 0.92].map((p, i) => {
    const x = (w * p).toFixed(1);
    return `<rect x="${x}" y="${-h}" width="${Math.round(w * 0.06)}" height="${h * 3}" transform="rotate(28 ${x} ${h / 2})" fill="url(#st)" fill-opacity="${((0.55 - i * 0.07) * k).toFixed(2)}"/>`;
  }).join("");
  return `<defs><linearGradient id="st" x1="0" x2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
    + `<filter id="sb"><feGaussianBlur stdDeviation="${Math.round(h * 0.04)}"/></filter>`
    + `<clipPath id="clip"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${rx}"/></clipPath>`
    + `<linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ea}" stop-opacity=".55"/><stop offset="1" stop-color="${eb}" stop-opacity=".55"/></linearGradient></defs>`
    + `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="${BASE[mode]}"/>`
    + `<g clip-path="url(#clip)"><g filter="url(#sb)">${bands}</g></g>`
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

function activitySvg(repos, mode) {
  const t = THEME[mode];
  const recent = [...repos].sort((a, b) => b.pushed_at.localeCompare(a.pushed_at)).slice(0, 5);
  const rowH = 58, top = 58, lineX = 128;
  const H = top + (Math.max(1, recent.length) - 1) * rowH + 56;
  let rows = "";
  recent.forEach((r, i) => {
    const y = top + i * rowH;
    const d = new Date(r.pushed_at);
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Recently pushed repositories: ${recent.map((r) => `${r.name} on ${r.pushed_at.slice(0, 10)}`).join(", ")}">`
    + surface(W, H, mode)
    + `<text x="24" y="34" fill="${t.fg}" font-family="${SANS}" font-size="14" font-weight="600">Recently pushed <tspan fill="${t.muted}" font-weight="400">· my 5 latest public repos</tspan></text>`
    + line + rows + `</svg>\n`;
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

await mkdir(OUT, { recursive: true });
for (const mode of ["light", "dark"]) {
  await writeFile(new URL(`languages-${mode}.svg`, OUT), languagesSvg(langs, repos.length, mode));
  await writeFile(new URL(`tools-${mode}.svg`, OUT), toolsSvg(tools, repos.length, mode));
  await writeFile(new URL(`activity-${mode}.svg`, OUT), activitySvg(repos, mode));
}
await writeFile(new URL("stats.json", OUT), JSON.stringify({
  repos: repos.length,
  languages: Object.fromEntries(langs),
  tools: Object.fromEntries(Object.entries(toolRepos).map(([k, s]) => [k, [...s].sort()])),
}, null, 2) + "\n");
console.log(`${repos.length} repos · ${langs.length} languages · ${tools.length} tools`);
