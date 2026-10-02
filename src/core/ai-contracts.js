import { clamp, isPlainObject, safeDate } from "./utils.js";
import { captureSelection, MAX_CAPTURE_BLOCKS, MAX_CAPTURE_TASKS } from "./capture.js";
import { httpFailureDetails, validationFailureCode } from "./diagnostics.js";

export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
export { DEFAULT_MODEL, SUGGESTED_MODELS } from "./models.js";

// Gemini accepts only a documented subset of JSON Schema. Length limits are
// enforced again by the local validators instead of being sent to the API.
const stringField = description => ({ type: "string", description });
const stringArray = (description, maxItems = 6) => ({
  type: "array",
  description,
  maxItems,
  items: { type: "string" }
});

export const CONNECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: { type: "boolean", description: "Always true when the instruction is understood." },
    message: stringField("A short friendly confirmation, no more than eight words.")
  },
  required: ["ok", "message"]
};

export const CAPTURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: stringField("Concise actionable task title."),
    notes: stringField("Useful detail from the input, or an empty string."),
    duration_minutes: { type: "integer", minimum: 5, maximum: 480 },
    due_at: stringField("ISO 8601 date-time with offset, or an empty string when no deadline was stated."),
    energy: { type: "string", enum: ["low", "medium", "high"] },
    priority: { type: "string", enum: ["low", "normal", "high"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    assumptions: stringArray("Any assumptions that the user should review.", 5)
  },
  required: ["title", "notes", "duration_minutes", "due_at", "energy", "priority", "confidence", "assumptions"]
};

export const EXPLANATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: stringField("A short headline for the proposal."),
    summary: stringField("A concise plain-language explanation of how the proposed blocks fit."),
    reasons: stringArray("Specific reasons for the placement choices.", 6),
    tradeoffs: stringArray("Honest constraints or tradeoffs in the proposal.", 5),
    suggested_adjustments: stringArray("Optional adjustments the user could make; never claim they were applied.", 5)
  },
  required: ["headline", "summary", "reasons", "tradeoffs", "suggested_adjustments"]
};

// Parallel arrays avoid nested task/block arrays and repeated array-size
// constraints in Gemini's schema. Local validation still enforces every cap.
export const MULTI_CAPTURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rationale: stringField("Brief explanation of the chosen grouping and block lengths."),
    tasks: {
      type: "array",
      description: `One to ${MAX_CAPTURE_TASKS} new task drafts for the user's request.`,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          ...CAPTURE_SCHEMA.properties,
          assumptions: { type: "array", description: "Up to five assumptions for review.", items: { type: "string" } }
        },
        required: CAPTURE_SCHEMA.required
      }
    },
    focus_blocks: {
      type: "array",
      description: `One to ${MAX_CAPTURE_BLOCKS} blocks across all tasks. Each task needs at least one block.`,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          task_index: { type: "integer", minimum: 0, maximum: MAX_CAPTURE_TASKS - 1, description: "Zero-based index of the owning task in tasks." },
          label: stringField("Short, descriptive name for this focus block."),
          duration_minutes: { type: "integer", minimum: 5, maximum: 180 },
          start_at: stringField("ISO 8601 start time with UTC offset, or empty if no feasible slot; explain in task assumptions.")
        },
        required: ["task_index", "label", "duration_minutes", "start_at"]
      }
    }
  },
  required: ["rationale", "tasks", "focus_blocks"]
};

export const REFLECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: stringField("A calm, non-judgmental headline."),
    narrative: stringField("Two or three sentences describing the aggregate pattern without inventing causes."),
    wins: stringArray("Up to three evidence-based wins.", 3),
    gentle_experiment: stringField("One small experiment for the next week, phrased as optional.")
  },
  required: ["headline", "narrative", "wins", "gentle_experiment"]
};

export function buildConnectionRequest() {
  return {
    input: "Return JSON confirming that this private connection test succeeded. Set ok to true and keep message under eight words.",
    schema: CONNECTION_SCHEMA
  };
}

