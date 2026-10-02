# Stuđiô — Prototype B2 · v0.12.0

This release simplifies the everyday flow: **write one task → start focus → optionally adjust or review**. Today offers quick local capture, a direct timer start, a compact summary and contextual recovery. A new privacy screen explains each optional feature, the data it uses and its Chrome permissions. Existing Activity, tasks, timers, Kanban, budgets, memory and English/Vietnamese remain available.

Observed browser time, confirmed time, task attribution and planned work remain separate. None establishes attention or task completion. The extension does not measure native apps or whole-device screen time. See [PRIVACY.md](PRIVACY.md) for the new optional data and permissions, [HUONG-DAN.md](HUONG-DAN.md) for Vietnamese instructions, and [INTEGRATION.md](INTEGRATION.md) for the future website/backend contract.

## Install or upgrade

1. For an existing installation, export a backup and close the panel.
2. Extract this ZIP and replace files in your existing unpacked extension folder.
3. Open `chrome://extensions` and click **Reload** for Stuđiô. Do not remove the extension first.
4. Reopen the panel and confirm Settings shows **v0.12.0**.

For a new installation: enable Developer mode, choose **Load unpacked**, select `Studio-Prototype-B2-Chrome-Extension`, and click its toolbar icon. Chrome 116 or newer is required. No build step or third-party runtime packages are needed.

App schema **12** imports older backups and preserves tasks, timer history, Kanban, budgets and existing choices. New Activity tracking, title/resource recording, AI attribution, site access and notifications start off. Existing hostname totals stay in their original store. Enabling Activity pauses that collector; re-enabling the older collector pauses Activity. Totals from the two modes are never combined. An ordinary task backup excludes detailed Activity; export it separately from Activity when upgrading again. Keep a pre-upgrade backup if rolling back.

Start with [TESTING.md](TESTING.md) for a short walkthrough.

## New in v0.12.0 — Everyday flow and privacy

- New users can choose **Start with simple defaults**, then continue from the privacy screen with every optional feature off. Personalization remains available. No API key or optional Chrome grant is required for local task/timer use.
- Add a task with only a title. Its estimate defaults to the configured focus interval and can be edited later. The main **Start focus** action begins one interval directly; its duration is visible and editable. It prefers today's next scheduled block, then a task picked for today, then an open task. It never starts automatically or replaces a running/paused timer. **Timer options** retains Pomodoro and detailed setup.
- **Today → Plan and time tools** retains budgets, timer modes and today's blocks. Gemini setup/model choice lives in **Settings**, not the daily starting surface.
- **Today → Day changed?** exposes reviewed recovery when past blocks remain open. Nothing moves without Apply. A timer ending asks whether to mark its task done or keep it open.
- **Activity** starts with grouped totals. Use **All sessions** for the underlying timeline or **Conflicting associations** for optional corrections. Estimates and unlabeled sessions can remain unchanged indefinitely; they do not cause daily review notifications. Group minutes can overlap; do not add them to timer totals.
- **Settings → Privacy choices** reopens onboarding's feature controls. Switches reflect saved choices; a Gemini switch stays off until a key test succeeds, and media signals stay off until a site is granted. Turning these switches off is not deletion or Chrome permission revocation. Current Chrome grants can be revoked in extension settings.
- On a new installation, instruction sharing, saved-memory sharing and daily-review reminders now default off too. Upgrades preserve existing settings and show a nonblocking privacy-review link; they do not force onboarding again.

## Activity, reminders and recovery

