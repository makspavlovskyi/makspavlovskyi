// Daily profile refresh, run by .github/workflows/update-profile.yml.
// 1. Rewrites the "latest activity" block in README.md.
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
  light: { bg: "#ffffff", soft: "#eff2f5", border: "#d0d7de", fg: "#1f2328", muted: "#59636e", bar: "#2da44e" },
  dark: { bg: "#0d1117", soft: "#21262d", border: "#30363d", fg: "#e6edf3", muted: "#9198a1", bar: "#3fb950" },
};
const LANG_COLOR = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5", HTML: "#e34c26", CSS: "#563d7c", SCSS: "#c6538c",
  Java: "#b07219", "C++": "#f34b7d", C: "#555555", "C#": "#178600", Go: "#00ADD8", Rust: "#dea584", PHP: "#4F5D95",
  Shell: "#89e051", Dockerfile: "#384d54", GDScript: "#355570", "Jupyter Notebook": "#DA5B0B", Vue: "#41b883",
  Svelte: "#ff3e00", Kotlin: "#A97BFF", Swift: "#F05138", Dart: "#00B4AB", Makefile: "#427819", PLpgSQL: "#336790",
};
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
    + `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>`
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
      + `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${h / 2}" fill="${t.bg}" stroke="${t.border}"/>`
      + `<text x="12" y="19.5" fill="${t.fg}" font-family="${SANS}" font-size="13" font-weight="500">${esc(name)}</text>`
      + `<rect x="${w - countW - 5}" y="5" width="${countW}" height="20" rx="10" fill="${n > 1 ? t.bar : t.soft}"/>`
      + `<text x="${w - 5 - countW / 2}" y="19" text-anchor="middle" fill="${n > 1 ? t.bg : t.muted}" font-family="${SANS}" font-size="12" font-weight="600" style="font-variant-numeric:tabular-nums">${n}</text>`
      + `</g>`;
    x += w + gap;
  }
  if (!tools.length) chips = `<text x="${pad}" y="${top + 18}" fill="${t.muted}" font-family="${SANS}" font-size="13">No frameworks detected yet.</text>`;
  const H = y + h + 22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Frameworks and tools found in ${repoCount} public repositories, with the number of repos using each: ${tools.map(([n, c]) => `${n} ${c}`).join(", ")}">`
    + `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>`
    + `<text x="${pad}" y="34" fill="${t.fg}" font-family="${SANS}" font-size="14" font-weight="600">Frameworks &amp; tools <tspan fill="${t.muted}" font-weight="400">· number of repos using each, from dependencies and config files</tspan></text>`
    + chips + `</svg>\n`;
}

// ---------- activity block ----------
const escMd = (s) => s.replace(/[|<>]/g, (c) => `&#${c.charCodeAt(0)};`);
async function updateReadme(repos) {
  const lines = [...repos]
    .sort((a, b) => b.pushed_at.localeCompare(a.pushed_at))
    .slice(0, 5)
    .map((r) => `- [${r.name}](${r.html_url})${r.description ? ` · ${escMd(r.description.trim())}` : ""} · ${r.pushed_at.slice(0, 10)}`);
  const file = new URL("README.md", ROOT);
  const readme = await readFile(file, "utf8");
  const re = /(<!--START:activity-->\n)[\s\S]*?(\n<!--END:activity-->)/;
  if (!re.test(readme)) throw new Error("activity markers not found in README.md");
  const next = readme.replace(re, `$1${lines.join("\n") || "_No public activity yet._"}$2`);
  if (next !== readme) await writeFile(file, next);
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
}
await writeFile(new URL("stats.json", OUT), JSON.stringify({
  repos: repos.length,
  languages: Object.fromEntries(langs),
  tools: Object.fromEntries(Object.entries(toolRepos).map(([k, s]) => [k, [...s].sort()])),
}, null, 2) + "\n");
await updateReadme(repos);
console.log(`${repos.length} repos · ${langs.length} languages · ${tools.length} tools`);
