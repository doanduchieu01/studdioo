import { t, html, msg, markup, setLanguage, getLocale } from "./i18n.js";
import { escapeHtml } from "./core/utils.js";

function duration(ms) {
  const seconds = Math.floor((ms || 0) / 1000);
  return getLocale() === "vi-VN" ? `${Math.floor(seconds / 60)} phút ${String(seconds % 60).padStart(2, "0")} giây` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function renderTrackingCard(tracking, busy = false) {
  const disabled = busy || !tracking?.available ? "disabled" : "";
  return html`<section class="card"><p class="eyebrow">Local browser tracking</p><h2>Website time today</h2>
    <p class="subtle">${tracking?.enabled ? t("On") : t("Off")} · ${duration(tracking?.totalMs)} recorded${tracking?.activeHost ? msg` · Current: ${escapeHtml(tracking.activeHost)}` : ""}</p>
    ${(tracking?.sites ?? []).map(site => html`<div class="setting-row"><span>${escapeHtml(site.host)}</span><strong>${duration(site.ms)}</strong></div>`).join("")}
    <details class="mini-disclosure"><summary>Details</summary><p class="field-help">Active website in the focused browser window; pauses on device idle after 60 seconds. Estimates, not proof of attention. Long sleep gaps are skipped; passive reading/video may be undercounted. Not other apps or total device screen time.</p>
    <p class="field-help">Off by default. Enabling asks for optional tab and idle access. Only hostnames and daily totals are stored locally for up to seven days, pruned on the next check. Private tabs, page titles, full URLs, Gemini, learning memory, diagnostics, and backups are excluded.</p>
    </details><div class="button-row"><button class="btn" type="button" data-action="tracking-${tracking?.enabled ? "pause" : "enable"}" ${disabled}>${tracking?.enabled ? t("Pause tracking") : t("Enable website tracking")}</button><button class="btn ghost" type="button" data-action="tracking-refresh" ${disabled}>Refresh totals</button><button class="btn ghost danger" type="button" data-action="tracking-ask-clear" ${busy ? "disabled" : ""}>Clear tracking data</button></div>
    <p class="field-help">${tracking ? msg`Snapshot at ${escapeHtml(new Date(tracking.checkedAt).toLocaleTimeString(getLocale()))}. Refresh for the latest totals. Pausing may discard up to one uncommitted minute; it keeps saved totals.` : t("Tracking status unavailable. Reopen the panel to retry.")}</p>
  </section>`;
}
