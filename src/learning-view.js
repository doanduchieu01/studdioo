import { getLocale } from "./i18n.js";
import { escapeHtml as e } from "./core/utils.js";
import { LEARNING_TOPICS, learningTopic } from "./core/learning-guide.js";

export const guideText = (en, vi) => getLocale() === "vi-VN" ? vi : en;
const c = value => e(guideText(value.en, value.vi));
const button = (action, label, extra = "", primary = false) => `<button type="button" class="btn compact ${primary ? "primary" : "ghost"}" data-action="learning-${action}" ${extra}>${e(label)}</button>`;

export function renderLearningOffer(topicId) {
  if (!learningTopic(topicId)) return "";
  return `<aside class="learning-offer"><span>${guideText("New here?", "Mới đến đây?")}</span>${button("start", guideText("Explain this screen", "Giải thích màn hình"))}${button("pause", guideText("Not now", "Để sau"))}</aside>`;
}

export function renderLearningCard(guide, topicId, step, saving = false) {
  if (!step) return "";
  const topic = learningTopic(topicId), index = topic.steps.indexOf(step);
  const disabled = saving ? "disabled" : "";
  return `<div class="learning-overlay"><div class="learning-spotlight" aria-hidden="true" hidden></div><section class="learning-card" role="dialog" aria-modal="true" aria-labelledby="learning-title" aria-describedby="learning-body" tabindex="-1">
    <div class="learning-heading"><span>${c(topic.title)} · ${index + 1}/${topic.steps.length}</span>${button("pause", guideText("Close tour", "Đóng hướng dẫn"), disabled)}</div>
    <h2 id="learning-title" tabindex="-1">${c(step.title)}</h2><p id="learning-body">${c(step.body)}</p>
    <p id="learning-target-status" class="field-help" role="status"></p>
    <div class="button-row">${index ? button("back", guideText("Back", "Trước"), disabled) : ""}${button("next", index === topic.steps.length - 1 ? guideText("Done", "Xong") : guideText("Next", "Tiếp"), disabled, true)}${button("skip", guideText("Skip step", "Bỏ qua bước"), disabled)}</div>
    <p class="learning-note">${guideText("A guide only. Nothing is enabled, sent or changed. Escape closes; Help & tours can replay it.", "Chỉ là hướng dẫn. Không bật, gửi hay thay đổi gì. Escape để đóng; xem lại trong Trợ giúp & hướng dẫn.")}</p>
  </section></div>`;
}

export function renderLearningCenter(guide, error = "", saving = false) {
  const disabled = saving ? "disabled" : "";
  return `<div class="header-copy"><h1 class="page-title" tabindex="-1" id="learning-center-title">${guideText("Help & tours", "Trợ giúp & hướng dẫn")}</h1><p class="page-subtitle">${guideText("A little help, when you want it. Tours never require a real task, timer or permission.", "Một chút trợ giúp khi cần. Hướng dẫn không yêu cầu tạo việc, chạy bộ đếm hay cấp quyền.")}</p></div>
    <section class="card learning-preferences"><h2>${guideText("Contextual invitations", "Lời mời theo ngữ cảnh")}</h2><p>${guideText("A small invitation appears in areas you have not explored. You decide when to open the overlay. Invitations wait during focus sessions; progress stays on this device, outside AI and backups.", "Lời mời nhỏ xuất hiện ở phần chưa khám phá. Bạn chọn lúc mở lớp hướng dẫn. Lời mời tạm ẩn khi tập trung; tiến độ chỉ lưu trên máy, không gửi AI hay vào bản sao lưu.")}</p>${button("enabled", guide.enabled ? guideText("Turn invitations off", "Tắt lời mời") : guideText("Turn invitations on", "Bật lời mời"), disabled)}<p class="field-help">${guideText("Explain this screen and these guides remain available when invitations are off.", "Vẫn có thể dùng Giải thích màn hình và các hướng dẫn bên dưới khi tắt lời mời.")}</p></section>
    ${error ? `<p role="status" class="privacy-note">${e(error)}</p>` : ""}
    <div class="stack learning-topics">${LEARNING_TOPICS.map(topic => {
      const explored = topic.steps.every(step => guide.steps[step.id]);
      return `<section class="card"><h2>${c(topic.title)}</h2><p class="field-help">${topic.steps.length} ${guideText("short explanations", "giải thích ngắn")}${explored ? guideText(" · explored", " · đã xem") : ""}</p><div class="button-row">${button(explored ? "replay" : "resume", explored ? guideText("Replay guide", "Xem lại hướng dẫn") : guideText("Open guide", "Mở hướng dẫn"), `data-topic="${topic.id}" ${disabled}`, true)}</div></section>`;
    }).join("")}`;
}

