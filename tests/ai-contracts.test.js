import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCaptureRequest,
  buildExplanationRequest,
  buildReflectionRequest,
  CAPTURE_SCHEMA,
  CONNECTION_SCHEMA,
  DEFAULT_MODEL,
  EXPLANATION_SCHEMA,
  extractInteractionText,
  parseStructuredResponse,
  publicGeminiError,
  REFLECTION_SCHEMA,
  SUGGESTED_MODELS,
  validateCaptureDraft,
  validateConnection,
  validateExplanation,
  validateReflection
} from "../src/core/ai-contracts.js";

test("the default model is a suggested Interactions-compatible Flash-Lite model", () => {
  assert.equal(DEFAULT_MODEL, "gemini-3.1-flash-lite");
  assert.ok(SUGGESTED_MODELS.includes(DEFAULT_MODEL));
});

test("provider schemas use only documented string constraints", () => {
  const serialized = JSON.stringify([CONNECTION_SCHEMA, CAPTURE_SCHEMA, EXPLANATION_SCHEMA, REFLECTION_SCHEMA]);
  assert.equal(serialized.includes("maxLength"), false);
  assert.equal(serialized.includes("minLength"), false);
});

test("capture requests declare review-only behavior", () => {
  const request = buildCaptureRequest("Study English for two hours tomorrow", { nowIso: "2026-09-03T08:00:00Z", timezone: "Asia/Ho_Chi_Minh", defaultDuration: 25 });
  assert.match(request.input, /Do not create the task/i);
  assert.equal(request.schema, CAPTURE_SCHEMA);
});

test("capture validation maps schema names to local task names", () => {
  const draft = validateCaptureDraft({ title: "Study English", notes: "", duration_minutes: 120, due_at: "", energy: "high", priority: "normal", confidence: 0.8, assumptions: ["No exact start time was given."] });
  assert.equal(draft.durationMinutes, 120);
  assert.equal(draft.dueAt, null);
  assert.equal(draft.source, "gemini");
});

test("capture validation rejects an empty title", () => {
  assert.throws(() => validateCaptureDraft({ title: "", notes: "", duration_minutes: 25, due_at: "", energy: "medium", priority: "normal", confidence: 1, assumptions: [] }), /title cannot be empty/i);
});

test("explanation request states that Gemini cannot apply the schedule", () => {
  const proposal = { blocks: [{ taskId: "t", startAt: "2026-09-03T09:00:00Z", endAt: "2026-09-03T09:25:00Z" }] };
  const request = buildExplanationRequest(proposal, [{ id: "t", title: "Write", priority: "high", energy: "high", dueAt: null }]);
  assert.match(request.input, /do not say that you created, changed, or applied/i);
  assert.match(request.input, /Write/);
});

test("reflection request accepts aggregate metrics without task content", () => {
  const request = buildReflectionRequest({ total_focus_minutes: 50, completed_sessions: 2 });
  assert.match(request.input, /aggregate metrics only/i);
  assert.equal(request.input.includes("task title"), false);
});

test("validators normalize explanation and reflection field names", () => {
  const explanation = validateExplanation({ headline: "A fit", summary: "Two blocks fit before the deadline.", reasons: ["Earlier deadline first."], tradeoffs: [], suggested_adjustments: ["Move one block later if needed."] });
  const reflection = validateReflection({ headline: "A steady start", narrative: "There is a small amount of data.", wins: ["Two sessions completed."], gentle_experiment: "Try one similar block tomorrow." });
  assert.deepEqual(explanation.suggestedAdjustments, ["Move one block later if needed."]);
  assert.equal(reflection.gentleExperiment, "Try one similar block tomorrow.");
});

test("interaction text is extracted from model output steps", () => {
  const response = { steps: [{ type: "model_output", content: [{ type: "text", text: '{"ok":true,"message":"Connected"}' }] }] };
  assert.equal(extractInteractionText(response), '{"ok":true,"message":"Connected"}');
  assert.deepEqual(parseStructuredResponse(response, validateConnection), { ok: true, message: "Connected" });
});

test("malformed structured output is rejected locally", () => {
  const response = { steps: [{ type: "model_output", content: [{ type: "text", text: "not json" }] }] };
  assert.throws(() => parseStructuredResponse(response, validateConnection), /malformed structured output/i);
});

test("public errors are useful without replaying provider bodies", () => {
  const secretBody = { error: { message: "request included SECRET", status: "PERMISSION_DENIED" } };
  const message = publicGeminiError(403, secretBody);
  assert.match(message, /key was rejected/i);
  assert.equal(message.includes("SECRET"), false);
});

test("public errors distinguish response-format and model failures", () => {
  assert.match(publicGeminiError(400, { error: { message: "Invalid response_format schema" } }), /response format/i);
  assert.match(publicGeminiError(400, { error: { message: "Model is not supported" } }), /model cannot be used/i);
  assert.match(publicGeminiError(400, [{ message: "Invalid response_format schema" }]), /response format/i);
  assert.match(publicGeminiError(400, { message: "Model is not supported" }), /model cannot be used/i);
  assert.match(publicGeminiError(400, {}), /Export a debug report/);
  assert.doesNotMatch(publicGeminiError(418, { error: { status: "SECRET-CREDENTIAL" } }), /SECRET/);
});
