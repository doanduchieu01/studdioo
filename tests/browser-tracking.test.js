import test from "node:test";
import assert from "node:assert/strict";
import { advanceTracking, normalizeTracking, trackingSummary, websiteHost, TRACKING_KEY, TRACKING_ALARM } from "../src/core/browser-tracking.js";
import { createBrowserTracker } from "../src/browser-tracker.js";
import { createBackup, createDefaultState } from "../src/core/state.js";
import { renderTrackingCard } from "../src/tracking-view.js";

process.env.TZ = "UTC";
const start = Date.parse("2026-09-12T10:00:00Z");

function harness() {
  let now = start, allowed = true, idle = "active", focused = true, privateTab = false, failWrite = false;
  let url = "https://example.com/private-path?q=PRIVATE-QUERY", queries = 0;
  const local = new Map(), session = new Map(), alarms = new Map();
  const storage = map => ({
    async get(key) { return { [key]: structuredClone(map.get(key)) }; },
    async set(values) { if (map === local && failWrite) throw new Error("Storage unavailable"); for (const [key, value] of Object.entries(values)) map.set(key, structuredClone(value)); }
  });
  const api = {
    storage: { local: storage(local), session: storage(session) },
    permissions: { async contains() { return allowed; } },
    idle: { async queryState() { return idle; }, setDetectionInterval(seconds) { assert.equal(seconds, 60); } },
    windows: { async getLastFocused() { return { id: 1, focused, incognito: false, state: "normal" }; } },
    tabs: { async query(query) { assert.deepEqual(query, { active: true, windowId: 1 }); queries++; return [{ active: true, incognito: privateTab, url, title: "PRIVATE-TITLE" }]; } },
    alarms: { async get(name) { return alarms.get(name); }, async create(name, alarm) { alarms.set(name, alarm); }, async clear(name) { return alarms.delete(name); } }
  };
  return { api, local, session, alarms, tracker: createBrowserTracker(api, () => now), clock: () => now,
    advance(ms) { now += ms; }, permission(value) { allowed = value; }, idle(value) { idle = value; }, focus(value) { focused = value; }, private(value) { privateTab = value; }, url(value) { url = value; }, failWrite(value) { failWrite = value; }, queries() { return queries; } };
}

test("tracking retains only HTTP(S) hostnames, not paths, queries, titles, or private tabs", () => {
  assert.equal(websiteHost("https://User:password@www.example.com:123/path?q=private#hash"), "www.example.com");
  for (const url of ["chrome://settings", "file:///secret.txt", "about:blank", "bad-url", "data:text/plain,secret"]) assert.equal(websiteHost(url), null);
  assert.equal(websiteHost("https://private.example", true), null);
});

test("tracking attributes intervals once and splits midnight in local time", () => {
  const t = Date.parse("2026-09-11T23:59:30Z");
  let state = advanceTracking({ enabled: true }, "a.example", t, "session");
  state = advanceTracking(state, "b.example", t + 60_000, "session");
  assert.deepEqual(state.days.map(day => [day.date, day.sites[0].ms]), [["2026-09-11", 30_000], ["2026-09-12", 30_000]]);
  state = advanceTracking(state, "b.example", t + 60_000, "session");
  assert.equal(trackingSummary(state, t + 60_000).totalMs, 30_000);
});

test("tracking skips long gaps, backward clocks, and a new browser session", () => {
  for (const [elapsed, session] of [[120_000, "a"], [-10_000, "a"], [60_000, "b"]]) {
    const before = advanceTracking({ enabled: true }, "a.example", start, "a");
    assert.equal(advanceTracking(before, "a.example", start + elapsed, session).days.length, 0);
  }
});

test("tracking retention and domain caps remain bounded; backups exclude the store", () => {
  const days = Array.from({ length: 12 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, sites: [], otherMs: 0 }));
  const state = normalizeTracking({ enabled: true, days }, start);
  assert.equal(state.days.length, 7);
  let value = advanceTracking(state, "s0.example", start, "a");
  for (let i = 1; i <= 102; i++) value = advanceTracking(value, `s${i}.example`, start + i * 100, "a");
  assert.equal(value.days.at(-1).sites.length, 100);
  assert.equal(value.days.at(-1).otherMs, 200);
  assert.equal(trackingSummary(value, start + 10_200).totalMs, 10_200);
  const app = { ...createDefaultState(), [TRACKING_KEY]: value };
  assert.doesNotMatch(JSON.stringify(createBackup(app)), /s0.example|studioBrowserTracking/);
});

