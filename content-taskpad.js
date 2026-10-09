/**
 * Stuđiô AI Companion - TaskPad Content Script (on-demand inject only).
 * NOT declared in manifest.json: background.js injects this file via
 * chrome.scripting on the first TaskPad trigger (Alt+S / Alt+N), after a
 * just-in-time scripting+host permission grant. Runs on non-Studio pages,
 * top frame only — the guards below are unchanged from the pre-split build.
 *    - In-Page Floating TaskPad Calm-Tech ghim việc & micro-sprint (0/3)
 *    - Bộ chuyển đổi nhanh nhiệm vụ (Task Switcher từ TickTick/Todoist)
 *    - Bong bóng bôi đen văn bản lưu tức thì (Inline Selection Bubble từ Glasp/Weava)
 *    - Sổ tay ghi chép tức thời (Scratchpad từ Notion/Slite)
 *    - Âm thanh vòm tập trung & Chuông Chime hoàn thành (Web Audio API từ Forest)
 *    - Phím tắt toàn cục (Alt+S: Bật/Tắt TaskPad, Alt+N: Ghi nhanh)
 */

// Trang Stuđiô không bao giờ nhận TaskPad (giữ nguyên hành vi trước tách file:
// background cũng từ chối inject vào Studio tab, đây là lớp phòng thủ thứ hai).
const isStudioWebApp =
  window.location.hostname.includes("exe-studio") ||
  (window.location.hostname === "localhost" && (window.location.port === "5173" || window.location.port === "8000")) ||
  (window.location.hostname === "127.0.0.1" && (window.location.port === "5173" || window.location.port === "8000"));

