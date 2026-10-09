/**
 * Stuđiô AI Companion - Auth Bridge (declared content script, Studio pages only).
 * Declared in manifest.json with NARROW matches (exe-studio / localhost:5173,8000),
 * so it auto-runs without any optional permission. Reads the web login tokens
 * from localStorage and forwards them to the background service worker.
 */

// Kiểm tra xem trang hiện tại có phải là Stuđiô AI Web App không
const isStudioWebApp =
  window.location.hostname.includes("exe-studio") ||
  (window.location.hostname === "localhost" && (window.location.port === "5173" || window.location.port === "8000")) ||
  (window.location.hostname === "127.0.0.1" && (window.location.port === "5173" || window.location.port === "8000"));

// ================= CẦU NỐI ĐĂNG NHẬP (TRÊN WEB STUĐIÔ) =================
if (isStudioWebApp) {
  function sendAuthToExtension() {
    try {
      const accessToken = localStorage.getItem("studi_access_token");
      const refreshToken = localStorage.getItem("studi_refresh_token");
      const userRaw = localStorage.getItem("studi_user");
      let user = null;
      if (userRaw) {
        try {
          user = JSON.parse(userRaw);
        } catch {}
      }

      if (accessToken) {
        chrome.runtime.sendMessage({
          type: "companion:auto-sync-auth",
          payload: {
            accessToken,
            refreshToken,
            user,
            apiBase: window.location.origin,
          },
        }).catch(() => {});
      }
    } catch (e) {}
  }

  sendAuthToExtension();
  setTimeout(sendAuthToExtension, 1000);
  setTimeout(sendAuthToExtension, 3000);
  setTimeout(sendAuthToExtension, 6000);

  window.addEventListener("storage", sendAuthToExtension);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type === "content:get-auth") {
      const accessToken = localStorage.getItem("studi_access_token");
      const refreshToken = localStorage.getItem("studi_refresh_token");
      const userRaw = localStorage.getItem("studi_user");
      let user = null;
      try {
        user = userRaw ? JSON.parse(userRaw) : null;
      } catch {}

      sendResponse({
        ok: true,
        auth: accessToken ? { accessToken, refreshToken, user, apiBase: window.location.origin } : null,
      });
      return true;
    }
  });
}
