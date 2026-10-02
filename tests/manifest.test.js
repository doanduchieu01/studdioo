import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

test("extension uses Manifest V3", () => {
  assert.equal(manifest.manifest_version, 3);
});

test("extension requests only the agreed Chrome permissions", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["alarms", "sidePanel", "storage"]);
});

test("extension has exactly one remote host boundary", () => {
  assert.deepEqual(manifest.host_permissions, ["https://generativelanguage.googleapis.com/*"]);
});

test("tracking, notifications and scripting remain optional, without automatic all-site scripts", () => {
  assert.deepEqual([...manifest.optional_permissions].sort(), ["idle", "notifications", "scripting", "tabs"]);
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
});

test("all manifest entry files exist", async () => {
  await Promise.all([
    access(new URL(manifest.background.service_worker, root)),
    access(new URL(manifest.side_panel.default_path, root))
  ]);
});

test("side panel uses only packaged script and stylesheet resources", async () => {
  const html = await readFile(new URL("../src/sidepanel.html", import.meta.url), "utf8");
  assert.match(html, /src="app\.js"/);
  assert.match(html, /href="styles\.css"/);
  assert.doesNotMatch(html, /https?:\/\//);
});
