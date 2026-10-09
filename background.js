/**
 * Stuđiô AI Companion - Service Worker (Background)
 * Tiện ích đồng hành tập trung, chuông báo nhịp sinh học & nhận diện bài giảng học tập.
 */

import { createApiClient } from "./lib/api.js";
import { createSyncEngine } from "./lib/sync-engine.js";
import { newTaskId } from "./lib/task-sync.js";
import { checkPageCapturable, isReadablePageUrl } from "./lib/page-capture.js";
import {
  ensureOptionalPermissions,
  TASKPAD_INJECT_REQUEST,
  LECTURE_DETECT_REQUEST,
  TABS_QUERY_REQUEST,
  NOTIFY_REQUEST,
} from "./lib/permissions.js";

const AUTH_KEY = "studioAuth";
const TIMER_KEY = "studioTimer";
const SETTINGS_KEY = "studioCompanionSettings";
const ACTIVITY_KEY = "studioActivityToday";
// Cờ logout tay: chặn cầu auth tự động (auto-sync/scan-tabs) trong 1 lúc để
// logout không tự đăng nhập lại khi còn tab web mở. Login tay/xác thực lại xóa cờ.
const MANUAL_LOGOUT_KEY = "studioManualLogoutAt";
const MANUAL_LOGOUT_TTL_MS = 5 * 60 * 1000;

async function freshManualLogout() {
  const saved = await chrome.storage.local.get(MANUAL_LOGOUT_KEY);
  const at = saved?.[MANUAL_LOGOUT_KEY];
  return typeof at === "number" && Date.now() - at < MANUAL_LOGOUT_TTL_MS;
}

// Sync outbox pull-cache: minimal local mirror {tasks:[], schedule:[]} holding
// RAW server records. Display + merge base only — never user-edited directly.
// Server list stays the truth for display; the outbox gives write durability.
const TASK_CACHE_KEY = "studioTaskCache";
// Dedicated pull alarm (NOT the 1-min companion-heartbeat — avoid overloading it).
const SYNC_PULL_ALARM = "sync-pull";

// API Base ưu tiên Render Production hoặc Local
const DEFAULT_API_BASE = "https://exe-studio.onrender.com";

// Single HTTP transport: every backend call goes through this client
// (Bearer token + 401 -> refresh -> retry). Payloads/URLs unchanged.
const api = createApiClient({ storage: chrome.storage, fetchImpl: (...args) => fetch(...args) });

// Offline-first sync engine: task writes go through the outbox (client UUID on
// create, If-Match revision on patch); pull merges server state into the cache
// while skipping records with pending ops. No local task DB — server list is
// the truth for display, the outbox is the durability layer.
async function readSyncState() {
  const saved = await chrome.storage.local.get(TASK_CACHE_KEY);
  const cache = saved?.[TASK_CACHE_KEY];
  return {
    tasks: Array.isArray(cache?.tasks) ? cache.tasks : [],
    schedule: Array.isArray(cache?.schedule) ? cache.schedule : [],
  };
}

async function writeSyncState(next) {
  await chrome.storage.local.set({
    [TASK_CACHE_KEY]: {
      tasks: Array.isArray(next?.tasks) ? next.tasks : [],
      schedule: Array.isArray(next?.schedule) ? next.schedule : [],
    },
  });
}

// The engine pushes through this recording wrapper (pass-through for reads)
// so message handlers can echo the exact server response for a just-flushed
// op back to the caller (TaskPad/sidepanel update on flush completion).
// ApiClient methods are context-free closures, so spreading is safe.
const lastWriteResponses = new Map();
function rememberWrite(key, response) {
  lastWriteResponses.set(key, response);
  while (lastWriteResponses.size > 50) {
    lastWriteResponses.delete(lastWriteResponses.keys().next().value);
  }
}
const syncApi = {
  ...api,
  post: async (path, body, opts) => {
    const res = await api.post(path, body, opts);
    try { rememberWrite(`POST ${path} ${body?.id ?? ""}`, res); } catch {}
    return res;
  },
  patch: async (path, body, opts) => {
    const res = await api.patch(path, body, opts);
    try { rememberWrite(`PATCH ${path}`, res); } catch {}
    return res;
  },
};

const syncEngine = createSyncEngine({
  storage: chrome.storage,
  api: syncApi,
  readState: readSyncState,
  writeState: writeSyncState,
});

// Revision for If-Match, best-effort from the pull cache (backend tolerates a
// missing header, so null simply means "no precondition").
async function cachedRevision(taskId) {
  try {
    const state = await readSyncState();
    return (state.tasks ?? []).find((t) => t?.id === taskId)?.revision ?? null;
  } catch {
    return null;
  }
}

