import { APP_VERSION } from "./release.js";

export const DIAGNOSTICS_KEY = "studioGeminiDiagnostics";
export const DIAGNOSTICS_SETTINGS_KEY = "studioGeminiDiagnosticsSettings";
export const MAX_DIAGNOSTIC_RECORDS = 20;
export const MAX_DIAGNOSTIC_PROMPT_LENGTH = 30000;
export const MAX_DIAGNOSTIC_ERROR_LENGTH = 4000;

export function normalizeDiagnosticSettings(value) {
  return {
    includeText: value?.includeText === true,
    revision: Number.isSafeInteger(value?.revision) && value.revision >= 0 ? value.revision : 0
  };
}

export function redactText(value, secrets = []) {
  let text = typeof value === "string" ? value : "";
  for (const secret of secrets) {
    if (typeof secret === "string" && secret) text = text.split(secret).join("[REDACTED API KEY]");
  }
  return text.replace(/(?:AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,})/g, "[REDACTED API KEY]");
}

export function diagnosticRequestText(prompt, customInstructions, secrets = [], providerErrorMessage, savedMemoryContext) {
  const safePrompt = redactText(prompt, secrets);
  const safeInstructions = redactText(customInstructions, secrets);
  const text = {
    prompt: safePrompt.slice(0, MAX_DIAGNOSTIC_PROMPT_LENGTH),
    customInstructions: safeInstructions.slice(0, 10000),
    promptTruncated: safePrompt.length > MAX_DIAGNOSTIC_PROMPT_LENGTH,
    customInstructionsTruncated: safeInstructions.length > 10000
  };
  if (typeof providerErrorMessage === "string" && providerErrorMessage) {
    const safeError = redactText(providerErrorMessage, secrets);
    text.providerErrorMessage = safeError.slice(0, MAX_DIAGNOSTIC_ERROR_LENGTH);
    text.providerErrorMessageTruncated = safeError.length > MAX_DIAGNOSTIC_ERROR_LENGTH;
  }
  if (typeof savedMemoryContext === "string" && savedMemoryContext) {
    const safeContext = redactText(savedMemoryContext, secrets);
    text.savedMemoryContext = safeContext.slice(0, 10000);
    text.savedMemoryContextTruncated = safeContext.length > 10000;
  }
  return text;
}

const summaries = {
  ok: "The response passed local validation.",
  missing_key: "No Gemini connection was available.",
  context_error: "Stuđiô could not prepare the request context.",
  timeout: "The request timed out.",
  network_error: "The API could not be reached.",
  schema_complexity: "The provider reported excessive schema complexity or constraints.",
  response_format: "The provider rejected the response format or schema.",
  model_error: "The provider rejected the model selection.",
  invalid_request: "The provider rejected the request parameters.",
  access_error: "The provider rejected API access.",
  quota_error: "The provider reported a usage limit.",
  provider_error: "The provider reported a service error.",
  http_error: "The API returned an unsuccessful HTTP status.",
  invalid_response: "The API response body was not valid JSON.",
  empty_output: "The API response contained no usable model text.",
  malformed_output: "The model text was not valid JSON.",
  empty_tasks: "The model returned an empty task list.",
  invalid_tasks: "The returned task group was invalid.",
  invalid_blocks: "The returned focus-block group was invalid.",
  invalid_duration: "A returned duration was invalid.",
  duration_mismatch: "Block durations did not match the task total.",
  invalid_date: "A returned date, time, or UTC offset was invalid.",
  invalid_draft: "The model response failed local draft validation.",
  internal_error: "The attempt failed before a more specific cause was identified."
};

