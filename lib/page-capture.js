// Page-capture helpers: readability rules + snapshot builder + system-page
// rejection. Pure logic, no chrome.* — unit-testable under node --test.
//
// Ported from archived extension src/core/page-capture.js (extractPageSnapshot
// readability semantics, buildCaptureTask, isReadablePageUrl). Companion
// difference: the content script already runs on every page (manifest
// <all_urls>) and reads document.title/selection/URL directly, so snapshots
// are built from explicit fields via normalizeSnapshot instead of
// executeScript results. extractPageSnapshot is kept DOM-only and
// closure-free for parity. checkPageCapturable is the single gate the
// background capture paths (quick-capture, context menus) must consult so
// system/empty pages produce a clear rejection reason instead of junk tasks.

export function extractPageSnapshot() {
  const selection = (window.getSelection ? String(window.getSelection()).trim() : "").slice(0, 2000);
  const desc = (document.querySelector('meta[name="description"]')?.content ?? "").trim().slice(0, 500);
  return {
    url: String(location.href ?? ""),
    title: String(document.title ?? "").trim().slice(0, 500),
    selection,
    description: desc,
  };
}

// Normalize raw tab/content fields into a bounded snapshot. Never throws.
export function normalizeSnapshot(raw) {
  return {
    url: String(raw?.url ?? ""),
    title: String(raw?.title ?? "").trim().slice(0, 500),
    selection: String(raw?.selection ?? "").trim().slice(0, 2000),
    description: String(raw?.description ?? "").trim().slice(0, 500),
  };
}

export function buildCaptureTask(snapshot) {
  const selection = String(snapshot?.selection ?? "");
  const firstLine = selection.split("\n").map(line => line.trim()).find(Boolean) ?? "";
  const title = (firstLine || String(snapshot?.title ?? "")).slice(0, 160).trim();
  if (!title) throw new Error("Trang này không có tiêu đề và bạn chưa bôi đen gì.");
  const parts = [];
  if (selection.trim()) parts.push(selection.trim().slice(0, 2000));
  parts.push(`Nguồn: ${snapshot.url}`);
  return {
    title,
    description: parts.join("\n\n"),
    source: "capture",
    source_url: snapshot.url,
    source_title: String(snapshot?.title ?? "").slice(0, 500) || null,
  };
}

export function isReadablePageUrl(url) {
  return /^https?:\/\//i.test(String(url ?? ""));
}

// Single gate for every capture path. Returns { capturable, reason, message,
// snapshot } where reason is null on success, "system-page" for
// chrome://-style or empty URLs, "empty-content" when neither title nor
// selection can name a task.
export function checkPageCapturable(raw) {
  const snapshot = normalizeSnapshot(raw);
  if (!isReadablePageUrl(snapshot.url)) {
    return {
      capturable: false,
      reason: "system-page",
      message: "Không thể thu thập trang hệ thống (chrome://, about:, file://). Hãy mở một trang web http(s) rồi thử lại.",
      snapshot,
    };
  }
  if (!snapshot.title && !snapshot.selection) {
    return {
      capturable: false,
      reason: "empty-content",
      message: "Trang này không có tiêu đề và bạn chưa bôi đen gì — không có gì để lưu.",
      snapshot,
    };
  }
  return { capturable: true, reason: null, message: "", snapshot };
}
