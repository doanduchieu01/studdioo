// Local-only website totals. Never pass this store to AI, memory, or app backups.
export const TRACKING_KEY = "studioBrowserTracking";
export const TRACKING_ALARM = "studio-browser-tracking";
export const TRACKING_PERMISSIONS = { permissions: ["tabs", "idle"] };
export const MAX_TRACKING_GAP_MS = 90_000;
export const IDLE_SECONDS = 60;

export function trackingDay(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function websiteHost(url, incognito = false) {
  if (incognito || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.hostname.length <= 253 ? parsed.hostname : null;
  } catch { return null; }
}

const validHost = host => typeof host === "string" && websiteHost(`https://${host}`) === host;
const boundedMs = ms => Number.isFinite(ms) ? Math.max(0, Math.min(90_000_000, Math.floor(ms))) : 0;

export function normalizeTracking(raw, now = Date.now()) {
  const cutoff = new Date(now); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - 6);
  const today = trackingDay(now), oldest = trackingDay(cutoff);
  const days = (Array.isArray(raw?.days) ? raw.days : []).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day?.date) && day.date >= oldest && day.date <= today).slice(-7).map(day => ({
    date: day.date,
    sites: (Array.isArray(day.sites) ? day.sites : []).filter(site => validHost(site?.host)).slice(0, 100).map(site => ({ host: site.host, ms: boundedMs(site.ms) })),
    otherMs: boundedMs(day.otherMs)
  }));
  const c = raw?.cursor;
  const cursor = raw?.enabled === true && validHost(c?.host) && Number.isFinite(c?.at) && typeof c?.session === "string"
    ? { host: c.host, at: c.at, session: c.session.slice(0, 100) } : null;
  return { version: 1, enabled: raw?.enabled === true, days, cursor };
}

export function advanceTracking(raw, host, now, session) {
  const state = normalizeTracking(raw, now), previous = state.cursor;
  const elapsed = previous ? now - previous.at : 0;
  // Do not fill browser downtime, long sleep/worker gaps, or clock reversals.
  if (state.enabled && previous?.session === session && elapsed > 0 && elapsed <= MAX_TRACKING_GAP_MS) {
    let start = previous.at;
    while (start < now) {
      const d = new Date(start), date = trackingDay(start);
      const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const end = Math.min(now, midnight), ms = end - start;
      let day = state.days.find(item => item.date === date);
      if (!day) { day = { date, sites: [], otherMs: 0 }; state.days.push(day); }
      const site = day.sites.find(item => item.host === previous.host);
      if (site) site.ms = boundedMs(site.ms + ms);
      else if (day.sites.length < 100) day.sites.push({ host: previous.host, ms });
      else day.otherMs = boundedMs(day.otherMs + ms);
      start = end;
    }
  }
  state.cursor = state.enabled && validHost(host) ? { host, at: now, session } : null;
  return normalizeTracking(state, now);
}

export function trackingSummary(raw, now = Date.now(), available = false) {
  const state = normalizeTracking(raw, now);
  const day = state.days.find(item => item.date === trackingDay(now));
  const sites = [...(day?.sites ?? [])].sort((a, b) => b.ms - a.ms);
  return { available, enabled: state.enabled, activeHost: state.cursor?.host ?? null, date: trackingDay(now),
    totalMs: sites.reduce((sum, site) => sum + site.ms, day?.otherMs ?? 0), sites: sites.slice(0, 5), checkedAt: now };
}