const providerStatuses = ["INVALID_ARGUMENT", "FAILED_PRECONDITION", "OUT_OF_RANGE", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED", "CANCELLED", "UNKNOWN"];
const errorEnvelopes = ["nested", "flat", "array-nested", "array-flat", "error-list", "array-error-list", "unknown"];
const fieldNames = ["response_format", "schema", "model", "system_instruction", "input", "maxItems", "minItems", "additionalProperties", "required", "properties", "items", "enum", "minimum", "maximum", "tasks", "focus_blocks", "task_index", "duration_minutes", "due_at", "start_at"];
const numberFields = ["durationMs", "promptCharacters", "memoryCharacters", "inputCharacters", "schemaCharacters", "responseTextCharacters", "learnedMemoryCharacters", "selectedMemoryCount"];
const choose = (value, allowed, fallback = null) => allowed.includes(value) ? value : fallback;
const count = value => Number.isFinite(value) ? Math.max(0, Math.min(100_000_000, Math.round(value))) : 0;

// Reconstruct records from an allowlist, including on export. Request text
// and a specific provider error message require an explicit option. Complete
// provider bodies, headers, and model output never enter the record.
export function normalizeDiagnostic(value, { includeText = false, secrets = [] } = {}) {
  const source = value && typeof value === "object" ? value : {};
  const code = choose(source.code, Object.keys(summaries), "internal_error");
  const record = {
    timestamp: typeof source.timestamp === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(source.timestamp) ? source.timestamp : null,
    appVersion: typeof source.appVersion === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(source.appVersion) ? source.appVersion : APP_VERSION,
    action: choose(source.action, ["test", "capture", "explain", "reflect", "advice", "memory-update", "sort", "activity-classify"], "unknown"),
    mode: choose(source.mode, ["single-task", "multiple-blocks"]),
    model: typeof source.model === "string" && /^gemini-[a-z0-9._-]{1,80}$/.test(source.model) ? source.model : "custom-or-unknown",
    phase: choose(source.phase, ["setup", "context", "request", "response", "parse", "validation", "complete"], "setup"),
    code,
    summary: summaries[code],
    httpStatus: Number.isInteger(source.httpStatus) && source.httpStatus >= 100 && source.httpStatus <= 599 ? source.httpStatus : null,
    providerStatus: choose(source.providerStatus, providerStatuses),
    errorEnvelope: choose(source.errorEnvelope, errorEnvelopes),
    schemaVariant: choose(source.schemaVariant, ["multiple-flat-v2", "memory-changes-v1", "day-advice-v1", "guided-planning-v1"]),
    interactionStatus: choose(source.interactionStatus, ["completed", "failed", "incomplete", "in_progress", "requires_action", "cancelled"]),
    affectedFields: Array.isArray(source.affectedFields) ? [...new Set(source.affectedFields.filter(field => fieldNames.includes(field)))].slice(0, 10) : []
  };
  for (const name of numberFields) record[name] = count(source[name]);
  if (includeText && source.requestText && typeof source.requestText === "object") {
    record.requestText = diagnosticRequestText(source.requestText.prompt, source.requestText.customInstructions, secrets, source.requestText.providerErrorMessage, source.requestText.savedMemoryContext);
    record.requestText.promptTruncated ||= source.requestText.promptTruncated === true;
    record.requestText.customInstructionsTruncated ||= source.requestText.customInstructionsTruncated === true;
    if (record.requestText.providerErrorMessage) record.requestText.providerErrorMessageTruncated ||= source.requestText.providerErrorMessageTruncated === true;
    if (record.requestText.savedMemoryContext) record.requestText.savedMemoryContextTruncated ||= source.requestText.savedMemoryContextTruncated === true;
  }
  return record;
}

export function appendDiagnostic(records, record, options = {}) {
  return [...(Array.isArray(records) ? records : []).slice(-(MAX_DIAGNOSTIC_RECORDS - 1)), record].map(value => normalizeDiagnostic(value, options));
}

export function createDiagnosticReport(records, now = new Date(), options = {}) {
  const normalized = (Array.isArray(records) ? records : []).slice(-MAX_DIAGNOSTIC_RECORDS).map(value => normalizeDiagnostic(value, options));
  const containsRequestText = normalized.some(record => record.requestText);
  return {
    reportType: "studio-gemini-debug",
    reportVersion: 4,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    includeTextEnabled: options.includeText === true,
    containsRequestText,
    privacy: containsRequestText
      ? "Includes opted-in request prompts, custom instructions, selected saved memories, and any specific provider error message. Memory-update prompts can include activity evidence. These may contain personal or task details. API keys are redacted. Complete provider bodies, headers, and model output are excluded. This report is not uploaded automatically."
      : "Contains technical metadata and character counts only. No API keys, prompt or instruction text, task data, raw provider messages, or model output. Nothing is uploaded automatically.",
    records: normalized
  };
}

export function extractProviderError(body) {
  // Google's SDK accepts flat errors and single-element array wrappers as well
  // as the usual { error: ... } envelope. Interactions can use code, not status.
  const wrapped = Array.isArray(body) && body.length === 1;
  const root = wrapped ? body[0] : body;
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  if (!object(root)) return { message: "", providerStatus: null, details: [], errorEnvelope: "unknown" };
  const nested = object(root.error);
  const listed = !nested && Array.isArray(root.errors) && object(root.errors[0]);
  const error = nested ? root.error : listed ? root.errors[0] : root;
  const recognized = nested || listed || ["message", "status", "code"].some(key => Object.hasOwn(root, key));
  const envelope = nested ? "nested" : listed ? "error-list" : "flat";
  const rawStatus = root.status ?? error.status ?? error.code ?? root.code;
  const status = typeof rawStatus === "string" ? rawStatus.slice(0, 256).split(/[\/#]/).at(-1).replaceAll("-", "_").toUpperCase() : null;
  return {
    message: typeof root.message === "string" ? root.message : typeof error.message === "string" ? error.message : "",
    providerStatus: choose(status, providerStatuses),
    details: Array.isArray(error.details) ? error.details : Array.isArray(root.details) ? root.details : [],
    errorEnvelope: recognized ? `${wrapped ? "array-" : ""}${envelope}` : "unknown"
  };
}

export function httpFailureDetails(status, body) {
  const provider = extractProviderError(body);
  const message = provider.message.slice(0, 10_000).toLowerCase();
  let code = "http_error";
  if (status === 400) {
    code = /too many states|schema.{0,80}(?:complex|large|deep)|complexity|too many constraints/.test(message) ? "schema_complexity"
      : /response[_ ]?format|schema/.test(message) ? "response_format"
      : /model/.test(message) ? "model_error" : "invalid_request";
  } else if (status === 401 || status === 403) code = "access_error";
  else if (status === 404) code = "model_error";
  else if (status === 429) code = "quota_error";
  else if (status >= 500) code = "provider_error";
  const violations = provider.details.slice(0, 10).flatMap(detail => Array.isArray(detail?.fieldViolations) ? detail.fieldViolations.slice(0, 10) : []);
  const mentionedFields = [message, ...violations.map(item => typeof item?.field === "string" ? item.field.slice(0, 500) : "")].join(" ");
  return {
    code,
    providerStatus: provider.providerStatus,
    errorEnvelope: provider.errorEnvelope,
    affectedFields: fieldNames.filter(field => new RegExp(`\\b${field}\\b`, "i").test(mentionedFields)).slice(0, 10)
  };
}

export function validationFailureCode(error) {
  const message = String(error?.message ?? "");
  if (/no tasks to draft/i.test(message)) return "empty_tasks";
  if (/durations do not match/i.test(message)) return "duration_mismatch";
  if (/invalid group of tasks/i.test(message)) return "invalid_tasks";
  if (/invalid group of focus blocks|invalid focus block/i.test(message)) return "invalid_blocks";
  if (/duration|whole minutes|480 minutes/i.test(message)) return "invalid_duration";
  if (/date|time|deadline|UTC offset/i.test(message)) return "invalid_date";
  return "invalid_draft";
}
