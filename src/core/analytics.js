import { localDateKey, safeDate } from "./utils.js";

export function computeAnalytics(state, now = new Date()) {
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    days.push({ key: localDateKey(date), date: date.toISOString(), focusedSeconds: 0, sessions: 0 });
  }
  const byDay = new Map(days.map(day => [day.key, day]));
  let completedSessions = 0;
  let stoppedSessions = 0;
  const hourTotals = new Map();

  for (const session of state.sessions) {
    const ended = safeDate(session.endedAt);
    if (!ended) continue;
    const day = byDay.get(localDateKey(ended));
    if (day) {
      day.focusedSeconds += Math.max(0, Number(session.focusedSeconds) || 0);
      day.sessions += 1;
      if (session.outcome === "completed") completedSessions += 1;
      else stoppedSessions += 1;
    }
    if (day) {
      const hour = ended.getHours();
      hourTotals.set(hour, (hourTotals.get(hour) ?? 0) + Math.max(0, Number(session.focusedSeconds) || 0));
    }
  }

  const totalFocusedSeconds = days.reduce((sum, day) => sum + day.focusedSeconds, 0);
  const nonArchivedTasks = state.tasks.filter(task => task.status !== "archived");
  const completedTasks = nonArchivedTasks.filter(task => task.status === "done").length;
  const bestDay = [...days].sort((a, b) => b.focusedSeconds - a.focusedSeconds)[0] ?? null;
  const peakHourEntry = [...hourTotals.entries()].sort((a, b) => b[1] - a[1])[0];

  let streakDays = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index].focusedSeconds <= 0) break;
    streakDays += 1;
  }

  return {
    windowDays: 7,
    days,
    totalFocusedSeconds,
    totalFocusedMinutes: Math.round(totalFocusedSeconds / 60),
    completedSessions,
    stoppedSessions,
    sessionCompletionRate: completedSessions + stoppedSessions
      ? completedSessions / (completedSessions + stoppedSessions)
      : 0,
    completedTasks,
    activeTasks: nonArchivedTasks.length - completedTasks,
    taskCompletionRate: nonArchivedTasks.length ? completedTasks / nonArchivedTasks.length : 0,
    bestDayKey: bestDay?.focusedSeconds ? bestDay.key : null,
    peakHour: peakHourEntry && peakHourEntry[1] > 0 ? peakHourEntry[0] : null,
    streakDays
  };
}

export function privacyReducedReflectionPayload(analytics) {
  return {
    window_days: analytics.windowDays,
    focus_minutes_by_day: analytics.days.map(day => ({ date: day.key, minutes: Math.round(day.focusedSeconds / 60) })),
    total_focus_minutes: analytics.totalFocusedMinutes,
    completed_sessions: analytics.completedSessions,
    stopped_sessions: analytics.stoppedSessions,
    session_completion_rate: Number(analytics.sessionCompletionRate.toFixed(3)),
    completed_task_count: analytics.completedTasks,
    active_task_count: analytics.activeTasks,
    current_streak_days: analytics.streakDays,
    peak_hour_local: analytics.peakHour
  };
}
