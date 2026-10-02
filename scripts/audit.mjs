import { spawnSync } from "node:child_process";
import { readdir, readFile, access } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION } from "../src/core/release.js";

const auditPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(auditPath), "..");

async function filesUnder(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", "node_modules", "artifacts"].includes(entry.name)) continue;
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(full));
    else files.push(full);
  }
  return files;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const allFiles = await filesUnder(root);
const jsFiles = allFiles.filter(file => file.endsWith(".js") || file.endsWith(".mjs"));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert(result.status === 0, `Syntax check failed for ${relative(root, file)}\n${result.stderr}`);
}

const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const packageInfo = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const readme = await readFile(join(root, "README.md"), "utf8");
const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
assert(manifest.version === APP_VERSION && packageInfo.version === APP_VERSION, "App, manifest, and package release versions must match.");
assert(readme.split("\n")[0].includes(`v${APP_VERSION}`), "README must identify the current release.");
assert(changelog.includes(`## ${APP_VERSION} —`), "Current release must have a changelog entry.");
assert(manifest.manifest_version === 3, "Manifest must use V3.");
assert(JSON.stringify([...manifest.permissions].sort()) === JSON.stringify(["alarms", "sidePanel", "storage"]), "Unexpected Chrome permission.");
assert(JSON.stringify([...(manifest.optional_permissions ?? [])].sort()) === JSON.stringify(["idle", "notifications", "scripting", "tabs"]), "Tracking, media access and notifications must remain optional.");
assert(!manifest.content_scripts, "Site scripts must only be registered after an explicit site grant.");
assert(JSON.stringify(manifest.optional_host_permissions) === JSON.stringify(["https://*/*", "http://*/*"]), "Only optional HTTP(S) site access is allowed.");
assert(JSON.stringify(manifest.host_permissions) === JSON.stringify(["https://generativelanguage.googleapis.com/*"]), "Unexpected host permission.");
await access(join(root, manifest.background.service_worker));
await access(join(root, manifest.side_panel.default_path));

const textFiles = allFiles.filter(file => /\.(?:js|mjs|json|html|css|md)$/.test(file));
for (const file of textFiles) {
  const text = await readFile(file, "utf8");
  assert(!/(?:AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,})/.test(text), `Possible API key found in ${relative(root, file)}.`);
  if ((file.endsWith(".js") || file.endsWith(".mjs")) && resolve(file) !== resolve(auditPath)) {
    assert(!/\beval\s*\(/.test(text), `eval() found in ${relative(root, file)}.`);
    assert(!/new\s+Function\s*\(/.test(text), `new Function() found in ${relative(root, file)}.`);
  }
}

const background = await readFile(join(root, "src/background.js"), "utf8");
assert(background.includes('"x-goog-api-key"'), "Gemini key must be passed in a request header.");
assert(background.includes("store: false"), "Gemini interactions must explicitly disable storage.");
assert(!background.includes("?key="), "Gemini key must never be placed in a URL.");

const html = await readFile(join(root, "src/sidepanel.html"), "utf8");
assert(!/<script(?![^>]*src=)/i.test(html), "Inline scripts are not allowed.");
assert(!/<link[^>]+href=[\"']https?:/i.test(html), "Remote stylesheets are not allowed.");

const css = await readFile(join(root, "src/styles.css"), "utf8");
assert(!/url\([\"']?https?:/i.test(css), "Remote CSS assets are not allowed.");

console.log(`Audit passed: v${APP_VERSION}, ${jsFiles.length} scripts checked, matching release versions, one Gemini host boundary, no embedded key.`);
