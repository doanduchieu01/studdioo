import { html, markup, msg, t, getLocale } from "./i18n.js";
import { escapeHtml, formatDay, formatTime, minutesLabel, safeDate } from "./core/utils.js";
import { kanbanItem, kanbanStage, kanbanWip, kanbanMetrics, kanbanSuggestion, canUndoKanban } from "./core/kanban.js";

const labels = { backlog: "Backlog", ready: "Ready", doing: "Doing", done: "Done" };
const reasons = { picked_today: "Picked for today", scheduled_today: "Scheduled today", timer_started: "Task timer started", urgent: "Urgent by choice or deadline", important: "Important in Eisenhower", high_priority: "High task priority", oldest_ready: "Waiting in Ready longest" };

function rules() {
  return html`<details class="mini-disclosure"><summary>Automation rules</summary><ul>
    <li>Picked tasks and today's upcoming blocks: Backlog → Ready.</li>
    <li>A new task timer: Ready or Backlog → Doing. No old starts are imported.</li>
    <li>Timers may exceed the soft WIP limit; the extra work stays visible.</li>
    <li>Manual moves and Undo pause automation for that task until allowed again.</li>
    <li>Blocked work stays in Doing. Nothing automatically unblocks or completes it.</li>
    <li>Removing a pick, a missed block or midnight never moves work backwards.</li>
    <li>Suggestions rank Ready tasks by today's block, urgency, importance, high priority, then time waiting. Ties use earlier block/deadline, then time waiting.</li>
    <li>Aging hints use elapsed time, not focus time. Weekly review appears here after seven days, not as a notification.</li>
  </ul><p class="field-help">Runs on app changes and reopening. No AI, new permissions, task creation, timer starts, priority changes or automatic completion.</p></details>`;
}

export function renderKanbanOffer(state, { always = false } = {}) {
  if (state.kanban.enabled || (!always && state.kanban.offerDismissed)) return "";
  return html`<section class="card kanban-offer"><div class="card-header"><h2>Try Kanban?</h2><span class="status-chip">Optional</span></div><p class="field-help">Keep Eisenhower and the daily budget as defaults. Preview Kanban, or enable it to track unfinished work.</p><div class="button-row"><button class="btn compact" type="button" data-action="kanban-preview">Preview</button><button class="btn compact soft" type="button" data-action="kanban-ask-enable">Enable Kanban</button>${!always ? markup('<button class="btn compact ghost" type="button" data-action="kanban-dismiss">Not now</button>') : ""}</div></section>`;
}

export function renderKanbanSettings(state) {
  const k = state.kanban;
  return html`<section class="card"><div class="card-header"><h2>Kanban</h2><span class="status-chip">${k.enabled ? t("On") : t("Off")}</span></div><p class="field-help">Optional. Eisenhower and your budget stay available. Turning off keeps board history.</p><div class="button-row"><button class="btn compact" type="button" data-action="kanban-preview">Preview</button><button class="btn compact" type="button" data-action="${k.enabled ? "kanban-disable" : "kanban-ask-enable"}">${k.enabled ? t("Turn off Kanban") : t("Enable Kanban")}</button>${k.enabled ? markup('<button class="btn compact ghost" type="button" data-action="kanban-open">Open board</button>') : ""}</div>
    <div class="field-grid"><div class="field"><label for="kanban-wip">WIP limit</label><input id="kanban-wip" class="input" type="number" min="1" max="10" step="1" value="${k.wipLimit}" data-kanban-setting="wipLimit"></div><div class="field"><label for="kanban-age">Flag unfinished work after (days)</label><input id="kanban-age" class="input" type="number" min="1" max="30" step="1" value="${k.ageDays}" data-kanban-setting="ageDays"></div></div>
    <label class="check-row"><input type="checkbox" data-kanban-setting="autoReady" ${k.autoReady ? "checked" : ""}><span>Move today's picks and blocks to Ready</span></label><label class="check-row"><input type="checkbox" data-kanban-setting="autoStart" ${k.autoStart ? "checked" : ""}><span>Move to Doing when a task timer starts</span></label><label class="check-row"><input type="checkbox" data-kanban-setting="showHints" ${k.showHints ? "checked" : ""}><span>Show next-task, aging and weekly-review hints</span></label><p class="field-help">These rules run only while Kanban is enabled. Each automatic move has a reason and a guarded Undo.</p>${rules()}</section>`;
}

