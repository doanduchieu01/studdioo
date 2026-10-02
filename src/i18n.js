import { vi } from "./locales/vi.js";
import { en } from "./locales/en.js";
let language = "en";
export const setLanguage = value => { language = value === "vi" ? "vi" : "en"; };
export const getLocale = () => language === "vi" ? "vi-VN" : "en-US";
export function t(value) {
  const text = String(value ?? "");
  const key = text.trim().replace(/\s+/g, " ").replaceAll("&amp;", "&");
  const translated = (language === "vi" ? vi[key] : en[key]) ?? (language === "vi" ? vi[en[key]] : undefined);
  return translated === undefined ? text : text.replace(text.trim(), translated);
}
// Translate app-owned text before interpolation. User/AI text and input values
// remain untouched, even when they happen to match an interface label.
const marker = /\u0001(\d+)\u0002/g;
const fragments = text => text.split(/(\u0001\d+\u0002)/).map(part => /^\u0001/.test(part) ? part : t(part)).join("");
function interpolate(strings, values, markup) {
  const skeleton = strings.map((part, i) => part + (i < values.length ? `\u0001${i}\u0002` : "")).join("");
  const translated = markup ? skeleton.replace(/<[^>]*>|[^<]+/g, token => token.startsWith("<")
    ? token.replace(/\b(aria-label|aria-valuetext|title|placeholder)="([^"]*)"/g, (_, name, text) => `${name}="${fragments(text)}"`)
    : fragments(token)) : fragments(skeleton);
  return translated.replace(marker, (_, i) => String(values[Number(i)] ?? ""));
}
export const html = (strings, ...values) => interpolate(strings, values, true);
export const msg = (strings, ...values) => interpolate(strings, values, false);
export const markup = text => interpolate([text], [], true);
