#!/usr/bin/env node
// Check the Chinese documentation: links, image paths, backticked repo paths
// and the rule that no documentation lives inside docs/ (the live site).
//
// No dependencies beyond Node. Run it with `npm run docs:check`; it exits 1 and
// lists every problem it found. Paths resolve the way a reader would follow
// them: links relative to the markdown file, the rest relative to the repo root.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Text files that may contain links: the root README and documentation/*.md. */
function markdownFiles() {
  const files = ["README.md"];
  for (const name of readdirSync(join(ROOT, "documentation"))) {
    if (name.endsWith(".md")) files.push(join("documentation", name));
  }
  return files;
}

/** Paths we are allowed to have as files inside docs/ (a licence, not a doc). */
const DOCS_ALLOWED = /LICENSE\.md$/i;

/** Every file under docs/, relative to the repo root. */
function filesUnderDocs(dir = join(ROOT, "docs")) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...filesUnderDocs(full));
    else found.push(relative(ROOT, full));
  }
  return found;
}

const exists = (path) => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

const problems = [];
const report = (file, message) => problems.push(`${file}: ${message}`);

/** `true` for links we do not resolve (other sites, e-mail, in-page anchors). */
function isExternal(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target);
}

/** Split a link target into the path part and drop an optional "title". */
function linkPath(raw) {
  let target = raw.trim();
  if (target.startsWith("<")) target = target.slice(1, target.indexOf(">"));
  else target = target.split(/\s+/)[0];
  const hash = target.indexOf("#");
  if (hash >= 0) target = target.slice(0, hash);
  return target;
}

/** Check every `[text](target)` and `![alt](target)` in one file. */
function checkLinks(file, text) {
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]*)\)/g)) {
    const target = linkPath(match[1]);
    if (!target || isExternal(target)) continue;
    const full = resolve(ROOT, dirname(file), target);
    if (!exists(full)) report(file, `broken link ${target}`);
  }
}

/** Code-span tokens that are commands, patterns or prose, not repo paths. */
const NOT_A_PATH = [
  /^[-a-z]+:/i, // URLs and other schemes
  /^(?:npm|npx|node|python3?|git|TZ=|BASE_URL)/i, // shell commands
  /[*?{}<>|(),=`"'\s]/, // globs, shell syntax, quoted text, spaces
  /(^|\/)\$/, // shell variables
  /\.\.\./, // ellipsis
];

/** File extensions worth checking; other code spans are prose or code. */
const EXTENSIONS = new Set([
  ".md", ".mjs", ".js", ".json", ".py", ".sh", ".csv", ".html", ".css",
  ".svg", ".dot", ".png", ".txt", ".yml", ".yaml",
]);

/**
 * Check every backticked repo path, e.g. `docs/js/core/calc.js` or `data-src/`.
 * Only tokens with a slash count as paths: a bare file name such as
 * `foods.json` is usually prose about a file whose full path is given nearby.
 * A path resolves relative to the markdown file first, then to the repo root.
 */
function checkCodePaths(file, text) {
  const prose = text.replace(/```[\s\S]*?```/g, ""); // skip fenced code blocks
  for (const match of prose.matchAll(/`([^`\n]+)`/g)) {
    const token = match[1].trim();
    if (!token || token.startsWith("/") || token.includes("://")) continue;
    if (!token.includes("/")) continue;
    if (NOT_A_PATH.some((pattern) => pattern.test(token))) continue;
    const name = token.replace(/\/+$/, "");
    if (!name) continue;
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 ? name.slice(dot) : "";
    const isFolder = token.endsWith("/");
    if (!isFolder && !EXTENSIONS.has(extension)) continue;
    if (!isFolder && /^\./.test(name.slice(name.lastIndexOf("/") + 1))) continue;
    const near = resolve(ROOT, dirname(file), name);
    if (!exists(near) && !exists(join(ROOT, name))) {
      report(file, `missing path ${token}`);
    }
  }
}

const files = markdownFiles();
for (const file of files) {
  const text = readFileSync(join(ROOT, file), "utf8");
  checkLinks(file, text);
  checkCodePaths(file, text);
}

for (const file of filesUnderDocs()) {
  if (file.endsWith(".md") && !DOCS_ALLOWED.test(file)) {
    report(file, "documentation must live in documentation/, not docs/");
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`docs:check ${problem}`);
  console.error(`docs:check failed: ${problems.length} problem(s)`);
  process.exit(1);
}

console.log(
  `docs:check ok: ${files.length} markdown files, all links and paths resolve`,
);