1. Open **Activity → Tracking settings → Enable session tracking** and approve optional tab/idle access. No Gemini key is required for collection or local rules.
2. Keep the default 30-minute reading allowance, or set 5–180 minutes. A page with no input is retained as an estimate; after 10 minutes its uncertainty is marked, without requiring review. **Reading mode** extends the allowance from now. Device lock, unfocused windows and long observation gaps stop foreground collection.
3. Optionally enable **Record titles and exact resource IDs**, then save a resource association under **Projects, tags and resource associations**. The default matches one resource. Entire-domain matching requires its own checkbox. Project/tag names create reusable labels.
4. For video/audio evidence, expand **Media signals by site**, enter one site's URL, approve that site, and reload the page. Enable background listening separately if wanted. Player evidence improves context but never verifies attention; embedded players/PDF viewers may expose no signal.
5. Review the timeline or filter **Needs review**. Select several sessions to assign labels together; confirm duration separately. **Trim or split**, **Merge selected**, Exclude and guarded Undo correct the history. Original interval observations remain available. A stale edit is rejected; Refresh closes the editor so it can be reopened against current data.
6. Optionally connect Gemini in Settings, then enable Activity's own AI toggle after title/resource recording. Closed unclear sessions can receive suggestions automatically, at most once per unchanged revision; **Ask AI** permits an explicit retry. Up to 3 requests per local day, including failures, with 30 minutes between automatic batches. Each batch includes at most 8 sessions and 40 open task titles. AI never directly applies an assignment; saved local associations can apply automatically. No task notes, full URLs, page content, Custom Instructions or saved memory are added to this request.

An exact resource rule wins over a domain rule. Conflicting rules, page-title matches and planned-time overlaps provide candidates for review. Choosing a candidate opens the editor; Save makes the choice explicit. **Remember these exact resources** teaches a local rule. Removing a rule followed by **Apply saved associations** clears obsolete automatic attribution; manual edits remain protected. Resources associated with the same work can form one session across tab changes.

The adaptive reading allowance uses up to 12 recent confirmed reading sessions after at least 3 examples across 2 local dates. It is 1.25 times the median included reading duration, rounded up, bounded by 5 minutes and the configured maximum. Turn adaptation off for a fixed allowance. AI labels and unconfirmed durations do not train it. Trimming and confirming time provide better examples.

Playback without input is capped at 120 minutes. Background listening uses fresh player signals from an allowed audible tab when Chrome is unfocused, excludes muted/private tabs, and does not add another parallel stream to foreground time. Estimates can still overcount an unattended tab or undercount unsupported players. Intervals overlap only once in totals; timer time is shown separately. Gaps over 90 seconds and new browser sessions are never filled. Pausing can discard the uncommitted interval, normally under a minute.

**Settings → Reminders** offers scheduled-block, deadline, Pomodoro-ending and daily 18:00 review notifications. Delivery stays off until desktop reminders are enabled and permission is granted. Daily activity review is a separate opt-in and only flags conflicting associations. Quiet hours default to 22:00–08:00; equal times disable them. Focus/paused-focus suppress delivery. Open and Snooze 10 min are available. Events have stable IDs for restart deduplication; several eligible missed events are summarized together. Chrome must be running; sleep can delay delivery, and expired events are dropped. Notification text can include task titles on the desktop. Turning reminders off clears existing Stuđiô notifications.

**Plan → Schedule → Recover delayed work** detects past planned blocks whose task is still open, excluding a task with a live/waiting timer. Confirm the remaining minutes, then choose **Propose recovery**. The local planner preserves future commitments, fits the next 7 workdays, checks deadlines and daily budgets (including zero and overnight boundaries), and reserves configured breaks/buffers. Each selected task is scheduled fully or listed as infeasible. Review and **Apply recovery** mark replaced old blocks skipped and add new blocks; the task itself remains open. Undo restores the schedule while its relevant state is unchanged. Changed plans or elapsed start times require a fresh proposal. Browser uncertainty never triggers this process automatically.

**Status confirmation:** v0.10.0 did not reorganize delayed blocks automatically. v0.12.0 implements detection and an explicit proposal → Apply → Undo flow. Unattended rescheduling, Telegram delivery, cloud sync and a deployed website/backend are deferred. The included core modules are platform-independent; Chrome collection and storage adapters are separate.

## Included from v0.10.0 — optional Kanban

On **Plan**, choose **Preview**, **Enable Kanban**, or **Not now**. Preview shows existing tasks without changing them. Enabling requires an explicit choice. Dismissal persists; **Settings → Kanban** remains available. Today gains no Kanban invitation or planning-assistance card. Each panel opening starts Plan on Eisenhower; Schedule and an enabled Kanban board are separate tabs.

The board uses the same tasks: **Backlog → Ready → Doing → Done**. Done follows explicit task completion from any view; archive is not completion. Backlog and Done are collapsed to keep the board compact. **Start task** changes the board only; **Focus** opens timer setup. A finished timer leaves the task open and offers **Mark task done**.