export function buildCaptureRequest(text, context = {}) {
  const now = context.nowIso ?? new Date().toISOString();
  const timezone = context.timezone ?? "local time";
  const defaultDuration = clamp(context.defaultDuration ?? 25, 5, 180);
  return {
    input: [
      "You convert one natural-language planning note into one editable task draft.",
      "Do not create the task, schedule it, contact anyone, or claim that an action occurred.",
      `Current time: ${now}. User timezone: ${timezone}. Default duration: ${defaultDuration} minutes.`,
      "Infer only what is reasonable. Put uncertainty in assumptions. If there is no explicit deadline, set due_at to an empty string.",
      `User note: ${String(text).slice(0, 2000)}`
    ].join("\n"),
    schema: CAPTURE_SCHEMA
  };
}

export function buildMultiCaptureRequest(text, context) {
  return {
    input: [
      "Turn the user's note into editable new tasks and proposed focus blocks, for one review screen.",
      "Multiple focus blocks are allowed, not required. Choose the number, grouping, and lengths from the meaning of the request and relevant preferences. Do not mechanically split into equal intervals.",
      "Handle several distinct tasks if the note names them. For a longer single task, keep related blocks grouped under that task. Do not invent unrelated work or modify existing tasks.",
      "If the note asks for suggestions, you may propose small next steps grounded in relevant projects or goals in the saved custom instructions. Identify them as suggestions and state assumptions. You cannot retrieve the user's existing plan from busy times. If there is no work or relevant project context to use, return empty tasks and focus_blocks arrays.",
      "Return separate top-level tasks and focus_blocks arrays. Every block must use task_index to identify its task by zero-based position in tasks. Each task must have at least one block; do not nest blocks inside tasks.",
      `Use at most ${MAX_CAPTURE_TASKS} tasks and ${MAX_CAPTURE_BLOCKS} total blocks. Each block is 5–180 whole minutes; each task totals at most 480 minutes. Preserve explicitly requested totals and make block durations sum to each task's duration_minutes.`,
      "Treat preferred_focus_minutes as a guideline. Suggest start times between earliest_start and latest_end, within local workday hours, before any stated deadline, and clear of busy_periods and other suggested blocks by at least buffer_minutes.",
      "A workday_end earlier than or equal to workday_start means an overnight workday. Use the supplied timezone and explicit UTC offsets.",
      "When the note supplies a requested start time, honor it if feasible. If timing is unspecified, choose a feasible time and disclose the assumption. If no feasible time exists, leave start_at empty and explain it; the user can edit or deselect that block.",
      "Never infer an unstated deadline: use an empty due_at. Explain other uncertainties in assumptions. Do not claim that tasks or blocks were saved, scheduled, or started. Only the user's later confirmation can save them.",
      `Planning context (busy times only, no existing task text): ${JSON.stringify(context)}`,
      `User note: ${String(text).slice(0, 2000)}`
    ].join("\n"),
    schema: MULTI_CAPTURE_SCHEMA,
    schemaVariant: "multiple-flat-v2"
  };
}

export function buildExplanationRequest(proposal, tasks, timezone = "local time") {
  const taskMap = new Map(tasks.map(task => [task.id, task]));
  const payload = proposal.blocks.map(block => {
    const task = taskMap.get(block.taskId);
    return {
      title: task?.title ?? "Untitled task",
      duration_minutes: Math.round((new Date(block.endAt) - new Date(block.startAt)) / 60_000),
      priority: task?.priority ?? "normal",
      energy: task?.energy ?? "medium",
      deadline: task?.dueAt ?? null,
      proposed_start: block.startAt,
      proposed_end: block.endAt
    };
  });
  return {
    input: [
      "Explain a schedule proposal that was generated by deterministic local rules.",
      "You may explain and suggest adjustments, but do not say that you created, changed, or applied the schedule.",
      "Be transparent when the provided data cannot justify a claim.",
      `Timezone: ${timezone}.`,
      `Proposal: ${JSON.stringify(payload)}`
    ].join("\n"),
    schema: EXPLANATION_SCHEMA
  };
}