// Enqueue a task op, flush immediately when online, pull after a push so the
// cache (and any UI reading it) converges. Mirrors archived background.js:
// conflicts are kept as history entries + surfaced via notification.
// Returns the server echo for the op when it flushed (null when still queued).
async function enqueueAndSync(op) {
  const queued = await syncEngine.enqueue(op);
  if (queued.dropped > 0) {
    notify("⚠️ Stuđiô AI", `Hàng đợi đồng bộ đầy — đã bỏ ${queued.dropped} thao tác cũ nhất.`);
  }
  const result = await syncEngine.syncNow().catch(() => null);
  if (result?.flushed?.conflicts > 0) {
    notify(
      "⚠️ Xung đột đồng bộ",
      `${result.flushed.conflicts} thay đổi bị bản web mới hơn thay thế. Mở Lịch sử đồng bộ để xem/khôi phục.`
    );
  }
  let echo = null;
  try {
    const method = String(op.method ?? "POST").toUpperCase();
    if (method === "POST") echo = lastWriteResponses.get(`POST ${op.path} ${op.body?.id ?? ""}`) ?? null;
    else if (method === "PATCH") echo = lastWriteResponses.get(`PATCH ${op.path}`) ?? null;
  } catch {}
  return { queued, echo, ...(result ?? {}) };
}

// Kích hoạt tính năng mở SidePanel khi bấm vào biểu tượng tiện ích
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

// Tạo lịch báo rà soát 18:00 hằng ngày
function setupDailyReviewAlarm() {
  chrome.alarms.get("daily-18-review", (alarm) => {
    if (!alarm) {
      const now = new Date();
      const target = new Date();
      target.setHours(18, 0, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      chrome.alarms.create("daily-18-review", {
        when: target.getTime(),
        periodInMinutes: 24 * 60,
      });
    }
  });
}
setupDailyReviewAlarm();

// Heartbeat 1 phút để nhận diện bài giảng & âm thanh học tập
chrome.alarms.create("companion-heartbeat", { periodInMinutes: 1 });

// Pull nền 5 phút (kênh riêng — không gộp vào heartbeat để khỏi quá tải)
chrome.alarms.create(SYNC_PULL_ALARM, { periodInMinutes: 5 });

// Helper gửi Notification ("notifications" là optional: lần nhắc đầu tiên xin
// quyền; bị từ chối thì bỏ qua lặng lẽ — caller đã có toast/UI riêng nên
// không crash và không spam lỗi). Trả về promise để test có thể await.
function notify(title, message, iconUrl = "icons/logo.png") {
  if (!chrome.notifications?.create) return Promise.resolve(false);
  return ensureOptionalPermissions(chrome, NOTIFY_REQUEST, null)
    .then((granted) => {
      if (!granted) return false;
      return chrome.notifications
        .create({
          type: "basic",
          iconUrl,
          title,
          message,
          priority: 2,
          silent: false,
        })
        .then(() => true)
        .catch(() => false);
    })
    .catch(() => false);
}

// Đăng ký Context Menus cho thao tác trực tiếp trên mọi trang web.
// contextMenus GIỮ ở base permissions (không optional): menu chuột phải
// page/selection là mặt kích hoạt cốt lõi — Chrome chỉ hiện menu khi quyền
// đã granted từ lúc cài, đưa vào optional sẽ giấu tính năng đến lần dùng đầu.
function setupContextMenus() {
  if (!chrome.contextMenus) return;
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "studi-save-selection-note",
        title: "📝 Stuđiô: Lưu trích dẫn vào Ghi chú",
        contexts: ["selection"],
      });
      chrome.contextMenus.create({
        id: "studi-save-selection-task",
        title: "📌 Stuđiô: Tạo việc cần làm từ đoạn trích",
        contexts: ["selection"],
      });
      chrome.contextMenus.create({
        id: "studi-save-page-task",
        title: "🌐 Stuđiô: Lưu trang này vào Việc cần làm",
        contexts: ["page"],
      });
    });
  } catch (e) {
    console.warn("Lỗi tạo context menu:", e);
  }
}
setupContextMenus();
chrome.runtime.onInstalled?.addListener(setupContextMenus);