export function renderKanban(state, { preview = false, now = new Date() } = {}) {
  if (!preview && !state.kanban.enabled) return renderKanbanOffer(state, { always: true });
  const k = state.kanban, metrics = kanbanMetrics(state, now);
  const suggestion = !preview ? kanbanSuggestion(state, now) : null;
  const tasks = state.tasks.filter(task => task.status !== "archived");
  const card = task => {
    const item = kanbanItem(state, task.id), stage = kanbanStage(state, task);
    const started = safeDate(item.startedAt);
    const ageMinutes = started ? Math.max(0, (now - started) / 60000) : null;
    const due = safeDate(task.dueAt);
    const lastMove = [...k.changes].reverse().find(change => change.taskId === task.id && !change.undoneAt && change.after.stage === stage);
    return html`<article class="matrix-task kanban-task"><h4>${escapeHtml(task.title)}</h4><p class="field-help">${minutesLabel(task.durationMinutes)} estimated${due ? msg` · Due ${escapeHtml(formatDay(due, getLocale()))}` : ""}</p>
      ${stage === "doing" && ageMinutes !== null ? html`<p class="field-help">Age: ${minutesLabel(ageMinutes)} elapsed</p>` : ""}
      ${stage === "doing" && item.blockedReason ? html`<p class="kanban-warning"><strong>Blocked</strong> · ${escapeHtml(item.blockedReason)}</p>` : ""}
      ${!preview && k.showHints && stage === "doing" && ageMinutes >= k.ageDays * 1440 ? markup('<p class="kanban-warning">Past your aging threshold. Review the next step or blocker.</p>') : ""}
      ${!preview && k.showHints && stage !== "done" && due && due < now ? markup('<p class="kanban-warning">Deadline passed; completion is still your choice.</p>') : ""}
      ${stage !== "done" && item.manualHold ? markup('<p class="field-help">Manual stage · automation paused for this task.</p>') : stage !== "done" && lastMove ? html`<p class="field-help">Auto move: ${t(reasons[lastMove.reason])} · ${escapeHtml(lastMove.evidence.date)}</p>` : ""}
      ${preview || stage === "done" ? "" : html`<div class="button-row">${stage !== "doing" ? html`<button class="btn compact soft" type="button" data-action="kanban-move" data-task-id="${escapeHtml(task.id)}" data-stage="doing">Start task</button><button class="btn compact ghost" type="button" data-action="kanban-move" data-task-id="${escapeHtml(task.id)}" data-stage="${stage === "backlog" ? "ready" : "backlog"}">${stage === "backlog" ? t("Make ready") : t("Return to Backlog")}</button>` : html`<button class="btn compact" type="button" data-action="complete-task" data-task-id="${escapeHtml(task.id)}">Done</button><button class="btn compact ghost" type="button" data-action="${item.blockedReason ? "kanban-unblock" : "kanban-block"}" data-task-id="${escapeHtml(task.id)}">${item.blockedReason ? t("Unblock") : t("Mark blocked")}</button>`}<button class="btn compact ghost" type="button" data-action="open-focus" data-task-id="${escapeHtml(task.id)}">Focus</button><button class="btn compact ghost" type="button" data-action="edit-task" data-task-id="${escapeHtml(task.id)}">Edit</button>${item.manualHold ? html`<button class="btn compact ghost" type="button" data-action="kanban-allow-auto" data-task-id="${escapeHtml(task.id)}">Allow automation</button>` : ""}</div>`}
    </article>`;
  };
  return html`<section class="section"><div class="section-heading"><h2>Kanban</h2><span class="status-chip ${metrics.wip > k.wipLimit ? "budget-over" : ""}">WIP ${metrics.wip} / ${k.wipLimit}</span></div>
    ${preview ? markup('<p class="field-help">Read-only preview. This preview changes no tasks.</p>') : markup('<p class="field-help">Start task changes the board, not the timer. Done is always manual. Blocked and paused work still count.</p>')}
    ${!preview && metrics.wip >= k.wipLimit ? markup('<p class="kanban-warning" role="status">WIP limit reached. Finish or unblock work before starting more. Extra manual starts need confirmation; timers only warn.</p>') : ""}
    ${suggestion ? html`<div class="card"><p class="eyebrow">Suggested next · no automatic start</p><h3>${escapeHtml(suggestion.task.title)}</h3><p class="field-help">${t(reasons[suggestion.reason])}. A WIP slot is available. ${suggestion.block ? msg`Block: ${escapeHtml(formatTime(suggestion.block.startAt, getLocale()))}.` : ""}</p><button class="btn compact" type="button" data-action="kanban-move" data-stage="doing" data-task-id="${escapeHtml(suggestion.task.id)}">Start task</button></div>` : ""}
    ${!preview && k.showHints && metrics.reviewDue ? html`<section class="card"><h3>Weekly Kanban review</h3><p class="field-help">Seven days since enabling or the last review. Check blocked and aging work; finish, clarify or archive it. Keep Kanban only if it helps.</p><div class="button-row"><button class="btn compact" type="button" data-action="kanban-review">Reviewed</button><button class="btn compact ghost" type="button" data-action="kanban-disable">Turn off Kanban</button></div></section>` : ""}
    <div class="kanban-grid">${["backlog", "ready", "doing", "done"].map(stage => {
      const all = tasks.filter(task => kanbanStage(state, task) === stage);
      const shown = stage === "done" ? [...all].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 20) : all;
      return html`<details class="kanban-column" ${stage === "ready" || stage === "doing" ? "open" : ""}><summary>${t(labels[stage])} · ${all.length}</summary>${shown.length ? shown.map(card).join("") : markup('<p class="field-help">No tasks here.</p>')}${all.length > shown.length ? markup('<p class="field-help">Showing the latest 20 completed tasks.</p>') : ""}</details>`;
    }).join("")}</div>
    ${!preview ? html`<details class="mini-disclosure"><summary>Flow measures</summary><dl class="budget-sources"><div><dt>Completed · last 7 days</dt><dd>${metrics.completed}</dd></div><div><dt>Blocked in Doing</dt><dd>${metrics.blocked}</dd></div><div><dt>Oldest unfinished work</dt><dd>${minutesLabel(metrics.oldestMinutes)}</dd></div><div><dt>Median cycle · last 7 days</dt><dd>${metrics.medianCycleMinutes === null ? t("Not enough data") : minutesLabel(metrics.medianCycleMinutes)}</dd></div></dl><p class="field-help">${metrics.cycleSamples} tasks with an observed start and finish. Cycle time includes waiting and breaks, not just focus. Earlier starts are unknown; archived tasks are not completed. This is not a productivity score.</p></details>
      <details class="mini-disclosure"><summary>Automatic moves & Undo</summary><p class="field-help">Last 100 automatic moves. Undo restores only the board stage and pauses task automation; timers, schedules and priorities stay unchanged. Newer task changes can make Undo unavailable.</p>${[...k.changes].reverse().map(change => {
        const task = state.tasks.find(task => task.id === change.taskId);
        return html`<div class="kanban-change"><strong>${escapeHtml(task?.title ?? t("Task"))}</strong><p class="field-help">${t(labels[change.before.stage])} → ${t(labels[change.after.stage])} · ${t(reasons[change.reason])} · ${escapeHtml(formatDay(change.at, getLocale()))} ${escapeHtml(formatTime(change.at, getLocale()))}</p>${change.undoneAt ? markup('<small>Undone</small>') : canUndoKanban(state, change) ? html`<button class="btn compact ghost" type="button" data-action="kanban-undo" data-change-id="${escapeHtml(change.id)}">Undo</button>` : markup('<small>Newer changes; undo unavailable.</small>')}</div>`;
      }).join("") || markup('<p class="field-help">No automatic moves yet.</p>')}</details>` : ""}${rules()}</section>`;
}

