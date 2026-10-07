// Only bounded lesson identifiers and states are retained; never task text or browsing data.
export const LEARNING_KEY = "studioLearningGuide";
const copy = (en, vi) => ({ en, vi });
export const LEARNING_TOPICS = [
  { id: "basics", view: "today", title: copy("Your first focus", "Bắt đầu tập trung"), steps: [
    { id: "basics.add", target: "#quick-task", title: copy("Add one thing to do", "Thêm một việc cần làm"), body: copy("A title is enough to add a task here. Tags, deadlines and AI can wait. This tour only explains the controls; you do not need to create a task to continue.", "Chỉ cần tiêu đề để thêm việc tại đây. Có thể thêm nhãn, hạn chót và AI sau. Hướng dẫn chỉ giải thích điều khiển; không cần tạo việc để tiếp tục.") },
    { id: "basics.focus", target: ".focus-hero", title: copy("Start when you are ready", "Bắt đầu khi sẵn sàng"), body: copy("Here is one suggested next task. Choose another if it does not fit, set a comfortable duration, then Start focus when ready. Pause or end whenever needed. Starting a timer does not complete the task.", "Đây là một việc được gợi ý tiếp theo. Chọn việc khác nếu chưa phù hợp, đặt thời lượng rồi Bắt đầu tập trung khi sẵn sàng. Có thể dừng bất cứ lúc nào. Chạy bộ đếm không đánh dấu việc đã xong.") }
  ] },
  { id: "priorities", view: "plan", planView: "matrix", title: copy("Choose your priorities", "Chọn việc ưu tiên"), steps: [
    { id: "priorities.sort", target: "[data-quadrant-task]", title: copy("Decide what matters", "Chọn việc quan trọng"), body: copy("Use a task's quadrant selector to choose its importance and urgency. Needs sorting is a safe place for undecided tasks. Automatic sorting stays optional.", "Dùng ô phân loại của từng việc để chọn mức quan trọng và khẩn cấp. Có thể giữ việc ở Chưa phân loại nếu chưa quyết định. Tự phân loại là tùy chọn.") },
    { id: "priorities.budget", target: "#budget-minutes", title: copy("Leave room in today", "Chừa thời gian cho hôm nay"), body: copy("Set the time you want to make available today. Pick tasks for today to compare their estimates with that budget. Picking a task does not schedule it or start a timer.", "Đặt quỹ thời gian muốn dành cho hôm nay. Chọn việc cho hôm nay để so sánh thời lượng ước tính với quỹ này. Chọn việc không tự xếp lịch hay chạy bộ đếm.") }
  ] },
  { id: "schedule", view: "plan", planView: "schedule", title: copy("Shape your schedule", "Sắp xếp lịch"), steps: [
    { id: "schedule.propose", target: '[data-action="propose-schedule"]', title: copy("Try a local proposal", "Thử đề xuất lịch cục bộ"), body: copy("Propose schedule prepares a draft using your open tasks and available time. No AI connection is needed. You can read this tour without generating a proposal.", "Đề xuất lịch tạo bản nháp từ việc đang mở và thời gian có sẵn. Không cần AI. Có thể đọc hướng dẫn mà không tạo đề xuất.") },
    { id: "schedule.review", target: '[data-action="apply-proposal"]', title: copy("Review before applying", "Kiểm tra trước khi áp dụng"), body: copy("Check the proposed times and any tasks that could not fit. Apply proposal commits the blocks; Dismiss leaves the schedule unchanged. Reading this tip never applies anything.", "Kiểm tra giờ đề xuất và các việc chưa xếp được. Áp dụng đề xuất mới thêm các phiên vào lịch; Bỏ qua giữ nguyên lịch. Đọc hướng dẫn không tự áp dụng thay đổi.") }
  ] },
  { id: "activity", view: "activity", title: copy("Understand browser activity", "Hiểu hoạt động trình duyệt"), steps: [
    { id: "activity.control", target: ".activity-settings summary", title: copy("You choose what is recorded", "Tự chọn dữ liệu được ghi"), body: copy("Open Tracking settings to review optional session tracking. Enabling it requests tabs and idle access. Titles, media signals, and AI have separate choices. You can learn this feature while leaving it off.", "Mở Cài đặt ghi nhận để xem tùy chọn theo dõi phiên. Bật tính năng sẽ xin quyền thẻ và trạng thái không thao tác. Tiêu đề, tín hiệu media và AI có lựa chọn riêng. Có thể đọc hướng dẫn mà không bật ghi nhận.") },
    { id: "activity.estimates", target: "#activity-filter", title: copy("Read estimates as estimates", "Hiểu đúng số liệu ước tính"), body: copy("Switch between summaries and sessions to inspect recorded time. Reading and media signals cannot prove attention. Review labels only when useful; unlabeled sessions can remain as they are.", "Chuyển giữa tổng hợp và các phiên để xem thời gian đã ghi. Tín hiệu đọc hoặc media không chứng minh mức tập trung. Chỉ kiểm tra nhãn khi cần; không bắt buộc gán nhãn mọi phiên.") }
  ] },
  { id: "insights", view: "insights", title: copy("Review your progress", "Xem lại tiến độ"), steps: [
    { id: "insights.records", target: ".chart", title: copy("Notice the pattern", "Nhìn lại nhịp làm việc"), body: copy("These charts summarize timer-recorded focus, not estimated browser activity. Session completion and task completion are different. Gemini narration is optional and has its own disclosure.", "Biểu đồ tổng hợp thời gian từ bộ đếm, không phải hoạt động trình duyệt ước tính. Hoàn tất phiên khác với hoàn thành việc. Nhận xét Gemini là tùy chọn có giải thích dữ liệu riêng.") },
    { id: "insights.reflect", target: '[data-action="reflect"]', title: copy("Reflect when useful", "Suy ngẫm khi cần"), body: copy("Optional Gemini reflection sends the totals described here. You can review the chart locally and leave without requesting a reflection.", "Nhận xét Gemini tùy chọn gửi các tổng số được mô tả tại đây. Có thể xem biểu đồ trên máy rồi rời đi mà không yêu cầu nhận xét.") }
  ] },
  { id: "settings", view: "settings", title: copy("Explore optional help", "Khám phá hỗ trợ tùy chọn"), steps: [
    { id: "settings.ai", target: '[data-action="show-gemini-form"]', title: copy("Connect AI only if useful", "Chỉ kết nối AI khi cần"), body: copy("Gemini setup is here when you want it. Tasks, timers, and local scheduling already work without a key. Connecting and sending data require their normal explicit actions.", "Có thể thiết lập Gemini tại đây khi cần. Việc, bộ đếm và xếp lịch cục bộ vẫn dùng được khi không có khóa. Kết nối và gửi dữ liệu vẫn cần các thao tác xác nhận riêng.") },
    { id: "settings.privacy", target: '[data-action="open-privacy"]', title: copy("Find your privacy choices", "Tìm lựa chọn riêng tư"), body: copy("Privacy choices explains tracking, reminders, AI, and their permissions. Turning a feature off stops future use but does not erase earlier records. This guide changes none of those switches.", "Lựa chọn riêng tư giải thích ghi nhận, nhắc việc, AI và các quyền cần dùng. Tắt tính năng dừng sử dụng về sau nhưng không xóa dữ liệu đã ghi. Hướng dẫn không thay đổi các công tắc đó.") },
    { id: "settings.memory", target: "#memory-enabled", title: copy("Keep personalization deliberate", "Chủ động chọn cá nhân hóa"), body: copy("Custom instructions and saved memories have separate controls for use with Gemini. Save only what you want, review sharing, and keep learning off if you do not need it.", "Hướng dẫn cá nhân và ghi nhớ có điều khiển riêng cho việc dùng với Gemini. Chỉ lưu nội dung cần thiết, kiểm tra chia sẻ và giữ tính năng học ở trạng thái tắt nếu không cần.") }
  ] },
  { id: "privacy", view: "privacy", title: copy("Control optional features", "Kiểm soát tính năng tùy chọn"), steps: [
    { id: "privacy.choices", target: ".privacy-choice input", title: copy("Read before switching on", "Đọc trước khi bật"), body: copy("Each choice explains its purpose, data, and permissions. Keep any optional feature off, or change it later. Finishing a guide is not consent and grants no browser permission.", "Mỗi lựa chọn giải thích mục đích, dữ liệu và quyền cần dùng. Có thể giữ tính năng tùy chọn ở trạng thái tắt hoặc đổi sau. Hoàn tất hướng dẫn không phải đồng ý thu thập và không cấp quyền trình duyệt.") },
    { id: "privacy.ai", target: ".ai-policy-card", title: copy("AI has its own boundary", "AI có lựa chọn riêng"), body: copy("Local collection never enables AI sharing. AI starts in Only when I ask mode. Selected automatic features also need the automatic mode and share a daily limit.", "Thu thập trên máy không bật chia sẻ AI. AI bắt đầu ở chế độ Chỉ khi yêu cầu. Tính năng tự động đã chọn còn cần bật chế độ tự động và dùng chung giới hạn mỗi ngày.") }
  ] },
  { id: "kanban", view: "plan", planView: "kanban", title: copy("Explore the task board", "Khám phá bảng công việc"), steps: [
    { id: "kanban.flow", target: '[data-action="kanban-move"], [data-action="kanban-preview"], [data-action="kanban-ask-enable"]', title: copy("Move work at your pace", "Chuyển việc theo nhịp riêng"), body: copy("Kanban is optional. Preview it before enabling it. On an enabled board, change a task's stage with its controls. Board stages, scheduled time, and focus timers are separate.", "Kanban là tùy chọn. Có thể xem thử trước khi bật. Khi đã bật, dùng điều khiển của việc để đổi giai đoạn. Giai đoạn trên bảng, giờ đã xếp và bộ đếm tập trung là các phần riêng.") },
    { id: "kanban.limit", target: '[data-kanban-setting="wipLimit"]', title: copy("Keep work manageable", "Giữ lượng việc vừa sức"), body: copy("The work-in-progress limit is a reminder to finish before starting more. It is adjustable in Settings, and never blocks you from recording time.", "Giới hạn việc đang làm nhắc hoàn thành trước khi nhận thêm. Có thể chỉnh trong Cài đặt; giới hạn không cản việc ghi thời gian.") }
  ] },
  { id: "capture", view: "today", title: copy("Try Smart Capture", "Thử nhập nhanh thông minh"), steps: [
    { id: "capture.review", target: "#capture-input", title: copy("Capture, then review", "Nhập rồi kiểm tra"), body: copy("Write an intention here. Without Gemini, it becomes a manual draft. With Gemini, Interpret & review sends the submitted text to Google and prepares a draft. Check it before saving; this guide makes no AI call.", "Nhập ý định tại đây. Khi không có Gemini, nội dung trở thành bản nháp thủ công. Khi đã kết nối, Diễn giải và kiểm tra gửi nội dung đã nhập đến Google để tạo bản nháp. Kiểm tra trước khi lưu; hướng dẫn không gọi AI.") },
    { id: "capture.optional", target: ".omnibar", title: copy("Details can wait", "Có thể thêm chi tiết sau"), body: copy("Close capture to return to your screen. For a simple task, the title-only field on Today is enough. You never need AI or a complete plan to begin.", "Đóng nhập nhanh để trở về màn hình. Với việc đơn giản, chỉ cần ô tiêu đề ở Hôm nay. Không cần AI hay kế hoạch đầy đủ để bắt đầu.") }
  ] }
];