| Optional local rule | What happens | Explanation/control |
| --- | --- | --- |
| Today's picks or confirmed upcoming blocks | Backlog → Ready | Pick/block reason, local date, Undo |
| New task-linked focus timer | Backlog/Ready → Doing | Timer-start reason, Undo; no old starts imported |
| Next-task hint | Suggest one Ready task when below WIP | Today's block, urgency, importance, high priority, then longest waiting; never starts it |
| Aging/deadline hint | Flag elapsed Doing age or passed deadline | Default aging threshold: 3 days; no automatic completion |
| Weekly review | In-app hint after 7 days since enabling/reviewing | Reviewed or Turn off; no push notification or AI call |

**WIP** means unfinished work already in Doing. The default soft limit is **2**, adjustable from 1–10. Blocked and paused work still count. An extra manual start requires confirmation. Actual timer starts may exceed the limit and produce a warning so started work is not hidden. Once started, work stays Doing until completed or archived; record a blocker instead of silently moving it backwards. Undo can correct an automatic start without stopping its timer.

Manual moves and Undo pause automation for that task until **Allow automation** is selected. Removing today's pick, a missed block or midnight never moves work backwards. Rules run on app changes and reopening, not continuous background polling. They never create tasks, start timers, change priorities or schedules, unblock work, or mark tasks done. Settings provides separate Ready-sync, timer-sync and hints switches; turning Kanban off keeps its history.

Expand **Automatic moves & Undo** for the last 100 moves. Undo works only while the task is still open and its board state matches that move; newer changes prevent stale undo. It changes only board metadata, not the timer, task text, schedule or priorities. Next-task ties use earlier block/deadline, then Ready waiting time, then task ID; the longest-waiting fallback uses Ready time alone.

**Flow measures** shows current blocked/oldest unfinished work and completions from the last 7 elapsed days, no earlier than first enable. Cycle-time median uses only those completions with an observed Doing start, with sample count. It includes waiting and breaks, not just focus. It is not a productivity score; earlier start times are unknown. Board settings, blockers, timestamps and move history stay local and are included in backups, not AI context. All controls and explanations support English/Vietnamese.

## Included from v0.9.1 — multi-source budgets

Enable **Settings → Automatic daily budget**. The estimate uses:

- **Recent manual budgets:** median of the latest seven recorded days in the previous 28 local days, including explicit zero values.
- **Recorded focus:** median daily focus plus estimated breaks, from up to seven recorded days in that window. Sessions are summed by their ending local day, including partial/stopped focus. Missing days are unknown, not zero availability. Today and future dates are excluded.
- **Default budget:** used alone without history and blended in when a source has fewer than three recorded days.
- **Workday hours:** cap the result. Overnight windows are supported; matching start/end clocks mean 24 hours. This is a whole-day ceiling, not a countdown or proof that all those hours are free.

This is a transparent heuristic, not a learned productivity score. At full history, the manual-budget median has weight 2 and the focus-plus-breaks median has weight 1. Each available source gets `min(recorded days / 3, 1)` of its full weight; the default fills its missing weight. Missing sources are omitted. The weighted mean is rounded to a minute, then capped by the workday. Automatic/default day plans never train the manual-history source.

Today's picked tasks, scheduled blocks and timer rounds are compared against that capacity, with estimated breaks. They **do not raise available time** to make an overloaded plan fit. Website time, outside calendars, deadlines and task importance do not imply free time. No new data is collected or sent to AI.

Expand **How this estimate works → Budget sources** for values and sample counts. A manually saved value for today still wins, including zero or a value above the automatic cap. **Use estimate** explicitly removes only today's override and keeps task selections. Automatic values recalculate from current local data; manual values stay fixed.

## Included from v0.9.0