// Only explicit tour controls open disclosures or scroll the page. Never activate targets.
let cleanup = null;
export function clearLearningTarget() { cleanup?.(); cleanup = null; }

export function tourPlacement(rect, width, height, cardHeight) {
  const margin = 12, cardWidth = Math.min(360, Math.max(0, width - margin * 2));
  const visible = rect && rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width;
  const maxTop = Math.max(margin, height - cardHeight - margin);
  const below = visible ? rect.bottom + 16 : margin;
  const above = visible ? rect.top - cardHeight - 16 : margin;
  const top = visible && below <= maxTop ? below : visible && above >= margin ? above : maxTop;
  return { left: Math.max(margin, Math.min(width - cardWidth - margin, visible ? rect.left : (width - cardWidth) / 2)), top: Math.max(margin, Math.min(maxTop, top)), width: cardWidth };
}

export function trapDialogKey(event, dialog, doc = document) {
  if (event.key !== "Tab" || !dialog) return false;
  const controls = [...(dialog.querySelectorAll?.('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])].filter(node => !node.hidden && node.getClientRects?.().length !== 0);
  const first = controls[0], last = controls.at(-1);
  if (!first) { event.preventDefault(); dialog.focus?.(); return true; }
  if (!dialog.contains(doc.activeElement) || event.shiftKey && (doc.activeElement === first || doc.activeElement?.tabIndex === -1)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return true; }
  if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); return true; }
  return false;
}

export function showLearningTarget(step, doc = document, focus = true) {
  clearLearningTarget();
  const node = step && doc.querySelector(step.target);
  const overlay = doc.querySelector(".learning-overlay"), card = doc.querySelector(".learning-card");
  if (!overlay || !card) return false;
  const status = doc.querySelector("#learning-target-status"), spot = doc.querySelector(".learning-spotlight");
  const visibleTarget = node && !node.disabled;
  if (status) status.textContent = visibleTarget ? "" : guideText("This part appears when relevant. You can continue the tour without adding data or enabling anything.", "Phần này hiện khi phù hợp. Có thể tiếp tục hướng dẫn mà không thêm dữ liệu hay bật tính năng.");
  if (visibleTarget) {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
    node.scrollIntoView?.({ block: "center", behavior: "auto" });
  }
  const inertNodes = [...(doc.querySelectorAll?.(".shell, .bottom-nav, .fab-wrap") ?? [])].map(item => [item, item.inert]);
  for (const [item] of inertNodes) item.inert = true;
  const win = doc.defaultView;
  const position = () => {
    if (!card.getBoundingClientRect || !win) return;
    const width = win.innerWidth, height = win.innerHeight;
    const rect = visibleTarget ? node.getBoundingClientRect() : null;
    const place = tourPlacement(rect, width, height, card.getBoundingClientRect().height);
    Object.assign(card.style, { left: `${place.left}px`, top: `${place.top}px`, width: `${place.width}px`, maxHeight: `${Math.max(0, height - 24)}px` });
    if (spot) {
      spot.hidden = !rect || rect.bottom <= 0 || rect.top >= height;
      if (rect) Object.assign(spot.style, { left: `${Math.max(0, rect.left - 6)}px`, top: `${Math.max(0, rect.top - 6)}px`, width: `${Math.min(width, rect.width + 12)}px`, height: `${Math.min(height, rect.height + 12)}px` });
    }
    overlay.classList?.toggle("has-target", !!spot && !spot.hidden);
  };
  position();
  win?.addEventListener("resize", position);
  doc.addEventListener?.("scroll", position, true);
  cleanup = () => { for (const [item, inert] of inertNodes) item.inert = inert; win?.removeEventListener("resize", position); doc.removeEventListener?.("scroll", position, true); };
  if (focus) (doc.querySelector("#learning-title") ?? card).focus?.({ preventScroll: true });
  return !!visibleTarget;
}
