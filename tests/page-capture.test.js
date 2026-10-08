import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCaptureTask,
  checkPageCapturable,
  extractPageSnapshot,
  isReadablePageUrl,
  normalizeSnapshot,
} from "../lib/page-capture.js";

// Adapted from archived extension tests/capture-page.test.js + capture-background.test.js.
// Companion runs content scripts on every page, so snapshots are built from
// explicit fields (url/title/selection) instead of executeScript results.

test("selection becomes the title, page becomes the source", () => {
  const task = buildCaptureTask({
    url: "https://example.com/a",
    title: "Page title",
    selection: "Remember Stokes theorem\nSecond line",
    description: "",
  });
  assert.equal(task.title, "Remember Stokes theorem");
  assert.equal(task.source, "capture");
  assert.equal(task.source_url, "https://example.com/a");
  assert.equal(task.source_title, "Page title");
  assert.match(task.description, /Ngu\u1ed3n: https:\/\/example\.com\/a/);
});

test("no selection falls back to the page title", () => {
  const task = buildCaptureTask({ url: "https://example.com/b", title: "Title only", selection: "", description: "" });
  assert.equal(task.title, "Title only");
});

test("empty title and selection are rejected, no junk task", () => {
  assert.throws(
    () => buildCaptureTask({ url: "https://example.com/c", title: "  ", selection: "  \n  ", description: "" }),
    /kh\u00f4ng c\u00f3 ti\u00eau \u0111\u1ec1/
  );
});

test("long title and selection are truncated to limits", () => {
  const task = buildCaptureTask({
    url: "https://example.com/d",
    title: "T".repeat(600),
    selection: "S".repeat(3000),
    description: "",
  });
  assert.ok(task.title.length <= 160);
  assert.ok(task.description.length <= 2000 + 100);
  assert.equal(task.source_title.length, 500);
});

test("isReadablePageUrl blocks system and dangerous schemes", () => {
  assert.equal(isReadablePageUrl("https://example.com/"), true);
  assert.equal(isReadablePageUrl("http://localhost:8000/"), true);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "chrome://extensions", "chrome://newtab", "about:blank", "edge://settings", "file:///etc/passwd", "", null, undefined]) {
    assert.equal(isReadablePageUrl(bad), false, String(bad));
  }
});

test("extractPageSnapshot stays DOM-only with no closure (tab-serializable)", () => {
  const src = extractPageSnapshot.toString();
  assert.ok(!/\bimport\b|\brequire\b/.test(src));
  assert.match(src, /getSelection|querySelector/);
});

test("normalizeSnapshot trims and caps raw tab fields", () => {
  const snap = normalizeSnapshot({ url: "https://example.com/a", title: "  T\u00edtulo  ", selection: "  sel  ", description: "d" });
  assert.deepEqual(snap, { url: "https://example.com/a", title: "T\u00edtulo", selection: "sel", description: "d" });
  const long = normalizeSnapshot({ url: "https://example.com/a", title: "T".repeat(600), selection: "S".repeat(3000) });
  assert.equal(long.title.length, 500);
  assert.equal(long.selection.length, 2000);
});

test("readable page with title/url/selection is capturable with a snapshot", () => {
  const res = checkPageCapturable({ url: "https://example.com/a", title: "Hay", selection: "Ghi nh\u1edb" });
  assert.equal(res.capturable, true);
  assert.equal(res.reason, null);
  assert.equal(res.snapshot.title, "Hay");
  assert.equal(res.snapshot.url, "https://example.com/a");
  assert.equal(res.snapshot.selection, "Ghi nh\u1edb");
});

test("chrome:// and empty urls are rejected as system-page", () => {
  for (const url of ["chrome://extensions", "chrome://newtab/", "about:blank", ""]) {
    const res = checkPageCapturable({ url, title: "Extensions", selection: "" });
    assert.equal(res.capturable, false, url);
    assert.equal(res.reason, "system-page", url);
    assert.match(res.message, /h\u1ec7 th\u1ed1ng/i);
  }
});

test("empty title and empty selection are rejected as empty-content", () => {
  const res = checkPageCapturable({ url: "https://example.com/e", title: "   ", selection: "  \n " });
  assert.equal(res.capturable, false);
  assert.equal(res.reason, "empty-content");
  assert.ok(res.message.length > 0);
});
