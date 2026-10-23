// Rewrites the block between <!--START:activity--> and <!--END:activity--> in README.md
// with the most recently pushed public, non-fork repos. Dates (not "2 days ago") so the
// README only changes when activity actually changes.
import { readFile, writeFile } from "node:fs/promises";

const USER = process.env.GH_USER ?? "makspavlovskyi";
const LIMIT = 5;
const README = new URL("../README.md", import.meta.url);

async function loadRepos() {
  if (process.env.FIXTURE) return JSON.parse(await readFile(process.env.FIXTURE, "utf8"));
  const res = await fetch(`https://api.github.com/users/${USER}/repos?type=owner&sort=pushed&per_page=30`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

const escape = (s) => s.replace(/[|<>]/g, (c) => `&#${c.charCodeAt(0)};`);

const repos = (await loadRepos())
  .filter((r) => !r.fork && !r.archived && r.name.toLowerCase() !== USER.toLowerCase())
  .sort((a, b) => b.pushed_at.localeCompare(a.pushed_at))
  .slice(0, LIMIT);

const lines = repos.map((r) => {
  const desc = r.description ? ` · ${escape(r.description.trim())}` : "";
  return `- [${r.name}](${r.html_url})${desc} · ${r.pushed_at.slice(0, 10)}`;
});

const readme = await readFile(README, "utf8");
const re = /(<!--START:activity-->\n)[\s\S]*?(\n<!--END:activity-->)/;
if (!re.test(readme)) throw new Error("activity markers not found in README.md");
const next = readme.replace(re, `$1${lines.join("\n") || "_No public activity yet._"}$2`);
if (next !== readme) {
  await writeFile(README, next);
  console.log(`Updated with ${lines.length} repos`);
} else console.log("No change");
