// Task sync mapping: local task <-> API payload.
//
// Ported from archived extension src/core/task-sync.js — logic identical.
// Companion has no lib/utils.js, so the two helpers it used (clamp, toIso)
// are inlined here (same semantics) to keep the port dependency-free.
//
// - UUID gate: backend 422 mọi id không phải UUID.
// - Status map tường minh: inbox→pending, planned→in_progress, done→completed,
//   archived→archived. Backend không đoán.
// - Field local-only (sortLocked/sortSource/sortNote/sortFingerprint) không gửi.
//   toApiTaskUpdate trả null khi changes chỉ có field local-only → caller skip.

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function safeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value, fallback = null) {
  const date = safeDate(value);
  return date ? date.toISOString() : fallback;
}

// Backend trả datetime NAIVE (không Z, không offset) nhưng ngữ nghĩa là UTC
// (DB lưu naive UTC). new Date("2026-10-08T07:00:00") hiểu theo giờ LOCAL của
// máy nên lệch múi giờ — phải gắn Z trước khi parse.
const NAIVE_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;

export function serverIso(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return toIso(value, null);
  const text = String(value).trim();
  if (!text) return null;
  const withZone = NAIVE_DATETIME_RE.test(text) ? `${text}Z` : text;
  return toIso(withZone, null);
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

export function newTaskId() {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (typeof uuid === "string" && UUID_RE.test(uuid)) return uuid;
  } catch {
    // bỏ qua, dùng fallback bên dưới
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const STATUS_TO_API = {
  inbox: "pending",
  planned: "in_progress",
  done: "completed",
  archived: "archived",
};

export function mapStatusToApi(status) {
  return STATUS_TO_API[status] ?? "pending";
}

// Body POST /tasks/ đầy đủ từ task local đã normalize.
export function toApiTask(task) {
  if (!task || !isUuid(task.id)) return null;
  return {
    id: task.id,
    title: task.title,
    description: task.notes || null,
    duration_minutes: task.durationMinutes ?? null,
    deadline: task.dueAt ?? null,
    priority: task.priority ?? null,
    complexity: task.energy ?? null,
    status: mapStatusToApi(task.status),
    important: task.important ?? null,
    urgency: task.urgency ?? null,
    source: task.source === "gemini" ? "gemini" : "manual",
    subtasks: [],
  };
}

// Body PATCH /tasks/{id} từ changes cục bộ. Trả null nếu không có gì gửi được.
const MAPPABLE = {
  title: "title",
  notes: "description",
  durationMinutes: "duration_minutes",
  dueAt: "deadline",
  priority: "priority",
  energy: "complexity",
  important: "important",
  urgency: "urgency",
  source: "source",
};

export function toApiTaskUpdate(changes) {
  if (!changes || typeof changes !== "object") return null;
  const body = {};
  for (const [localKey, apiKey] of Object.entries(MAPPABLE)) {
    if (Object.hasOwn(changes, localKey) && changes[localKey] !== undefined) {
      body[apiKey] = changes[localKey];
    }
  }
  if (Object.hasOwn(changes, "status") && changes.status !== undefined) {
    body.status = mapStatusToApi(changes.status);
  }
  return Object.keys(body).length > 0 ? body : null;
}

// Chiều ngược: TaskOut server -> task local (dùng khi pull).
const API_STATUS_TO_LOCAL = {
  pending: "inbox",
  in_progress: "planned",
  completed: "done",
  archived: "archived",
};

const API_PRIORITY_TO_LOCAL = { high: "high", low: "low", medium: "normal" };
const API_COMPLEXITY_TO_LOCAL = { low: "low", medium: "medium", high: "high" };
const API_SOURCES = new Set(["manual", "gemini", "capture", "extension"]);

export function taskFromApi(rec, prev = null) {
  if (!rec || typeof rec.id !== "string" || !rec.id) return null;
  const title = String(rec.title ?? "").trim().slice(0, 255);
  if (!title) return null;
  const previous = prev && typeof prev === "object" ? prev : null;
  return {
    id: rec.id,
    title,
    notes: typeof rec.description === "string" ? rec.description.slice(0, 4000) : "",
    durationMinutes: clamp(rec.duration_minutes ?? 25, 5, 480),
    energy: API_COMPLEXITY_TO_LOCAL[rec.complexity] ?? "medium",
    priority: API_PRIORITY_TO_LOCAL[rec.priority] ?? "normal",
    important: typeof rec.important === "boolean" ? rec.important : null,
    urgency: ["urgent", "not-urgent"].includes(rec.urgency) ? rec.urgency : "auto",
    dueAt: serverIso(rec.deadline),
    sortLocked: previous?.sortLocked === true,
    sortSource: ["ai", "rules", "manual"].includes(previous?.sortSource) ? previous.sortSource : null,
    sortNote: typeof previous?.sortNote === "string" ? previous.sortNote.slice(0, 160) : "",
    sortFingerprint: typeof previous?.sortFingerprint === "string" ? previous.sortFingerprint.slice(0, 16000) : "",
    status: API_STATUS_TO_LOCAL[rec.status] ?? "inbox",
    source: API_SOURCES.has(rec.source) ? rec.source : "manual",
    createdAt: serverIso(rec.created_at) ?? new Date().toISOString(),
    updatedAt: serverIso(rec.updated_at) ?? serverIso(rec.created_at) ?? new Date().toISOString(),
    completedAt: (API_STATUS_TO_LOCAL[rec.status] ?? "inbox") === "done"
      ? (serverIso(rec.completed_at) ?? serverIso(rec.created_at) ?? new Date().toISOString())
      : null,
    ...(rec.revision != null ? { revision: rec.revision } : {}),
  };
}
