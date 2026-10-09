#!/usr/bin/env node
/**
 * Stuđiô AI Companion - release packer (phase 5.4).
 * Run via `npm run pack`. Zips extension-companion/ EXCLUDING tests/,
 * scripts/ and .git* files (README + icons + lib ARE included) into
 * frontend/assets/studio-companion.zip (repo-relative), then verifies:
 * the listing contains manifest.json + background.js + sidepanel.html at
 * top level, no tests//scripts/ entries leaked in, the zipped manifest
 * parses, and its version matches manifest.json + package.json.
 *
 * Zipping uses the Python stdlib (zipfile) — the backend already requires
 * Python, so no npm dependency is needed. Tries `python3`, then `python`.
 */

import { execFile } from "node:child_process";
import { readdirSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(SCRIPTS_DIR, "..");
const REPO_ROOT = path.resolve(EXT_DIR, "..");
const OUT_ZIP = path.join(REPO_ROOT, "frontend", "assets", "studio-companion.zip");

const SKIP_DIRS = new Set(["tests", "scripts", "node_modules", ".git"]);

function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".git")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else out.push(full);
  }
  return out;
}

function runPython(python, code, args = []) {
  return execFileAsync(python, ["-c", code, ...args]);
}

async function pickPython() {
  for (const bin of ["python3", "python"]) {
    try {
      await execFileAsync(bin, ["--version"]);
      return bin;
    } catch {}
  }
  throw new Error("pack requires Python (tried python3, python) — not found on PATH");
}

const ZIP_CODE = `
import json, sys, zipfile
sys.stdout.reconfigure(encoding="utf-8")
spec = json.load(open(sys.argv[1], encoding="utf-8"))
def canonical(p):
    # Deterministic bytes across checkouts: Windows materializes CRLF,
    # blobs store LF. Zip the LF form so any machine rebuilds the same zip.
    with open(p, "rb") as f:
        return f.read().replace(b"\\r\\n", b"\\n")
with zipfile.ZipFile(spec["out"], "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for src, arc in spec["files"]:
        z.writestr(arc, canonical(src))
print("wrote %d entries" % len(spec["files"]))
`;

const INSPECT_CODE = `
import json, sys, zipfile
sys.stdout.reconfigure(encoding="utf-8")
z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
print("\\n".join(sorted(names)))
print("---MANIFEST---")
print(json.dumps(json.loads(z.read("manifest.json").decode("utf-8")), ensure_ascii=True))
`;

const files = collect(EXT_DIR).sort();
const spec = {
  out: OUT_ZIP,
  files: files.map((f) => [f, path.relative(EXT_DIR, f).split(path.sep).join("/")]),
};

const python = await pickPython();
const specFile = path.join(mkdtempSync(path.join(tmpdir(), "studio-pack-")), "spec.json");
writeFileSync(specFile, JSON.stringify(spec), "utf8");
await runPython(python, ZIP_CODE, [specFile]);

const { stdout } = await runPython(python, INSPECT_CODE, [OUT_ZIP]);
const [listingRaw, manifestRaw] = stdout.split("---MANIFEST---");
const names = listingRaw
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

// Verify: required top-level entries, no excluded dirs, manifest parses,
// version matches manifest.json + package.json.
const fail = (msg) => {
  console.error(`FAIL  pack verify — ${msg}`);
  process.exitCode = 1;
};
for (const need of ["manifest.json", "background.js", "sidepanel.html", "content-auth.js", "content-taskpad.js"]) {
  if (!names.includes(need)) fail(`missing required entry: ${need}`);
}
for (const bad of names.filter((n) => n.startsWith("tests/") || n.startsWith("scripts/"))) {
  fail(`excluded entry leaked into zip: ${bad}`);
}
let zippedManifest = null;
try {
  zippedManifest = JSON.parse(manifestRaw);
} catch (err) {
  fail(`zipped manifest does not parse: ${err?.message ?? err}`);
}
if (zippedManifest) {
  const diskManifest = JSON.parse(
    (await import("node:fs")).readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8")
  );
  const pkg = JSON.parse(
    (await import("node:fs")).readFileSync(path.join(EXT_DIR, "package.json"), "utf8")
  );
  if (zippedManifest.version !== diskManifest.version) {
    fail(`version drift: zip=${zippedManifest.version} manifest.json=${diskManifest.version}`);
  }
  if (zippedManifest.version !== pkg.version) {
    fail(`version drift: zip=${zippedManifest.version} package.json=${pkg.version}`);
  }
  console.log(`zip manifest version: ${zippedManifest.version}`);
}

if (process.exitCode) throw new Error("pack verification failed");
console.log(`pack: ${path.relative(REPO_ROOT, OUT_ZIP)} (${names.length} entries) verified OK`);