export function buildReflectionRequest(aggregateMetrics) {
  return {
    input: [
      "Narrate a seven-day productivity pattern from aggregate metrics only.",
      "Do not infer mental health, personality, motivation, or causes. Do not shame the user. Do not invent task content.",
      "State uncertainty when there is little data and offer only one small optional experiment.",
      `Aggregate metrics: ${JSON.stringify(aggregateMetrics)}`
    ].join("\n"),
    schema: REFLECTION_SCHEMA
  };
}

function boundedString(value, name, maxLength, allowEmpty = false) {
  if (typeof value !== "string") throw new Error(`${name} must be text.`);
  const text = value.trim().slice(0, maxLength);
  if (!allowEmpty && !text) throw new Error(`${name} cannot be empty.`);
  return text;
}

function validateStringArray(value, name, maxItems, maxLength = 300) {
  if (!Array.isArray(value)) throw new Error(`${name} must be a list.`);
  return value.slice(0, maxItems).map((item, index) => boundedString(item, `${name}[${index}]`, maxLength));
}

export function validateConnection(value) {
  if (!isPlainObject(value) || value.ok !== true) throw new Error("Gemini did not confirm the test.");
  return { ok: true, message: boundedString(value.message, "message", 80) };
}

export function validateCaptureDraft(value) {
  if (!isPlainObject(value)) throw new Error("Gemini returned an invalid task draft.");
  const dueText = typeof value.due_at === "string" ? value.due_at.trim() : "";
  const dueDate = dueText ? safeDate(dueText) : null;
  return {
    title: boundedString(value.title, "title", 160),
    notes: boundedString(value.notes ?? "", "notes", 1000, true),
    durationMinutes: clamp(value.duration_minutes, 5, 480),
    dueAt: dueDate ? dueDate.toISOString() : null,
    energy: ["low", "medium", "high"].includes(value.energy) ? value.energy : "medium",
    priority: ["low", "normal", "high"].includes(value.priority) ? value.priority : "normal",
    confidence: clamp(value.confidence, 0, 1),
    assumptions: validateStringArray(value.assumptions ?? [], "assumptions", 5),
    source: "gemini"
  };
}

function strictCaptureDate(value, label) {
  if (value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !safeDate(value)) {
    throw new Error(`${label} must include a valid date, time, and UTC offset.`);
  }
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || Number(value.slice(11, 13)) > 23) {
    throw new Error(`${label} has an invalid calendar date or time.`);
  }
  return new Date(value).toISOString();
}

export function validateMultiCaptureDraft(value) {
  if (isPlainObject(value) && Array.isArray(value.tasks) && !value.tasks.length) throw new Error("Gemini found no tasks to draft. Name the work you want to add; capture cannot retrieve your existing plan.");
  if (!isPlainObject(value) || !Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length > MAX_CAPTURE_TASKS) throw new Error("Gemini returned an invalid group of tasks.");
  // Keep the API schema shallow; enforce array bounds and task/block relations
  // here. Older nested drafts still normalize to the same local review shape.
  let groupedTasks = value.tasks;
  if (Object.hasOwn(value, "focus_blocks")) {
    if (!Array.isArray(value.focus_blocks) || !value.focus_blocks.length || value.focus_blocks.length > MAX_CAPTURE_BLOCKS) throw new Error("Gemini returned an invalid group of focus blocks.");
    groupedTasks = value.tasks.map(task => {
      if (!isPlainObject(task)) throw new Error("Gemini returned an invalid group of tasks.");
      if (Object.hasOwn(task, "focus_blocks")) throw new Error("Gemini returned an invalid group of focus blocks with mixed formats.");
      return { ...task, focus_blocks: [] };
    });
    for (const block of value.focus_blocks) {
      if (!isPlainObject(block) || !Number.isInteger(block.task_index) || block.task_index < 0 || block.task_index >= groupedTasks.length) throw new Error("Gemini returned an invalid focus block task reference.");
      groupedTasks[block.task_index].focus_blocks.push(block);
    }
  }
  const tasks = groupedTasks.map(task => {
    if (!isPlainObject(task) || !Array.isArray(task.focus_blocks) || !task.focus_blocks.length || task.focus_blocks.length > MAX_CAPTURE_BLOCKS) throw new Error("Gemini returned an invalid group of focus blocks.");
    if (!Number.isInteger(task.duration_minutes) || task.duration_minutes < 5 || task.duration_minutes > 480) throw new Error("Gemini returned an invalid task duration.");
    const normalized = validateCaptureDraft(task);
    normalized.dueAt = strictCaptureDate(task.due_at, "Task deadline");
    normalized.focusBlocks = task.focus_blocks.map(block => {
      if (!isPlainObject(block)) throw new Error("Gemini returned an invalid focus block.");
      return {
        label: block.label,
        durationMinutes: block.duration_minutes,
        startAt: strictCaptureDate(block.start_at, "Block start"),
        selected: true
      };
    });
    if (normalized.focusBlocks.reduce((sum, block) => sum + block.durationMinutes, 0) !== normalized.durationMinutes) throw new Error("Gemini's block durations do not match the task total. Try interpreting again.");
    return normalized;
  });
  const draft = { kind: "capture-blocks", rationale: boundedString(value.rationale, "rationale", 500, true), tasks };
  captureSelection(draft);
  return draft;
}

