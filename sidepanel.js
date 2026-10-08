/**
 * Stuđiô Companion - Sổ tay Ghim Việc, Tích Gạch & Ghi Chú Thông Minh Khi Lướt Web
 * Tích hợp siêu năng lực trực tiếp trên trang web:
 * - Chèn mốc thời gian video YouTube/Coursera [MM:SS]
 * - Lấy trích dẫn bôi đen trực tiếp từ bài đọc
 * - Ghi chép nhanh (Scratchpad) & Tự động lưu
 * - Biến ghi chú thành công việc cần làm (1-Click)
 * - Tích gạch hoàn thành (Strike-through checklist)
 */

import { createApiClient } from "./lib/api.js";

// Single HTTP transport: Bearer token + 401 -> refresh -> retry.
// Payloads/URLs unchanged; the token is re-read from the store per request.
const api = createApiClient({ storage: chrome.storage, fetchImpl: (...args) => fetch(...args) });

let currentAuth = null;
let timerMinutes = 25;
let timerSecondsLeft = 25 * 60;
let timerInterval = null;
let isTimerRunning = false;
let currentFocusTask = null;
let allTasks = [];
let allNotes = [];
let currentFilter = "pending"; // "pending" | "completed"
let activeWebTab = null;
let activeVideoTime = null;

document.addEventListener("DOMContentLoaded", () => {
  initCompanion();
  setupEventListeners();
  checkCurrentWebTab();
});

async function initCompanion() {
  await loadStoredData();

  // Quét tab tự động nếu chưa đăng nhập
  if (!currentAuth?.accessToken) {
    await scanTabsAuth(false);
  }

  if (currentAuth?.accessToken) {
    await loadAllTasks();
    await loadRecentNotes();
  }

  // Khôi phục bản nháp ghi chú chưa lưu
  restoreDraftNote();
}

// 1. Quét tab web hiện tại & đọc thông tin Video/Text
async function checkCurrentWebTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;
    const tab = tabs[0];
    const url = tab.url || "";

    // Bỏ qua trang nội bộ / router
    const isJunk =
      url.startsWith("chrome://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:") ||
      url.includes("192.168.") ||
      url.includes("10.0.") ||
      url.includes("127.0.0.1") ||
      url.includes("localhost") ||
      url.includes("/login") ||
      url.includes("/cgi-bin/");

    const captureBox = document.getElementById("smartCaptureBox");
    const captureTitle = document.getElementById("captureTabTitle");
    const captureIcon = document.getElementById("captureIcon");

    if (!isJunk && url.startsWith("http")) {
      activeWebTab = tab;
      captureBox.style.display = "flex";
      captureTitle.textContent = tab.title || url;

      const isVideoSite = url.includes("youtube.com") || url.includes("coursera.org") || url.includes("udemy.com");
      captureIcon.textContent = isVideoSite ? "🎧" : "📌";

      // Kiểm tra mốc thời gian video trên trang nếu có
      checkVideoPlaybackOnTab(tab.id);
    } else {
      activeWebTab = null;
      captureBox.style.display = "none";
    }
  } catch (err) {
    console.warn("Không thể đọc active tab:", err);
  }
}

// Kiểm tra video đang phát trên tab
async function checkVideoPlaybackOnTab(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const video = document.querySelector("video");
        if (video && !isNaN(video.currentTime)) {
          const sec = Math.floor(video.currentTime);
          const mins = Math.floor(sec / 60);
          const secs = sec % 60;
          return {
            timeStr: `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`,
            seconds: sec,
          };
        }
        return null;
      },
    });

    const info = res?.[0]?.result;
    const badge = document.getElementById("currentVideoTimeBadge");
    if (info?.timeStr) {
      activeVideoTime = info;
      badge.textContent = info.timeStr;
    } else {
      badge.textContent = "00:00";
    }
  } catch {
    // Tab không cho phép inject script
  }
}

// 2. Tải Auth & Session từ Storage
async function loadStoredData() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "companion:get-data" });
    const { auth, timer, activity } = res || {};
    currentAuth = auth;

    updateAuthUI(currentAuth);

    document.getElementById("focusTimeVal").textContent = `${activity?.focusMinutes || 0}p`;
    document.getElementById("lectureTimeVal").textContent = `${activity?.lectureMinutes || 0}p`;

    if (timer?.isRunning && timer?.startTime && timer?.durationMinutes) {
      const elapsedSec = Math.floor((Date.now() - timer.startTime) / 1000);
      const totalSec = timer.durationMinutes * 60;
      if (elapsedSec < totalSec) {
        timerSecondsLeft = totalSec - elapsedSec;
        if (timer.taskTitle) {
          pinTaskToHero({ title: timer.taskTitle });
        }
        startLocalTimerDisplay();
      }
    }
  } catch (err) {
    console.error("Lỗi lấy dữ liệu companion:", err);
  }
}

