process.env.TZ = "UTC";

import test from "node:test";
import assert from "node:assert/strict";
import {
  isUuid,
  newTaskId,
  mapStatusToApi,
  toApiTask,
  toApiTaskUpdate,
  taskFromApi,
} from "../lib/task-sync.js";
import {
  newBlockId,
  deviceTimezone,
  toApiEvent,
  toApiEventUpdate,
  diffScheduleBlocks,
  blockFromApi,
} from "../lib/schedule-sync.js";

const UUID = "3f2a1b9c-7d4e-4a1b-9c2f-8e6d5b4a3f21";
const UUID_A = "3f2a1b9c-7d4e-4a1b-9c2f-8e6d5b4a3f21";
const UUID_B = "6f2a1b9c-7d4e-4a1b-9c2f-8e6d5b4a3f22";
const UUID_T = "11111111-2222-4333-8444-555555555555";

// ---- task converters (port of archive tests/task-sync.test.js, minus kanban gate) ----

test("isUuid chỉ chấp nhận UUID chuẩn có gạch nối", () => {
  assert.equal(isUuid(UUID), true);
  assert.equal(isUuid(UUID.toUpperCase()), true);
  for (const bad of ["task-1234-abcd", "task-capture-1-0", "", null, undefined, 123, "3f2a1b9c7d4e4a1b9c2f8e6d5b4a3f21", UUID + "x"]) {
    assert.equal(isUuid(bad), false, String(bad));
  }
});

test("newTaskId sinh UUID thật, không phải task-xxx", () => {
  const id = newTaskId();
  assert.equal(isUuid(id), true);
  assert.ok(!id.startsWith("task-"));
});

test("status map tường minh, không đoán", () => {
  assert.equal(mapStatusToApi("inbox"), "pending");
  assert.equal(mapStatusToApi("planned"), "in_progress");
  assert.equal(mapStatusToApi("done"), "completed");
  assert.equal(mapStatusToApi("archived"), "archived");
  assert.equal(mapStatusToApi("weird"), "pending");
  assert.equal(mapStatusToApi(undefined), "pending");
});

test("toApiTask map đủ field, id không UUID thì null", () => {
  const body = toApiTask({
    id: UUID,
    title: "Học bài",
    notes: "ghi chú",
    durationMinutes: 45,
    dueAt: "2026-10-09T00:00:00.000Z",
    priority: "high",
    energy: "medium",
    important: true,
    urgency: "urgent",
    status: "planned",
    source: "manual",
  });
  assert.deepEqual(body, {
    id: UUID,
    title: "Học bài",
    description: "ghi chú",
    duration_minutes: 45,
    deadline: "2026-10-09T00:00:00.000Z",
    priority: "high",
    complexity: "medium",
    status: "in_progress",
    important: true,
    urgency: "urgent",
    source: "manual",
    subtasks: [],
  });
});

test("toApiTask từ chối id legacy", () => {
  assert.equal(toApiTask({ id: "task-1234-abcd", title: "x" }), null);
  assert.equal(toApiTask(null), null);
  assert.equal(toApiTask({ title: "no id" }), null);
});

test("toApiTaskUpdate chỉ map field gửi được, null khi toàn local-only", () => {
  assert.deepEqual(
    toApiTaskUpdate({ title: "Mới", notes: "n", sortLocked: true }),
    { title: "Mới", description: "n" }
  );
  assert.deepEqual(toApiTaskUpdate({ status: "done" }), { status: "completed" });
  assert.deepEqual(toApiTaskUpdate({ important: false, urgency: "auto" }), { important: false, urgency: "auto" });
  assert.equal(toApiTaskUpdate({ sortLocked: true, sortFingerprint: "x", sortSource: "manual" }), null);
  assert.equal(toApiTaskUpdate({}), null);
  assert.equal(toApiTaskUpdate(null), null);
});

test("source gemini giữ nguyên, source lạ không lọt", () => {
  assert.equal(toApiTask({ id: UUID, title: "x", source: "gemini" }).source, "gemini");
  assert.equal(toApiTask({ id: UUID, title: "x", source: "weird" }).source, "manual");
});

