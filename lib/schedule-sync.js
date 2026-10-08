// Schedule sync mapping: local block <-> API payload.
//
// Ported from archived extension src/core/schedule-sync.js — logic identical.
// Companion scope: converters + pull merge only (NO schedule creation UI).
// toIso is inlined (companion has no lib/utils.js).
//
// - UUID gate (giống task-sync): backend 422 id không phải UUID.
// - Local không có: description, event_type -> backend default.
//   Backend không có: skipped (gộp vào is_completed=false), proposalId, source.
// - Title backend bắt buộc >=2 ký tự: label rỗng -> fallback task title ->
//   vẫn rỗng thì skip (không tạo event "Untitled" rác).
import { isUuid, serverIso } from "./task-sync.js";

export { isUuid };

function safeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value, fallback = null) {
  const date = safeDate(value);
  return date ? date.toISOString() : fallback;
}

export function newBlockId() {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (typeof uuid === "string" && isUuid(uuid)) return uuid;
  } catch {
    // bỏ qua
  }
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function deviceTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && tz) return tz;
  } catch {
    // bỏ qua
  }
  return "UTC";
}

// Body POST /schedule/events đầy đủ từ block local. Trả null nếu không gửi được.
export function toApiEvent(block, { taskTitle = "", timezone = null } = {}) {
  if (!block || !isUuid(block.id)) return null;
  const title = String(block.label ?? "").trim().slice(0, 255)
    || String(taskTitle ?? "").trim().slice(0, 255);
  if (title.length < 2) return null;
  const startAt = block.startAt ?? null;
  const endAt = block.endAt ?? null;
  if (!startAt || !endAt) return null;
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return {
    id: block.id,
    task_id: isUuid(block.taskId) ? block.taskId : null,
    title,
    description: null,
    started_at: startAt,
    ended_at: endAt,
    timezone: timezone ?? deviceTimezone(),
  };
}

// Body PATCH /schedule/events/{id} từ thay đổi cục bộ. Trả null nếu rỗng.
export function toApiEventUpdate(changes) {
  if (!changes || typeof changes !== "object") return null;
  const body = {};
  const title = changes.label ?? changes.title;
  if (title !== undefined) {
    const text = String(title ?? "").trim().slice(0, 255);
    if (text.length >= 2) body.title = text;
  }
  for (const [localKey, apiKey] of [["startAt", "started_at"], ["endAt", "ended_at"], ["timezone", "timezone"], ["taskId", "task_id"]]) {
    if (Object.hasOwn(changes, localKey) && changes[localKey] !== undefined) {
      if (localKey === "taskId" && !isUuid(changes.taskId)) continue;
      body[apiKey] = changes[localKey];
    }
  }
  if (Object.hasOwn(changes, "is_completed")) body.is_completed = Boolean(changes.is_completed);
  if (Object.hasOwn(changes, "status") && changes.status !== undefined) {
    // Local: planned/active/done/skipped. Backend chỉ có is_completed.
    body.is_completed = changes.status === "done";
  }
  return Object.keys(body).length > 0 ? body : null;
}

// Diff 2 mảng block theo id: added / removed / changed (so toàn record).
export function diffScheduleBlocks(beforeArr, afterArr) {
  const before = new Map((Array.isArray(beforeArr) ? beforeArr : []).map(b => [b?.id, b]));
  const after = new Map((Array.isArray(afterArr) ? afterArr : []).map(b => [b?.id, b]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, next] of after) {
    if (id == null) continue;
    const prev = before.get(id);
    if (!prev) added.push(next);
    else if (JSON.stringify(prev) !== JSON.stringify(next)) changed.push({ before: prev, after: next });
  }
  for (const [id, prev] of before) {
    if (id == null) continue;
    if (!after.has(id)) removed.push(prev);
  }
  return { added, removed, changed };
}

// Chiều ngược: ScheduleEventOut server -> block local (dùng khi pull).
export function blockFromApi(rec, prev = null) {
  if (!rec || typeof rec.id !== "string" || !rec.id) return null;
  const startAt = serverIso(rec.started_at);
  const endAt = serverIso(rec.ended_at);
  if (!startAt || !endAt || endAt <= startAt) return null;
  const title = String(rec.title ?? "").trim().slice(0, 255);
  if (title.length < 2) return null;
  const previous = prev && typeof prev === "object" ? prev : null;
  const status = rec.is_completed === true
    ? "done"
    : (previous?.status === "skipped" || previous?.status === "active" ? previous.status : "planned");
  return {
    id: rec.id,
    taskId: typeof rec.task_id === "string" && rec.task_id ? rec.task_id : null,
    label: title,
    startAt,
    endAt,
    status,
    source: "manual",
    proposalId: null,
    createdAt: serverIso(rec.created_at) ?? new Date().toISOString(),
    ...(rec.revision != null ? { revision: rec.revision } : {}),
  };
}

// Gán UUID cho entity bundle MỚI để sync được. Companion không tạo bundle
// (không có UI tạo schedule) nhưng giữ hàm để port đầy đủ với archive.
export function assignBundleUuids(state, beforeTaskIds, beforeBlockIds) {
  const next = {
    ...state,
    tasks: (state.tasks ?? []).map(t => ({ ...t })),
    schedule: (state.schedule ?? []).map(b => ({ ...b })),
  };
  const beforeTasks = beforeTaskIds instanceof Set ? beforeTaskIds : new Set(beforeTaskIds ?? []);
  const beforeBlocks = beforeBlockIds instanceof Set ? beforeBlockIds : new Set(beforeBlockIds ?? []);
  const taskRemap = new Map();
  const newTasks = [];
  for (const task of next.tasks) {
    if (beforeTasks.has(task.id) || isUuid(task.id)) continue;
    const fresh = newBlockId();
    if (!isUuid(fresh)) continue;
    taskRemap.set(task.id, fresh);
    task.id = fresh;
    newTasks.push(task);
  }
  const newBlocks = [];
  for (const block of next.schedule) {
    if (taskRemap.has(block.taskId)) block.taskId = taskRemap.get(block.taskId);
    if (beforeBlocks.has(block.id) || isUuid(block.id)) continue;
    const fresh = newBlockId();
    if (!isUuid(fresh)) continue;
    block.id = fresh;
    newBlocks.push(block);
  }
  return { state: next, newTasks, newBlocks };
}
