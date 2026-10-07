// Presets are suggestions, never permission grants or a claim of player compatibility.
export const MEDIA_PRESETS = [
  { name: "YouTube", origin: "https://www.youtube.com", kind: "Video" },
  { name: "YouTube Music", origin: "https://music.youtube.com", kind: "Music" },
  { name: "Spotify", origin: "https://open.spotify.com", kind: "Music · Podcasts" },
  { name: "SoundCloud", origin: "https://soundcloud.com", kind: "Audio" },
  { name: "Apple Music", origin: "https://music.apple.com", kind: "Music" },
  { name: "Apple Podcasts", origin: "https://podcasts.apple.com", kind: "Podcasts" },
  { name: "Pocket Casts", origin: "https://play.pocketcasts.com", kind: "Podcasts" },
  { name: "Vimeo", origin: "https://vimeo.com", kind: "Video" },
  { name: "Zing MP3", origin: "https://zingmp3.vn", kind: "Music" },
  { name: "NhacCuaTui", origin: "https://www.nhaccuatui.com", kind: "Music" }
];
export function presetOrigins(values = []) {
  if (!Array.isArray(values) || values.some(origin => !MEDIA_PRESETS.some(site => site.origin === origin))) throw new Error("Choose sites from the displayed list.");
  return [...new Set(values)];
}
export function localExtrasPermission(origins) {
  const sites = presetOrigins(origins);
  return { permissions: ["tabs", "idle", "notifications", ...(sites.length ? ["scripting"] : [])], ...(sites.length ? { origins: sites.map(origin => `${origin}/*`) } : {}) };
}
export function localExtrasState(activity, reminders) {
  const s = activity?.settings ?? {}, r = reminders?.settings ?? {};
  const flags = [s.enabled, s.details, s.signalOrigins?.length > 0, s.backgroundMedia, r.enabled, r.review];
  const count = flags.filter(Boolean).length;
  return { count, all: count === flags.length, some: count > 0 && count < flags.length };
}