test("taskFromApi: TaskOut server -> task local, enum + snake_case map dung", () => {
  const out = taskFromApi({
    id: UUID,
    title: "Lam bai",
    description: "ghi chu dai",
    duration_minutes: 45,
    deadline: "2026-10-09T00:00:00",
    priority: "high",
    complexity: "medium",
    status: "in_progress",
    important: true,
    urgency: "urgent",
    source: "capture",
    created_at: "2026-10-08T01:00:00",
    updated_at: "2026-10-08T02:00:00",
    completed_at: null,
    revision: 7,
    subtasks: [],
  });
  assert.equal(out.status, "planned");
  assert.equal(out.notes, "ghi chu dai");
  assert.equal(out.durationMinutes, 45);
  assert.equal(out.energy, "medium");
  assert.equal(out.priority, "high");
  assert.equal(out.dueAt, "2026-10-09T00:00:00.000Z");
  assert.equal(out.source, "capture");
  assert.equal(out.revision, 7);
  assert.equal(out.sortLocked, false);
});

test("taskFromApi: completed/done + pending/inbox + archived giu nguyen", () => {
  assert.equal(taskFromApi({ id: UUID, title: "x", status: "completed" }).status, "done");
  assert.equal(taskFromApi({ id: UUID, title: "x", status: "pending" }).status, "inbox");
  assert.equal(taskFromApi({ id: UUID, title: "x", status: "archived" }).status, "archived");
  assert.equal(taskFromApi({ id: UUID, title: "x", status: "weird" }).status, "inbox");
});

test("taskFromApi: giu sort* local, khong revision thi khong them key", () => {
  const prev = { sortLocked: true, sortSource: "manual", sortNote: "n", sortFingerprint: "fp" };
  const out = taskFromApi({ id: UUID, title: "x", status: "pending" }, prev);
  assert.equal(out.sortLocked, true);
  assert.equal(out.sortSource, "manual");
  assert.equal(out.sortFingerprint, "fp");
  assert.ok(!("revision" in out));
});

test("taskFromApi: thieu title/id -> null", () => {
  assert.equal(taskFromApi({ id: UUID, title: "  ", status: "pending" }), null);
  assert.equal(taskFromApi({ title: "x", status: "pending" }), null);
  assert.equal(taskFromApi(null), null);
});

// ---- schedule converters (port of archive tests/schedule-sync.test.js) ----

function block(over = {}) {
  return {
    id: UUID_A,
    taskId: UUID_T,
    label: "Học sâu",
    startAt: "2026-10-08T07:00:00.000Z",
    endAt: "2026-10-08T07:25:00.000Z",
    status: "planned",
    source: "manual",
    proposalId: null,
    createdAt: "2026-10-08T06:00:00.000Z",
    ...over,
  };
}

test("newBlockId sinh UUID thật", () => {
  assert.equal(isUuid(newBlockId()), true);
});

test("deviceTimezone trả chuỗi IANA hợp lệ", () => {
  const tz = deviceTimezone();
  assert.equal(typeof tz, "string");
  assert.ok(tz.length > 0);
});

test("toApiEvent map đủ field block UUID", () => {
  const body = toApiEvent(block(), { taskTitle: "Bỏ qua", timezone: "Asia/Ho_Chi_Minh" });
  assert.deepEqual(body, {
    id: UUID_A,
    task_id: UUID_T,
    title: "Học sâu",
    description: null,
    started_at: "2026-10-08T07:00:00.000Z",
    ended_at: "2026-10-08T07:25:00.000Z",
    timezone: "Asia/Ho_Chi_Minh",
  });
});

test("toApiEvent chặn id legacy, thiếu giờ, title ngắn", () => {
  assert.equal(toApiEvent(block({ id: "block-123" })), null);
  assert.equal(toApiEvent(null), null);
  assert.equal(toApiEvent(block({ startAt: null })), null);
  assert.equal(toApiEvent(block({ endAt: "2026-10-08T06:00:00.000Z" })), null);
  assert.equal(toApiEvent(block({ label: "  " }), { taskTitle: "Việc X" }).title, "Việc X");
  assert.equal(toApiEvent(block({ label: " " }), { taskTitle: " " }), null);
  assert.equal(toApiEvent(block({ label: "A" }), { taskTitle: "" }), null);
});