- **Plan → Eisenhower → Needs sorting → AI automatic sorting** enables sorting while the panel is open. Rules recognize explicit importance labels (`Importance: important`, `Importance: low`, `Quan trọng: có`, `Quan trọng: không`). Gemini handles unclear tasks in batches of up to 10. Saved deadlines and manual urgency win; durations, task text and schedules stay intact. Low-confidence or unknown decisions remain in Needs sorting. AI results have a short reason and can be corrected with the dropdown. Moving a task back to Needs sorting locks that choice until **Allow AI sorting** is selected. Failed/uncertain revisions are not sent repeatedly; edit the task or choose **Retry sorting**.
- **Settings → Automatic daily budget** remains optional and preserves manual daily values. The v0.9.1 calculation is described above. It does not schedule tasks or call AI.
- **Settings → Planning assistance** is off initially and lives only in Settings. Guided planning and Gemini suggestions remain available when enabled. **Schedule** on an Eisenhower task opens an independent manual dialog.
- A **one-time prompt** offers to enable Planning assistance after at least seven days of observation, when the seven preceding completed local days contain at least 21 user-requested Capture, explanation, reflection or planning-help API attempts. Inactive days count as zero; today's partial day, connection tests, automatic sorting and memory updates do not count. Counted attempts include provider failures after sending. Tracking begins with this upgrade; no older usage is invented. The prompt waits through onboarding, dialogs, AI activity and active timers. It never enables the feature automatically; dismissal is remembered.
- Choose **Language / Ngôn ngữ → Tiếng Việt** in Settings or onboarding. Interface, dates and new Gemini assistance responses follow the choice. Existing tasks, notes, memories and AI responses are not translated. Chrome's extension name/description use the browser language.

The sorting request uses Google's [structured JSON output contract](https://ai.google.dev/gemini-api/docs/structured-output), followed by local ID/type checks, confidence checks and task-revision checks. Rules are deliberately narrow; a keyword alone is not evidence of importance.

## Time management

### Pomodoro

Choose **Today → Plan and time tools → Pomodoro**, optionally select a task, and adjust focus minutes, short/long breaks, number of rounds, and how often to take a long break. New installs default to 25-minute focus, 5-minute short breaks, a 15-minute long break every four rounds, and four focus rounds. Existing default settings are preserved. Settings stores your defaults; the setup form adjusts only the current session.

Each focus round ends at a **Break ready** screen. Click **Start break** or skip it. After a break, **Start next focus** begins the next round. The final round also offers a break, with **Finish Pomodoro** available immediately. No phase starts while you are away. Pause/resume, returning to Today, and reopening the panel preserve progress. The toolbar badge displays REST, NEXT, or DONE at phase boundaries; this build does not request desktop notification permission or play an alert sound.

Only focus rounds enter session history and Insights. Breaks and paused time are excluded. The final summary totals recorded focus across rounds; ending early keeps partial focus. A pending or paused timer cannot be overwritten. **Single timer** remains available. Scheduled blocks use one interval to match their reserved time; use the task's Focus action for several Pomodoro rounds.

Absolute deadlines and background alarms recover the elapsed interval when the panel closes or Chrome restarts. A delayed alarm records one interval at its stored end time and then waits; it does not invent further rounds during sleep. These are elapsed timer records, not verified attention. Alarm delivery can be delayed by the browser or device sleep, as documented in Chrome's [alarms reference](https://developer.chrome.com/docs/extensions/reference/api/alarms) and [service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

### Eisenhower priorities

Open **Plan → Eisenhower**, or the Eisenhower button on Today. Four quadrants are **Do first**, **Schedule**, **Delegate / simplify**, and **Defer / drop**. Existing tasks begin in **Needs sorting** rather than having importance inferred from their old priority.

In **Edit task**, choose **Important to my goals?** and **Urgency**. Automatic urgency means overdue or due within the next 24 hours; a task without a deadline is not automatically urgent. Manual urgent/not-urgent choices override that rule. The task's existing priority remains available to the scheduler independently.

Use the quadrant dropdown to move a task. This sets importance and urgency explicitly; Edit lets you return urgency to Auto. Quadrant changes do not change the deadline or automatically schedule, delegate, or delete work. Cards support **Pick for today**, **Focus**, **Schedule**, **Edit**, and **Done**. Schedule opens the existing manual block form for that task; choose the time yourself. Archive remains available from Edit.

### Daily time budget — suggested companion feature

Set the total minutes available **today**, including breaks, on Today or Plan. The default on a new day is 120 minutes, adjustable in Settings. **Pick for today** selects tasks to include without creating calendar blocks. Upcoming blocks and remaining timer rounds count automatically. A task estimate and its blocks/timer use the larger remaining amount rather than being added together.