// Xử lý sự kiện click menu chuột phải trên web
chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
  if (!auth?.accessToken) {
    notify("⚠️ Stuđiô AI", "Vui lòng mở SidePanel đăng nhập một lần để kích hoạt tính năng này!");
    return;
  }
  const apiBase = auth.apiBase || DEFAULT_API_BASE;
  const pageTitle = (tab?.title || "Tài liệu học").slice(0, 100);
  const pageUrl = tab?.url || info.pageUrl || "";

  // 1. Lưu đoạn trích vào Ghi chú
  if (info.menuItemId === "studi-save-selection-note" && info.selectionText) {
    try {
      const quoteText = info.selectionText.trim();
      const title = `Trích dẫn: ${pageTitle.slice(0, 60)}`;
      const content = `> "${quoteText}"\n\n🔗 Nguồn: [${pageTitle}](${pageUrl})\n⏰ Thời gian: ${new Date().toLocaleString("vi-VN")}`;

      try {
        await api.post("/notes/", { title, content });
        notify("📝 Đã lưu vào Ghi chú", `"${quoteText.slice(0, 50)}..." đã được lưu vào Sổ ghi chép Stuđiô!`);
      } catch (err) {
        if (err?.code === "network_error" || err?.code === "timeout") throw err;
        notify("❌ Lỗi lưu ghi chú", "Không thể gửi dữ liệu lên máy chủ Stuđiô.");
      }
    } catch {
      notify("❌ Lỗi kết nối", "Không thể kết nối máy chủ Stuđiô.");
    }
  }

  // 2. Tạo việc cần làm từ đoạn trích (qua outbox: client UUID + flush ngay)
  if (info.menuItemId === "studi-save-selection-task" && info.selectionText) {
    // Capture gate: trang hệ thống/trống → toast rõ ràng, không tạo task rác.
    const gate = checkPageCapturable({ url: pageUrl, title: tab?.title ?? "", selection: info.selectionText });
    if (!gate.capturable) {
      notify("⚠️ Stuđiô AI", gate.message);
      return;
    }
    try {
      const taskTitle = info.selectionText.trim().slice(0, 100);
      await enqueueAndSync({
        kind: "task",
        method: "POST",
        path: "/tasks/",
        body: {
          id: newTaskId(),
          title: taskTitle,
          description: `Trích từ trang: ${pageTitle}\nNguồn: ${pageUrl}`,
          source_url: pageUrl,
          source_title: pageTitle,
          priority: "high",
          duration_minutes: 30,
          source: "capture",
        },
      });
      notify("📌 Đã tạo việc cần làm", `"${taskTitle}" đã được đưa vào Danh sách việc!`);
    } catch {
      notify("❌ Lỗi kết nối", "Không thể tạo việc từ đoạn trích.");
    }
  }

  // 3. Lưu trang web vào Việc cần làm (qua outbox)
  if (info.menuItemId === "studi-save-page-task") {
    // Capture gate: trang hệ thống/trống → toast rõ ràng, không tạo task rác.
    const gate = checkPageCapturable({ url: pageUrl, title: tab?.title ?? "", selection: "" });
    if (!gate.capturable) {
      notify("⚠️ Stuđiô AI", gate.message);
      return;
    }
    try {
      const title = `Nghiên cứu: ${pageTitle.slice(0, 80)}`;
      await enqueueAndSync({
        kind: "task",
        method: "POST",
        path: "/tasks/",
        body: {
          id: newTaskId(),
          title,
          description: `Nguồn thu thập: ${pageUrl}`,
          source_url: pageUrl,
          source_title: pageTitle,
          priority: "medium",
          duration_minutes: 30,
          source: "capture",
        },
      });
      notify("🌐 Đã lưu trang vào Stuđiô", `Đã tạo việc nghiên cứu cho "${pageTitle}"!`);
    } catch {
      notify("❌ Lỗi kết nối", "Không thể lưu trang này.");
    }
  }
});

// ---- ALARMS LISTENER ----
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "pomodoro-timer") {
    const data = await chrome.storage.local.get(TIMER_KEY);
    const timer = data?.[TIMER_KEY];
    const taskName = timer?.taskTitle ? ` "${timer.taskTitle}"` : "";

    notify(
      "🌊 Stuđiô AI • Hoàn thành phiên tập trung!",
      `Bạn vừa hoàn thành xuất sắc phiên học tập sâu${taskName}. Hãy nghỉ ngơi thư giãn 5 phút nhé!`
    );

    // Cập nhật trạng thái timer đã xong
    await chrome.storage.local.set({
      [TIMER_KEY]: { isRunning: false, remainingSeconds: 0, taskTitle: null },
    });

    // Cộng điểm phút tập trung hôm nay
    await recordActivityMinutes(timer?.durationMinutes || 25, 0);

    // Báo cáo phiên focus lên backend (giữ nguyên notify + phút local ở trên).
    // task_id CHỈ khi timer được start từ context task đã biết (payload
    // studi:start-timer có taskId) — không bao giờ đoán mò theo taskTitle.
    // Chưa đăng nhập / countdown trần không auth → bỏ qua lặng lẽ.
    try {
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (auth?.accessToken) {
        const planned = Number(timer?.durationMinutes) || 25;
        const startTime = Number(timer?.startTime) || Date.now();
        const elapsed = (Date.now() - startTime) / 60000;
        const actual = Math.min(planned, Math.max(0, Math.round(elapsed)));
        const taskId = typeof timer?.taskId === "string" && timer.taskId ? timer.taskId : null;
        await enqueueAndSync({
          kind: "task",
          method: "POST",
          path: "/focus/session/complete",
          body: {
            id: newTaskId(),
            planned_minutes: planned,
            actual_minutes: actual,
            started_at: new Date(startTime).toISOString(),
            ...(taskId ? { task_id: taskId } : {}),
          },
          recordId: null,
        });
      }
    } catch {
      // Báo cáo focus là best-effort: không phá luồng chuông báo local.
    }
  } else if (alarm.name === "daily-18-review") {
    const settings = (await chrome.storage.local.get(SETTINGS_KEY))?.[SETTINGS_KEY] || {};
    if (settings.dailyReview !== false) {
      notify(
        "🌅 Stuđiô AI • Rà soát nhịp sinh học 18:00",
        "Đã đến 18:00! Hãy mở Stuđiô để rà soát tiến độ công việc và chuẩn bị năng lượng cho buổi tối."
      );
    }
  } else if (alarm.name === "companion-heartbeat") {
    checkAudibleLectureTabs();
  } else if (alarm.name === SYNC_PULL_ALARM) {
    syncEngine.pull().catch(() => {});
  }
});