test("toApiEvent task_id legacy thành null, không fail cả record", () => {
  const body = toApiEvent(block({ taskId: "task-1" }), { timezone: "UTC" });
  assert.equal(body.task_id, null);
  assert.equal(body.id, UUID_A);
});

test("toApiEventUpdate map partial, rỗng thì null", () => {
  assert.deepEqual(
    toApiEventUpdate({ label: "Mới", startAt: "2026-10-08T08:00:00.000Z" }),
    { title: "Mới", started_at: "2026-10-08T08:00:00.000Z" }
  );
  assert.deepEqual(toApiEventUpdate({ status: "done" }), { is_completed: true });
  assert.deepEqual(toApiEventUpdate({ status: "skipped" }), { is_completed: false });
  assert.deepEqual(toApiEventUpdate({ status: "planned" }), { is_completed: false });
  assert.deepEqual(toApiEventUpdate({ is_completed: true }), { is_completed: true });
  assert.deepEqual(toApiEventUpdate({ timezone: "Asia/Ho_Chi_Minh" }), { timezone: "Asia/Ho_Chi_Minh" });
  assert.equal(toApiEventUpdate({}), null);
  assert.equal(toApiEventUpdate(null), null);
  assert.equal(toApiEventUpdate({ title: "x" }), null);
  assert.deepEqual(toApiEventUpdate({ taskId: "task-9", title: "OK" }), { title: "OK" });
  assert.equal(toApiEventUpdate({ taskId: "task-9" }), null);
});

test("diffScheduleBlocks phân biệt added/removed/changed", () => {
  const before = [block({ id: UUID_A }), block({ id: "gone-1", label: "Cũ" })];
  const after = [
    { ...block({ id: UUID_A }), label: "Đổi tên" },
    { ...block({ id: UUID_B, label: "Mới" }) },
  ];
  const diff = diffScheduleBlocks(before, after);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].id, UUID_B);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].id, "gone-1");
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].after.label, "Đổi tên");
});

test("blockFromApi: ScheduleEventOut -> block local, snake_case map đúng", () => {
  const out = blockFromApi({
    id: UUID_A,
    task_id: UUID_T,
    title: "Họp nhóm",
    description: "bỏ qua",
    event_date: "2026-10-08",
    start_time: "14:00",
    end_time: "15:00",
    event_type: "class",
    is_completed: false,
    is_circadian_optimized: true,
    started_at: "2026-10-08T07:00:00",
    ended_at: "2026-10-08T08:00:00",
    timezone: "Asia/Ho_Chi_Minh",
    updated_at: "2026-10-08T07:30:00",
    revision: 4,
  });
  assert.equal(out.taskId, UUID_T);
  assert.equal(out.label, "Họp nhóm");
  assert.equal(out.startAt, "2026-10-08T07:00:00.000Z");
  assert.equal(out.endAt, "2026-10-08T08:00:00.000Z");
  assert.equal(out.status, "planned");
  assert.equal(out.revision, 4);
});

test("blockFromApi: done theo server; skipped/active giữ local", () => {
  const done = blockFromApi({ id: UUID_A, title: "Hop nhom", started_at: "2026-10-08T07:00:00", ended_at: "2026-10-08T08:00:00", is_completed: true });
  assert.equal(done.status, "done");
  const skipped = blockFromApi(
    { id: UUID_A, title: "Hop nhom", started_at: "2026-10-08T07:00:00", ended_at: "2026-10-08T08:00:00", is_completed: false },
    { status: "skipped" }
  );
  assert.equal(skipped.status, "skipped");
  const active = blockFromApi(
    { id: UUID_A, title: "Hop nhom", started_at: "2026-10-08T07:00:00", ended_at: "2026-10-08T08:00:00", is_completed: false },
    { status: "active" }
  );
  assert.equal(active.status, "active");
});

test("blockFromApi: task_id null giữ được (standalone), thiếu giờ/title thì null", () => {
  const standalone = blockFromApi({
    id: UUID_A, task_id: null, title: "Tự do",
    started_at: "2026-10-08T07:00:00", ended_at: "2026-10-08T08:00:00",
    is_completed: false,
  });
  assert.equal(standalone.taskId, null);
  assert.equal(blockFromApi({ id: UUID_A, title: "Hop nhom", started_at: null, ended_at: "2026-10-08T08:00:00" }), null);
  assert.equal(blockFromApi(null), null);
});