The card shows recorded focus, estimated remaining work, estimated breaks, and spare time or overload. Estimates subtract recorded focus from the task's estimated duration; they cannot determine whether the task is actually finished. Break allowance uses default intervals and counts breaks between rounds, not an optional final rest. Completed timer intervals are attributed to their ending day, matching Insights. A new local day starts a new selection and budget; up to 90 daily plans are retained in backups.

## Legacy minimal website-time tracking

This older mode retains hostname totals only. For detailed sessions and passive study estimates, use Activity above. On Today or Settings, choose **Website time today → Enable website tracking** and approve optional tab/idle access. Tracking starts only after consent; denying access leaves the feature off. It works without a Gemini connection and while the panel is closed, as long as the browser runs.

The tracker samples the active HTTP(S) tab in the focused, non-minimized normal browser window, plus tab/focus/idle events and a one-minute heartbeat. Private tabs/windows and browser-internal/file pages are excluded. It pauses when the device reports idle/locked; the idle threshold is 60 seconds. Return to **Refresh totals** to see today's total and top five hostnames. The displayed card is a snapshot, not a live counter.

Only hostnames (including subdomains), daily milliseconds, and a recovery cursor are saved locally. No full URLs, paths, queries, titles, page content, screenshots, or historical visits are saved. Keep up to seven local-calendar days, pruned on the next tracker check; at most 100 hostnames per day, with excess sites contributing only to the total. No new remote hosts or content scripts are used.

**Limits:** this is an estimate, not a full screen-time monitor. Passive reading/video can be undercounted after idle detection; browser UI/side-panel use can remain attributed to the active site. Gaps over 90 seconds and new browser sessions are not backfilled. Short gaps cannot always be distinguished from ordinary inactivity. Pausing drops the unfinished interval (normally under a minute) and keeps totals. **Clear tracking data** requires confirmation, deletes all website totals, and pauses tracking; it cannot be undone. Optional permission grants remain available until revoked in Chrome's extension settings.

Website data never enters tasks, timer records, AI prompts, learning evidence, diagnostics, or app backups. Restoring a backup pauses tracking but keeps its existing local totals; **Erase local data** also clears them. This legacy collector does not supply detailed Activity records, categories or AI context. Native-app and cross-device tracking remain deferred.

Implementation follows Chrome's [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), [tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs), [idle detection](https://developer.chrome.com/docs/extensions/reference/api/idle), and [alarm lifecycle](https://developer.chrome.com/docs/extensions/reference/api/alarms) documentation.

## Planning assistance in Settings

Enable **Settings → Planning assistance**, then choose **Guide me**. It provides local questions about your outcome, concrete action, estimate, and commitments. It works without Gemini.

Expand **Create a task or block**. Choose a task or scheduled block; write your own title and minutes, and choose a start time for a block. A block can use an existing task. Saving checks overlaps, past times, a running timer, and the existing task's deadline. Nothing starts a timer.

Optional **Gemini brainstorming** provides questions, planning steps, and ideas based on what you write. Its output never fills or submits the manual form.

The selector also offers **Suggest my next step**: up to three options using a fresh snapshot of up to 20 active tasks, short notes, upcoming blocks, and timer totals. Existing-task suggestions use verified IDs and actual titles. With no active tasks, relevant saved context may support an idea; otherwise Gemini is instructed to ask for a goal. You review focus setup or write a new task manually.

The mode choice persists and makes no API call. This is a choice-preserving workflow, not a medical intervention or a claim to prevent cognitive harm. It does not disable other manual, Capture, or Plan workflows.

## Capture and Plan

**Allow multiple focus blocks** starts on for **I'm just starting out**, off for **I have my own system**, and preserves later overrides. It appears in Smart Capture and Settings.

When on, **Interpret & review** can draft up to six tasks and twelve blocks from one note. Gemini chooses grouping, lengths, and proposed times; multiple blocks are allowed, not required. Review/edit task details and block labels, lengths, and local times; uncheck unwanted blocks. One confirmation saves the selection together.

Selected blocks must be 5–180 whole minutes, with at most 480 minutes per task. Saving rechecks deadlines, work hours, busy times, buffers, and changes since review opened. Missing times require editing or deselection. Each task's estimate becomes its selected block total. Timers start only when chosen.

