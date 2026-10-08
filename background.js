/**
 * Stuđiô AI Companion - Service Worker (Background)
 * Tiện ích đồng hành tập trung, chuông báo nhịp sinh học & nhận diện bài giảng học tập.
 */

const AUTH_KEY = "studioAuth";
const TIMER_KEY = "studioTimer";
const SETTINGS_KEY = "studioCompanionSettings";
const ACTIVITY_KEY = "studioActivityToday";

// API Base ưu tiên Render Production hoặc Local
const DEFAULT_API_BASE = "https://exe-studio.onrender.com";

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

// Helper gửi Notification
function notify(title, message, iconUrl = "icons/logo.png") {
  chrome.notifications.create({
    type: "basic",
    iconUrl,
    title,
    message,
    priority: 2,
    silent: false,
  });
}

// Đăng ký Context Menus cho thao tác trực tiếp trên mọi trang web
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

      const res = await fetch(`${apiBase}/api/v1/notes/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({ title, content }),
      });

      if (res.ok) {
        notify("📝 Đã lưu vào Ghi chú", `"${quoteText.slice(0, 50)}..." đã được lưu vào Sổ ghi chép Stuđiô!`);
      } else {
        notify("❌ Lỗi lưu ghi chú", "Không thể gửi dữ liệu lên máy chủ Stuđiô.");
      }
    } catch {
      notify("❌ Lỗi kết nối", "Không thể kết nối máy chủ Stuđiô.");
    }
  }

  // 2. Tạo việc cần làm từ đoạn trích
  if (info.menuItemId === "studi-save-selection-task" && info.selectionText) {
    try {
      const taskTitle = info.selectionText.trim().slice(0, 100);
      const res = await fetch(`${apiBase}/api/v1/tasks/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({
          title: taskTitle,
          description: `Trích từ trang: ${pageTitle}\nNguồn: ${pageUrl}`,
          source_url: pageUrl,
          source_title: pageTitle,
          priority: "high",
          duration_minutes: 30,
          source: "capture",
        }),
      });

      if (res.ok) {
        notify("📌 Đã tạo việc cần làm", `"${taskTitle}" đã được đưa vào Danh sách việc!`);
      }
    } catch {
      notify("❌ Lỗi kết nối", "Không thể tạo việc từ đoạn trích.");
    }
  }

  // 3. Lưu trang web vào Việc cần làm
  if (info.menuItemId === "studi-save-page-task") {
    try {
      const title = `Nghiên cứu: ${pageTitle.slice(0, 80)}`;
      const res = await fetch(`${apiBase}/api/v1/tasks/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({
          title,
          description: `Nguồn thu thập: ${pageUrl}`,
          source_url: pageUrl,
          source_title: pageTitle,
          priority: "medium",
          duration_minutes: 30,
          source: "capture",
        }),
      });

      if (res.ok) {
        notify("🌐 Đã lưu trang vào Stuđiô", `Đã tạo việc nghiên cứu cho "${pageTitle}"!`);
      }
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

// Kiểm tra tab phát video bài giảng
const LECTURE_DOMAINS = ["youtube.com", "coursera.org", "udemy.com", "edx.org", "ted.com", "notion.so"];
async function checkAudibleLectureTabs() {
  try {
    const tabs = await chrome.tabs.query({ audible: true });
    for (const tab of tabs) {
      const url = tab.url || "";
      if (LECTURE_DOMAINS.some((d) => url.includes(d))) {
        await recordActivityMinutes(0, 1);
        break;
      }
    }
  } catch {
    // Quyền tabs là optional
  }
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
          [AUTH_KEY]: { accessToken, refreshToken, user, apiBase: apiBase || DEFAULT_API_BASE },
        });
        return { success: true, message: "Đã đồng bộ phiên đăng nhập vào Extension." };
      }
      return { success: false, message: "Thiếu accessToken." };
    }

    // 3. Xóa Auth khi đăng xuất
    if (type === "studi:clear-auth") {
      await chrome.storage.local.remove(AUTH_KEY);
      return { success: true };
    }

    // 4. Bật chuông báo hẹn giờ tập trung từ Web
    if (type === "studi:start-timer") {
      const { durationMinutes = 25, taskTitle = "" } = request.payload || {};
      chrome.alarms.create("pomodoro-timer", { delayInMinutes: durationMinutes });
      await chrome.storage.local.set({
        [TIMER_KEY]: {
          isRunning: true,
          durationMinutes,
          taskTitle,
          startTime: Date.now(),
        },
      });
      notify("⏱️ Bắt đầu phiên tập trung", `Đang đếm giờ ${durationMinutes} phút${taskTitle ? ` cho "${taskTitle}"` : ""}. Bạn có thể an tâm tắt tab!`);
      return { success: true };
    }

    // 5. Hủy chuông báo
    if (type === "studi:stop-timer") {
      chrome.alarms.clear("pomodoro-timer");
      await chrome.storage.local.set({ [TIMER_KEY]: { isRunning: false } });
      return { success: true };
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

// Tab Stuđiô hợp lệ để nhận Auth Token: cùng quy tắc với content.js isStudioWebApp
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
      const { accessToken, refreshToken, user, apiBase } = request.payload || {};
      if (accessToken) {
        const authData = {
          accessToken,
          refreshToken,
          user: user || { full_name: "Sinh viên Stuđiô", email: "chau.nguyen@vnuhcm.edu.vn" },
          apiBase: apiBase || DEFAULT_API_BASE,
        };
        await chrome.storage.local.set({ [AUTH_KEY]: authData });
        return { success: true, message: "Đã tự động đồng bộ auth từ content script." };
      }
      return { success: false, message: "Không có accessToken." };
    }

    // Quét chủ động các tab Stuđiô đang mở để lấy Auth Token
    if (type === "companion:scan-tabs-auth") {
      try {
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
                apiBase: data.origin || DEFAULT_API_BASE,
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
      const res = await fetch(`${apiBase}/api/v1/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: "", email: "chau.nguyen@vnuhcm.edu.vn" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Không thể đăng nhập tài khoản mẫu.");
      }
      const data = await res.json();
      const authData = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        user: data.user,
        apiBase,
      };
      await chrome.storage.local.set({ [AUTH_KEY]: authData });
      return { success: true, auth: authData };
    }

    // Đăng nhập thủ công qua Email & Mật khẩu
    if (type === "companion:manual-login") {
      const { email, password, apiBase = DEFAULT_API_BASE } = request.payload || {};
      const res = await fetch(`${apiBase}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Email hoặc mật khẩu không chính xác.");
      }
      const data = await res.json();
      const authData = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        user: data.user,
        apiBase,
      };
      await chrome.storage.local.set({ [AUTH_KEY]: authData });
      return { success: true, auth: authData };
    }

    // Đăng xuất khỏi Extension
    if (type === "companion:logout") {
      await chrome.storage.local.remove(AUTH_KEY);
      return { success: true };
    }

    // Thu thập nhanh trang web hiện tại thành Task
    if (type === "companion:quick-capture") {
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) {
        throw new Error("Vui lòng đồng bộ tài khoản Stuđiô AI trước khi thu thập trang.");
      }

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      if (!currentTab?.url) throw new Error("Không thể đọc tab hiện tại.");

      const apiBase = auth.apiBase || DEFAULT_API_BASE;
      const title = `Nghiên cứu: ${(currentTab.title || "Tài liệu học tập").slice(0, 100)}`;
      const notes = `Nguồn thu thập: ${currentTab.url}`;

      const res = await fetch(`${apiBase}/api/v1/tasks/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({
          title,
          description: notes,
          source_url: currentTab.url,
          source_title: (currentTab.title || "").slice(0, 500),
          priority: "medium",
          duration_minutes: 30,
          source: "capture",
        }),
      });

      if (!res.ok) {
        throw new Error(`Lỗi máy chủ (${res.status}): Không thể lưu task.`);
      }

      notify("📌 Đã lưu vào Stuđiô AI", `Đã tạo công việc "${title}" thành công!`);
      return { success: true, title };
    }

    // Toggle trạng thái micro-sprint (subtask)
    if (type === "companion:toggle-subtask") {
      const { subtaskId } = request.payload || {};
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) throw new Error("Vui lòng kết nối tài khoản Stuđiô AI.");
      const apiBase = auth.apiBase || DEFAULT_API_BASE;

      const res = await fetch(`${apiBase}/api/v1/tasks/subtasks/${subtaskId}/toggle`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
        },
      });

      if (!res.ok) throw new Error(`Lỗi cập nhật micro-sprint (${res.status}).`);
      const updatedSubtask = await res.json();

      // Đồng bộ vào studioPinnedTask trong storage nếu đang ghim task này
      const pinned = (await chrome.storage.local.get("studioPinnedTask"))?.studioPinnedTask;
      if (pinned && Array.isArray(pinned.subtasks)) {
        const sub = pinned.subtasks.find((s) => s.id === subtaskId);
        if (sub) {
          sub.is_completed = updatedSubtask.is_completed;
          pinned.completed_sprints = pinned.subtasks.filter((s) => s.is_completed).length;
          if (pinned.completed_sprints === pinned.subtasks.length) {
            pinned.status = "completed";
          }
          await chrome.storage.local.set({ studioPinnedTask: pinned });
        }
      }

      return { success: true, subtask: updatedSubtask };
    }

    // Toggle trạng thái task chính
    if (type === "companion:toggle-task") {
      const { taskId, status } = request.payload || {};
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) throw new Error("Chưa kết nối tài khoản.");
      const apiBase = auth.apiBase || DEFAULT_API_BASE;

      const res = await fetch(`${apiBase}/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) throw new Error("Không thể cập nhật task.");
      const updatedTask = await res.json();

      const pinned = (await chrome.storage.local.get("studioPinnedTask"))?.studioPinnedTask;
      if (pinned && pinned.id === taskId) {
        pinned.status = status;
        await chrome.storage.local.set({ studioPinnedTask: pinned });
      }

      return { success: true, task: updatedTask };
    }

    // Tạo task nhanh từ Floating Widget trên trang web
    if (type === "companion:create-task") {
      const { title, description } = request.payload || {};
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) throw new Error("Chưa kết nối tài khoản.");
      const apiBase = auth.apiBase || DEFAULT_API_BASE;

      const res = await fetch(`${apiBase}/api/v1/tasks/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({
          title,
          description: description || "Ghi nhanh từ Floating TaskPad",
          priority: "high",
          duration_minutes: 25,
          source: "floating_widget",
        }),
      });

      if (!res.ok) throw new Error("Không thể tạo task.");
      const created = await res.json();
      return { success: true, task: created };
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
        const res = await fetch(`${apiBase}/api/v1/tasks/`, {
          headers: { Authorization: `Bearer ${auth.accessToken}` },
        });
        if (res.ok) {
          const tasks = await res.json();
          return { tasks: Array.isArray(tasks) ? tasks : [] };
        }
      } catch {}
      return { tasks: [] };
    }

    // Tạo ghi chú nhanh từ Floating Scratchpad hoặc bôi đen chữ
    if (type === "companion:create-note") {
      const { title, content } = request.payload || {};
      const auth = (await chrome.storage.local.get(AUTH_KEY))?.[AUTH_KEY];
      if (!auth?.accessToken) throw new Error("Chưa kết nối tài khoản.");
      const apiBase = auth.apiBase || DEFAULT_API_BASE;
      const res = await fetch(`${apiBase}/api/v1/notes/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({
          title: title || "Ghi chép từ web",
          content: content || "",
        }),
      });
      if (!res.ok) throw new Error("Không thể tạo ghi chú.");
      const note = await res.json();
      return { success: true, note };
    }

    return null;
  })()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));

  return true;
});

// ---- PHÍM TẮT TOÀN CỤC (Alt+S: Bật/Tắt TaskPad, Alt+N: Ghi nhanh) ----
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0 || !tabs[0].id) return;
      const tabId = tabs[0].id;

      if (command === "toggle-taskpad") {
        chrome.tabs.sendMessage(tabId, { type: "taskpad:toggle" }).catch(() => {});
      } else if (command === "quick-capture") {
        chrome.tabs.sendMessage(tabId, { type: "taskpad:quick-capture" }).catch(() => {});
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

    const apiBase = auth.apiBase || DEFAULT_API_BASE;
    try {
      const res = await fetch(`${apiBase}/api/v1/tasks/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
        },
        body: JSON.stringify({
          title: taskTitle,
          description: "Tạo từ thanh địa chỉ Omnibar",
          priority: "high",
          duration_minutes: 30,
          source: "extension",
        }),
      });

      if (res.ok) {
        notify("✨ Đã tạo công việc từ Omnibar", `"${taskTitle}" đã được đưa vào Danh sách Việc cần làm!`);
      } else {
        notify("❌ Lỗi tạo việc", "Không thể lưu việc lên máy chủ Stuđiô AI.");
      }
    } catch (e) {
      notify("❌ Lỗi kết nối", "Không thể gửi dữ liệu tới máy chủ Stuđiô AI.");
    }
  });
}

