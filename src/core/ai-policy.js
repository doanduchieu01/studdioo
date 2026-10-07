import { localDateKey } from "./utils.js";

export const AI_POLICY_KEY = "studioAIPolicy";
export const AUTOMATIC_AI_FEATURES = ["sorting", "activity", "memory"];
export const DEFAULT_AUTOMATIC_LIMIT = 3;

export function normalizeAIPolicy(value, now = new Date()) {
  const day = localDateKey(now), sameDay = value?.day === day;
  const count = n => Math.min(100000, Math.max(0, Math.floor(Number(n) || 0)));
  return {
    version: 1,
    automaticEnabled: value?.automaticEnabled === true,
    dailyLimit: Number.isInteger(value?.dailyLimit) ? Math.min(100, Math.max(0, value.dailyLimit)) : DEFAULT_AUTOMATIC_LIMIT,
    day, used: sameDay ? count(value?.used) : 0,
    byFeature: Object.fromEntries(AUTOMATIC_AI_FEATURES.map(key => [key, sameDay ? count(value?.byFeature?.[key]) : 0])),
    epoch: count(value?.epoch)
  };
}

export function automaticAIStatus(policy) {
  return !policy.automaticEnabled ? "manual" : policy.used >= policy.dailyLimit ? "budget" : "ready";
}

export function automaticAIPaused(policy, now = new Date()) {
  const next = new Date(now); next.setHours(24, 0, 0, 0);
  const error = new Error(!policy.automaticEnabled
    ? "Automatic AI is off. Requests you make yourself remain available."
    : "Automatic AI is paused: today's shared request limit is reached. Local tools still work.");
  error.code = "automatic_ai_paused";
  error.retryAt = policy.automaticEnabled ? next.toISOString() : null;
  return error;
}

// A separate queue avoids holding task/memory writers during network work.
export function createAIPolicyController(storage, { now = () => new Date(), migrate = async () => false } = {}) {
  let writes = Promise.resolve();
  const queue = operation => {
    const result = writes.then(operation); writes = result.catch(() => {}); return result;
  };
  async function read() {
    const raw = (await storage.get(AI_POLICY_KEY))[AI_POLICY_KEY];
    const next = normalizeAIPolicy(raw ?? { automaticEnabled: await migrate() }, now());
    if (JSON.stringify(raw) !== JSON.stringify(next)) await storage.set({ [AI_POLICY_KEY]: next });
    return next;
  }
  return {
    get: () => queue(read),
    settings: patch => queue(async () => {
      const next = await read();
      if (Object.hasOwn(patch, "dailyLimit")) {
        if (!Number.isInteger(patch.dailyLimit) || patch.dailyLimit < 0 || patch.dailyLimit > 100) throw new Error("Choose an automatic AI limit from 0 to 100 requests per day.");
        next.dailyLimit = patch.dailyLimit;
      }
      if (Object.hasOwn(patch, "automaticEnabled")) {
        if (typeof patch.automaticEnabled !== "boolean") throw new Error("Choose whether automatic AI is enabled.");
        if (next.automaticEnabled !== patch.automaticEnabled) next.epoch++;
        next.automaticEnabled = patch.automaticEnabled;
      }
      await storage.set({ [AI_POLICY_KEY]: next }); return next;
    }),
    reserve: feature => queue(async () => {
      if (!AUTOMATIC_AI_FEATURES.includes(feature)) throw new Error("Unknown automatic AI feature.");
      const next = await read();
      if (automaticAIStatus(next) !== "ready") throw automaticAIPaused(next, now());
      next.used++; next.byFeature[feature]++;
      await storage.set({ [AI_POLICY_KEY]: next }); return next;
    })
  };
}