When off, capture returns one task draft. Without Gemini it stays manual. **Plan → Propose schedule** remains explicit and deterministic, splitting tasks into focus-sized blocks in a reversible proposal. Gemini can explain that proposal, not apply it.

Capture creates new work; it cannot retrieve your existing plan. Use the planning-assistance card for context-aware help. The flat task/block schema from v0.5.4 remains, with all limits enforced locally.

## Custom Instructions

In Settings, save up to 10,000 characters. **Use with Gemini** defaults off on new installations; existing saved choices are preserved. Saving/editing is local; unsubmitted drafts are not sent.

Enabled instructions accompany capture, planning help, explanations, reflections, automatic sorting, and separately opted-in learning updates—not connection/model tests. **The automatic updater cannot rewrite Custom Instructions.** Longer instructions increase every request's size.

Turning use off keeps the text. Clearing asks for confirmation. Neither recalls requests already sent or removes older responses, backups, or debug exports. The ordinary scheduler and timer use structured Settings, not free-text instructions.

## Saved memory and learning

Open **Settings → Saved memory**. Entries have editable text, source, evidence, status, topic, and optional expiry.

| Control/status | Meaning |
| --- | --- |
| Add / Edit | Explicit guidance saved locally; no API call. |
| Use saved memory in assistance | Off on new installations; includes relevant active entries only when enabled. Existing choices are preserved. |
| Learn from my activity | Off by default; separately authorizes background updates. |
| Explicit / Confirmed | User-written or user-confirmed; eligible for relevant requests. |
| Supported observation | Model-classified observation with at least 3 distinct events across 2 local dates. |
| Tentative inference | Excluded from assistance until confirmed. |
| Conflict | Excluded and kept for review; cannot overwrite explicit/confirmed guidance. |

Learning collects only new eligible activity after opt-in: saved tasks, task edits, reviewed block-duration changes, task completions, recorded timer sessions, and explicitly submitted learning notes. Historic activity, old feedback, diagnostics, and planning-chat text are not imported.

An update sends at most 40 evidence events, existing saved-memory texts, and enabled Custom Instructions. Gemini proposes at most six create/revise/reinforce/conflict/ignore operations. Local validation checks IDs, targets, sizes, expiry, and protected entries. It writes only the separate memory store—not tasks, schedules, timers, settings, or Custom Instructions. It does not train model weights.

The observation threshold is **not verification that a statement is true**. Gemini can misinterpret evidence or propose contradictions. Inferred preferences remain tentative regardless of event count. Inspect **Why this is saved** and correct, confirm, or forget entries.

### Timing and recovery

- One automatic batch per local day near the configured workday end, or catch-up after reopening when evidence is overdue.
- At most three memory requests per local day, including manual refreshes, failures, and interrupted reservations. A manual refresh also uses that day's automatic slot.
- No new evidence means no API call. Automatic updates defer during a running timer or interactive Gemini request.
- **Refresh memory now** runs a pending batch when allowed. Failures retain evidence with a 15-minute backoff. No immediate automatic retry; the next automatic attempt is on a later eligible day.
- Job state/quota are saved before the request. An interrupted job has a 75-second lease and can be recovered within the budget.
- Edits, forget, pause, clear, and restore invalidate stale in-flight results.
- Chrome must be able to run the extension. It cannot run while closed or wake a sleeping device. This is local scheduling, not Google's server-side background execution.

Limits: 100 entries, 500 evidence events, 40 recent changes. Old evidence can age out. Assistance selects by topic/word matching, not semantic search: up to eight active entries and 4,000 text characters. Expired, tentative, and conflict entries are excluded. Reflection selects only explicit/confirmed preference memories, plus enabled Custom Instructions.

### Review, forgetting, and backups

Recent changes offer undo when no newer edit intervenes. **Forget** is not undoable: it purges the entry, its memory revisions, and their supporting learning evidence. Non-text fingerprints suppress exact regeneration; excluded old evidence is not replayed. A similar idea could still be inferred from genuinely new evidence.

Original tasks/timers, other entries, exports, opted-in debug copies, and provider-held data are separate. Forget does not remove those. Turn debug text off or clear diagnostics to remove local debug copies.

Pausing learning deletes pending evidence and keeps saved entries/supporting history; re-enabling starts with future activity. **Clear learned data** clears this memory store and pauses learning, retaining quota/backoff counters. Custom Instructions and app tasks remain.