// Ghi nhận phút học tập / bài giảng
async function recordActivityMinutes(focusMins = 0, lectureMins = 0) {
  const today = new Date().toISOString().slice(0, 10);
  const data = (await chrome.storage.local.get(ACTIVITY_KEY))?.[ACTIVITY_KEY] || {
    date: today,
    focusMinutes: 0,
    lectureMinutes: 0,
  };

  if (data.date !== today) {
    data.date = today;
    data.focusMinutes = 0;
    data.lectureMinutes = 0;
  }

  data.focusMinutes += focusMins;
  data.lectureMinutes += lectureMins;

  await chrome.storage.local.set({ [ACTIVITY_KEY]: data });
}

// Kiểm tra tab phát video bài giảng ("tabs"/"idle" là optional: xin quyền ở
// lần lecture-detect đầu tiên; bị từ chối thì bỏ qua lặng lẽ, không crash).
const LECTURE_DOMAINS = ["youtube.com", "coursera.org", "udemy.com", "edx.org", "ted.com", "notion.so"];
async function checkAudibleLectureTabs() {
  try {
    const granted = await ensureOptionalPermissions(chrome, LECTURE_DETECT_REQUEST, null);
    if (!granted) return;
    const tabs = await chrome.tabs.query({ audible: true });
    for (const tab of tabs) {
      const url = tab.url || "";
      if (LECTURE_DOMAINS.some((d) => url.includes(d))) {
        await recordActivityMinutes(0, 1);
        break;
      }
    }
  } catch {
    // Quyền optional bị từ chối / API vắng mặt: bỏ qua lặng lẽ
  }
}

// Timer Pomodoro dùng chung cho cả web (external) lẫn TaskPad/sidepanel (nội bộ).
// Contract giữ nguyên: web chỉ gửi { durationMinutes, taskTitle }.
// taskId là field TÙY CHỌN cho caller nào biết task context — vắng thì phiên
// báo cáo không kèm task_id.
async function startPomodoroTimer(payload = {}) {
  const { durationMinutes = 25, taskTitle = "", taskId = null } = payload || {};
  chrome.alarms.create("pomodoro-timer", { delayInMinutes: durationMinutes });
  await chrome.storage.local.set({
    [TIMER_KEY]: {
      isRunning: true,
      durationMinutes,
      taskTitle,
      taskId: typeof taskId === "string" && taskId ? taskId : null,
      startTime: Date.now(),
    },
  });
  notify("⏱️ Bắt đầu phiên tập trung", `Đang đếm giờ ${durationMinutes} phút${taskTitle ? ` cho "${taskTitle}"` : ""}. Bạn có thể an tâm tắt tab!`);
  return { success: true };
}

async function stopPomodoroTimer() {
  chrome.alarms.clear("pomodoro-timer");
  await chrome.storage.local.set({ [TIMER_KEY]: { isRunning: false } });
  return { success: true };
}

// ---- CẦU NỐI VỚI WEBSITE STUĐIÔ AI (onMessageExternal) ----
const ALLOWED_ORIGINS = [
  "https://exe-studio.onrender.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

chrome.runtime.onMessageExternal?.addListener((request, sender, sendResponse) => {
  (async () => {
    const origin = sender?.origin || (sender?.url ? new URL(sender.url).origin : "");
    if (!ALLOWED_ORIGINS.includes(origin)) {
      throw new Error(`Origin '${origin}' không được phép kết nối với Stuđiô Extension.`);
    }

    const type = request?.type;

    // 1. Ping nhận diện Extension
    if (type === "studi:ping") {
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      const timer = (await chrome.storage.local.get(TIMER_KEY))?.[TIMER_KEY];
      return {
        installed: true,
        version: "1.0.0",
        signedIn: Boolean(auth?.accessToken),
        user: auth?.user || null,
        timerActive: Boolean(timer?.isRunning),
      };
    }

    // 2. Đồng bộ Auth Token từ Web sang Extension
    if (type === "studi:sync-auth") {
      const { accessToken, refreshToken, user, apiBase } = request.payload || {};
      if (accessToken) {
        await chrome.storage.local.set({
          [AUTH_KEY]: { accessToken, refreshToken, user, apiBase: normalizeApiBase(apiBase) },
        });
        // Login xác thực trên web -> xóa cờ logout tay để cầu tự động chạy lại.
        await chrome.storage.local.remove(MANUAL_LOGOUT_KEY);
        return { success: true, message: "Đã đồng bộ phiên đăng nhập vào Extension." };
      }
      return { success: false, message: "Thiếu accessToken." };
    }

    // 3. Xóa Auth khi đăng xuất
    if (type === "studi:clear-auth") {
      await chrome.storage.local.remove(AUTH_KEY);
      return { success: true };
    }

    // 4. Bật chuông báo hẹn giờ tập trung từ Web (dùng chung hàm với nội bộ)
    if (type === "studi:start-timer") {
      return startPomodoroTimer(request.payload);
    }

    // 5. Hủy chuông báo
    if (type === "studi:stop-timer") {
      return stopPomodoroTimer();
    }

    // 6. Test chuông báo thử nghiệm
    if (type === "studi:test-notification") {
      notify("🔔 Stuđiô AI Companion", "Tiện ích hoạt động hoàn hảo! Bạn sẽ nhận được chuông báo đúng giờ kể cả khi đóng tab.");
      return { success: true };
    }

    throw new Error(`Yêu cầu '${type}' không được hỗ trợ.`);
  })()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));

  return true;
});