function updateAuthUI(auth) {
  const authStatusEl = document.getElementById("authStatus");
  const authTextEl = document.getElementById("authText");
  const authPromptCard = document.getElementById("authPromptCard");
  const btnHeaderLogout = document.getElementById("btnHeaderLogout");
  const openWebEl = document.getElementById("btnOpenWeb");

  if (auth?.accessToken && auth?.user) {
    authStatusEl.className = "badge-status connected";
    const name = auth.user.full_name || auth.user.email?.split("@")[0] || "Đã kết nối";
    authTextEl.textContent = name;
    authPromptCard.style.display = "none";
    btnHeaderLogout.style.display = "inline-flex";
    if (auth.apiBase) openWebEl.href = auth.apiBase;
  } else {
    authStatusEl.className = "badge-status disconnected";
    authTextEl.textContent = "Chưa kết nối";
    authPromptCard.style.display = "flex";
    btnHeaderLogout.style.display = "none";
  }
}

function showAuthNotice(msg, type = "success") {
  const el = document.getElementById("authNotice");
  if (!el) return;
  el.textContent = msg;
  el.className = `auth-notice ${type}`;
  el.style.display = "block";
  setTimeout(() => {
    el.style.display = "none";
  }, 4000);
}

// 3. Quét tab mở sẵn để nhận diện tài khoản
async function scanTabsAuth(showFeedback = true) {
  const btn = document.getElementById("btnScanTabs");
  const originalText = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Đang quét các tab...";
  }

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

    let found = false;
    for (const tab of studioTabs) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            accessToken: localStorage.getItem("studi_access_token"),
            refreshToken: localStorage.getItem("studi_refresh_token"),
            userRaw: localStorage.getItem("studi_user"),
            origin: window.location.origin,
          }),
        });

        const item = results?.[0]?.result;
        if (item?.accessToken) {
          let user = null;
          try {
            user = item.userRaw ? JSON.parse(item.userRaw) : null;
          } catch {}

          const authData = {
            accessToken: item.accessToken,
            refreshToken: item.refreshToken,
            user: user || { full_name: "Sinh viên Stuđiô", email: "chau.nguyen@vnuhcm.edu.vn" },
            apiBase: item.origin || "https://exe-studio.onrender.com",
          };
          await chrome.storage.local.set({ studioAuth: authData });
          currentAuth = authData;
          updateAuthUI(currentAuth);
          await loadAllTasks();
          await loadRecentNotes();
          if (showFeedback) {
            showAuthNotice(`✓ Đã kết nối: ${currentAuth.user?.full_name || "Stuđiô AI"}`, "success");
          }
          found = true;
          break;
        }
      } catch (e) {
        // Skip tab
      }
    }

    if (!found && showFeedback) {
      showAuthNotice("Chưa tìm thấy tab Stuđiô AI đăng nhập.", "error");
    }
    return found;
  } catch (err) {
    if (showFeedback) {
      showAuthNotice(err.message || "Lỗi quét tab.", "error");
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
  return false;
}

// Đăng nhập nhanh Châu Nguyễn
async function handleDemoLogin() {
  const btn = document.getElementById("btnQuickDemo");
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Đang đăng nhập Châu Nguyễn...";

  const apiBase = "https://exe-studio.onrender.com";
  try {
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
    await chrome.storage.local.set({ studioAuth: authData });
    currentAuth = authData;
    updateAuthUI(currentAuth);
    await loadAllTasks();
    await loadRecentNotes();
    showAuthNotice("✓ Đã đăng nhập tài khoản Châu Nguyễn!", "success");
  } catch (err) {
    showAuthNotice(err.message || "Lỗi kết nối.", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Đăng nhập thủ công
async function handleManualLogin(e) {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const submitBtn = document.getElementById("btnLoginSubmit");

  if (!email || !password) return;
  submitBtn.disabled = true;
  submitBtn.textContent = "Đang xử lý...";

  const apiBase = "https://exe-studio.onrender.com";
  try {
    const res = await fetch(`${apiBase}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Sai email hoặc mật khẩu.");
    }

    const data = await res.json();
    const authData = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user,
      apiBase,
    };
    await chrome.storage.local.set({ studioAuth: authData });
    currentAuth = authData;
    updateAuthUI(currentAuth);
    await loadAllTasks();
    await loadRecentNotes();
    showAuthNotice("✓ Đăng nhập thành công!", "success");
  } catch (err) {
    showAuthNotice(err.message || "Lỗi đăng nhập.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Đăng nhập";
  }
}

// Đăng xuất
async function handleLogout() {
  if (!confirm("Bạn có chắc muốn đăng xuất khỏi tiện ích?")) return;
  await chrome.storage.local.remove("studioAuth");
  currentAuth = null;
  allTasks = [];
  allNotes = [];
  currentFocusTask = null;
  updateAuthUI(null);
  renderTaskList();
  renderNotesList();
}

// ================= 4. PHẦN VIỆC CẦN LÀM (TASKS & CHECKLIST) =================

async function loadAllTasks() {
  if (!currentAuth?.accessToken) return;

  try {
    const tasks = await api.get("/tasks/");
    allTasks = Array.isArray(tasks) ? tasks : [];

    // Tự động ghim việc đầu tiên nếu chưa ghim
    if (!currentFocusTask && allTasks.length > 0) {
      const firstPending = allTasks.find((t) => t.status !== "completed");
      if (firstPending) {
        pinTaskToHero(firstPending);
      }
    }

    renderTaskList();
  } catch (err) {
    console.error("Lỗi tải tasks:", err);
  }
}

function renderTaskList() {
  const listEl = document.getElementById("taskList");
  const countPendingEl = document.getElementById("countPending");
  const countCompletedEl = document.getElementById("countCompleted");
  const badgePendingCount = document.getElementById("badgePendingCount");

  const pendingList = allTasks.filter((t) => t.status !== "completed");
  const completedList = allTasks.filter((t) => t.status === "completed");

  countPendingEl.textContent = pendingList.length;
  countCompletedEl.textContent = completedList.length;
  badgePendingCount.textContent = pendingList.length;

  const displayTasks = currentFilter === "completed" ? completedList : pendingList;

  if (displayTasks.length === 0) {
    listEl.innerHTML =
      currentFilter === "completed"
        ? '<li class="task-empty">Chưa có việc nào được hoàn thành.</li>'
        : '<li class="task-empty">🎉 Tuyệt vời! Bạn không còn việc tồn đọng. Thêm việc mới ở trên!</li>';
    return;
  }

  listEl.innerHTML = "";
  displayTasks.forEach((task) => {
    const isCompleted = task.status === "completed";
    const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    const hasSubtasks = subtasks.length > 0;
    const totalSprints = task.total_sprints || subtasks.length;
    const completedSprints =
      task.completed_sprints !== undefined
        ? task.completed_sprints
        : subtasks.filter((s) => s.is_completed).length;

    const li = document.createElement("li");
    li.className = "task-item-group";

    li.innerHTML = `
      <div class="task-item ${isCompleted ? "is-completed" : ""}" data-task-id="${task.id}">
        <label class="custom-checkbox" title="${isCompleted ? "Bỏ hoàn thành" : "Tích để gạch xong"}">
          <input type="checkbox" class="task-check" data-id="${task.id}" ${isCompleted ? "checked" : ""} />
          <span class="checkmark"></span>
        </label>
        <div class="task-item-body">
          <div class="task-item-header-row">
            <span class="task-item-title truncate" title="${task.title}">${task.title}</span>
            ${
              hasSubtasks
                ? `<span class="subtask-badge-pill ${completedSprints === totalSprints ? "all-done" : ""}" data-toggle-subtasks="${task.id}" title="Xem/Thu gọn micro-sprint">🎯 ${completedSprints}/${totalSprints} ▾</span>`
                : ""
            }
          </div>
        </div>
        <div class="task-actions">
          ${
            !isCompleted
              ? `<button class="btn-task-action pin-focus" data-id="${task.id}" title="Ghim lên đếm giờ & web">🎯</button>`
              : ""
          }
          <button class="btn-task-action delete" data-id="${task.id}" title="Xóa việc">🗑️</button>
        </div>
      </div>
      ${
        hasSubtasks
          ? `
        <div class="task-subtasks-drawer" id="subtasks-drawer-${task.id}">
          ${subtasks
            .map(
              (sub, sIdx) => `
            <div class="subtask-card ${sub.is_completed ? "is-completed" : ""}" data-subtask-id="${sub.id}">
              <label class="custom-checkbox" title="Tích chặng này">
                <input type="checkbox" class="task-sub-check" data-task-id="${task.id}" data-sub-id="${sub.id}" ${sub.is_completed ? "checked" : ""} />
                <span class="checkmark"></span>
              </label>
              <span class="subtask-card-title truncate" title="${sub.title}">${sIdx + 1}. ${sub.title}</span>
              <span class="subtask-mini-time">${sub.estimated_minutes || 25}p</span>
            </div>
          `
            )
            .join("")}
        </div>
      `
          : ""
      }
    `;

    // Sự kiện TÍCH GẠCH TASK CHÍNH
    const checkEl = li.querySelector(".task-check");
    checkEl.addEventListener("change", async (e) => {
      const willBeCompleted = e.target.checked;
      const itemEl = li.querySelector(".task-item");
      itemEl.classList.toggle("is-completed", willBeCompleted);

      task.status = willBeCompleted ? "completed" : "in_progress";

      if (currentFocusTask?.id === task.id) {
        const pinnedCheck = document.getElementById("checkPinnedTask");
        const pinnedTitle = document.getElementById("pinnedTaskTitle");
        pinnedCheck.checked = willBeCompleted;
        pinnedTitle.classList.toggle("completed", willBeCompleted);
      }

      await updateTaskStatus(task.id, task.status);

      setTimeout(() => {
        renderTaskList();
      }, 350);
    });

    // Sự kiện mở/thu gọn Subtasks
    const badgeToggle = li.querySelector("[data-toggle-subtasks]");
    badgeToggle?.addEventListener("click", () => {
      const drawer = li.querySelector(`#subtasks-drawer-${task.id}`);
      if (drawer) {
        drawer.classList.toggle("collapsed");
      }
    });

    // Sự kiện TÍCH GẠCH SUBTASK
    li.querySelectorAll(".task-sub-check").forEach((subInput) => {
      subInput.addEventListener("change", async () => {
        const subId = subInput.dataset.subId;
        await toggleSubtask(task.id, subId);
        if (currentFocusTask?.id === task.id) {
          pinTaskToHero(task);
        }
        renderTaskList();
      });
    });

    // Ghim việc lên Hero Focus
    const pinBtn = li.querySelector(".pin-focus");
    pinBtn?.addEventListener("click", () => {
      pinTaskToHero(task);
    });

    // Xóa việc
    const deleteBtn = li.querySelector(".delete");
    deleteBtn.addEventListener("click", async () => {
      if (confirm(`Xóa công việc "${task.title}"?`)) {
        await deleteTask(task.id);
      }
    });

    listEl.appendChild(li);
  });
}

function pinTaskToHero(task) {
  currentFocusTask = task;
  const titleEl = document.getElementById("pinnedTaskTitle");
  const checkEl = document.getElementById("checkPinnedTask");
  const subtasksSection = document.getElementById("pinnedSubtasksSection");
  const subtasksListEl = document.getElementById("pinnedSubtasksList");
  const sprintCountEl = document.getElementById("pinnedSprintCount");

  if (!task) {
    titleEl.textContent = "Chọn 1 việc bên dưới để bắt đầu";
    checkEl.checked = false;
    titleEl.classList.remove("completed");
    if (subtasksSection) subtasksSection.style.display = "none";
    chrome.storage.local.remove("studioPinnedTask").catch(() => {});
    return;
  }

  titleEl.textContent = task.title;
  const isCompleted = task.status === "completed";
  checkEl.checked = isCompleted;
  titleEl.classList.toggle("completed", isCompleted);

  // Render micro-sprints nếu có
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  if (subtasksSection && subtasksListEl && sprintCountEl) {
    if (subtasks.length > 0) {
      subtasksSection.style.display = "flex";
      const total = task.total_sprints || subtasks.length;
      const completed =
        task.completed_sprints !== undefined
          ? task.completed_sprints
          : subtasks.filter((s) => s.is_completed).length;
      sprintCountEl.textContent = `${completed}/${total}`;

      subtasksListEl.innerHTML = "";
      subtasks.forEach((sub, idx) => {
        const itemEl = document.createElement("div");
        itemEl.className = `pinned-subtask-item ${sub.is_completed ? "is-completed" : ""}`;
        itemEl.innerHTML = `
          <label class="custom-checkbox" title="Tích chặng này">
            <input type="checkbox" class="pinned-sub-check" data-sub-id="${sub.id}" ${sub.is_completed ? "checked" : ""} />
            <span class="checkmark"></span>
          </label>
          <span class="pinned-subtask-name" title="${sub.title}">${idx + 1}. ${sub.title}</span>
          <span class="subtask-mini-time">${sub.estimated_minutes || 25}p</span>
        `;

        const subCheck = itemEl.querySelector(".pinned-sub-check");
        subCheck.addEventListener("change", async () => {
          await toggleSubtask(task.id, sub.id);
          pinTaskToHero(task);
          renderTaskList();
        });

        subtasksListEl.appendChild(itemEl);
      });
    } else {
      subtasksSection.style.display = "none";
    }
  }

  // Đồng bộ studioPinnedTask vào storage để Widget nổi trên Web nhận được
  chrome.storage.local.set({ studioPinnedTask: task }).catch(() => {});
}

async function toggleSubtask(taskId, subtaskId) {
  if (!currentAuth?.accessToken) return;

  const parentTask = allTasks.find((t) => t.id === taskId);
  if (parentTask && Array.isArray(parentTask.subtasks)) {
    const sub = parentTask.subtasks.find((s) => s.id === subtaskId);
    if (sub) {
      sub.is_completed = !sub.is_completed;
      parentTask.completed_sprints = parentTask.subtasks.filter((s) => s.is_completed).length;
      if (parentTask.completed_sprints === parentTask.subtasks.length) {
        parentTask.status = "completed";
      } else if (parentTask.status === "completed") {
        parentTask.status = "in_progress";
      }
    }
  }

  if (currentFocusTask?.id === taskId) {
    chrome.storage.local.set({ studioPinnedTask: parentTask || currentFocusTask }).catch(() => {});
  }

  try {
    const updatedSub = await api.patch(`/tasks/subtasks/${subtaskId}/toggle`, undefined);
    if (parentTask && Array.isArray(parentTask.subtasks)) {
      const sub = parentTask.subtasks.find((s) => s.id === subtaskId);
      if (sub) sub.is_completed = updatedSub.is_completed;
    }
  } catch (err) {
    console.error("Lỗi toggle subtask:", err);
  }
}

// Ghi việc mới cực nhanh (Optimistic update)
async function handleQuickAdd(title) {
  if (!currentAuth?.accessToken) {
    alert("Vui lòng kết nối tài khoản Stuđiô AI trước khi tạo việc.");
    return;
  }

  const apiBase = currentAuth.apiBase || "https://exe-studio.onrender.com";

  const tempTask = {
    id: `temp-${Date.now()}`,
    title,
    status: "pending",
  };
  allTasks.unshift(tempTask);
  currentFilter = "pending";
  document.querySelectorAll(".filter-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.filter === "pending");
  });
  renderTaskList();

  try {
    const created = await api.post("/tasks/", {
      title,
      priority: "high",
      status: "pending",
      duration_minutes: 30,
      source: "extension",
      description: "Ghi nhanh từ Stuđiô TaskPad",
    });
    tempTask.id = created.id;
    if (!currentFocusTask) {
      pinTaskToHero(created);
    }
    renderTaskList();
  } catch (err) {
    console.error("Lỗi tạo task:", err);
    await loadAllTasks();
  }
}

// Bắt tab hiện tại vào checklist
async function handleSaveCurrentTab() {
  if (!activeWebTab?.url || !currentAuth?.accessToken) return;

  const btn = document.getElementById("btnSaveCurrentTab");
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Đang lưu...";

  const apiBase = currentAuth.apiBase || "https://exe-studio.onrender.com";
  const title = `Nghiên cứu: ${(activeWebTab.title || "Tài liệu học").slice(0, 80)}`;

  try {
    await api.post("/tasks/", {
      title,
      description: `Nguồn thu thập: ${activeWebTab.url}`,
      source_url: activeWebTab.url,
      source_title: (activeWebTab.title || "").slice(0, 500),
      priority: "medium",
      duration_minutes: 30,
      source: "capture",
    });

    btn.textContent = "✓ Đã lưu!";
    await loadAllTasks();
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = oldText;
    }, 1500);
  } catch (err) {
    alert("Không thể lưu trang này.");
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

async function updateTaskStatus(taskId, status) {
  if (!currentAuth?.accessToken || taskId.startsWith("temp-")) return;
  try {
    await api.patch(`/tasks/${taskId}`, { status });
  } catch (e) {
    console.error("Lỗi update task:", e);
  }
}

async function deleteTask(taskId) {
  if (!currentAuth?.accessToken) return;

  allTasks = allTasks.filter((t) => t.id !== taskId);
  if (currentFocusTask?.id === taskId) {
    currentFocusTask = null;
    document.getElementById("pinnedTaskTitle").textContent = "Chọn 1 việc bên dưới để bắt đầu";
    document.getElementById("checkPinnedTask").checked = false;
  }
  renderTaskList();

  try {
    await api.delete(`/tasks/${taskId}`);
  } catch (e) {
    console.error("Lỗi xóa task:", e);
  }
}

// ================= 5. PHẦN SỔ GHI CHÉP (SMART NOTES & WEB CONTEXT) =================

// Tải danh sách ghi chú từ server
async function loadRecentNotes() {
  if (!currentAuth?.accessToken) return;

  try {
    const data = await api.get("/notes/");
    allNotes = Array.isArray(data?.notes) ? data.notes : [];
    renderNotesList();
  } catch (err) {
    console.error("Lỗi tải notes:", err);
  }
}

function renderNotesList() {
  const container = document.getElementById("recentNotesList");
  const badgeNotesCount = document.getElementById("badgeNotesCount");
  badgeNotesCount.textContent = allNotes.length;

  if (allNotes.length === 0) {
    container.innerHTML = '<div class="task-empty">Chưa có ghi chú nào. Hãy bắt đầu ghi chép ở trên!</div>';
    return;
  }

  container.innerHTML = "";
  allNotes.forEach((note) => {
    const item = document.createElement("div");
    item.className = "note-card-item";

    item.innerHTML = `
      <div class="note-card-top">
        <span class="note-card-title truncate" title="${note.title}">${note.title}</span>
        <button class="btn-task-action delete-note" data-id="${note.id}" title="Xóa ghi chú">🗑️</button>
      </div>
      <div class="note-card-content">${escapeHtml(note.content || "")}</div>
      <div class="note-card-actions">
        <button class="btn-note-to-task" data-id="${note.id}" title="Biến ghi chú này thành một Việc cần làm trong Checklist">
          ➔ Chuyển thành Task
        </button>
      </div>
    `;

    // Chuyển note thành Task
    item.querySelector(".btn-note-to-task").addEventListener("click", async () => {
      await convertNoteToTask(note);
    });

    // Xóa note
    item.querySelector(".delete-note").addEventListener("click", async () => {
      if (confirm(`Xóa ghi chú "${note.title}"?`)) {
        await deleteNote(note.id);
      }
    });

    container.appendChild(item);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Bắt mốc video từ tab hiện tại
async function handleGrabVideoTimestamp() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;
  const tab = tabs[0];

  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const video = document.querySelector("video");
        if (video && !isNaN(video.currentTime)) {
          const sec = Math.floor(video.currentTime);
          const mins = Math.floor(sec / 60);
          const secs = sec % 60;
          return {
            timeStr: `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`,
            seconds: sec,
            url: window.location.href,
          };
        }
        return null;
      },
    });

    const data = res?.[0]?.result;
    const contentArea = document.getElementById("noteContentInput");
    const titleInput = document.getElementById("noteTitleInput");

    if (data?.timeStr) {
      const videoLink = data.url.includes("youtube.com")
        ? `${data.url.split("&t=")[0]}&t=${data.seconds}s`
        : data.url;

      const tag = `[Mốc ${data.timeStr}](${videoLink}) `;
      contentArea.value = (contentArea.value ? contentArea.value + "\n" : "") + tag;
      contentArea.focus();

      if (!titleInput.value) {
        titleInput.value = `Ghi chú bài giảng: ${(tab.title || "Video").slice(0, 50)}`;
      }
      saveDraftNote();
    } else {
      alert("Không tìm thấy video nào đang chạy trên tab hiện tại.");
    }
  } catch {
    alert("Không thể đọc video trên trang này.");
  }
}

