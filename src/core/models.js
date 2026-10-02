// Verified against Google pricing and the Interactions supported-model list.
// A free tier is offered for standard text requests; account quotas still apply.
export const MODEL_CATALOG_CHECKED_AT = "2026-09-10";
export const MODEL_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing";
export const DEFAULT_MODEL = "gemini-3.1-flash-lite";
export const FREE_TIER_MODELS = [
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", detail: "Current default" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", detail: "Newer Flash-Lite option" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", detail: "Latest listed Flash option" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", detail: "Flash alternative" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", detail: "Earlier Flash option" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", detail: "2.5 Flash option" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", detail: "2.5 Flash-Lite option" }
];
export const SUGGESTED_MODELS = FREE_TIER_MODELS.map(model => model.id);