// Quy tắc apiBase PHẢI giống resolveApiBase phía web (services/extension.js):
// dev (localhost/127.0.0.1, mọi port) -> cùng host port 8000; web prod ->
// cùng origin; còn lại mặc định prod. Chuẩn hóa lúc NHẬN để 2 đường
// (explicit từ web / auto từ tab) không bao giờ vênh nhau.
function normalizeApiBase(raw) {
  try {
    const u = new URL(String(raw ?? ""));
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return `http://${u.hostname}:8000`;
    if (u.hostname.includes("exe-studio")) return u.origin;
  } catch { /* bỏ qua, dùng mặc định dưới */ }
  return DEFAULT_API_BASE;
}

// Tab Stuđiô hợp lệ để nhận Auth Token: cùng quy tắc với content-auth.js isStudioWebApp
function isStudioTabUrl(url) {
  try {
    const u = new URL(String(url ?? ""));
    if (u.hostname.includes("exe-studio")) return true;
    if (
      (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      (u.port === "5173" || u.port === "8000")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---- XỬ LÝ NỘI BỘ TRONG EXTENSION (onMessage cho SidePanel & Content Script) ----
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    const type = request?.type;

    // Chặn token từ tab lạ: chỉ tab Stuđiô mới được đồng bộ auth
    if (type === "companion:auto-sync-auth") {
      if (sender?.id !== chrome.runtime.id || !isStudioTabUrl(sender?.tab?.url)) {
        throw new Error("companion:auto-sync-auth chỉ chấp nhận từ tab Stuđiô (exe-studio / localhost:5173,8000).");
      }
    } else if (sender?.id !== chrome.runtime.id) {
      throw new Error("Yêu cầu nội bộ chỉ chấp nhận từ Stuđiô Extension.");
    }

    if (type === "companion:get-data") {
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY] || null;
      const timer = (await chrome.storage.local.get(TIMER_KEY))?.[TIMER_KEY] || null;
      const activity = (await chrome.storage.local.get(ACTIVITY_KEY))?.[ACTIVITY_KEY] || null;
      return { auth, timer, activity };
    }

    // Tự động nhận diện Auth Token từ Content Script gửi về
    if (type === "companion:auto-sync-auth") {
      if (await freshManualLogout()) {
        return { success: false, message: "Vừa đăng xuất thủ công — bỏ qua đồng bộ tự động." };
      }
      const { accessToken, refreshToken, user, apiBase } = request.payload || {};
      if (accessToken) {
        const authData = {
          accessToken,
          refreshToken,
          user: user || { full_name: "Sinh viên Stuđiô", email: "chau.nguyen@vnuhcm.edu.vn" },
          apiBase: normalizeApiBase(apiBase),
        };
        await chrome.storage.local.set({ [AUTH_KEY]: authData });
        return { success: true, message: "Đã tự động đồng bộ auth từ content script." };
      }
      return { success: false, message: "Không có accessToken." };
    }

    // Quét chủ động các tab Stuđiô đang mở để lấy Auth Token
    if (type === "companion:scan-tabs-auth") {
      if (await freshManualLogout()) {
        return { success: false, message: "Vừa đăng xuất thủ công — bỏ qua quét tab." };
      }
      try {
        // "tabs" là optional: xin ở lần quét đầu; bị từ chối thì trả về
        // "không tìm thấy" như cũ (không crash).
        await ensureOptionalPermissions(chrome, TABS_QUERY_REQUEST, null);
        const tabs = await chrome.tabs.query({});
        const studioTabs = tabs.filter((t) =>
          t.url && (
            t.url.includes("exe-studio.onrender.com") ||
            t.url.includes("localhost:5173") ||
            t.url.includes("127.0.0.1:5173") ||
            t.url.includes("localhost:8000") ||
            t.url.includes("127.0.0.1:8000")
          )
        );

        for (const tab of studioTabs) {
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                return {
                  accessToken: localStorage.getItem("studi_access_token"),
                  refreshToken: localStorage.getItem("studi_refresh_token"),
                  userRaw: localStorage.getItem("studi_user"),
                  origin: window.location.origin,
                };
              },
            });

            const data = results?.[0]?.result;
            if (data?.accessToken) {
              let user = null;
              try {
                user = data.userRaw ? JSON.parse(data.userRaw) : null;
              } catch {}

              const authData = {
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
                user: user || { full_name: "Sinh viên Stuđiô", email: "chau.nguyen@vnuhcm.edu.vn" },
                apiBase: normalizeApiBase(data.origin),
              };
              await chrome.storage.local.set({ [AUTH_KEY]: authData });
              return { success: true, auth: authData, tabTitle: tab.title };
            }
          } catch {
            // Tiếp tục tìm tab tiếp theo nếu tab này không inject được
          }
        }
      } catch (err) {
        console.warn("Scan tabs error:", err);
      }
      return { success: false, message: "Không tìm thấy token trên các tab Stuđiô đang mở." };
    }

    // Đăng nhập nhanh tài khoản mẫu (Demo) cho Châu Nguyễn
    if (type === "companion:demo-login") {
      const apiBase = request.payload?.apiBase || DEFAULT_API_BASE;
      try {
        const authData = await api.loginWithGoogle({
          id_token: "",
          email: "chau.nguyen@vnuhcm.edu.vn",
          apiBase,
        });
        await chrome.storage.local.remove(MANUAL_LOGOUT_KEY);
        return { success: true, auth: authData };
      } catch (err) {
        throw new Error(err?.message || "Không thể đăng nhập tài khoản mẫu.");
      }
    }

    // Đăng nhập thủ công qua Email & Mật khẩu
    if (type === "companion:manual-login") {
      const { email, password, apiBase = DEFAULT_API_BASE } = request.payload || {};
      try {
        const authData = await api.loginWithPassword({ email, password, apiBase });
        await chrome.storage.local.remove(MANUAL_LOGOUT_KEY);
        return { success: true, auth: authData };
      } catch (err) {
        throw new Error(err?.message || "Email hoặc mật khẩu không chính xác.");
      }
    }

    // Đăng xuất khỏi Extension (đặt cờ chặn cầu tự động 1 lúc)
    if (type === "companion:logout") {
      await chrome.storage.local.remove(AUTH_KEY);
      await chrome.storage.local.set({ [MANUAL_LOGOUT_KEY]: Date.now() });
      return { success: true };
    }

    // Timer nội bộ (TaskPad/sidepanel) — cùng hàm với cầu web, trước đây rơi
    // qua khe (không có case) nên hẹn giờ chạy giả.
    if (type === "studi:start-timer") {
      return startPomodoroTimer(request.payload);
    }
    if (type === "studi:stop-timer") {
      return stopPomodoroTimer();
    }

    // Thu thập nhanh trang web hiện tại thành Task
    if (type === "companion:quick-capture") {
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) {
        throw new Error("Vui lòng đồng bộ tài khoản Stuđiô AI trước khi thu thập trang.");
      }

      // "tabs" là optional: xin ở lần capture đầu; bị từ chối thì url trống
      // và gate bên dưới từ chối kèm toast rõ ràng (không crash).
      await ensureOptionalPermissions(chrome, TABS_QUERY_REQUEST, null);
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      if (!currentTab?.url) throw new Error("Không thể đọc tab hiện tại.");

      // Capture gate: trang hệ thống/trống → toast + lỗi rõ ràng, không task rác.
      const gate = checkPageCapturable({ url: currentTab.url, title: currentTab.title ?? "", selection: "" });
      if (!gate.capturable) {
        notify("⚠️ Stuđiô AI", gate.message);
        throw new Error(gate.message);
      }

      const title = `Nghiên cứu: ${(currentTab.title || "Tài liệu học tập").slice(0, 100)}`;
      const notes = `Nguồn thu thập: ${currentTab.url}`;

      try {
        await enqueueAndSync({
          kind: "task",
          method: "POST",
          path: "/tasks/",
          body: {
            id: newTaskId(),
            title,
            description: notes,
            source_url: currentTab.url,
            source_title: (currentTab.title || "").slice(0, 500),
            priority: "medium",
            duration_minutes: 30,
            source: "capture",
          },
        });
      } catch (err) {
        const status = String(err?.code ?? "").startsWith("http_") ? err.code.slice(5) : "?";
        throw new Error(`Lỗi máy chủ (${status}): Không thể lưu task.`);
      }

      notify("📌 Đã lưu vào Stuđiô AI", `Đã tạo công việc "${title}" thành công!`);
      return { success: true, title };
    }

    // Toggle trạng thái micro-sprint (subtask) — qua outbox, flush ngay
    if (type === "companion:toggle-subtask") {
      const { subtaskId } = request.payload || {};
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) throw new Error("Vui lòng kết nối tài khoản Stuđiô AI.");

      let updatedSubtask = null;
      try {
        ({ echo: updatedSubtask } = await enqueueAndSync({
          kind: "task",
          method: "PATCH",
          path: `/tasks/subtasks/${subtaskId}/toggle`,
          body: undefined,
          recordId: null,
        }));
      } catch (err) {
        const status = String(err?.code ?? "").startsWith("http_") ? err.code.slice(5) : "?";
        throw new Error(`Lỗi cập nhật micro-sprint (${status}).`);
      }

      // Đồng bộ vào studioPinnedTask trong storage nếu đang ghim task này
      const pinned = (await chrome.storage.local.get("studioPinnedTask"))?.studioPinnedTask;
      if (pinned && Array.isArray(pinned.subtasks)) {
        const sub = pinned.subtasks.find((s) => s.id === subtaskId);
        if (sub) {
          if (updatedSubtask && typeof updatedSubtask.is_completed === "boolean") {
            sub.is_completed = updatedSubtask.is_completed;
          }
          pinned.completed_sprints = pinned.subtasks.filter((s) => s.is_completed).length;
          if (pinned.completed_sprints === pinned.subtasks.length) {
            pinned.status = "completed";
          }
          await chrome.storage.local.set({ studioPinnedTask: pinned });
        }
      }

      return { success: true, subtask: updatedSubtask ?? { id: subtaskId } };
    }

    // Toggle trạng thái task chính — qua outbox (PATCH + If-Match từ cache)
    if (type === "companion:toggle-task") {
      const { taskId, status } = request.payload || {};
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) throw new Error("Chưa kết nối tài khoản.");

      let updatedTask = null;
      try {
        ({ echo: updatedTask } = await enqueueAndSync({
          kind: "task",
          method: "PATCH",
          path: `/tasks/${taskId}`,
          body: { status },
          ifMatch: await cachedRevision(taskId),
          recordId: taskId,
        }));
      } catch {
        throw new Error("Không thể cập nhật task.");
      }
      const task = updatedTask && updatedTask.id ? updatedTask : { id: taskId, status };

      const pinned = (await chrome.storage.local.get("studioPinnedTask"))?.studioPinnedTask;
      if (pinned && pinned.id === taskId) {
        pinned.status = task.status ?? status;
        if (task.revision != null) pinned.revision = task.revision;
        await chrome.storage.local.set({ studioPinnedTask: pinned });
      }

      return { success: true, task };
    }

    // Xóa task — qua outbox (DELETE + flush ngay)
    if (type === "companion:delete-task") {
      const { taskId } = request.payload || {};
      if (!taskId) throw new Error("Thiếu taskId.");
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) throw new Error("Chưa kết nối tài khoản.");

      await enqueueAndSync({
        kind: "task",
        method: "DELETE",
        path: `/tasks/${taskId}`,
        recordId: taskId,
      });

      const pinned = (await chrome.storage.local.get("studioPinnedTask"))?.studioPinnedTask;
      if (pinned && pinned.id === taskId) {
        await chrome.storage.local.remove("studioPinnedTask");
      }

      return { success: true };
    }

    // Tạo task nhanh từ Floating Widget trên trang web — qua outbox
    // (client UUID + flush ngay; offline vẫn success, op nằm chờ trong outbox)
    if (type === "companion:create-task") {
      const { title, description, priority, duration_minutes, source, source_url, source_title } = request.payload || {};
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) throw new Error("Chưa kết nối tài khoản.");

      const id = newTaskId();
      let created = null;
      try {
        ({ echo: created } = await enqueueAndSync({
          kind: "task",
          method: "POST",
          path: "/tasks/",
          body: {
            id,
            title,
            description: description || "Ghi nhanh từ Floating TaskPad",
            priority: priority || "high",
            duration_minutes: duration_minutes ?? 25,
            source: source || "capture",
            ...(source_url ? { source_url } : {}),
            ...(source_title ? { source_title } : {}),
          },
          recordId: id,
        }));
      } catch {
        throw new Error("Không thể tạo task.");
      }
      return { success: true, task: created && created.id ? created : { id, title, status: "pending" } };
    }

    // Mở SidePanel từ floating widget trên trang web
    if (type === "companion:open-sidepanel") {
      if (sender?.tab?.id) {
        chrome.sidePanel?.open?.({ tabId: sender.tab.id }).catch(() => {});
      } else if (sender?.tab?.windowId) {
        chrome.sidePanel?.open?.({ windowId: sender.tab.windowId }).catch(() => {});
      }
      return { success: true };
    }

    // Cập nhật cấu hình Floating Widget Pin
    if (type === "companion:set-floating-pin") {
      await chrome.storage.local.set({ studioFloatingPin: request.payload });
      return { success: true };
    }

    // Lấy danh sách nhiệm vụ cho Task Switcher trên Floating Widget
    if (type === "companion:get-tasks") {
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) return { tasks: [] };
      const apiBase = auth.apiBase || DEFAULT_API_BASE;
      try {
        const tasks = await api.get("/tasks/");
        return { tasks: Array.isArray(tasks) ? tasks : [] };
      } catch {}
      return { tasks: [] };
    }

    // ---- ĐỒNG BỘ OFFLINE-FIRST (sync:*) — mirror archived background.js ----
    if (type === "sync:status") return syncEngine.status();
    if (type === "sync:now") return syncEngine.syncNow();
    if (type === "sync:conflicts") return syncEngine.conflicts();
    if (type === "sync:retry-dead") return syncEngine.retryDead();
    if (type === "sync:restore") return syncEngine.restore(request?.conflictId);
    if (type === "sync:schedule") {
      const state = await readSyncState();
      return { events: state.schedule };
    }
    if (type === "sync:enqueue") {
      const queued = await syncEngine.enqueue(request?.op ?? {});
      // Đẩy ngay cho tươi (flush tự bỏ qua khi offline/chưa đăng nhập).
      const flushed = await syncEngine.flush().catch(() => ({ ok: false }));
      if (flushed?.pushed > 0) await syncEngine.pull().catch(() => {});
      return { queued, flushed };
    }

    // Sidepanel vừa mở → pull để hội tụ với bản web (không flush ở đây;
    // các thao tác ghi tự flush ngay lúc enqueue).
    if (type === "companion:sidepanel-opened") {
      const pulled = await syncEngine.pull().catch(() => ({ skipped: true }));
      return { pulled };
    }

    // Tạo ghi chú nhanh từ Floating Scratchpad hoặc bôi đen chữ
    if (type === "companion:create-note") {
      const { title, content } = request.payload || {};
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) throw new Error("Chưa kết nối tài khoản.");
      const apiBase = auth.apiBase || DEFAULT_API_BASE;
      let note;
      try {
        note = await api.post("/notes/", {
          title: title || "Ghi chép từ web",
          content: content || "",
        });
      } catch {
        throw new Error("Không thể tạo ghi chú.");
      }
      return { success: true, note };
    }

    return null;
  })()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));

  return true;
});