// Bắt đoạn chữ đang bôi đen trên trang web
async function handleGrabSelection() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;
  const tab = tabs[0];

  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString()?.trim() || "",
    });

    const selectedText = res?.[0]?.result;
    const contentArea = document.getElementById("noteContentInput");
    const titleInput = document.getElementById("noteTitleInput");

    if (selectedText) {
      const quote = `> "${selectedText}"\n(Nguồn: ${tab.title || tab.url})\n`;
      contentArea.value = (contentArea.value ? contentArea.value + "\n" : "") + quote;
      contentArea.focus();

      if (!titleInput.value) {
        titleInput.value = `Trích dẫn: ${(tab.title || "Tài liệu").slice(0, 50)}`;
      }
      saveDraftNote();
    } else {
      alert("Bạn chưa bôi đen (chọn) đoạn chữ nào trên trang web!");
    }
  } catch {
    alert("Không thể lấy văn bản từ trang web này.");
  }
}

// Lưu Ghi chú
async function handleSaveNote() {
  if (!currentAuth?.accessToken) {
    alert("Vui lòng kết nối tài khoản Stuđiô AI trước khi lưu ghi chú.");
    return;
  }

  const titleInput = document.getElementById("noteTitleInput");
  const contentArea = document.getElementById("noteContentInput");
  const saveBtn = document.getElementById("btnSaveNote");
  const statusEl = document.getElementById("noteSaveStatus");

  let title = titleInput.value.trim();
  const content = contentArea.value.trim();

  if (!content && !title) {
    alert("Vui lòng nhập nội dung hoặc tiêu đề ghi chú!");
    return;
  }

  if (!title) {
    title = activeWebTab?.title ? `Ghi chú: ${activeWebTab.title.slice(0, 50)}` : "Ghi chú học tập mới";
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Đang lưu...";

  try {
    await api.post("/notes/", { title, content });

    titleInput.value = "";
    contentArea.value = "";
    chrome.storage.local.remove("studioNoteDraft");
    statusEl.textContent = "✓ Đã lưu thành công lên Stuđiô!";
    setTimeout(() => {
      statusEl.textContent = "💡 Chuột phải trên web để note tức thì";
    }, 3000);
    await loadRecentNotes();
  } catch (err) {
    if (err?.code === "network_error" || err?.code === "timeout") {
      alert("Lỗi kết nối khi lưu ghi chú.");
    } else {
      alert("Không thể lưu ghi chú. Vui lòng thử lại.");
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "💾 Lưu ghi chú";
  }
}

// Biến Ghi chú thành Task trong Checklist
async function convertNoteToTask(note) {
  if (!currentAuth?.accessToken) return;

  const taskTitle = note.title;
  const description = note.content || "";

  try {
    await api.post("/tasks/", {
      title: taskTitle,
      description,
      priority: "high",
      status: "pending",
      duration_minutes: 30,
      source: "extension",
    });

    await loadAllTasks();
    // Chuyển sang tab Việc cần làm
    document.querySelector('.mode-btn[data-view="view-tasks"]').click();
  } catch (e) {
    alert("Không thể chuyển ghi chú thành việc cần làm.");
  }
}

async function deleteNote(noteId) {
  if (!currentAuth?.accessToken) return;

  allNotes = allNotes.filter((n) => n.id !== noteId);
  renderNotesList();

  try {
    await api.delete(`/notes/${noteId}`);
  } catch (e) {
    console.error("Lỗi xóa note:", e);
  }
}

// Lưu & Khôi phục nháp (Auto-save draft)
function saveDraftNote() {
  const title = document.getElementById("noteTitleInput").value;
  const content = document.getElementById("noteContentInput").value;
  chrome.storage.local.set({ studioNoteDraft: { title, content } });
}

async function restoreDraftNote() {
  const data = await chrome.storage.local.get("studioNoteDraft");
  if (data?.studioNoteDraft) {
    const { title, content } = data.studioNoteDraft;
    if (title) document.getElementById("noteTitleInput").value = title;
    if (content) document.getElementById("noteContentInput").value = content;
  }
}

// ================= 6. POMODORO TIMER =================
function updateTimerDisplay() {
  const mins = Math.floor(timerSecondsLeft / 60);
  const secs = timerSecondsLeft % 60;
  document.getElementById("timerDisplay").textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

async function toggleTimer() {
  const btn = document.getElementById("btnToggleTimer");
  if (isTimerRunning) {
    clearInterval(timerInterval);
    isTimerRunning = false;
    btn.textContent = "▶ Tiếp tục";
    btn.className = "btn-pill btn-pill-primary";
    chrome.runtime.sendMessage({ type: "studi:stop-timer" }).catch(() => {});
  } else {
    isTimerRunning = true;
    btn.textContent = "⏸ Tạm dừng";
    btn.className = "btn-pill btn-pill-subtle";

    const minsToRun = Math.ceil(timerSecondsLeft / 60);
    const taskName = currentFocusTask ? currentFocusTask.title : "Phiên học tập";
    chrome.runtime.sendMessage({
      type: "studi:start-timer",
      payload: { durationMinutes: minsToRun, taskTitle: taskName },
    }).catch(() => {});

    startLocalTimerDisplay();
  }
}

function startLocalTimerDisplay() {
  clearInterval(timerInterval);
  isTimerRunning = true;
  const btn = document.getElementById("btnToggleTimer");
  btn.textContent = "⏸ Tạm dừng";
  btn.className = "btn-pill btn-pill-subtle";

  timerInterval = setInterval(() => {
    if (timerSecondsLeft > 0) {
      timerSecondsLeft--;
      updateTimerDisplay();
    } else {
      clearInterval(timerInterval);
      isTimerRunning = false;
      btn.textContent = "▶ Bắt đầu";
      btn.className = "btn-pill btn-pill-primary";
      loadStoredData();
    }
  }, 1000);
}

function resetTimer() {
  clearInterval(timerInterval);
  isTimerRunning = false;
  timerSecondsLeft = timerMinutes * 60;
  updateTimerDisplay();
  const btn = document.getElementById("btnToggleTimer");
  btn.textContent = "▶ Bắt đầu";
  btn.className = "btn-pill btn-pill-primary";
  chrome.runtime.sendMessage({ type: "studi:stop-timer" }).catch(() => {});
}

// ================= 7. EVENT LISTENERS =================
function setupEventListeners() {
  // Chuyển Mode: Việc cần làm vs Sổ ghi chép
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view-panel").forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.dataset.view;
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add("active");
    });
  });

  // Auth
  document.getElementById("btnScanTabs")?.addEventListener("click", () => scanTabsAuth(true));
  document.getElementById("btnHeaderSync")?.addEventListener("click", () => {
    checkCurrentWebTab();
    scanTabsAuth(true);
  });
  document.getElementById("btnQuickDemo")?.addEventListener("click", handleDemoLogin);
  document.getElementById("formManualLogin")?.addEventListener("submit", handleManualLogin);
  document.getElementById("btnHeaderLogout")?.addEventListener("click", handleLogout);

  // Timer controls
  document.getElementById("btnToggleTimer").addEventListener("click", toggleTimer);
  document.getElementById("btnResetTimer").addEventListener("click", resetTimer);

  document.querySelectorAll(".preset-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isTimerRunning) return;
      document.querySelectorAll(".preset-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      timerMinutes = parseInt(btn.dataset.min, 10);
      timerSecondsLeft = timerMinutes * 60;
      updateTimerDisplay();
    });
  });

  // Tích gạch trên Hero Banner
  document.getElementById("checkPinnedTask").addEventListener("change", async (e) => {
    if (!currentFocusTask?.id) return;
    const isCompleted = e.target.checked;
    currentFocusTask.status = isCompleted ? "completed" : "in_progress";
    document.getElementById("pinnedTaskTitle").classList.toggle("completed", isCompleted);
    await updateTaskStatus(currentFocusTask.id, currentFocusTask.status);
    setTimeout(() => {
      renderTaskList();
    }, 300);
  });

  // Quick-Add Input (Enter hoặc click +)
  const quickInput = document.getElementById("quickAddInput");
  const quickAddSubmit = document.getElementById("btnQuickAddSubmit");

  const submitQuickAdd = async () => {
    const title = quickInput.value.trim();
    if (!title) return;
    quickInput.value = "";
    quickInput.focus();
    await handleQuickAdd(title);
  };

  quickInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      await submitQuickAdd();
    }
  });

  quickAddSubmit.addEventListener("click", submitQuickAdd);

  // Filter Tabs ("Cần làm" | "Đã xong")
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      renderTaskList();
    });
  });

  // Bắt tab hiện tại
  document.getElementById("btnSaveCurrentTab")?.addEventListener("click", handleSaveCurrentTab);

  // Sổ ghi chép: Web tools & Auto-save
  document.getElementById("btnGrabVideoTimestamp")?.addEventListener("click", handleGrabVideoTimestamp);
  document.getElementById("btnGrabSelection")?.addEventListener("click", handleGrabSelection);
  document.getElementById("btnSaveNote")?.addEventListener("click", handleSaveNote);
  document.getElementById("btnRefreshNotes")?.addEventListener("click", loadRecentNotes);

  document.getElementById("noteTitleInput")?.addEventListener("input", saveDraftNote);
  document.getElementById("noteContentInput")?.addEventListener("input", saveDraftNote);

  // Bật/tắt ghim TaskPad nổi ra ngoài trang web
  const toggleFloatingEl = document.getElementById("toggleFloatingWidget");
  if (toggleFloatingEl) {
    chrome.storage.local.get("studioFloatingPin", (data) => {
      toggleFloatingEl.checked = data?.studioFloatingPin?.enabled !== false;
    });
    toggleFloatingEl.addEventListener("change", (e) => {
      chrome.storage.local.set({
        studioFloatingPin: { enabled: e.target.checked },
      });
    });
  }

  // Lắng nghe thay đổi storage từ Floating Widget trên trang web (khi tích subtask)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.studioPinnedTask) {
      const updatedPinned = changes.studioPinnedTask.newValue;
      if (updatedPinned) {
        currentFocusTask = updatedPinned;
        pinTaskToHero(updatedPinned);
        const matchInList = allTasks.find((t) => t.id === updatedPinned.id);
        if (matchInList) {
          Object.assign(matchInList, updatedPinned);
          renderTaskList();
        }
      }
    }
  });
}