export function validateExplanation(value) {
  if (!isPlainObject(value)) throw new Error("Gemini returned an invalid explanation.");
  return {
    headline: boundedString(value.headline, "headline", 100),
    summary: boundedString(value.summary, "summary", 700),
    reasons: validateStringArray(value.reasons, "reasons", 6),
    tradeoffs: validateStringArray(value.tradeoffs, "tradeoffs", 5),
    suggestedAdjustments: validateStringArray(value.suggested_adjustments, "suggested_adjustments", 5)
  };
}

export function validateReflection(value) {
  if (!isPlainObject(value)) throw new Error("Gemini returned an invalid reflection.");
  return {
    headline: boundedString(value.headline, "headline", 100),
    narrative: boundedString(value.narrative, "narrative", 700),
    wins: validateStringArray(value.wins, "wins", 3),
    gentleExperiment: boundedString(value.gentle_experiment, "gentle_experiment", 240)
  };
}

export function extractInteractionText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  const textBlocks = [];
  for (const step of response?.steps ?? []) {
    if (step?.type !== "model_output") continue;
    for (const block of step.content ?? []) {
      if (block?.type === "text" && typeof block.text === "string") textBlocks.push(block.text);
    }
  }
  if (!textBlocks.length) throw new Error("Gemini returned no text output.");
  return textBlocks.join("\n");
}

export function parseStructuredResponse(response, validator, diagnostic = null) {
  if (diagnostic) diagnostic.phase = "response";
  let text;
  try {
    text = extractInteractionText(response);
    if (!text.trim()) throw new Error("Gemini returned no text output.");
  } catch (error) {
    if (diagnostic) diagnostic.code = "empty_output";
    throw error;
  }
  if (diagnostic) { diagnostic.responseTextCharacters = text.length; diagnostic.phase = "parse"; }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (diagnostic) diagnostic.code = "malformed_output";
    throw new Error("Gemini returned malformed structured output.");
  }
  if (diagnostic) diagnostic.phase = "validation";
  try { return validator(parsed); }
  catch (error) {
    if (diagnostic) diagnostic.code = validationFailureCode(error);
    throw error;
  }
}

export function publicGeminiError(status, body) {
  const details = httpFailureDetails(status, body);
  if (status === 400 && ["schema_complexity", "response_format"].includes(details.code)) {
    return "Gemini rejected the response format. Export a debug report from Settings → Gemini diagnostics.";
  }
  if (status === 400 && details.code === "model_error") {
    return "That Gemini model cannot be used with this API endpoint. Try a suggested Flash-Lite model.";
  }
  if (status === 400) return "Gemini rejected the request (HTTP 400). Export a debug report from Settings → Gemini diagnostics.";
  if (status === 401 || status === 403) return "The API key was rejected or lacks Gemini access.";
  if (status === 404) return "That Gemini model is unavailable for this API key.";
  if (status === 429) return "Gemini's current usage limit was reached. Try again later or choose another model.";
  if (status >= 500) return "Gemini is temporarily unavailable. Try again shortly.";
  return details.providerStatus ? `Gemini request failed (${details.providerStatus}).` : "Gemini request failed.";
}