// ---- INJECT TASKPAD THEO NHU CẦU (content-taskpad.js KHÔNG khai báo trong
// manifest — background inject qua chrome.scripting ở lần trigger TaskPad đầu
// tiên (Alt+S / Alt+N), sau khi xin scripting+host. tabId đã inject được nhớ
// trong session storage để mỗi tab chỉ inject một lần mỗi phiên).
const TASKPAD_INJECT_KEY = "studioTaskpadInjectedTabs";
const TASKPAD_FILE = "content-taskpad.js";

async function getInjectedTabs() {
  try {
    const data = await chrome.storage.session?.get(TASKPAD_INJECT_KEY);
    const arr = data?.[TASKPAD_INJECT_KEY];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function markTabInjected(tabId) {
  try {
    const injected = await getInjectedTabs();
    if (!injected.includes(tabId)) {
      injected.push(tabId);
      await chrome.storage.session?.set({ [TASKPAD_INJECT_KEY]: injected });
    }
  } catch {}
}

// True khi TaskPad đã sẵn sàng trong tabId (đã inject trước đó hoặc vừa
// inject xong). Giữ hành vi trước tách file: không bao giờ inject vào tab
// Stuđiô (PART 2 cũ không chạy ở đó); trang hệ thống (chrome://) inject lỗi
// thì im lặng bỏ qua, không crash.
async function ensureTaskpadInjected(tabId, tabUrl) {
  if (!tabId) return false;
  if (isStudioTabUrl(tabUrl)) return false;
  if ((await getInjectedTabs()).includes(tabId)) return true;
  const granted = await ensureOptionalPermissions(chrome, TASKPAD_INJECT_REQUEST, () =>
    notify(
      "⚠️ Stuđiô AI • Cần quyền hiện TaskPad",
      "Hãy bấm lại Alt+S / Alt+N rồi chọn “Cho phép” để TaskPad nổi trên trang này."
    )
  );
  if (!granted) return false;
  try {
    await chrome.scripting?.executeScript({ target: { tabId }, files: [TASKPAD_FILE] });
  } catch {
    return false;
  }
  await markTabInjected(tabId);
  return true;
}

// ---- PHÍM TẮT TOÀN CỤC (Alt+S: Bật/Tắt TaskPad, Alt+N: Ghi nhanh) ----
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0 || !tabs[0].id) return;
      const tab = tabs[0];

      if (command === "toggle-taskpad") {
        if (!(await ensureTaskpadInjected(tab.id, tab.url))) return;
        chrome.tabs.sendMessage(tab.id, { type: "taskpad:toggle" }).catch(() => {});
      } else if (command === "quick-capture") {
        if (!(await ensureTaskpadInjected(tab.id, tab.url))) return;
        chrome.tabs.sendMessage(tab.id, { type: "taskpad:quick-capture" }).catch(() => {});
      }
    } catch (e) {}
  });
}