const topics = new Map(LEARNING_TOPICS.map(topic => [topic.id, topic]));
const steps = new Map(LEARNING_TOPICS.flatMap(topic => topic.steps.map(step => [step.id, step])));
export const learningTopic = id => topics.get(id) ?? null;
export function normalizeLearningGuide(value) {
  return {
    version: 2,
    enabled: value?.enabled !== false,
    steps: Object.fromEntries([...steps.keys()].filter(id => ["done", "skipped"].includes(value?.steps?.[id])).map(id => [id, value.steps[id]])),
    pausedTopics: LEARNING_TOPICS.filter(topic => Array.isArray(value?.pausedTopics) && value.pausedTopics.includes(topic.id)).map(topic => topic.id)
  };
}

export function initialLearningGuide(value) { return normalizeLearningGuide(value); }

export function learningContext(ui) {
  if (ui.learningTopic && topics.has(ui.learningTopic)) return ui.learningTopic;
  if (ui.omnibarOpen) return "capture";
  if (ui.view === "today") return "basics";
  if (ui.view === "plan") return ui.planView === "schedule" ? "schedule" : ui.planView === "kanban" ? "kanban" : "priorities";
  return topics.has(ui.view) ? ui.view : null;
}

export function currentLearningStep(guide, topicId, automatic = true) {
  if (!guide || automatic && (!guide.enabled || guide.pausedTopics.includes(topicId))) return null;
  return topics.get(topicId)?.steps.find(step => !guide.steps[step.id]) ?? null;
}

export function learningAction(value, action, options = {}) {
  const guide = normalizeLearningGuide(value);
  const topic = topics.get(options.topic), step = steps.get(options.step);
  if (action === "enabled") guide.enabled = options.enabled === true;
  else if (action === "event") return guide; // Older open panels cannot advance a tour through real actions.
  else if (action === "acknowledge" && step) guide.steps[step.id] = "done";
  else if (action === "skip" && step) guide.steps[step.id] = "skipped";
  else if (action === "pause" && topic) guide.pausedTopics = [...new Set([...guide.pausedTopics, topic.id])];
  else if (["resume", "replay"].includes(action) && topic) {
    guide.pausedTopics = guide.pausedTopics.filter(id => id !== topic.id);
    if (action === "replay") for (const item of topic.steps) delete guide.steps[item.id];
  } else throw new Error("Unknown guide action.");
  return guide;
}

export function learningEvents() { return []; }
