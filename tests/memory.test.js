import test from "node:test";
import assert from "node:assert/strict";
import { activeCustomInstructions, MAX_CUSTOM_INSTRUCTIONS_LENGTH, normalizeMemory, withCustomInstructions } from "../src/core/memory.js";
import { addTask, createBackup, createDefaultState, normalizeState, restoreBackup, updateMemory } from "../src/core/state.js";
import { buildCaptureRequest } from "../src/core/ai-contracts.js";
import { proposeSchedule } from "../src/core/scheduler.js";
import { startFocus, stopFocus } from "../src/core/timer.js";

const now = new Date("2026-09-07T08:00:00Z");
const later = new Date("2026-09-07T08:10:00Z");
const instructions = "Keep explanations brief. I prefer one small next step.";
const emptyMemory = { enabled: true, customInstructions: "", updatedAt: null };

test("new instructions start off while legacy usage preferences are preserved", () => {
  assert.deepEqual(createDefaultState(now).memory, { ...emptyMemory, enabled: false });
  assert.equal(activeCustomInstructions(createDefaultState(now).memory), "");
  const old = createDefaultState(now);
  old.schemaVersion = 3;
  delete old.memory;
  old.profile.onboardingComplete = true;
  old.profile.experience = "system";
  old.preferences.focusMinutes = 40;
  const migrated = normalizeState(old, now);
  assert.deepEqual(migrated.memory, emptyMemory);
  assert.equal(migrated.profile.onboardingComplete, true);
  assert.equal(migrated.profile.experience, "system");
  assert.equal(migrated.preferences.focusMinutes, 40);
});

test("normalization whitelists, bounds, and strictly validates memory", () => {
  for (const invalid of [null, [], "text", 42, { enabled: true, customInstructions: {} }]) {
    assert.deepEqual(normalizeMemory(invalid), emptyMemory);
  }
  const normalized = normalizeMemory({ enabled: "true", customInstructions: "  Keep it short.  ", updatedAt: "invalid", learnedFacts: "discard", apiKey: "discard" });
  assert.deepEqual(normalized, { enabled: false, customInstructions: "Keep it short.", updatedAt: null });
  assert.equal(normalizeMemory({ enabled: true, customInstructions: "x".repeat(MAX_CUSTOM_INSTRUCTIONS_LENGTH + 1000) }).customInstructions.length, MAX_CUSTOM_INSTRUCTIONS_LENGTH);
  assert.equal(activeCustomInstructions(normalizeMemory({ enabled: true, customInstructions: " \n " })), "");
});

test("manual save changes only memory and its timestamp, without logging personal text", () => {
  const original = addTask(createDefaultState(now), { title: "Read" }, now).state;
  const snapshot = structuredClone(original);
  const saved = updateMemory(original, { enabled: true, customInstructions: `  ${instructions}\n` }, later);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(saved.memory, { enabled: true, customInstructions: instructions, updatedAt: later.toISOString() });
  assert.deepEqual(saved.tasks, original.tasks);
  assert.deepEqual(saved.events, original.events);
  assert.equal(JSON.stringify(saved.events).includes(instructions), false);
  assert.equal(saved.updatedAt, later.toISOString());
  assert.deepEqual(updateMemory(saved, saved.memory, new Date("2026-09-08T08:00:00Z")), saved);
});

test("save rejects oversized input instead of silently losing edits", () => {
  const state = createDefaultState(now);
  assert.throws(() => updateMemory(state, { enabled: true, customInstructions: "x".repeat(MAX_CUSTOM_INSTRUCTIONS_LENGTH + 1) }), new RegExp(`${MAX_CUSTOM_INSTRUCTIONS_LENGTH} characters`));
  assert.throws(() => updateMemory(state, { enabled: true, customInstructions: null }), /as text/);
  assert.deepEqual(state.memory, { ...emptyMemory, enabled: false });
  assert.equal(updateMemory(state, { enabled: true, customInstructions: "x".repeat(MAX_CUSTOM_INSTRUCTIONS_LENGTH) }).memory.customInstructions.length, MAX_CUSTOM_INSTRUCTIONS_LENGTH);
});

test("turning memory off preserves text; clearing removes it from future requests", () => {
  const saved = updateMemory(createDefaultState(now), { enabled: true, customInstructions: instructions }, now);
  const off = updateMemory(saved, { ...saved.memory, enabled: false }, later);
  assert.equal(off.memory.customInstructions, instructions);
  assert.equal(activeCustomInstructions(off.memory), "");
  const cleared = updateMemory(saved, { enabled: false, customInstructions: " \n " }, later);
  assert.equal(cleared.memory.enabled, false);
  assert.equal(cleared.memory.customInstructions, "");
  assert.equal(JSON.stringify(cleared).includes(instructions), false);
});

