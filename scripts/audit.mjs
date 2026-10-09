#!/usr/bin/env node
/**
 * Stuđiô AI Companion - release audit (phase 5.3).
 * Run via `npm run verify` (= `npm test && node scripts/audit.mjs`).
 * Each check prints PASS/FAIL; any FAIL exits non-zero.
 *
 * Scan scope is SHIPPED runtime files only (manifest + root *.js/*.html +
 * lib/): tests/ legitimately asserts the absence of these patterns (and the
 * search patterns below live in this file), so scanning them would
 * self-incriminate. Excluded: tests/, scripts/, icons/, node_modules/.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["tests", "scripts", "icons", "node_modules", ".git"]);

let failures = 0;
let total = 0;
function check(name, ok, detail = "") {
  total++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|html|json)$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(EXT_DIR, f);

// 1. manifest.json parses.
let manifest = null;
try {
  manifest = JSON.parse(readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
  check("manifest.json parses", true);
} catch (err) {
  check("manifest.json parses", false, String(err?.message ?? err));
}

// 2. Version pin: sidepanel shows no version string, so the contract is
// manifest.version === package.json version.
if (manifest) {
  const sidepanelHtml = readFileSync(path.join(EXT_DIR, "sidepanel.html"), "utf8");
  const pkg = JSON.parse(readFileSync(path.join(EXT_DIR, "package.json"), "utf8"));
  if (/version/i.test(sidepanelHtml)) {
    const shown = sidepanelHtml.match(/\d+\.\d+\.\d+/g) ?? [];
    check(
      "sidepanel footer version matches manifest",
      shown.includes(manifest.version),
      `manifest=${manifest.version} footer=${shown.join(",") || "none"}`
    );
  } else {
    check("package.json has a version", typeof pkg.version === "string" && pkg.version.length > 0, `package=${pkg.version ?? "missing"}`);
    check(
      "manifest version === package.json version",
      pkg.version === manifest.version,
      `manifest=${manifest.version} package=${pkg.version ?? "missing"}`
    );
  }
}

// 3. externally_connectable must list explicit origins — no wildcard HOST
// (a trailing path `/*` is fine; `*` in scheme/host or `<all_urls>` is not).
if (manifest) {
  const matches = manifest.externally_connectable?.matches ?? [];
  const isWildcardHost = (m) => {
    const s = String(m);
    if (s === "<all_urls>") return true;
    const mm = s.match(/^([a-z*]+):\/\/([^/]+)/i);
    if (!mm) return true;
    return mm[1].includes("*") || mm[2].includes("*");
  };
  const wildcards = matches.filter(isWildcardHost);
  check(
    "externally_connectable has no wildcard host",
    Array.isArray(matches) && matches.length > 0 && wildcards.length === 0,
    wildcards.length > 0 ? `wildcards: ${wildcards.join(", ")}` : `${matches.length} explicit origins`
  );
}

// 4. MV3 omnibox key is `omnibox` ("studi") — the wrong `chrome.omnibar`
// API must not appear in shipped code. (Pattern is concatenated so this
// file never matches its own scan if the scope ever widens.)
if (manifest) {
  check("manifest has no omnibar key", manifest.omnibar === undefined);
  check("omnibox keyword is studi", manifest.omnibox?.keyword === "studi", `keyword=${manifest.omnibox?.keyword ?? "missing"}`);
}
{
  const needle = "chrome.omni" + "bar";
  const hits = walk(EXT_DIR).filter((f) => readFileSync(f, "utf8").includes(needle));
  check("no chrome.omnibar string in shipped code", hits.length === 0, hits.map(rel).join(", "));
}

// 5. No hardcoded tokens/secrets in shipped code. Bare `sk-` is scoped to
// key-shaped runs on purpose: `.task-*` / `.subtask-*` CSS classes contain
// the substring `sk-` and must not trip the gate.
{
  const patterns = [
    ["Bearer eyJ" + "[A-Za-z0-9_-]+", "hardcoded JWT"],
    ["sk-(proj-|ant-|live-)?[A-Za-z0-9]{16,}", "provider secret key"],
    ["AIza[A-Za-z0-9_-]{10,}", "Google API key"],
  ];
  const hits = [];
  for (const f of walk(EXT_DIR)) {
    const src = readFileSync(f, "utf8");
    for (const [pat, label] of patterns) {
      if (new RegExp(pat).test(src)) hits.push(`${rel(f)} (${label})`);
    }
  }
  check("no hardcoded tokens/secrets in shipped code", hits.length === 0, hits.join(", "));
}

// 6. Shared extension key present (same stable ID the web expects).
if (manifest) {
  check(
    "manifest key present (shared extension ID)",
    typeof manifest.key === "string" && manifest.key.length > 64,
    `key length=${typeof manifest.key === "string" ? manifest.key.length : 0}`
  );
}

console.log(`\naudit: ${total - failures}/${total} checks passed`);
process.exitCode = failures > 0 ? 1 : 0;
