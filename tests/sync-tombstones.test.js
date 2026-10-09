import test from "node:test";
import assert from "node:assert/strict";
import {
  DELETED_KEY,
  OUTBOX_KEY,
  createSyncEngine,
} from "../lib/sync-engine.js";

function area(map) {
  return {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => map.has(key)).map(key => [key, structuredClone(map.get(key))])); },
    async set(values) { for (const [key, value] of Object.entries(values)) map.set(key, structuredClone(value)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); }
  };
}

function err(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function harness({ apiImpl = {}, state = { tasks: [], schedule: [] }, nowValue = 1_000_000 } = {}) {
  const local = new Map();
  let clock = nowValue;
  let seq = 0;
  const api = {
    getStatus: async () => ({ signedIn: true }),
    get: async () => { throw err("network_error"); },
    post: async () => { throw err("network_error"); },
    patch: async () => { throw err("network_error"); },
    delete: async () => { throw err("network_error"); },
    ...apiImpl,
  };
  let held = structuredClone(state);
  const engine = createSyncEngine({
    storage: { local: area(local) },
    api,
    now: () => clock,
    uuid: () => `op-${++seq}`,
    readState: async () => structuredClone(held),
    writeState: async (next) => { held = structuredClone(next); },
  });
  return {
    engine, local, api,
    state: () => structuredClone(held),
    advance: (ms) => { clock += ms; },
  };
}

const T = { id: "t-del", title: "Xoa toi", status: "pending", revision: 2 };
const E = { id: "e-del", title: "Block xoa", revision: 1 };

function apiWith({ tasks = [], events = [], changes = null, changesFail = false } = {}) {
  return {
    get: async (path) => {
      if (String(path).startsWith("/sync/changes")) {
        if (changesFail) throw err("network_error");
        return changes ?? { server_time: "2026-10-09T00:00:00", truncated: false, upsert_tasks: [], upsert_events: [], delete_task_ids: [], delete_event_ids: [] };
      }
      if (String(path).endsWith("/schedule/timeline")) return structuredClone(events);
      if (String(path).endsWith("/tasks/")) return structuredClone(tasks);
      throw err("network_error");
    },
  };
}

test("pull xoa local theo tombstone va dem so ban xoa", async () => {
  const h = harness({
    state: { tasks: [T], schedule: [E] },
    apiImpl: apiWith({
      tasks: [],
      events: [],
      changes: { server_time: "2026-10-09T00:00:00", truncated: false, upsert_tasks: [], upsert_events: [], delete_task_ids: ["t-del"], delete_event_ids: ["e-del"] },
    }),
  });
  const r = await h.engine.pull();
  assert.equal(r.ok, true);
  assert.equal(r.deleted, 2);
  assert.deepEqual(h.state().tasks, []);
  assert.deepEqual(h.state().schedule, []);
  const gone = h.local.get(DELETED_KEY);
  assert.ok(gone.some((e) => e.kind === "task" && e.id === "t-del"));
  assert.ok(gone.some((e) => e.kind === "schedule" && e.id === "e-del"));
});

test("pull bo op pending cho id da xoa (khoi 404 vo ich)", async () => {
  const h = harness({
    state: { tasks: [T], schedule: [] },
    apiImpl: apiWith({
      tasks: [],
      events: [],
      changes: { server_time: "2026-10-09T00:00:00", truncated: false, upsert_tasks: [], upsert_events: [], delete_task_ids: ["t-del"], delete_event_ids: [] },
    }),
  });
  await h.engine.enqueue({ kind: "task", method: "PATCH", path: "/tasks/t-del", body: { title: "Sua muon" }, recordId: "t-del" });
  const r = await h.engine.pull();
  assert.equal(r.droppedOps, 1);
  assert.deepEqual(h.local.get(OUTBOX_KEY), []);
  assert.deepEqual(h.state().tasks, []);
});

test("restore tu choi id da xoa tren web", async () => {
  const h = harness({
    state: { tasks: [], schedule: [] },
    apiImpl: apiWith({
      tasks: [],
      events: [],
      changes: { server_time: "2026-10-09T00:00:00", truncated: false, upsert_tasks: [], upsert_events: [], delete_task_ids: ["t-del"], delete_event_ids: [] },
    }),
  });
  await h.engine.pull();
  h.local.set("studioSyncConflicts", [{ id: "c1", at: 1_000_000, kind: "task", recordId: "t-del", localSnapshot: T, serverSnapshot: null, serverRevision: 3 }]);
  await assert.rejects(h.engine.restore("c1"), /đã bị xóa trên web/);
  assert.deepEqual(h.state().tasks, [], "khong hoi sinh xac vao local");
});

test("changes hong van merge list binh thuong, danh dau delta unavailable", async () => {
  const h = harness({
    state: { tasks: [], schedule: [] },
    apiImpl: apiWith({ tasks: [T], events: [E], changesFail: true }),
  });
  const r = await h.engine.pull();
  assert.equal(r.ok, true);
  assert.equal(r.delta, "unavailable");
  assert.equal(h.state().tasks.length, 1);
  assert.equal(h.state().schedule.length, 1);
});

test("truncated goi tiep toi khi het (toi da 3 vong)", async () => {
  const calls = [];
  const h = harness({
    state: { tasks: [T], schedule: [] },
    apiImpl: {
      get: async (path) => {
        if (String(path).startsWith("/sync/changes")) {
          calls.push(path);
          if (calls.length === 1) {
            return { server_time: "2026-10-09T01:00:00", truncated: true, upsert_tasks: [], upsert_events: [], delete_task_ids: [], delete_event_ids: [] };
          }
          return { server_time: "2026-10-09T02:00:00", truncated: false, upsert_tasks: [], upsert_events: [], delete_task_ids: ["t-del"], delete_event_ids: [] };
        }
        if (String(path).endsWith("/schedule/timeline")) return [];
        if (String(path).endsWith("/tasks/")) return [];
        throw err("network_error");
      },
    },
  });
  const r = await h.engine.pull();
  assert.equal(calls.length, 2, "phai goi vong 2 voi server_time vong 1");
  assert.ok(calls[1].includes("since="));
  assert.equal(r.deleted, 1);
  assert.deepEqual(h.state().tasks, []);
});
