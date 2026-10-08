import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFLICTS_KEY,
  OUTBOX_CAP,
  OUTBOX_KEY,
  SYNC_META_KEY,
  createSyncEngine,
} from "../lib/sync-engine.js";
import { taskFromApi } from "../lib/task-sync.js";
import { blockFromApi } from "../lib/schedule-sync.js";

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

test("enqueue không cần mạng, offline ghi tiếp được", async () => {
  const h = harness();
  const r = await h.engine.enqueue({ kind: "task", method: "POST", path: "/tasks/", body: { id: "t1", title: "A" } });
  assert.equal(r.dropped, 0);
  assert.equal(r.pending, 1);
  const outbox = h.local.get(OUTBOX_KEY);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].tries, 0);
});

test("flush lỗi mạng giữ op, tăng tries, hẹn backoff", async () => {
  const h = harness();
  await h.engine.enqueue({ kind: "task", method: "POST", path: "/tasks/", body: { id: "t1" } });
  const r = await h.engine.flush();
  assert.equal(r.ok, true);
  assert.equal(r.pushed, 0);
  const outbox = h.local.get(OUTBOX_KEY);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].tries, 1);
  assert.ok(outbox[0].nextAttemptAt > 1_000_000);
  // Chưa tới giờ retry → flush bỏ qua, không gọi mạng thêm.
  let calls = 0;
  h.api.post = async () => { calls += 1; return {}; };
  await h.engine.flush();
  assert.equal(calls, 0);
  // Tới giờ → thử lại và thành công.
  h.advance(60_000);
  h.api.post = async (path, body) => ({ id: body.id, revision: 1 });
  const r2 = await h.engine.flush();
  assert.equal(r2.pushed, 1);
  assert.equal(h.local.get(OUTBOX_KEY).length, 0);
});

test("burst offline 20 ops cùng client UUID → server chỉ có 1 record", async () => {
  const server = new Map();
  const h = harness({
    apiImpl: {
      post: async (path, body) => {
        server.set(body.id, { ...(server.get(body.id) ?? {}), ...body, revision: 1 });
        return { id: body.id, revision: 1 };
      },
    },
  });
  for (let i = 0; i < 20; i++) {
    await h.engine.enqueue({ kind: "task", method: "POST", path: "/tasks/", body: { id: "same-id", title: `Lần ${i}` } });
  }
  const r = await h.engine.flush();
  assert.equal(r.pushed, 20);
  assert.equal(server.size, 1);
  assert.equal(h.local.get(OUTBOX_KEY).length, 0);
});

test("pull bỏ qua record đang pending, không ghi đè thao tác chưa đẩy", async () => {
  const h = harness({
    state: { tasks: [{ id: "t1", title: "Local mới", revision: 1 }], schedule: [] },
    apiImpl: {
      get: async (path) => {
        if (path === "/tasks/") return [{ id: "t1", title: "Server cũ", revision: 1 }];
        return [];
      },
    },
  });
  await h.engine.enqueue({ kind: "task", method: "PATCH", path: "/tasks/t1", body: { title: "Local mới" }, ifMatch: 1, recordId: "t1" });
  const r = await h.engine.pull();
  assert.equal(r.ok, true);
  assert.equal(r.skippedPending, 1);
  assert.equal(h.state().tasks[0].title, "Local mới");
});

test("pull thay toàn record server mới, thêm record chưa có", async () => {
  const h = harness({
    state: { tasks: [{ id: "t1", title: "Cũ", revision: 1 }], schedule: [] },
    apiImpl: {
      get: async (path) => {
        if (path === "/tasks/") return [{ id: "t1", title: "Mới", revision: 2 }, { id: "t2", title: "Thêm", revision: 1 }];
        return [];
      },
    },
  });
  const r = await h.engine.pull();
  assert.equal(r.changed, true);
  assert.equal(h.state().tasks.find(t => t.id === "t1").title, "Mới");
  assert.equal(h.state().tasks.find(t => t.id === "t2").title, "Thêm");
});

test("vượt cap 200 → drop-oldest + báo số bị bỏ", async () => {
  const h = harness();
  for (let i = 0; i < OUTBOX_CAP + 5; i++) {
    await h.engine.enqueue({ kind: "task", method: "POST", path: "/tasks/", body: { id: `t${i}` } });
  }
  const outbox = h.local.get(OUTBOX_KEY);
  assert.equal(outbox.length, OUTBOX_CAP);
  assert.equal(outbox[0].body.id, "t5");
  const st = await h.engine.status();
  assert.equal(st.pending, OUTBOX_CAP);
});