export function renderKanbanModal(state, modal) {
  const close = markup('<button class="icon-button ghost" type="button" data-action="close-modal" aria-label="Close">×</button>');
  let content;
  if (modal.type === "kanban-intro" || modal.type === "kanban-preview") {
    content = html`<h2 id="kanban-modal-title">${modal.type === "kanban-preview" ? t("Kanban preview") : t("Enable Kanban?")}</h2><p>Eisenhower and the daily budget remain the defaults. Kanban is optional and can be turned off in Settings.</p><p>When enabled, today's picks and blocks can enter Ready; new task timers can enter Doing. Manual moves pause task automation. Review reasons and Undo on the board.</p><p>WIP limit: ${state.kanban.wipLimit}. Rules and limits can be changed in Settings. No AI calls.</p>${modal.type === "kanban-preview" ? renderKanban(state, { preview: true }) : rules()}<div class="button-row">${!state.kanban.enabled ? markup('<button class="btn primary" type="button" data-action="kanban-enable">Enable Kanban</button>') : ""}${modal.type !== "kanban-preview" ? markup('<button class="btn" type="button" data-action="kanban-preview">Preview board</button>') : ""}<button class="btn ghost" type="button" data-action="${state.kanban.enabled ? "close-modal" : "kanban-dismiss"}">${state.kanban.enabled ? t("Close") : t("Keep defaults")}</button></div>`;
  } else if (modal.type === "kanban-wip") {
    content = html`<h2 id="kanban-modal-title">Start beyond the WIP limit?</h2><p>${kanbanWip(state).length} / ${state.kanban.wipLimit} tasks are already in Doing, including blocked work. This adds one more; it does not start a timer.</p><p>${escapeHtml(state.tasks.find(task => task.id === modal.taskId)?.title ?? "")}</p><div class="button-row"><button class="btn" type="button" data-action="kanban-confirm-start">Start anyway</button><button class="btn ghost" type="button" data-action="close-modal">Cancel</button></div>`;
  } else if (modal.type === "kanban-block") {
    content = html`<h2 id="kanban-modal-title">What is blocking this task?</h2><p>It stays in Doing and still counts toward WIP.</p><form id="kanban-block-form"><label for="kanban-blocker">Blocker</label><textarea id="kanban-blocker" class="textarea" name="reason" maxlength="300" required autofocus>${escapeHtml(modal.reason ?? "")}</textarea><div class="button-row"><button class="btn primary" type="submit">Mark blocked</button><button class="btn ghost" type="button" data-action="close-modal">Cancel</button></div></form>`;
  }
  return content ? html`<div class="modal-backdrop" data-action="backdrop-close"><section class="modal ${modal.type === "kanban-preview" ? "kanban-preview" : ""}" role="dialog" aria-modal="true" aria-labelledby="kanban-modal-title"><div class="modal-head">${close}</div>${content}</section></div>` : "";
}