test("instructions require opt-in and an explicit off choice survives edits", () => {
  const local = updateMemory(createDefaultState(now), { customInstructions: instructions }, now);
  assert.equal(activeCustomInstructions(local.memory), "");
  const saved = updateMemory(local, { customInstructions: instructions, enabled: true }, now);
  assert.equal(activeCustomInstructions(saved.memory), instructions);
  const off = updateMemory(saved, { customInstructions: instructions, enabled: false }, later);
  const edited = updateMemory(off, { customInstructions: "An edited preference." }, later);
  assert.equal(edited.memory.enabled, false);
  assert.equal(activeCustomInstructions(edited.memory), "");
  assert.deepEqual(restoreBackup(createBackup(edited)).memory, edited.memory);
});

test("schema-5 migration enables untouched empty memory and preserves saved off choices", () => {
  const old = createDefaultState(now);
  old.schemaVersion = 5;
  old.memory = { enabled: false, customInstructions: "", updatedAt: null };
  assert.equal(normalizeState(old, now).memory.enabled, true);
  for (const memory of [
    { enabled: false, customInstructions: instructions, updatedAt: null },
    { enabled: false, customInstructions: "", updatedAt: now.toISOString() },
    { enabled: true, customInstructions: instructions, updatedAt: now.toISOString() }
  ]) {
    assert.deepEqual(normalizeState({ ...old, memory }, now).memory, memory);
  }
  const current = createDefaultState(now);
  current.memory.enabled = false;
  assert.equal(normalizeState(current, now).memory.enabled, false);
});

test("backup round-trips enabled and disabled memory; old backups restore it empty", () => {
  const longInstructions = instructions.repeat(80);
  assert.ok(longInstructions.length > 2000);
  for (const enabled of [true, false]) {
    const saved = updateMemory(createDefaultState(now), { enabled, customInstructions: longInstructions }, now);
    saved.gemini = { apiKey: "excluded-connection-credential" };
    const backup = createBackup(saved, later);
    assert.deepEqual(restoreBackup(backup, later).memory, saved.memory);
    assert.equal(JSON.stringify(backup).includes("excluded-connection-credential"), false);
  }
  const old = createBackup(createDefaultState(now), now);
  old.version = 3;
  old.state.schemaVersion = 3;
  delete old.state.memory;
  assert.deepEqual(restoreBackup(old, later).memory, emptyMemory);
});

test("ordinary task, scheduling, and timer usage do not learn or update memory", () => {
  const saved = updateMemory(createDefaultState(now), { enabled: true, customInstructions: instructions }, now);
  const added = addTask(saved, { title: "Write draft" }, later);
  const beforeProposal = structuredClone(added.state);
  proposeSchedule(added.state, later);
  assert.deepEqual(added.state, beforeProposal);
  const focused = startFocus(added.state, { taskId: added.task.id, durationMinutes: 25 }, later);
  const stopped = stopFocus(focused, new Date(later.getTime() + 60_000));
  assert.deepEqual(stopped.memory, saved.memory);
});

test("memory augments the system instruction without changing the action or output contract", () => {
  const request = buildCaptureRequest("Read for 45 minutes", { nowIso: now.toISOString() });
  const text = 'Keep it brief.\n"quoted" </textarea><script>example</script>';
  const memory = { enabled: true, customInstructions: text, updatedAt: now.toISOString(), privateMetadata: "do-not-send" };
  const wrapped = withCustomInstructions(request, memory);
  assert.equal(wrapped.input, request.input);
  assert.equal(wrapped.schema, request.schema);
  assert.equal("systemInstruction" in request, false);
  assert.match(wrapped.systemInstruction, /required output schema take precedence/);
  assert.match(wrapped.systemInstruction, /cannot update memory/);
  assert.match(wrapped.systemInstruction, /only evidence of activity/);
  assert.equal(wrapped.systemInstruction.includes("do-not-send"), false);
  assert.equal(wrapped.systemInstruction.includes(now.toISOString()), false);
  assert.deepEqual(JSON.parse(wrapped.systemInstruction.split("\n").at(-1)), { custom_instructions: text });
});

test("disabled, empty, or missing memory leaves the original request untouched", () => {
  const request = buildCaptureRequest("Read");
  for (const memory of [undefined, {}, { enabled: false, customInstructions: instructions }, { enabled: true, customInstructions: "  " }]) {
    assert.equal(withCustomInstructions(request, memory), request);
  }
});