test("409 ghi conflict đủ 2 snapshot, xóa op, không retry", async () => {
  const h = harness({
    state: { tasks: [{ id: "t1", title: "Local", revision: 1 }], schedule: [] },
    apiImpl: {
      patch: async () => { throw err("http_409", "conflict"); },
      get: async () => [{ id: "t1", title: "Server", revision: 2 }],
    },
  });
  await h.engine.enqueue({ kind: "task", method: "PATCH", path: "/tasks/t1", body: { title: "Local" }, ifMatch: 1, recordId: "t1" });
  const r = await h.engine.flush();
  assert.equal(r.conflicts, 1);
  assert.equal(h.local.get(OUTBOX_KEY).length, 0);
  const conflicts = h.local.get(CONFLICTS_KEY);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].localSnapshot.title, "Local");
  assert.equal(conflicts[0].serverSnapshot.title, "Server");
  assert.equal(conflicts[0].serverRevision, 2);
  const st = await h.engine.status();
  assert.equal(st.conflicts, 1);
});

test("401 dừng worker, giữ nguyên queue", async () => {
  const h = harness({
    apiImpl: {
      post: async () => { throw err("unauthorized"); },
    },
  });
  await h.engine.enqueue({ kind: "task", method: "POST", path: "/tasks/", body: { id: "t1" } });
  const r = await h.engine.flush();
  assert.equal(r.stopped, "unauthorized");
  assert.equal(h.local.get(OUTBOX_KEY).length, 1);
});

test("422/400 chết ngay, không retry", async () => {
  const h = harness({
    apiImpl: {
      post: async () => { throw err("http_422", "bad"); },
    },
  });
  await h.engine.enqueue({ kind: "task", method: "POST", path: "/tasks/", body: { id: "t1" } });
  const r = await h.engine.flush();
  assert.equal(r.dead, 1);
  const outbox = h.local.get(OUTBOX_KEY);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].dead, true);
  const st = await h.engine.status();
  assert.equal(st.dead, 1);
  assert.equal(st.pending, 0);
});

test("đủ 10 lần thử → dead nhưng giữ lại; retryDead hồi sinh", async () => {
  const h = harness({
    apiImpl: { post: async () => { throw err("network_error"); } },
  });
  await h.engine.enqueue({ kind: "task", method: "POST", path: "/tasks/", body: { id: "t1" } });
  for (let i = 0; i < 10; i++) {
    h.advance(10 * 60_000);
    await h.engine.flush();
  }
  let outbox = h.local.get(OUTBOX_KEY);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].dead, true);
  const revived = await h.engine.retryDead();
  assert.equal(revived.revived, 1);
  outbox = h.local.get(OUTBOX_KEY);
  assert.equal(outbox[0].dead, undefined);
  assert.equal(outbox[0].tries, 0);
});

test("restore ghi bản local + enqueue PATCH với revision server", async () => {
  const h = harness({
    state: { tasks: [{ id: "t1", title: "Server", revision: 2 }], schedule: [] },
  });
  h.local.set(CONFLICTS_KEY, [{
    id: "c1", at: 1_000_000, kind: "task", recordId: "t1",
    localSnapshot: { id: "t1", title: "Local", revision: 1 },
    serverSnapshot: { id: "t1", title: "Server", revision: 2 },
    serverRevision: 2,
  }]);
  const r = await h.engine.restore("c1");
  assert.ok(r.opId);
  assert.equal(h.state().tasks[0].title, "Local");
  const outbox = h.local.get(OUTBOX_KEY);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].method, "PATCH");
  assert.equal(outbox[0].ifMatch, 2);
  assert.equal(h.local.get(CONFLICTS_KEY).length, 0);
});

test("restore id lạ thì báo lỗi", async () => {
  const h = harness();
  await assert.rejects(h.engine.restore("nope"), /Conflict not found/);
});

test("conflict quá 30 ngày bị dọn", async () => {
  const h = harness({ nowValue: 1_000_000 + 31 * 24 * 60 * 60 * 1000 });
  h.local.set(CONFLICTS_KEY, [
    { id: "old", at: 1_000_000, kind: "task", recordId: "t1" },
  ]);
  const list = await h.engine.conflicts();
  assert.equal(list.length, 0);
  assert.equal(h.local.get(CONFLICTS_KEY).length, 0);
});

test("syncNow đẩy rồi kéo để hội tụ", async () => {
  const h = harness({
    state: { tasks: [], schedule: [] },
    apiImpl: {
      post: async (path, body) => ({ id: body.id, revision: 1 }),
      get: async (path) => (path === "/tasks/" ? [{ id: "t9", title: "Từ server", revision: 1 }] : []),
    },
  });
  await h.engine.enqueue({ kind: "task", method: "POST", path: "/tasks/", body: { id: "t1", title: "A" } });
  const r = await h.engine.syncNow();
  assert.equal(r.flushed.pushed, 1);
  assert.equal(r.pulled.tasks, 1);
  assert.equal(h.state().tasks.find(t => t.id === "t9").title, "Từ server");
  const meta = h.local.get(SYNC_META_KEY);
  assert.ok(meta.lastPushAt > 0 && meta.lastPullAt > 0);
});

