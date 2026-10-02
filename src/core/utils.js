import { t, getLocale } from "../i18n.js";
export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function safeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toIso(value, fallback = null) {
  const date = safeDate(value);
  return date ? date.toISOString() : fallback;
}

export function localDateKey(value) {
  const date = safeDate(value) ?? new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localDateTimeInput(value) {
  const date = safeDate(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function parseClock(clock, fallbackHour = 8, fallbackMinute = 0) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(clock ?? ""));
  if (!match) return { hour: fallbackHour, minute: fallbackMinute };
  return {
    hour: clamp(Number(match[1]), 0, 23),
    minute: clamp(Number(match[2]), 0, 59)
  };
}

export function atLocalClock(day, clock) {
  const date = safeDate(day) ?? new Date();
  const { hour, minute } = parseClock(clock);
  date.setHours(hour, minute, 0, 0);
  return date;
}

export function roundUpTime(value, incrementMinutes = 5) {
  const date = safeDate(value) ?? new Date();
  const step = Math.max(1, incrementMinutes) * 60_000;
  return new Date(Math.ceil(date.getTime() / step) * step);
}

export function uid(prefix = "id", now = Date.now()) {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${now}-${random}`;
}

export function minutesLabel(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const m = getLocale() === "vi-VN" ? " phút" : "m";
  const h = getLocale() === "vi-VN" ? " giờ" : "h";
  if (safe < 60) return `${safe}${m}`;
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  return remainder ? `${hours}${h} ${remainder}${m}` : `${hours}${h}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function titleCase(value) {
  return t(String(value ?? "")
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\b\w/g, letter => letter.toUpperCase()));
}

export function formatTime(value, locale) {
  const date = safeDate(value);
  return date ? new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date) : "—";
}

export function formatDay(value, locale, options = {}) {
  const date = safeDate(value);
  return date
    ? new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", ...options }).format(date)
    : t("No date");
}