// ---- OMNIBOX: Gõ 'studi <tên task>' trên thanh URL Chrome để tạo nhanh task ----
if (chrome.omnibox) {
  chrome.omnibox.setDefaultSuggestion({
    description: "🌊 Stuđiô AI: Tạo nhanh công việc mới: <match>%s</match>",
  });

  chrome.omnibox.onInputEntered.addListener(async (text) => {
    const taskTitle = text.trim();
    if (!taskTitle) return;

    const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
    if (!auth?.accessToken) {
      notify("⚠️ Stuđiô AI", "Vui lòng mở web Stuđiô AI đăng nhập một lần để kích hoạt tính năng Omnibar!");
      return;
    }

    try {
      // Đính kèm tab đang đọc làm nguồn (chỉ khi là trang http(s) đọc được;
      // tab hệ thống → vẫn tạo task theo chữ đã gõ, nhưng không lưu source).
      // "tabs" là optional: bị từ chối thì bỏ qua source, vẫn tạo task.
      let sourceUrl = "";
      let sourceTitle = "";
      try {
        await ensureOptionalPermissions(chrome, TABS_QUERY_REQUEST, null);
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs?.[0];
        if (tab?.url && isReadablePageUrl(tab.url)) {
          sourceUrl = tab.url;
          sourceTitle = String(tab.title ?? "").slice(0, 500);
        }
      } catch {}
      await enqueueAndSync({
        kind: "task",
        method: "POST",
        path: "/tasks/",
        body: {
          id: newTaskId(),
          title: taskTitle,
          description: "Tạo từ thanh địa chỉ Omnibar",
          priority: "high",
          duration_minutes: 30,
          source: "extension",
          ...(sourceUrl ? { source_url: sourceUrl } : {}),
          ...(sourceTitle ? { source_title: sourceTitle } : {}),
        },
      });
      notify("✨ Đã tạo công việc từ Omnibar", `"${taskTitle}" đã được đưa vào Danh sách Việc cần làm!`);
    } catch (err) {
      if (err?.code === "network_error" || err?.code === "timeout") {
        notify("❌ Lỗi kết nối", "Không thể gửi dữ liệu tới máy chủ Stuđiô AI.");
      } else {
        notify("❌ Lỗi tạo việc", "Không thể lưu việc lên máy chủ Stuđiô AI.");
      }
    }
  });
}