test("chưa đăng nhập thì pull/flush bỏ qua", async () => {
  const h = harness({ apiImpl: {} });
  h.api.getStatus = async () => ({ signedIn: false });
  assert.deepEqual((await h.engine.pull()).skipped, true);
  assert.deepEqual((await h.engine.flush()).skipped, true);
  const both = await h.engine.syncNow();
  assert.equal(both.flushed.skipped, true);
});

test("adopt revision từ response giảm 409 sau này", async () => {
  const h = harness({
    state: { tasks: [{ id: "t1", title: "A", revision: 1 }], schedule: [] },
    apiImpl: {
      post: async (path, body) => ({ id: body.id, revision: 7, updated_at: "2026-10-08T00:00:00" }),
    },
  });
  await h.engine.enqueue({ kind: "task", method: "POST", path: "/tasks/", body: { id: "t1", title: "A" } });
  await h.engine.flush();
  assert.equal(h.state().tasks[0].revision, 7);
});

test("pull shape server: enum/snake_case/revision map đúng, sort local giữ lại", async () => {
  const local = new Map();
  const api = {
    getStatus: async () => ({ signedIn: true }),
    get: async (path) => {
      if (path === "/tasks/") {
        return [{
          id: "srv-1", title: "Việc server", description: "mô tả dài",
          duration_minutes: 45, deadline: "2026-10-09T00:00:00", priority: "high",
          complexity: "medium", status: "completed", important: true,
          urgency: "urgent", source: "capture", created_at: "2026-10-08T01:00:00",
          updated_at: "2026-10-08T02:00:00", completed_at: "2026-10-08T03:00:00",
          revision: 7, subtasks: [],
        }];
      }
      return [];
    },
  };
  let held = {
    tasks: [{
      id: "srv-1", title: "Cũ", notes: "", durationMinutes: 25, energy: "medium",
      priority: "normal", important: null, urgency: "auto", dueAt: null,
      sortLocked: true, sortSource: "manual", sortNote: "giữ lại", sortFingerprint: "fp",
      status: "inbox", source: "manual", createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z", completedAt: null,
    }],
    schedule: [],
  };
  const engine = createSyncEngine({
    storage: { local: area(local) },
    api,
    readState: async () => structuredClone(held),
    writeState: async (next) => { held = structuredClone(next); },
    normalizeTask: (rec, prev) => taskFromApi(rec, prev),
    normalizeBlock: (rec, prev) => blockFromApi(rec, prev),
  });
  const res = await engine.pull();
  assert.equal(res.ok, true);
  const task = held.tasks.find(t => t.id === "srv-1");
  // completed server -> done local (không phải inbox)
  assert.equal(task.status, "done");
  assert.equal(task.notes, "mô tả dài");
  assert.equal(task.durationMinutes, 45);
  assert.equal(task.revision, 7);
  // sort* local giữ nguyên (server không có cột này)
  assert.equal(task.sortLocked, true);
  assert.equal(task.sortSource, "manual");
  assert.equal(task.sortFingerprint, "fp");
});

test("pull shape event server: block hiện đúng, standalone giữ lại", async () => {
  const local = new Map();
  const api = {
    getStatus: async () => ({ signedIn: true }),
    get: async (path) => {
      if (path === "/schedule/timeline") {
        return [
          {
            id: "ev-1", task_id: "srv-1", title: "Họp", description: null,
            event_date: "2026-10-08", start_time: "14:00", end_time: "15:00",
            event_type: "class", is_completed: false, is_circadian_optimized: true,
            started_at: "2026-10-08T07:00:00", ended_at: "2026-10-08T08:00:00",
            timezone: "Asia/Ho_Chi_Minh", updated_at: "2026-10-08T07:30:00", revision: 3,
          },
          {
            id: "ev-free", task_id: null, title: "Tự do",
            started_at: "2026-10-08T09:00:00", ended_at: "2026-10-08T10:00:00",
            is_completed: false, revision: 1,
          },
        ];
      }
      return [];
    },
  };
  let held = {
    tasks: [{ id: "srv-1", title: "Việc", status: "planned" }],
    schedule: [],
  };
  const engine = createSyncEngine({
    storage: { local: area(local) },
    api,
    readState: async () => structuredClone(held),
    writeState: async (next) => { held = structuredClone(next); },
    normalizeTask: (rec, prev) => taskFromApi(rec, prev),
    normalizeBlock: (rec, prev) => blockFromApi(rec, prev),
  });
  const res = await engine.pull();
  assert.equal(res.ok, true);
  const blocks = held.schedule;
  assert.equal(blocks.length, 2);
  const linked = blocks.find(b => b.id === "ev-1");
  assert.equal(linked.taskId, "srv-1");
  assert.equal(linked.label, "Họp");
  assert.equal(linked.status, "planned");
  assert.equal(linked.revision, 3);
  const free = blocks.find(b => b.id === "ev-free");
  assert.equal(free.taskId, null);
});