test("tracking is off by default and permission denial reads no tab", async () => {
  const h = harness(); h.permission(false);
  assert.equal((await h.tracker.tick()).enabled, false);
  await assert.rejects(h.tracker.setEnabled(true), /Allow tab and idle access/);
  assert.equal(h.queries(), 0);
  assert.equal(h.local.has(TRACKING_KEY), false);
  assert.equal(h.alarms.size, 0);
});

test("tracking counts only the foreground website and resumes without backfilling idle/private time", async () => {
  const h = harness();
  await h.tracker.setEnabled(true);
  assert.equal(h.alarms.get(TRACKING_ALARM).periodInMinutes, 1);
  h.advance(30_000); h.url("https://second.example/page"); await h.tracker.tick();
  h.advance(30_000); h.focus(false); await h.tracker.tick();
  h.advance(30_000); await h.tracker.tick();
  assert.equal(trackingSummary(h.local.get(TRACKING_KEY), h.clock()).totalMs, 60_000);
  h.focus(true); h.idle("idle"); h.advance(30_000); await h.tracker.tick();
  h.idle("locked"); h.advance(30_000); await h.tracker.tick();
  h.idle("active"); h.private(true); h.advance(30_000); await h.tracker.tick();
  assert.equal(trackingSummary(h.local.get(TRACKING_KEY), h.clock()).totalMs, 60_000);
  h.private(false); await h.tracker.tick(); h.advance(10_000);
  assert.equal((await h.tracker.tick()).totalMs, 70_000);
  assert.doesNotMatch(JSON.stringify(h.local.get(TRACKING_KEY)), /PRIVATE|private-path|page|https:/);
});

test("tracking survives a worker restart but never fills browser downtime", async () => {
  const h = harness(); await h.tracker.setEnabled(true); h.advance(30_000);
  const restarted = createBrowserTracker(h.api, h.clock);
  assert.equal((await restarted.tick()).totalMs, 30_000);
  h.session.clear(); h.advance(30_000);
  assert.equal((await createBrowserTracker(h.api, h.clock).tick()).totalMs, 30_000);
  h.advance(600_000); assert.equal((await restarted.tick()).totalMs, 30_000);
});

test("tracking pause, permission removal, and clear stop collection while preserving control", async () => {
  const h = harness(); await h.tracker.setEnabled(true); h.advance(30_000); await h.tracker.tick();
  await h.tracker.setEnabled(false); const queries = h.queries(); h.advance(30_000);
  assert.equal((await h.tracker.tick()).totalMs, 30_000); assert.equal(h.queries(), queries);
  await h.tracker.setEnabled(true); h.permission(false); h.advance(30_000);
  assert.equal((await h.tracker.tick()).enabled, false); assert.equal(h.alarms.size, 0);
  const cleared = await h.tracker.clear();
  assert.equal(cleared.totalMs, 0); assert.equal(cleared.enabled, false);
  assert.deepEqual(h.local.get(TRACKING_KEY).days, []);
});

test("serialized tracking checks count once and recover after storage failure", async () => {
  const h = harness(); await h.tracker.setEnabled(true); h.advance(30_000);
  await Promise.all([h.tracker.tick(), h.tracker.tick(), h.tracker.tick()]);
  assert.equal((await h.tracker.tick()).totalMs, 30_000);
  h.advance(30_000); h.failWrite(true); await assert.rejects(h.tracker.tick(), /Storage unavailable/);
  h.failWrite(false); assert.equal((await h.tracker.tick()).totalMs, 60_000);
});

test("clearing tracking invalidates an in-flight tab snapshot", async () => {
  const h = harness(); await h.tracker.setEnabled(true); h.advance(30_000);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  h.api.tabs.query = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const pending = h.tracker.tick(); await started;
  const clearing = h.tracker.clear();
  release([{ active: true, url: "https://must-not-return.example" }]);
  await pending; await clearing;
  assert.deepEqual(h.local.get(TRACKING_KEY), { version: 1, enabled: false, days: [], cursor: null });
});

test("tracking view states its limits and escapes domain text", () => {
  const html = renderTrackingCard({ available: true, enabled: true, checkedAt: start, sites: [{ host: "<unsafe>", ms: 30_000 }], totalMs: 30_000 });
  assert.match(html, /&lt;unsafe&gt;/); assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /Other apps are not tracked/);
  assert.match(html, /data-action="tracking-pause"/);
  assert.match(renderTrackingCard(null), /Tracking status unavailable/);
});