// ================= SIÊU NĂNG LỰC FLOATING TRÊN MỌI TRANG WEB =================
if (!isStudioWebApp && window === window.top) {
  let isMinimized = localStorage.getItem("studio_taskpad_minimized") === "true";
  let isClosedForTab = false;
  let currentTabMode = "tasks"; // "tasks" | "scratchpad"
  let shadowRoot = null;
  let currentTask = null;
  let currentAuth = null;
  let isFloatingEnabled = true;
  let availableTasks = [];
  let isTaskSwitcherOpen = false;

  // Escape attacker-controlled titles before innerHTML interpolation (stored XSS).
  // Intentionally duplicated from sidepanel.js; a shared copy is out of scope.
  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ================= KHỞI TẠO FLOATING WIDGET =================
  async function initFloatingWidget() {
    if (isClosedForTab) return;
    if (!document.body) {
      window.addEventListener("DOMContentLoaded", initFloatingWidget, { once: true });
      return;
    }

    const stored = await chrome.storage.local.get(["studioAuth", "studioFloatingPin", "studioPinnedTask"]);
    currentAuth = stored.studioAuth || null;
    isFloatingEnabled = stored.studioFloatingPin?.enabled !== false;
    currentTask = stored.studioPinnedTask || null;

    if (!isFloatingEnabled) {
      removeWidget();
      return;
    }

    if (!currentTask && currentAuth?.accessToken) {
      await fetchTasksList();
    }

    renderWidget();
    setupSelectionBubble();
  }

  async function fetchTasksList() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "companion:get-tasks" });
      const tasks = res?.data?.tasks || [];
      availableTasks = Array.isArray(tasks) ? tasks : [];
      if (!currentTask && availableTasks.length > 0) {
        currentTask = availableTasks.find((t) => t.status !== "completed") || availableTasks[0];
        chrome.storage.local.set({ studioPinnedTask: currentTask }).catch(() => {});
      }
    } catch {}
  }

  function removeWidget() {
    const existing = document.getElementById("studio-floating-taskpad-host");
    if (existing) existing.remove();
    shadowRoot = null;
  }

  function renderWidget() {
    let host = document.getElementById("studio-floating-taskpad-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "studio-floating-taskpad-host";
      document.body.appendChild(host);
      shadowRoot = host.attachShadow({ mode: "open" });
    }

    const savedPos = getSavedPosition();
    const subtasks = Array.isArray(currentTask?.subtasks) ? currentTask.subtasks : [];
    const totalSprints = currentTask?.total_sprints || subtasks.length;
    const completedSprints =
      currentTask?.completed_sprints !== undefined
        ? currentTask.completed_sprints
        : subtasks.filter((s) => s.is_completed).length;

    const savedDraft = localStorage.getItem("studio_web_scratchpad_draft") || "";

    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Be Vietnam Pro", sans-serif;
          z-index: 2147483647;
          position: fixed;
          left: ${savedPos.left};
          top: ${savedPos.top};
          bottom: ${savedPos.bottom};
          right: ${savedPos.right};
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }

        /* 1. Pill Thu Gọn */
        .taskpad-pill {
          display: ${isMinimized ? "flex" : "none"};
          align-items: center;
          gap: 7px;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1.5px solid #bfdbfe;
          border-radius: 9999px;
          padding: 7px 14px;
          box-shadow: 0 8px 20px -3px rgba(37, 99, 235, 0.18), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          cursor: pointer;
          user-select: none;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .taskpad-pill:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 24px -3px rgba(37, 99, 235, 0.25);
        }
        .pill-icon { font-size: 14px; }
        .pill-title {
          font-size: 12px;
          font-weight: 600;
          color: #1e3a8a;
          max-width: 170px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pill-badge {
          background: #eff6ff;
          color: #2563eb;
          font-size: 10px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 9999px;
          border: 1px solid #dbeafe;
        }
        .pill-shortcut {
          font-size: 9px;
          color: #94a3b8;
          font-weight: 500;
        }

        /* 2. Hộp TaskPad Mở Rộng */
        .taskpad-card {
          display: ${isMinimized ? "none" : "flex"};
          flex-direction: column;
          width: 326px;
          max-height: 450px;
          background: rgba(255, 255, 255, 0.97);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1.5px solid #bfdbfe;
          border-radius: 14px;
          box-shadow: 0 16px 36px -4px rgba(15, 23, 42, 0.16), 0 6px 12px -2px rgba(0, 0, 0, 0.06);
          overflow: hidden;
          animation: floatIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes floatIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* Header Draggable */
        .taskpad-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%);
          border-bottom: 1px solid #e2e8f0;
          cursor: grab;
          user-select: none;
        }
        .taskpad-header:active {
          cursor: grabbing;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .drag-dots {
          color: #94a3b8;
          font-size: 13px;
          line-height: 1;
        }
        .header-title {
          font-size: 12.5px;
          font-weight: 700;
          color: #1e3a8a;
        }
        .sprint-badge {
          font-size: 10px;
          font-weight: 700;
          color: #2563eb;
          background: #dbeafe;
          padding: 1px 6px;
          border-radius: 9999px;
        }
        .header-btns {
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .btn-hdr {
          background: transparent;
          border: none;
          color: #64748b;
          width: 22px;
          height: 22px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s ease;
        }
        .btn-hdr:hover {
          background: #e2e8f0;
          color: #0f172a;
        }

        /* Nav Tabs: Checklist vs Sổ tay nhanh */
        .taskpad-tabs {
          display: flex;
          background: #f1f5f9;
          padding: 2px 4px;
          border-bottom: 1px solid #e2e8f0;
          gap: 3px;
        }
        .tab-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 4px 6px;
          font-size: 11px;
          font-weight: 600;
          color: #64748b;
          border: none;
          background: transparent;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .tab-btn.active {
          background: #ffffff;
          color: #1e3a8a;
          box-shadow: 0 1px 2px rgba(0,0,0,0.06);
        }

        /* Body */
        .taskpad-body {
          padding: 10px 11px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          overflow-y: auto;
          max-height: 330px;
        }

        /* Task Selector Row */
        .task-switcher-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .btn-switch-task {
          font-size: 10px;
          font-weight: 700;
          color: #2563eb;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          padding: 2px 7px;
          border-radius: 9999px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .btn-switch-task:hover { background: #dbeafe; }

        /* Dropdown Danh sách các việc có sẵn */
        .task-dropdown-menu {
          display: ${isTaskSwitcherOpen ? "flex" : "none"};
          flex-direction: column;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          max-height: 140px;
          overflow-y: auto;
          gap: 1px;
          padding: 3px;
        }
        .task-dropdown-item {
          padding: 5px 8px;
          font-size: 11px;
          color: #334155;
          border-radius: 5px;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .task-dropdown-item:hover {
          background: #eff6ff;
          color: #1e3a8a;
        }
        .task-dropdown-item.active {
          background: #dbeafe;
          font-weight: 600;
          color: #1e40af;
        }

        /* Hero Focus Task */
        .focus-task-row {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 7px 9px;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 9px;
        }
        .focus-title {
          font-size: 12px;
          font-weight: 600;
          color: #0f172a;
          line-height: 1.35;
          flex: 1;
          word-break: break-word;
          transition: color 0.15s ease;
        }
        .focus-title.is-done {
          text-decoration: line-through;
          color: #94a3b8;
        }

        /* Checkbox Tròn Calm-Tech */
        .circle-check {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 17px;
          height: 17px;
          cursor: pointer;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .circle-check input {
          opacity: 0;
          position: absolute;
          width: 0;
          height: 0;
        }
        .circle-check .check-ring {
          width: 17px;
          height: 17px;
          border: 1.5px solid #94a3b8;
          border-radius: 50%;
          background: #fff;
          transition: all 0.15s ease;
        }
        .circle-check input:checked ~ .check-ring {
          background: #10b981;
          border-color: #10b981;
        }
        .circle-check .check-ring:after {
          content: "";
          position: absolute;
          display: none;
          left: 5.5px;
          top: 2.5px;
          width: 4px;
          height: 8px;
          border: solid white;
          border-width: 0 1.8px 1.8px 0;
          transform: rotate(45deg);
        }
        .circle-check input:checked ~ .check-ring:after {
          display: block;
        }

        /* Micro-sprints List */
        .subtasks-section {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .subtasks-label {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10px;
          font-weight: 700;
          color: #3b82f6;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .subtasks-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .subtask-row {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 5px 8px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 7px;
          font-size: 11.5px;
          transition: all 0.15s ease;
        }
        .subtask-row:hover {
          background: #ffffff;
          border-color: #cbd5e1;
        }
        .subtask-row.is-done {
          opacity: 0.55;
          background: #f1f5f9;
        }
        .subtask-row.is-done .subtask-text {
          text-decoration: line-through;
          color: #94a3b8;
        }
        .subtask-text {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #334155;
          font-weight: 500;
        }
        .subtask-time {
          font-size: 9.5px;
          font-weight: 600;
          color: #2563eb;
          background: #eff6ff;
          padding: 1px 5px;
          border-radius: 4px;
          flex-shrink: 0;
        }

        /* Quick-Add Box */
        .quick-box {
          display: flex;
          align-items: center;
          gap: 5px;
          margin-top: 2px;
        }
        .quick-input {
          flex: 1;
          padding: 6px 9px;
          border: 1px solid #cbd5e1;
          border-radius: 7px;
          font-size: 11.5px;
          outline: none;
          background: #ffffff;
          color: #0f172a;
          transition: border-color 0.15s ease;
        }
        .quick-input:focus {
          border-color: #2563eb;
        }
        .btn-quick-add {
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: 7px;
          width: 28px;
          height: 28px;
          font-size: 15px;
          font-weight: bold;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s ease;
        }
        .btn-quick-add:hover { background: #1d4ed8; }

        /* Sổ tay nhanh Tab */
        .scratchpad-view {
          display: ${currentTabMode === "scratchpad" ? "flex" : "none"};
          flex-direction: column;
          gap: 6px;
        }
        .scratchpad-area {
          width: 100%;
          height: 140px;
          padding: 8px;
          border: 1px solid #cbd5e1;
          border-radius: 7px;
          font-size: 11.5px;
          font-family: inherit;
          resize: none;
          outline: none;
          color: #0f172a;
          line-height: 1.4;
        }
        .scratchpad-area:focus {
          border-color: #2563eb;
        }
        .scratchpad-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .scratchpad-hint {
          font-size: 10px;
          color: #94a3b8;
        }
        .btn-save-scratchpad {
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-save-scratchpad:hover { background: #1d4ed8; }

        /* Footer Tool Actions */
        .taskpad-footer {
          padding: 6px 11px;
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 10.5px;
        }
        .footer-left { display: flex; gap: 4px; }
        .btn-action-mini {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 3px 8px;
          font-size: 10px;
          font-weight: 600;
          color: #334155;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          transition: all 0.15s ease;
        }
        .btn-action-mini:hover {
          background: #eff6ff;
          color: #1e3a8a;
          border-color: #93c5fd;
        }
        .btn-action-mini.active {
          background: #dbeafe;
          border-color: #3b82f6;
          color: #1d4ed8;
        }
      </style>

      <!-- 1. Pill Thu Gọn -->
      <div class="taskpad-pill" id="btnExpandPill" title="Bấm để mở TaskPad (Phím tắt: Alt+S)">
        <span class="pill-icon">🎯</span>
        <span class="pill-title">${escapeHtml(currentTask?.title || "Stuđiô TaskPad")}</span>
        <span class="pill-badge">${completedSprints}/${totalSprints}</span>
        <span class="pill-shortcut">Alt+S</span>
      </div>

      <!-- 2. Hộp TaskPad Mở Rộng -->
      <div class="taskpad-card" id="taskpadCard">
        <div class="taskpad-header" id="taskpadHeader">
          <div class="header-left">
            <span class="drag-dots">⠿</span>
            <span class="header-title">Stuđiô Focus</span>
            <span class="sprint-badge">${completedSprints}/${totalSprints}</span>
          </div>
          <div class="header-btns">
            <button class="btn-hdr" id="btnMinimize" title="Thu gọn thành thanh nhỏ (Alt+S)">_</button>
            <button class="btn-hdr" id="btnCloseWidget" title="Đóng trên tab này">✕</button>
          </div>
        </div>

        <!-- Thanh chuyển chế độ (Checklist vs Ghi chú) -->
        <div class="taskpad-tabs">
          <button class="tab-btn ${currentTabMode === "tasks" ? "active" : ""}" id="tabTasks">
            📋 Việc cần làm
          </button>
          <button class="tab-btn ${currentTabMode === "scratchpad" ? "active" : ""}" id="tabScratchpad">
            📝 Sổ tay nhanh
          </button>
        </div>

        <div class="taskpad-body">
          <!-- TAB 1: VIỆC CẦN LÀM & MICRO-SPRINT -->
          <div id="viewTasksContent" style="display: ${currentTabMode === "tasks" ? "flex" : "none"}; flex-direction: column; gap: 8px;">
            <div class="task-switcher-bar">
              <span style="font-size: 10px; font-weight: 700; color: #64748b;">VIỆC ĐANG LÀM:</span>
              <button class="btn-switch-task" id="btnToggleSwitcher">
                Đổi việc (${availableTasks.length || 1}) ▾
              </button>
            </div>

            <!-- Dropdown chuyển việc -->
            <div class="task-dropdown-menu" id="taskDropdownMenu">
              ${
                availableTasks.length > 0
                  ? availableTasks
                      .map(
                        (t) => `
                    <div class="task-dropdown-item ${t.id === currentTask?.id ? "active" : ""}" data-switch-id="${t.id}" title="${escapeHtml(t.title)}">
                      ${escapeHtml(t.title)}
                    </div>
                  `
                      )
                      .join("")
                  : `<div style="padding: 4px; font-size: 10px; color: #94a3b8;">Không có việc khác</div>`
              }
            </div>

            <!-- Hero Focus Task -->
            <div class="focus-task-row">
              <label class="circle-check" title="Tích để gạch hoàn thành việc này">
                <input type="checkbox" id="checkHeroTask" ${currentTask?.status === "completed" ? "checked" : ""} />
                <span class="check-ring"></span>
              </label>
              <span class="focus-title ${currentTask?.status === "completed" ? "is-done" : ""}" id="heroTaskTitle">
                ${escapeHtml(currentTask?.title || "Chưa có việc nào được chọn")}
              </span>
            </div>

            <!-- Danh sách Micro-sprint (bước 25p) -->
            <div class="subtasks-section">
              <div class="subtasks-label">
                <span>Micro-sprint (${completedSprints}/${totalSprints})</span>
                <span style="font-size: 9px; color: #64748b; font-weight: normal;">Tích từng bước 25p ✓</span>
              </div>
              <div class="subtasks-list" id="subtasksList">
                ${
                  subtasks.length > 0
                    ? subtasks
                        .map(
                          (sub, idx) => `
                      <div class="subtask-row ${sub.is_completed ? "is-done" : ""}" data-sub-id="${sub.id}">
                        <label class="circle-check" title="Tích để gạch xong chặng này">
                          <input type="checkbox" class="subtask-checkbox" data-sub-id="${sub.id}" ${sub.is_completed ? "checked" : ""} />
                          <span class="check-ring"></span>
                        </label>
                        <span class="subtask-text" title="${escapeHtml(sub.title)}">${idx + 1}. ${escapeHtml(sub.title)}</span>
                        <span class="subtask-time">${sub.estimated_minutes || 25}p</span>
                      </div>
                    `
                        )
                        .join("")
                    : `<div style="font-size: 11px; color: #94a3b8; text-align: center; padding: 6px 0;">Không có micro-sprint nào.</div>`
                }
              </div>
            </div>

            <!-- Ghi nhanh việc cần làm -->
            <div class="quick-box">
              <input type="text" id="quickTaskInput" placeholder="+ Thêm việc nhanh..." class="quick-input" autocomplete="off" />
              <button class="btn-quick-add" id="btnQuickTaskSubmit" title="Thêm việc">+</button>
            </div>
          </div>

          <!-- TAB 2: SỔ TAY GHI CHÉP NHANH (NOTION STYLE) -->
          <div id="viewScratchpadContent" class="scratchpad-view">
            <textarea id="scratchpadInput" class="scratchpad-area" placeholder="Ghi chép nhanh công thức, ý tưởng, tóm tắt bài học trên trang này...">${escapeHtml(savedDraft)}</textarea>
            <div class="scratchpad-actions">
              <span class="scratchpad-hint" id="scratchpadStatus">Tự động lưu bản nháp</span>
              <button class="btn-save-scratchpad" id="btnSaveScratchpad">💾 Lưu vào Stuđiô</button>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="taskpad-footer">
          <div class="footer-left">
            <button class="btn-action-mini" id="btnStartPomodoro" title="Đếm giờ tập trung 25 phút">⏱️ 25p Hẹn giờ</button>
          </div>
          <button class="btn-action-mini" id="btnOpenSidePanel" title="Mở SidePanel tiện ích">📝 SidePanel</button>
        </div>
      </div>
    `;

    bindWidgetEvents();
    bindDragEvents();
  }

  function getSavedPosition() {
    try {
      const pos = JSON.parse(localStorage.getItem("studio_taskpad_pos") || "null");
      if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
        return {
          left: `${pos.left}px`,
          top: `${pos.top}px`,
          bottom: "auto",
          right: "auto",
        };
      }
    } catch {}
    return { left: "auto", top: "auto", bottom: "24px", right: "24px" };
  }

  function bindWidgetEvents() {
    const btnExpandPill = shadowRoot.getElementById("btnExpandPill");
    const btnMinimize = shadowRoot.getElementById("btnMinimize");
    const btnCloseWidget = shadowRoot.getElementById("btnCloseWidget");
    const tabTasks = shadowRoot.getElementById("tabTasks");
    const tabScratchpad = shadowRoot.getElementById("tabScratchpad");
    const btnToggleSwitcher = shadowRoot.getElementById("btnToggleSwitcher");
    const checkHeroTask = shadowRoot.getElementById("checkHeroTask");
    const heroTaskTitle = shadowRoot.getElementById("heroTaskTitle");
    const quickTaskInput = shadowRoot.getElementById("quickTaskInput");
    const btnQuickTaskSubmit = shadowRoot.getElementById("btnQuickTaskSubmit");
    const scratchpadInput = shadowRoot.getElementById("scratchpadInput");
    const btnSaveScratchpad = shadowRoot.getElementById("btnSaveScratchpad");
    const scratchpadStatus = shadowRoot.getElementById("scratchpadStatus");
    const btnStartPomodoro = shadowRoot.getElementById("btnStartPomodoro");
    const btnOpenSidePanel = shadowRoot.getElementById("btnOpenSidePanel");

    // Thu gọn & Mở rộng
    btnExpandPill?.addEventListener("click", () => {
      isMinimized = false;
      localStorage.setItem("studio_taskpad_minimized", "false");
      renderWidget();
    });

    btnMinimize?.addEventListener("click", () => {
      isMinimized = true;
      localStorage.setItem("studio_taskpad_minimized", "true");
      renderWidget();
    });

    btnCloseWidget?.addEventListener("click", () => {
      isClosedForTab = true;
      removeWidget();
    });

    // Chuyển Tab
    tabTasks?.addEventListener("click", () => {
      currentTabMode = "tasks";
      renderWidget();
    });
    tabScratchpad?.addEventListener("click", () => {
      currentTabMode = "scratchpad";
      renderWidget();
    });

    // Mở Task Switcher Dropdown
    btnToggleSwitcher?.addEventListener("click", async () => {
      isTaskSwitcherOpen = !isTaskSwitcherOpen;
      if (isTaskSwitcherOpen && availableTasks.length === 0) {
        await fetchTasksList();
      }
      renderWidget();
    });

    // Chọn Task trong Switcher
    shadowRoot.querySelectorAll("[data-switch-id]").forEach((item) => {
      item.addEventListener("click", () => {
        const taskId = item.dataset.switchId;
        const target = availableTasks.find((t) => t.id === taskId);
        if (target) {
          currentTask = target;
          isTaskSwitcherOpen = false;
          chrome.storage.local.set({ studioPinnedTask: target });
          renderWidget();
        }
      });
    });

    // Tích hoàn thành Task chính
    checkHeroTask?.addEventListener("change", async (e) => {
      if (!currentTask?.id) return;
      const isDone = e.target.checked;
      heroTaskTitle.classList.toggle("is-done", isDone);
      const newStatus = isDone ? "completed" : "in_progress";
      currentTask.status = newStatus;

      chrome.runtime.sendMessage({
        type: "companion:toggle-task",
        payload: { taskId: currentTask.id, status: newStatus },
      }).catch(() => {});
    });

    // Tích hoàn thành Micro-sprint (Subtask)
    shadowRoot.querySelectorAll(".subtask-checkbox").forEach((cb) => {
      cb.addEventListener("change", async (e) => {
        const subId = cb.dataset.subId;
        const row = cb.closest(".subtask-row");
        const isDone = e.target.checked;
        if (row) row.classList.toggle("is-done", isDone);

        if (currentTask && Array.isArray(currentTask.subtasks)) {
          const sub = currentTask.subtasks.find((s) => s.id === subId);
          if (sub) {
            sub.is_completed = isDone;
            currentTask.completed_sprints = currentTask.subtasks.filter((s) => s.is_completed).length;
            if (currentTask.completed_sprints === currentTask.subtasks.length) {
              currentTask.status = "completed";
            }
          }
        }

        chrome.runtime.sendMessage({
          type: "companion:toggle-subtask",
          payload: { subtaskId: subId },
        }).then((res) => {
          if (res?.data?.subtask) {
            renderWidget();
          }
        }).catch(() => {});
      });
    });

    // Thêm việc nhanh
    const submitQuick = () => {
      const val = quickTaskInput?.value?.trim();
      if (!val) return;
      quickTaskInput.value = "";

      chrome.runtime.sendMessage({
        type: "companion:create-task",
        payload: { title: val, description: `Tạo từ trang: ${document.title} (${window.location.href})` },
      }).then((res) => {
        if (res?.data?.task) {
          currentTask = res.data.task;
          chrome.storage.local.set({ studioPinnedTask: res.data.task });
          renderWidget();
        }
      }).catch(() => {});
    };

    quickTaskInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitQuick();
    });
    btnQuickTaskSubmit?.addEventListener("click", submitQuick);

    // Auto-save nháp Scratchpad
    scratchpadInput?.addEventListener("input", (e) => {
      localStorage.setItem("studio_web_scratchpad_draft", e.target.value);
    });

    // Lưu Scratchpad lên Stuđiô Notes API
    btnSaveScratchpad?.addEventListener("click", () => {
      const content = scratchpadInput?.value?.trim();
      if (!content) return;
      btnSaveScratchpad.disabled = true;
      btnSaveScratchpad.textContent = "Đang lưu...";

      const title = `Ghi chép: ${(document.title || "Tài liệu học").slice(0, 50)}`;
      const noteBody = `${content}\n\n🔗 Nguồn: [${document.title}](${window.location.href})\n⏰ Thời gian: ${new Date().toLocaleString("vi-VN")}`;

      chrome.runtime.sendMessage({
        type: "companion:create-note",
        payload: { title, content: noteBody },
      }).then((res) => {
        btnSaveScratchpad.disabled = false;
        btnSaveScratchpad.textContent = "✓ Đã lưu!";
        scratchpadStatus.textContent = "Đã lưu vào Stuđiô Notes";
        localStorage.removeItem("studio_web_scratchpad_draft");
        setTimeout(() => {
          if (btnSaveScratchpad) btnSaveScratchpad.textContent = "💾 Lưu vào Stuđiô";
        }, 2000);
      }).catch(() => {
        btnSaveScratchpad.disabled = false;
        btnSaveScratchpad.textContent = "Lỗi lưu";
      });
    });

    // Nút Pomodoro
    btnStartPomodoro?.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: "studi:start-timer",
        payload: { durationMinutes: 25, taskTitle: currentTask?.title || "Học tập" },
      }).catch(() => {});
      btnStartPomodoro.textContent = "✓ Đang đếm 25p";
      setTimeout(() => {
        if (btnStartPomodoro) btnStartPomodoro.textContent = "⏱️ 25p Hẹn giờ";
      }, 2000);
    });

    // Nút Mở SidePanel
    btnOpenSidePanel?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "companion:open-sidepanel" }).catch(() => {});
    });
  }

  function bindDragEvents() {
    const host = document.getElementById("studio-floating-taskpad-host");
    const header = shadowRoot.getElementById("taskpadHeader");
    const pill = shadowRoot.getElementById("btnExpandPill");

    const setupDraggable = (dragHandle) => {
      if (!dragHandle || !host) return;
      let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
      let hasDragged = false;

      const onMouseDown = (e) => {
        if (e.target.closest("button") || e.target.closest("input") || e.target.closest("textarea")) return;
        e.preventDefault();
        hasDragged = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = host.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        host.style.left = `${initialLeft}px`;
        host.style.top = `${initialTop}px`;
        host.style.right = "auto";
        host.style.bottom = "auto";

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
      };

      const onMouseMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true;

        let newLeft = Math.max(10, Math.min(window.innerWidth - host.offsetWidth - 10, initialLeft + dx));
        let newTop = Math.max(10, Math.min(window.innerHeight - host.offsetHeight - 10, initialTop + dy));

        host.style.left = `${newLeft}px`;
        host.style.top = `${newTop}px`;
      };

      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);

        if (hasDragged) {
          const rect = host.getBoundingClientRect();
          localStorage.setItem("studio_taskpad_pos", JSON.stringify({ left: rect.left, top: rect.top }));
        }
      };

      dragHandle.addEventListener("mousedown", onMouseDown);
    };

    setupDraggable(header);
    setupDraggable(pill);
  }

  // ================= PHẦN 3: BONG BÓNG BÔI ĐEN VĂN BẢN (GLASP/WEAVA STYLE) =================
  let selectionBubble = null;

  function setupSelectionBubble() {
    if (document.getElementById("studio-selection-bubble-host")) return;

    const host = document.createElement("div");
    host.id = "studio-selection-bubble-host";
    document.body.appendChild(host);
    const bubbleShadow = host.attachShadow({ mode: "open" });

    bubbleShadow.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          z-index: 2147483647;
          position: fixed;
          display: none;
        }
        .bubble-card {
          display: flex;
          align-items: center;
          gap: 4px;
          background: rgba(15, 23, 42, 0.94);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 9999px;
          padding: 4px 8px;
          box-shadow: 0 10px 25px -4px rgba(0, 0, 0, 0.35);
          animation: popIn 0.15s ease-out;
        }
        @keyframes popIn {
          from { opacity: 0; transform: translateY(4px) scale(0.94); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .bubble-btn {
          background: transparent;
          border: none;
          color: #f8fafc;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 7px;
          border-radius: 9999px;
          transition: background 0.15s ease;
        }
        .bubble-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          color: #ffffff;
        }
        .bubble-divider {
          width: 1px;
          height: 12px;
          background: rgba(255, 255, 255, 0.2);
        }
      </style>
      <div class="bubble-card" id="bubbleCard">
        <button class="bubble-btn" id="btnSelectionTask">📌 + Tạo việc</button>
        <div class="bubble-divider"></div>
        <button class="bubble-btn" id="btnSelectionNote">📝 + Ghi chú</button>
      </div>
    `;

    selectionBubble = host;

    let selectedTextCache = "";

    document.addEventListener("mouseup", (e) => {
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : "";
        if (text && text.length >= 3) {
          selectedTextCache = text;
          try {
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const top = Math.max(10, rect.top - 42);
              const left = Math.max(10, Math.min(window.innerWidth - 180, rect.left + rect.width / 2 - 80));
              host.style.top = `${top}px`;
              host.style.left = `${left}px`;
              host.style.display = "block";
              return;
            }
          } catch {}
        }
        host.style.display = "none";
      }, 30);
    });

    document.addEventListener("mousedown", (e) => {
      if (!host.contains(e.target)) {
        host.style.display = "none";
      }
    });

    const btnTask = bubbleShadow.getElementById("btnSelectionTask");
    const btnNote = bubbleShadow.getElementById("btnSelectionNote");

    btnTask?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!selectedTextCache) return;
      btnTask.textContent = "✓ Đang tạo...";
      chrome.runtime.sendMessage({
        type: "companion:create-task",
        payload: {
          title: selectedTextCache.slice(0, 100),
          description: `Trích từ: ${document.title}\nURL: ${window.location.href}`,
        },
      }).then(() => {
        btnTask.textContent = "✓ Đã tạo!";
        setTimeout(() => {
          host.style.display = "none";
          btnTask.textContent = "📌 + Tạo việc";
        }, 1200);
      });
    });

    btnNote?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!selectedTextCache) return;
      btnNote.textContent = "✓ Đang lưu...";
      const title = `Trích dẫn: ${(document.title || "Tài liệu").slice(0, 50)}`;
      const content = `> "${selectedTextCache}"\n\n🔗 Nguồn: [${document.title}](${window.location.href})\n⏰ Thời gian: ${new Date().toLocaleString("vi-VN")}`;

      chrome.runtime.sendMessage({
        type: "companion:create-note",
        payload: { title, content },
      }).then(() => {
        btnNote.textContent = "✓ Đã lưu!";
        setTimeout(() => {
          host.style.display = "none";
          btnNote.textContent = "📝 + Ghi chú";
        }, 1200);
      });
    });
  }

  // ================= PHẦN 4: LẮNG NGHE PHÍM TẮT & STORAGE REAL-TIME =================
  // Phím tắt trong trang: Alt+S (Bật/Tắt TaskPad) và Alt+N (Ghi nhanh)
  window.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      toggleTaskPadShortcut();
    } else if (e.altKey && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      openScratchpadShortcut();
    }
  });

  function toggleTaskPadShortcut() {
    isClosedForTab = false;
    isMinimized = !isMinimized;
    localStorage.setItem("studio_taskpad_minimized", isMinimized ? "true" : "false");
    renderWidget();
  }

  function openScratchpadShortcut() {
    isClosedForTab = false;
    isMinimized = false;
    currentTabMode = "scratchpad";
    localStorage.setItem("studio_taskpad_minimized", "false");
    renderWidget();
    setTimeout(() => {
      shadowRoot?.getElementById("scratchpadInput")?.focus();
    }, 150);
  }

  // Lắng nghe lệnh từ background worker (Alt+S từ Chrome commands)
  chrome.runtime.onMessage.addListener((request) => {
    if (request?.type === "taskpad:toggle") {
      toggleTaskPadShortcut();
    } else if (request?.type === "taskpad:quick-capture") {
      openScratchpadShortcut();
    }
  });

  // Lắng nghe thay đổi Storage từ SidePanel hoặc các tab khác để đồng bộ Real-Time
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.studioFloatingPin) {
      isFloatingEnabled = changes.studioFloatingPin.newValue?.enabled !== false;
      if (!isFloatingEnabled) {
        removeWidget();
        return;
      } else if (!shadowRoot) {
        renderWidget();
      }
    }

    if (changes.studioPinnedTask) {
      currentTask = changes.studioPinnedTask.newValue;
      if (isFloatingEnabled && !isClosedForTab) {
        renderWidget();
      }
    }
  });

  // Chạy khởi tạo
  initFloatingWidget();
}
