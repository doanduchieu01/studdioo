// Sync engine — local-first: UI đọc/ghi local tức thì, module này pull/push nền.
//
// - Mặt sync DUY NHẤT: task + schedule (activity/tracking/memory ở yên local).
// - Pull: GET /tasks/, GET /schedule/timeline → merge vào local, BỎ QUA record
//   đang có op pending trong outbox (tránh pull ghi đè thao tác chưa đẩy).
// - Push: outbox queue, oldest-first, idempotent nhờ client UUID (POST) và
//   If-Match revision (PATCH). 409 → ghi conflict, không retry.
// - Xung đột: server thắng; bản local giữ trong studioSyncConflicts (≤20, TTL
//   30 ngày) để user xem/khôi phục ở màn Sync.
// - Thuần logic + storage tiêm vào: test được mà không cần chrome stubs.
//
// Ported from archived extension src/core/sync-engine.js — logic identical,
// adapted to companion store keys (studioOutbox / studioSyncConflicts /
// studioSyncMeta, all FREE of collisions with companion keys).
export const OUTBOX_KEY = "studioOutbox";
export const CONFLICTS_KEY = "studioSyncConflicts";
export const SYNC_META_KEY = "studioSyncMeta";
// Bản đã xóa trên web (tombstone): để từ chối restore hồi sinh xác + dọn op
// pending cho record không còn tồn tại. Tombstone server giữ lâu nên set này
// chỉ cắt 500 mục cũ nhất, không TTL.
export const DELETED_KEY = "studioSyncDeleted";
export const DELETED_CAP = 500;

export const OUTBOX_CAP = 200;
export const CONFLICT_CAP = 20;
export const CONFLICT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_TRIES = 10;
const BACKOFF_MS = [5000, 30000, 300000]; // 5s → 30s → 5ph

function backoffDelayMs(tries) {
  return BACKOFF_MS[Math.min(Math.max(tries - 1, 0), BACKOFF_MS.length - 1)];
}

function isRecordArray(value) {
  return Array.isArray(value);
}