Backups include saved memories and evidence, not updater jobs, quota, memory undo history, context traces, diagnostics, or credentials. Restore replaces app and memory together, pauses learning, and retains this device's quota/backoff. Do not save a v0.6.0 backup with an older release; it cannot preserve the new store.

## Gemini model options

Open **Settings → Gemini connection** (also available on Today). Setup now has a **Gemini model** dropdown. Once connected, the dropdown stays visible beside the active-model status; it is no longer hidden in a disclosure. Choose a model, then **Use & test model** to reuse the current key for one small test. Selection alone makes no request or saved change. Failure keeps the previous working model. Models are never switched automatically.

Choose **Custom model ID…** to reveal an editable ID field in either setup or the connected card. Switching the dropdown does not rebuild the key form or clear a pasted key. Draft model choices survive unrelated renders; the active-model label changes only after a successful test. A custom ID may require billing or be unavailable to the project.

| Model ID | Catalog role |
| --- | --- |
| `gemini-3.1-flash-lite` | Unchanged default |
| `gemini-3.5-flash-lite` | Newer Flash-Lite |
| `gemini-3.8-flash` | Latest listed Flash |
| `gemini-3.7-flash` | Flash alternative |
| `gemini-3.6-flash` | Earlier Flash |
| `gemini-2.5-flash` | 2.5 Flash |
| `gemini-2.5-flash-lite` | 2.5 Flash-Lite |

Checked 2026-09-10 against Google's [standard text pricing](https://ai.google.dev/gemini-api/docs/pricing) and [Interactions supported models](https://ai.google.dev/gemini-api/docs/interactions-overview). Availability/quota depend on the project. A free-tier listing does not guarantee access or free usage on a billing-enabled project. A custom model ID remains available in the connection form.

## Privacy and diagnostics

No Stuđiô server or analytics SDK. Required access remains storage, alarms, sidePanel, and the Gemini host. Optional tabs/idle access is requested only when enabling website tracking. There is no history API, website host access, OS monitoring, notifications, or calendar access.

Keys use Chrome session storage unless **Remember on this device** is enabled. They are sent in the `x-goog-api-key` header, never a URL, and excluded as credentials from backups. Every request uses `store: false`; other provider data terms still apply. Free-tier content may be used to improve Google's products. Local app data/backups are not encrypted. See [PRIVACY.md](PRIVACY.md).

**Settings → Gemini diagnostics → Export debug report** downloads the last 20 attempts without an API call. Version 4 identifies capture, planning help, memory updates, model, stage, HTTP status, formats, counts, and errors.

**Include prompt and custom instructions in debug reports** is off by default. When on, future reports may contain prompts (including learning evidence), enabled instructions, selected memories, and provider error messages. Keys are redacted and truncation is marked. Complete provider bodies, headers, and model output are excluded. Turning it off purges debug text and prevents in-flight attempts from restoring it. Old exported files are unaffected.

Reproduce a Gemini problem once on v0.12.0, export the JSON, and attach it to the development chat. Enable debug text beforehand only if you want to share that content. Older metadata-only attempts cannot gain missing text retroactively. For tracking issues, describe the tab/window/idle sequence and expected versus shown time; Gemini diagnostics deliberately contain no browsing data.

## Verification and numbering

With Node.js 20 or newer:

```bash
npm run verify
```

The automated suite covers legacy features plus passive time, privacy boundaries, rules/AI suggestions, corrections, stale/concurrent writes, imports, reminders, overnight budgets, recovery and English/Vietnamese actions. See TESTING.md for the current count and manual checks. Tests use simulated DOM/Chrome APIs and mocked Gemini responses; no quota was used. An installed Chrome UI and a live Gemini key were not available in the release environment, so actual permission dialogs, notification delivery, player compatibility and rendered layout still require the supplied walkthrough.

**B2** is the prototype milestone; **0.11.0** adds Activity, reminders and reviewed recovery. Patch releases use `0.11.x`; substantial features increment the minor version. App, package, manifest and documentation versions are audited together. See [CHANGELOG.md](CHANGELOG.md).

Deferred: whole-device/native-app and cross-device tracking, unattended phase starts/rescheduling, calendar sync, Telegram, mobile apps, on-device models, paid accounts and cloud sync.
