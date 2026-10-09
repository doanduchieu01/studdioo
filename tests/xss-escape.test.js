import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sidepanelSrc = fs.readFileSync(path.join(__dirname, "..", "sidepanel.js"), "utf8");
const contentSrc = fs.readFileSync(path.join(__dirname, "..", "content-taskpad.js"), "utf8");

const PAYLOADS = ['"><svg onload=alert(1)>', '<img src=x onerror=alert(1)>'];

// Extract the real escapeHtml implementation from a source file and eval it.
// This tests the actual shipped helper without executing chrome/document top-level code.
function extractEscapeHtml(src, label) {
  const m = src.match(/function escapeHtml\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(m, `${label}: escapeHtml helper must exist`);
  const fn = new Function(`${m[0]}; return escapeHtml;`)();
  assert.equal(typeof fn, "function", `${label}: escapeHtml must be a function`);
  return fn;
}

// Raw title interpolation inside confirm() is a JS-string context (no HTML
// parsing), so it is safe. Only innerHTML/title="..." HTML contexts matter.
function htmlContextLines(src) {
  return src.split("\n").filter((line) => !line.includes("confirm("));
}

test("sidepanel escapeHtml escapes & < > \" '", () => {
  const escapeHtml = extractEscapeHtml(sidepanelSrc, "sidepanel.js");
  assert.equal(escapeHtml("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(escapeHtml("a&b<c>d\"e'f"), "a&amp;b&lt;c&gt;d&quot;e&#39;f");
});

test("content-taskpad.js has escapeHtml helper identical in behavior to sidepanel's", () => {
  const escapeHtml = extractEscapeHtml(contentSrc, "content-taskpad.js");
  assert.equal(escapeHtml("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
});

test("sidepanel task list render escapes task/subtask titles (text + attribute)", () => {
  // No raw unescaped title interpolation may remain in an HTML context.
  const htmlSrc = htmlContextLines(sidepanelSrc).join("\n");
  for (const raw of ["${task.title}", "${sub.title}"]) {
    assert.ok(!htmlSrc.includes(raw), `sidepanel.js must not contain raw ${raw} in HTML context`);
  }
  // Escaped usages must be present (both title="..." attr and element text).
  assert.ok(sidepanelSrc.includes("escapeHtml(task.title"), "task.title must go through escapeHtml");
  assert.ok(sidepanelSrc.includes("escapeHtml(sub.title"), "sub.title must go through escapeHtml");
});

test("sidepanel note list render escapes note.title", () => {
  const htmlSrc = htmlContextLines(sidepanelSrc).join("\n");
  assert.ok(!htmlSrc.includes("${note.title}"), "sidepanel.js must not contain raw ${note.title} in HTML context");
  assert.ok(sidepanelSrc.includes("escapeHtml(note.title"), "note.title must go through escapeHtml");
});

test("sidepanel sync-history name render escapes fully (not just quotes)", () => {
  assert.ok(
    sidepanelSrc.includes("escapeHtml(name"),
    "sync history name must go through escapeHtml (replaceAll('\"') alone is insufficient)"
  );
});

test("content-taskpad.js widget escapes task/dropdown/subtask titles", () => {
  for (const raw of ["${currentTask?.title}", "${t.title}", "${sub.title}"]) {
    assert.ok(!contentSrc.includes(raw), `content-taskpad.js must not contain raw ${raw}`);
  }
  // savedDraft lands inside <textarea> HTML context — must be escaped too.
  assert.ok(!contentSrc.includes("${savedDraft}"), "content-taskpad.js must not contain raw ${savedDraft}");
  assert.ok(contentSrc.includes("escapeHtml(savedDraft"), "scratchpad draft must go through escapeHtml");
  assert.ok(contentSrc.includes("escapeHtml(currentTask"), "hero/pill title must go through escapeHtml");
  assert.ok(contentSrc.includes("escapeHtml(t.title"), "dropdown title must go through escapeHtml");
  assert.ok(contentSrc.includes("escapeHtml(sub.title"), "subtask title must go through escapeHtml");
});

test("replicated render output neutralizes stored-XSS payloads", () => {
  const escapeHtml = extractEscapeHtml(sidepanelSrc, "sidepanel.js");
  const cEscape = extractEscapeHtml(contentSrc, "content-taskpad.js");
  for (const payload of PAYLOADS) {
    // Replicate each fixed render site's escaping contract.
    const sites = [
      `<span class="task-item-title truncate" title="${escapeHtml(payload)}">${escapeHtml(payload)}</span>`,
      `<span class="subtask-card-title truncate" title="${escapeHtml(payload)}">1. ${escapeHtml(payload)}</span>`,
      `<span class="pinned-subtask-name" title="${escapeHtml(payload)}">1. ${escapeHtml(payload)}</span>`,
      `<span class="note-card-title truncate" title="${escapeHtml(payload)}">${escapeHtml(payload)}</span>`,
      `<div class="sync-history-name truncate" title="${escapeHtml(payload)}">${escapeHtml(payload)}</div>`,
      `<span class="pill-title">${cEscape(payload)}</span>`,
      `<div class="task-dropdown-item" title="${cEscape(payload)}">${cEscape(payload)}</div>`,
      `<span class="focus-title">${cEscape(payload)}</span>`,
      `<span class="subtask-text" title="${cEscape(payload)}">1. ${cEscape(payload)}</span>`,
      `<textarea>${cEscape(payload)}</textarea>`,
    ];
    for (const html of sites) {
      // No tag can form: < and > are entity-encoded. Attribute/event-handler
      // text (e.g. the literal "onload=" inside escaped text) is inert
      // without a real tag, so only tag delimiters + quote breakout matter.
      assert.ok(!html.includes("<svg"), `output must not contain raw <svg for payload ${payload}`);
      assert.ok(!html.includes("<img"), `output must not contain raw <img for payload ${payload}`);
      assert.ok(!html.includes(payload), `output must not contain the raw payload ${payload}`);
      assert.ok(
        html.includes("&lt;svg") || html.includes("&lt;img"),
        `output must contain escaped entities for payload ${payload}`
      );
    }
    // Attribute-breakout check: any quote chars in the payload must be entity-encoded.
    if (payload.includes('"')) {
      assert.ok(escapeHtml(payload).includes("&quot;"), "double quote must be escaped (attribute context)");
      assert.ok(!escapeHtml(payload).includes('"'), "no raw double quote may survive escaping");
    }
    if (payload.includes("'")) {
      assert.ok(escapeHtml(payload).includes("&#39;"), "single quote must be escaped (attribute context)");
    }
  }
});