export function createSyncEngine({
  storage,
  api,
  now = () => Date.now(),
  uuid,
  readState,
  writeState,
  normalizeTask = null,
  normalizeBlock = null,
} = {}) {
  if (!storage?.local) throw new Error("SyncEngine needs chrome.storage.");
  if (!api) throw new Error("SyncEngine needs an ApiClient.");
  if (typeof readState !== "function" || typeof writeState !== "function") {
    throw new Error("SyncEngine needs readState/writeState for the local store.");
  }
  const newId = uuid ?? (() => globalThis.crypto?.randomUUID?.() ?? `${now()}-${Math.floor(Math.random() * 1e9)}`);

  async function readOutbox() {
    const saved = await storage.local.get(OUTBOX_KEY);
    const ops = saved?.[OUTBOX_KEY];
    return isRecordArray(ops) ? ops : [];
  }

  async function writeOutbox(ops) {
    await storage.local.set({ [OUTBOX_KEY]: ops });
  }

  async function readConflicts() {
    const saved = await storage.local.get(CONFLICTS_KEY);
    const list = saved?.[CONFLICTS_KEY];
    return isRecordArray(list) ? list : [];
  }

  async function readDeleted() {
    const saved = await storage.local.get(DELETED_KEY);
    const list = saved?.[DELETED_KEY];
    return isRecordArray(list) ? list : [];
  }

  async function writeDeleted(list) {
    await storage.local.set({ [DELETED_KEY]: list.slice(-DELETED_CAP) });
  }

  async function writeConflicts(list) {
    await storage.local.set({ [CONFLICTS_KEY]: list.slice(-CONFLICT_CAP) });
  }

  async function readMeta() {
    const saved = await storage.local.get(SYNC_META_KEY);
    return saved?.[SYNC_META_KEY] ?? { lastPullAt: 0, lastPushAt: 0 };
  }

  async function writeMeta(patch) {
    const meta = await readMeta();
    await storage.local.set({ [SYNC_META_KEY]: { ...meta, ...patch } });
  }

  async function signedIn() {
    try {
      const status = await api.getStatus();
      return Boolean(status?.signedIn);
    } catch {
      return false;
    }
  }

  function pendingIds(ops) {
    const ids = new Set();
    for (const op of ops) {
      if (!op?.dead && op?.recordId) ids.add(op.recordId);
    }
    return ids;
  }

  async function pruneConflicts(list) {
    const cutoff = now() - CONFLICT_TTL_MS;
    const kept = list.filter(item => (item?.at ?? 0) >= cutoff);
    if (kept.length !== list.length) await writeConflicts(kept);
    return kept;
  }

  // Merge 1 mảng server vào mảng local: thay TOÀN record theo id
  // (không merge nửa vời từng field). Bỏ qua id đang pending trong outbox.
  // normalize(rec, prev): convert shape server -> local TRƯỚC khi so sánh/lưu
  // (vd taskFromApi/blockFromApi). Mặc định identity để test cũ không vỡ.
  function mergeRecords(localArr, serverArr, skipIds, normalize) {
    const convert = typeof normalize === "function" ? normalize : (rec) => rec;
    const local = isRecordArray(localArr) ? localArr.slice() : [];
    const byId = new Map(local.map((item, index) => [item?.id, index]));
    let changed = false;
    for (const raw of serverArr) {
      if (!raw?.id || skipIds.has(raw.id)) continue;
      const index = byId.get(raw.id);
      const rec = convert(raw, index === undefined ? null : local[index]);
      if (!rec) continue;
      if (index === undefined) {
        local.push(rec);
        byId.set(rec.id, local.length - 1);
        changed = true;
      } else if (JSON.stringify(local[index]) !== JSON.stringify(rec)) {
        local[index] = rec;
        changed = true;
      }
    }
    return { records: local, changed };
  }

  async function pull() {
    if (!(await signedIn())) return { skipped: true, reason: "signed-out" };
    let tasks, timeline;
    try {
      [tasks, timeline] = await Promise.all([
        api.get("/tasks/"),
        api.get("/schedule/timeline"),
      ]);
    } catch (error) {
      return { skipped: true, reason: error?.code ?? "network_error" };
    }
    if (!isRecordArray(tasks) || !isRecordArray(timeline)) {
      return { skipped: true, reason: "bad-payload" };
    }
    const ops = await readOutbox();
    const skip = pendingIds(ops);
    const state = await readState();
    const mergedTasks = mergeRecords(state?.tasks, tasks, skip, normalizeTask);
    const mergedSchedule = mergeRecords(state?.schedule, timeline, skip, normalizeBlock);
    let changed = mergedTasks.changed || mergedSchedule.changed;
    // Tombstone: bản web đã xóa không còn trong list endpoints — học qua
    // GET /sync/changes (full set, tối đa 3 vòng khi truncated). Xóa local +
    // bỏ op pending cho id đó (server thắng; op đó đằng nào cũng 404) + ghi
    // vào tập deleted để restore từ chối hồi sinh xác.
    let deleted = 0;
    let droppedOps = 0;
    let delta = "ok";
    try {
      let rounds = 0;
      let since = null;
      const tombTasks = new Set();
      const tombEvents = new Set();
      const extraTasks = [];
      const extraEvents = [];
      for (;;) {
        const qs = since ? `?since=${encodeURIComponent(since)}` : "";
        const diff = await api.get(`/sync/changes${qs}`);
        for (const rec of diff?.upsert_tasks ?? []) extraTasks.push(rec);
        for (const rec of diff?.upsert_events ?? []) extraEvents.push(rec);
        for (const id of diff?.delete_task_ids ?? []) tombTasks.add(id);
        for (const id of diff?.delete_event_ids ?? []) tombEvents.add(id);
        rounds += 1;
        if (!diff?.truncated || rounds >= 3) break;
        since = diff?.server_time ?? null;
        if (!since) break;
      }
      const upTasks = mergeRecords(mergedTasks.records, extraTasks, skip, normalizeTask);
      const upSchedule = mergeRecords(mergedSchedule.records, extraEvents, skip, normalizeBlock);
      let nextTasks = upTasks.records;
      let nextSchedule = upSchedule.records;
      changed = changed || upTasks.changed || upSchedule.changed;
      const dropIds = new Set([...tombTasks, ...tombEvents]);
      if (dropIds.size > 0) {
        const before = [nextTasks.length, nextSchedule.length];
        nextTasks = nextTasks.filter(item => !dropIds.has(item?.id));
        nextSchedule = nextSchedule.filter(item => !dropIds.has(item?.id));
        deleted = (before[0] - nextTasks.length) + (before[1] - nextSchedule.length);
        changed = changed || deleted > 0;
        const keptOps = [];
        for (const op of ops) {
          if (!op?.dead && op?.recordId && dropIds.has(op.recordId)) { droppedOps += 1; continue; }
          keptOps.push(op);
        }
        if (droppedOps > 0) await writeOutbox(keptOps);
        const known = await readDeleted();
        const knownIds = new Set(known.map(entry => `${entry?.kind}:${entry?.id}`));
        const additions = [];
        for (const id of tombTasks) {
          if (!knownIds.has(`task:${id}`)) { knownIds.add(`task:${id}`); additions.push({ kind: "task", id, at: now() }); }
        }
        for (const id of tombEvents) {
          if (!knownIds.has(`schedule:${id}`)) { knownIds.add(`schedule:${id}`); additions.push({ kind: "schedule", id, at: now() }); }
        }
        if (additions.length > 0) await writeDeleted([...known, ...additions]);
      }
      if (changed) {
        await writeState({ ...state, tasks: nextTasks, schedule: nextSchedule });
      }
    } catch {
      delta = "unavailable";
      if (mergedTasks.changed || mergedSchedule.changed) {
        await writeState({ ...state, tasks: mergedTasks.records, schedule: mergedSchedule.records });
      }
    }
    await pruneConflicts(await readConflicts());
    await writeMeta({ lastPullAt: now() });
    return {
      ok: true,
      tasks: tasks.length,
      events: timeline.length,
      skippedPending: skip.size,
      changed,
      deleted,
      droppedOps,
      delta,
    };
  }

  async function recordConflict({ kind, recordId, serverSnapshot }) {
    const state = await readState();
    const pool = kind === "schedule" ? state?.schedule : state?.tasks;
    const localSnapshot = isRecordArray(pool)
      ? (pool.find(item => item?.id === recordId) ?? null)
      : null;
    const conflicts = await readConflicts();
    conflicts.push({
      id: newId(),
      at: now(),
      kind,
      recordId,
      localSnapshot,
      serverSnapshot: serverSnapshot ?? null,
      serverRevision: serverSnapshot?.revision ?? null,
    });
    await writeConflicts(conflicts);
  }

  async function fetchServerRecord(kind, recordId) {
    try {
      const list = kind === "schedule"
        ? await api.get("/schedule/timeline")
        : await api.get("/tasks/");
      if (!isRecordArray(list)) return null;
      return list.find(item => item?.id === recordId) ?? null;
    } catch {
      return null;
    }
  }

  function isRetryable(error) {
    const code = error?.code ?? "";
    if (code === "unauthorized") return false;
    if (code === "http_409") return false;
    if (code === "http_422") return false;
    if (code === "http_400") return false;
    return true;
  }

  async function runOp(op) {
    const method = String(op.method ?? "POST").toLowerCase();
    const call = method === "patch" ? api.patch
      : method === "delete" ? api.delete
      : api.post;
    if (method === "delete") return call.call(api, op.path);
    return call.call(api, op.path, op.body, op.ifMatch != null ? { ifMatch: op.ifMatch } : undefined);
  }

  // Cập nhật revision/updatedAt từ response vào record local để giảm 409 sau này.
  async function adoptServerRevision(kind, response) {
    if (!response?.id || response?.revision == null) return;
    try {
      const state = await readState();
      const pool = kind === "schedule" ? state?.schedule : state?.tasks;
      if (!isRecordArray(pool)) return;
      const index = pool.findIndex(item => item?.id === response.id);
      if (index === -1) return;
      const next = pool.slice();
      next[index] = { ...next[index], revision: response.revision, updated_at: response.updated_at ?? next[index].updated_at };
      await writeState({ ...state, [kind === "schedule" ? "schedule" : "tasks"]: next });
    } catch {
      // Best-effort: local vẫn đúng, chỉ thiếu revision mới.
    }
  }

  async function flush() {
    if (!(await signedIn())) return { skipped: true, reason: "signed-out" };
    const ops = await readOutbox();
    const timestamp = now();
    let pushed = 0;
    let dead = 0;
    let conflicts = 0;
    for (const op of ops) {
      if (op?.dead) { dead += 1; continue; }
      if ((op?.nextAttemptAt ?? 0) > timestamp) continue;
      try {
        const response = await runOp(op);
        await adoptServerRevision(op.kind, response);
        op.done = true;
        pushed += 1;
      } catch (error) {
        const code = error?.code ?? "";
        if (code === "unauthorized") {
          return { ok: false, stopped: "unauthorized", pushed, dead, conflicts };
        }
        if (code === "http_409") {
          const serverSnapshot = await fetchServerRecord(op.kind, op.recordId);
          await recordConflict({ kind: op.kind, recordId: op.recordId, serverSnapshot });
          op.done = true;
          conflicts += 1;
          continue;
        }
        if (!isRetryable(error)) {
          op.dead = true;
          op.deadReason = code || "bad-request";
          dead += 1;
          continue;
        }
        op.tries = (op.tries ?? 0) + 1;
        if (op.tries >= MAX_TRIES) {
          op.dead = true;
          op.deadReason = "max-tries";
          dead += 1;
        } else {
          op.nextAttemptAt = timestamp + backoffDelayMs(op.tries);
        }
      }
    }
    const remaining = ops.filter(op => !op.done);
    await writeOutbox(remaining);
    if (pushed > 0) await writeMeta({ lastPushAt: timestamp });
    return { ok: true, pushed, dead, conflicts, pending: remaining.filter(op => !op.dead).length };
  }

  return {
    // Ghi op vào outbox. Vượt cap 200 → drop-oldest + báo số bị bỏ (không im lặng).
    async enqueue({ kind, method = "POST", path, body, ifMatch, recordId }) {
      if (!path) throw new Error("Sync op needs a path.");
      const ops = await readOutbox();
      const op = {
        opId: newId(),
        kind: kind === "schedule" ? "schedule" : "task",
        method: String(method).toUpperCase(),
        path,
        body,
        ifMatch: ifMatch ?? null,
        recordId: recordId ?? body?.id ?? null,
        enqueuedAt: now(),
        tries: 0,
        nextAttemptAt: 0,
      };
      ops.push(op);
      let dropped = 0;
      while (ops.length > OUTBOX_CAP) {
        ops.shift();
        dropped += 1;
      }
      await writeOutbox(ops);
      return { opId: op.opId, dropped, pending: ops.filter(o => !o.dead).length };
    },

    async pull() {
      return pull();
    },

    async flush() {
      return flush();
    },

    // Đẩy rồi kéo để hội tụ: sau push thành công thì pull ngay.
    async syncNow() {
      const flushed = await flush();
      if (flushed?.skipped) return { flushed, pulled: { skipped: true, reason: flushed.reason } };
      if (flushed?.stopped) return { flushed, pulled: { skipped: true, reason: flushed.stopped } };
      const pulled = await pull();
      return { flushed, pulled };
    },

    async status() {
      const [ops, conflicts, meta] = await Promise.all([
        readOutbox(), readConflicts(), readMeta(),
      ]);
      const live = await pruneConflicts(conflicts);
      return {
        pending: ops.filter(op => !op?.dead).length,
        dead: ops.filter(op => op?.dead).length,
        conflicts: live.length,
        lastPullAt: meta.lastPullAt ?? 0,
        lastPushAt: meta.lastPushAt ?? 0,
      };
    },

    async conflicts() {
      return pruneConflicts(await readConflicts());
    },

    // Khôi phục bản local từ conflict: ghi local + enqueue push với revision mới.
    // Từ chối nếu bản đó đã bị xóa trên web (tránh hồi sinh xác rồi 404 vòng lặp).
    async restore(conflictId) {
      const conflicts = await readConflicts();
      const item = conflicts.find(entry => entry?.id === conflictId);
      if (!item?.localSnapshot) throw new Error("Conflict not found.");
      const gone = await readDeleted();
      if (gone.some(entry => entry?.kind === (item.kind === "schedule" ? "schedule" : "task") && entry?.id === item.recordId)) {
        throw new Error("Bản này đã bị xóa trên web nên không thể khôi phục. Muốn dùng lại, hãy tạo mới.");
      }
      const state = await readState();
      const key = item.kind === "schedule" ? "schedule" : "tasks";
      const pool = isRecordArray(state?.[key]) ? state[key].slice() : [];
      const index = pool.findIndex(entry => entry?.id === item.recordId);
      const snapshot = { ...item.localSnapshot };
      if (index === -1) pool.push(snapshot);
      else pool[index] = snapshot;
      await writeState({ ...state, [key]: pool });
      const path = item.kind === "schedule"
        ? `/schedule/events/${item.recordId}`
        : `/tasks/${item.recordId}`;
      const result = await this.enqueue({
        kind: item.kind,
        method: "PATCH",
        path,
        body: snapshot,
        ifMatch: item.serverRevision,
        recordId: item.recordId,
      });
      await writeConflicts(conflicts.filter(entry => entry?.id !== conflictId));
      return result;
    },

    async retryDead() {
      const ops = await readOutbox();
      let revived = 0;
      for (const op of ops) {
        if (op?.dead) {
          delete op.dead;
          delete op.deadReason;
          op.tries = 0;
          op.nextAttemptAt = 0;
          revived += 1;
        }
      }
      await writeOutbox(ops);
      return { revived };
    },

    // Exposed cho test.
    _keys: { OUTBOX_KEY, CONFLICTS_KEY, SYNC_META_KEY, DELETED_KEY },
  };
}
