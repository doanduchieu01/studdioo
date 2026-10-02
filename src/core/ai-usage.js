import { localDateKey, safeDate } from "./utils.js";

export const COUNTED_AI_ACTIONS = new Set(["capture", "explain", "reflect", "advice"]);

export function normalizeAiUsage(value, now = new Date()) {
  const counts = new Map();
  for (const item of Array.isArray(value?.days) ? value.days : []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item?.date) || !Number.isInteger(item.count) || item.count < 0) continue;
    counts.set(item.date, Math.min(10000, item.count));
  }
  return {
    startedAt: safeDate(value?.startedAt)?.toISOString() ?? now.toISOString(),
    promptSeenAt: safeDate(value?.promptSeenAt)?.toISOString() ?? null,
    days: [...counts].sort(([a], [b]) => a.localeCompare(b)).slice(-35).map(([date, count]) => ({ date, count }))
  };
}

export function recordAiUsage(value, action, now = new Date()) {
  const usage = normalizeAiUsage(value, now);
  if (!COUNTED_AI_ACTIONS.has(action)) return usage;
  const date = localDateKey(now);
  const day = usage.days.find(item => item.date === date);
  if (day) day.count += 1;
  else usage.days.push({ date, count: 1 });
  return normalizeAiUsage(usage, now);
}

export function planningPromptEligible(state, now = new Date()) {
  const usage = normalizeAiUsage(state.aiUsage, now);
  if (state.preferences.planningEnabled || usage.promptSeenAt || now - new Date(usage.startedAt) < 7 * 86400000) return false;
  // Seven completed local calendar days, including days with zero requests.
  const dates = new Set();
  for (let i = 1; i <= 7; i++) {
    const date = new Date(now); date.setDate(date.getDate() - i);
    dates.add(localDateKey(date));
  }
  return usage.days.filter(day => dates.has(day.date)).reduce((sum, day) => sum + day.count, 0) / 7 >= 3;
}
