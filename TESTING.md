# v1.0.0 — release acceptance

Export both the task backup and, if used, the separate Activity backup. Replace files in the same unpacked extension folder, reload at `chrome://extensions`, and confirm Settings shows **v1.0.0**. Do not remove the extension or clear its data. Confirm the installed name is **Stuđiô** and that Settings and website tracking have no pre-release label in either language. Stored app schema remains 12; this promotion must preserve tasks, history and consent choices.

## v1.0.0 automated verification

Run `npm run verify` with Node.js 20 or newer. The release suite covers 407 cases using simulated Chrome/DOM APIs and mocked Gemini. No live AI quota was used. Both headless-shell and full Chromium downloads failed with invalid/truncated archives in the release environment. Actual permissions, player signals, OS notifications, browser sleep, screen-reader output and visual layout remain manual acceptance checks below. Passing code tests does not establish that users experience the product as effortless.

## Progressive-guide acceptance checks

1. Finish privacy onboarding with optional features off. Only a small invitation should appear. Open **Explain this screen**: the overlay highlights task entry. Next advances without entering anything, and Done closes without starting a timer. Ordinary task/timer actions must not advance the guide.
2. Visit Plan, Schedule, Activity, Insights, Settings, Privacy and Smart Capture. Each may offer help, but none should open an overlay automatically. Explicitly open each tour; Next/Back/Skip must work. Missing targets or disabled controls explain the state without adding data or enabling features.
3. Dismiss an invitation, navigate away/back, then reopen the panel: the topic stays paused. Resume/replay through `?` → Help & tours. Turn invitations off: manual Explain this screen and Help remain usable. Enter an unsaved budget, open its tour, advance/back/skip/close: the form and value must survive. Closing a manually opened Kanban tour must not immediately start a Settings tour.
4. Upgrade with saved v0.13 guide progress/preferences: retain them. Tasks and timers never fabricate new progress. Restoring an app backup preserves device-local guide state; Erase local data on a disposable profile resets it.
5. Test English/Vietnamese, Paper/Night, 300/320/400px and wide panels, 200% zoom, reduced motion and keyboard-only use. The tour card must stay visible/scrollable; its target must remain visible when space permits. Tab/Shift+Tab stay inside the tour, Escape closes it first, and focus returns to its opener or Explain control. Background controls are inert. Closing a Smart Capture tour must keep the unsent capture text.
6. Start/pause a timer, reach a waiting Pomodoro phase and end a session: automatic invitations stay hidden. Explicitly opened help never stops the timer. The usage-based planning invitation must not stack with a tour or first-use invitation.
7. With optional features off, explore every guide, including Kanban after dismissing its original offer. Confirm no permission prompt, AI request, feature opt-in, task completion or schedule change. Tours never activate their highlighted controls.
8. Fail a guide write: Next must remain on the same step and report the failure; Close must still close. Task/timer saves remain independent. Concurrent panels must preserve unrelated guide progress. Content-script senders cannot access guide messages. These logic boundaries are covered by automated mocks; real browser focus remains a manual check.

## Local extras, AI and visual acceptance

1. At the end of privacy onboarding, toggle **Enable all local extras**. The review overlay must show purpose, local retention, exact site choices, permissions, and the separate AI boundary before any native permission request. Cancel preserves settings. Confirm requests only tabs/idle/notifications plus scripting and selected sites. Denial must not report success.
2. Select no sites: no host or scripting grant should be requested; the summary remains mixed because media stays off. Select one: only that origin is requested. Later-added catalogue entries remain inactive. Existing individually allowed sites are explicitly retained. Pause local extras: history is kept; background collection stops. Try Revoke access on one site and verify Chrome removes its grant.
3. Simulate one failing store during bulk enabling. The panel must refresh actual state and show a partial/mixed result, with an error. It must never imply a transaction succeeded across all stores.
4. A new Gemini connection selects 3.5 Flash-Lite, has manual-only mode, and does not enable collection or automatic features. Existing saved custom/older models remain. Opening/cancelling the automatic-mode warning sends nothing. Enabling this mode alone still enables no individual AI feature.
5. Set the shared automatic allowance to 1, enable an automatic feature, and trigger one mocked request. A second automatic request must stop; failures count. A manual request remains usable, subject to existing Activity/memory caps. Set 0 to pause. Raising/lowering the limit must preserve today's used count. Check local midnight reset and two panels competing for the last slot. No real API quota is needed for the automated suite.
6. Pause AI while an automatic request is held in flight: its response must not change task labels/memory. Disconnect/reconnect and backup restore must leave automatic mode off. Existing feature opt-ins migrate only once. Already-sent provider data cannot be recalled.
7. Check the Today task title, editable duration and Choose another. Selection alone must not save task changes or move blocks; starting must use the selected task. Long Vietnamese titles, theme contrast, numeric timer alignment and collapsed secondary tools must remain readable. Check About's MD Studio reference links.

## Small usability trial — not yet performed

Ask 3–5 people unfamiliar with the extension to add a title-only task and start focus, choose another task, finish without reflection, recover a delayed plan, and explain which data would leave the device. Repeat one task after a day without coaching. Record time to first focus, wrong turns, unwanted interruptions, confidence about privacy, and whether help was needed. Use observations to decide the next change; do not claim “effortless” from automated tests or a successful developer walkthrough.

## New daily-flow and privacy acceptance checks

1. Fresh profile, both EN/VI and both themes, 320px/400px/wide panel: choose simple defaults, then continue with optional features off. Confirm no optional permission prompts or network requests, no key requirement, and a usable local task/timer flow. All switches must have understandable purpose/data/permission explanations. Keyboard focus and labels must work.
2. Enable tracking, deny the permission and confirm the switch returns off. Try again and grant: only `tabs`/`idle` should be requested, without automatically enabling details, signals, AI, memory or reminders. Repeat for `notifications`; daily activity review remains separately off.
3. Enable media setup: no prompt yet and the feature stays off. Submit one exact HTTPS site: only `scripting` and that origin should be requested. Denial keeps it off. Grant and reload a compatible video page, then remove the site and confirm future signals stop. No wildcard hostname is accepted. Verify that Chrome's previously granted access remains until revoked there.
4. Gemini opt-in opens setup but remains off until **Connect & test** succeeds. A failed key/model test must not show it enabled. Remember-on-device is separately selected. Turning Gemini off disconnects it; the separate AI switches are not implicitly enabled on reconnect.
5. Toggle each remaining switch; reopen the panel and verify persistence. Simulate a storage/read failure: unavailable states must not be silently represented as reliable defaults or successful saves. Upgrade a v0.11 profile with existing choices: nothing is silently reset or newly enabled, and onboarding is not forced.
6. Enter one task title on Today. Start directly with the shown duration; change it before starting. Confirm the timer cannot replace a running/paused one. End it: the task stays open unless **Mark task done** is chosen. Advanced details remain available when editing; AI drafts expose all details for review.
7. Check Today with delayed blocks: open **Day changed?**, confirm remaining work, review a proposal, Apply and Undo. Simply viewing Today must not move or mark work. Try recovery after editing another schedule in another panel; stale proposals must be rejected.
8. Check grouped Activity, raw sessions, batch correction and empty conflict view. Reading estimates and unlabeled sessions must not require confirmation or trigger review notifications. Browser totals and timer minutes must remain distinct.

Suggested usability trial (not yet measured): first useful local action within a minute after essential setup; returning focus start in 1–2 actions; understand what each opt-in sends and how to turn it off; recover a changed day without reading these notes. Observe actual users before claiming these targets are met.

## Activity — start without AI

1. Back up tasks. Open Activity in English, then Vietnamese; inspect both themes at a narrow panel width. New tracking, detailed titles/resource IDs and AI must be off. Enable tracking, deny permission once and confirm it stays off; then enable and grant tabs/idle. Existing hostname totals must stay available but their collector should pause.
2. Read a page for 20 minutes without touching the mouse/keyboard. With the default 30-minute allowance, time should remain estimated rather than stop at 60 seconds. A long no-input interval should stay visibly estimated without requiring a review. Keep reading beyond the allowance and verify collection stops; Reading mode should extend it. Lock the device or leave Chrome: foreground time must stop. Allow for the sampling boundary (normally under a minute).
3. With titles/resource IDs off, inspect Activity export: hostname and intervals only, with no new title/path. Enable details, visit a page containing query parameters, then inspect a new record: query/fragment removed except supported YouTube video ID. Existing detailed records remain after turning details off. Confirm clearing Activity removes them after confirmation.
4. Add one allowed media site and approve scripting/that origin. Reload it, play/pause a supported top-frame video and inspect Why this record. Enable background listening and switch away from Chrome; eligible audible/unmuted player time can be estimated. Hidden paused tabs must not count. Revoke the site grant and ensure new signals stop. Cross-origin embedded players and built-in PDF viewers may have no signal; verify reading fallback remains honest.
5. Enable detailed recording, create two resource associations for the same task, and move between them. They should group by work. An exact resource association overrides a whole-domain rule. Save a correction with Remember checked and confirm only future matching resources are automatic; a title match/overlapping plan remains a suggestion.
6. Select two sessions, assign task/project/tags, and leave Confirm duration unchecked: the labels should save while time stays estimated. Reopen, trim or split, exclude, merge untrimmed sessions and use Undo. Confirm raw interval observations survive trimming, totals avoid overlap, and task/timer/schedule data do not change. Remembered rules persist after Undo and can be removed separately.
7. Open a review form, change language/theme or wait for a storage update; entered values should survive. A stale revision must reject the edit instead of silently overwriting changes. Refresh closes the editor; reopen it against current data. Check keyboard focus and details/checkbox controls.
8. Sleep longer than 90 seconds and resume; restart the browser separately. Neither gap should be filled. Export/import Activity: it should restore paused, without AI or active site settings. Task-backup restore pauses Activity; Erase local data clears it. Verify no private/internal/file pages appear.

## Optional AI attribution

1. Connect a test Gemini key, enable titles/resource recording and then Activity AI. Review the disclosure first. Use a closed unclear session, click Ask AI, and inspect candidates; choosing one opens the review editor, with Save required to apply it.
2. Correct the session while a response is pending or disable AI; the late response must not replace the correction. Three attempts, including failures, consume the local daily allowance. Automatic requests must not repeat an unchanged revision; manual retry may use another attempt.
3. Enable diagnostic text, repeat once and export a debug report: activity prompt/title/host/resource text must be absent. Mocked tests cover this boundary; a live provider request is an optional manual check and may consume quota.

## Desktop reminders

1. In Settings, enable desktop reminders and grant permission. Denial must leave the setting off. Set equal quiet times temporarily, create an upcoming short block and wait for the notice; Open should reach Schedule and Snooze should wait 10 minutes.
2. Reopen/restart the worker after delivery: it must not duplicate that event. Completing/deleting the task cancels its pending notice/snooze. Multiple eligible missed reminders should collapse into a summary. Expired notices are dropped.
3. Test a quiet window and a running/paused focus timer: no notification until suppression ends and only while the event remains eligible. Test a timer phase ending, then verify no subsequent phase starts automatically. Turn reminders off: visible Stuđiô notifications clear. Restore preferred quiet hours afterward.

## Delayed-work recovery

1. Use a disposable task with a past planned block. Open Plan → Schedule. It should appear in Recover delayed work, without changing itself or the schedule. Tasks with a running/paused/waiting timer should be excluded.
2. Select it and confirm a remaining amount different from the original estimate. Propose recovery: check the total, fixed future blocks, break gaps, deadline, workday and budget. A zero budget or impossible deadline should move it later or explain infeasibility, never increase capacity automatically.
3. Apply: old selected blocks become skipped and new blocks appear; the task remains unfinished. Undo immediately, including after reopening the panel. Edit the schedule before applying/undoing: a stale proposal/history must be rejected. Leave a proposal until its start passes and verify it requires regeneration.
4. Keep an older task/settings form open while applying recovery elsewhere. Saving it must not restore the old schedule. Repeat around midnight with overnight working hours and distinct budgets for both dates.

## Optional Kanban — no Gemini needed

1. Open Plan. Eisenhower and the daily budget should be visible by default. Today should have no Kanban invitation. Choose **Preview**: inspect real tasks without any task-edit controls or saved moves. Choose **Keep defaults/Not now** and reopen: the invitation stays dismissed, but **Settings → Kanban** remains available.
2. Pick a task for today, then explicitly **Enable Kanban**. It should enter Ready with a reason/date. A confirmed upcoming block today also qualifies; a proposal, past block or tomorrow's block does not. Remove the pick: the task stays Ready.
3. Under **Automatic moves & Undo**, undo that move: it returns to Backlog and shows automation paused. Reopen: it stays there. **Allow automation** permits today's pick/block to move it again. Check that new board changes, a blocker, completion or archive make older Undo unavailable.
4. Use **Start task** on two tasks. No timer should start; Doing and WIP should count two. Mark one blocked with a short reason: it still counts. Try a third task; cancel the WIP confirmation, then try again and choose **Start anyway**. The count should become 3/2 with a warning. Unblocking does not reduce WIP. Completing a task explicitly does.
5. Start a timer on an unheld Backlog/Ready task. It should enter Doing, explain the timer trigger, and warn if over the limit. Pause/resume or finish the timer: no duplicate move and no automatic task completion. Ending a session offers **Mark task done**. If Undo is used on the automatic Doing move, its timer must keep running and task automation must pause.
6. In Settings, test Ready sync, timer sync and hints independently; adjust WIP (1–10) and aging days (1–30). Turning off hides the board tab and stops its rules, retaining metadata/history. Re-enable while a timer is already running: it must not invent an earlier task start.
7. Switch to Tiếng Việt and test preview, enable, move, blocker, Undo and settings in both themes at narrow side-panel widths. User task titles and blocker text remain unchanged. Check keyboard activation of details, labels and dialogs. No horizontal board overflow should occur.
8. Export/restore a backup and reopen: opt-in, limits, blockers and valid history should survive. Return to Plan on reopening: Eisenhower remains the default. **Review proposal** on Today must still open Schedule.

Automated simulations cover seven-day review/aging boundaries without waiting, next-task ordering, the 100-move history limit, local midnight, completion metrics, stale/concurrent writes and failed-save recovery. These rules are local, with no Gemini or new permissions. Cycle time includes waiting/breaks; there is no productivity score. Weekly review is an in-app hint when revisiting the board, not a notification or an OS-scheduled job.

## Multi-source budget — no Gemini needed

1. Enable **Settings → Automatic daily budget**. Existing manual values must remain. On Today, choose **Use estimate** only if you want to clear today's override; picked tasks must remain.
2. Expand **How this estimate works → Budget sources**. Check recent-budget and focus-history medians/sample counts, any default contribution, blended baseline, workday cap, automatic result and today's workload. Without history, the default is used, capped by workday hours. With only one or two recorded days, the default fills the missing source weight. Existing pre-patch timer records can be used.
3. Pick a long task or add a scheduled block. Its work must affect overload, not raise available time. The same task's estimate, block and timer must not be added twice. Website time must not affect the estimate.
4. Set workday hours to 09:00–10:00. Automatic capacity must be at most 60 minutes; 22:00–02:00 caps it at 240 minutes. The cap covers the whole configured day, not only the hours left. Restore your preferred hours afterward.
5. Save today's budget as 0. Add/remove a task, toggle automatic budgets off/on and reopen: it must stay 0 until **Use estimate** is clicked. Tomorrow's budget must not copy today's override. Switch to Tiếng Việt and check the source disclosure and **Dùng ước tính** at a narrow panel width, in both themes.

Simulated tests cover the 28-day window, latest seven distinct days, partial/stopped sessions, sparse history, zero budgets, excluded automatic/default plans, local midnight, backup/reload, manual reset and storage failures. No waiting or API requests are needed for those cases.

## v0.9 changes

1. Confirm Today has no Planning assistance card. Enable it in Settings; change tabs and reopen to verify that the preference persists and the feature stays in Settings. Schedule a task directly from Eisenhower with assistance off.
2. Change Language to Tiếng Việt. Check Today, Eisenhower, timer setup and Settings. Task titles, notes and instructions must remain unchanged; controls and form names must still work. Switch back to English if preferred.
3. In Needs sorting, enable AI automatic sorting. A task with the note `Importance: important` can be classified locally. With Gemini connected, a task with a clear goal can be classified through one batch; uncertain tasks may stay unsorted. Inspect its reason and change the quadrant. Send it back to Needs sorting; the manual choice must remain until Allow AI sorting is chosen. The toggle is off by default. Cloud classification uses the connected key and quota.
4. Check the multi-source automatic budget using the steps above. A manually saved value for today always wins, including zero.
5. The planning invitation requires seven days and an average of at least 3 counted requests per day. Boundary, dismissal, one-time behavior and enable flows are covered by simulated dates/counters in tests; no need to spend requests just to trigger it.

## New time tools — about five minutes, no Gemini needed

1. **Today → Plan and time tools → Pomodoro**: choose a task, set focus and short break to 1 minute, long break to 2 minutes, two rounds, long break every two rounds. Start, pause, reload the extension, reopen, and resume. It should retain the remaining time.
2. After the focus minute, expect **Short break ready** and one recorded focus interval. Wait briefly: the break must not begin by itself. Choose **Start break**, then **Skip break**. Expect **Start next focus**. Start the next round, then choose **Finish Pomodoro** after it ends (or try the long break). The summary and Insights should include two focused minutes, with no break or paused time.
3. Try **Back to today** during a timer. Opening another timer should take you back to the current one. Check **Single timer** separately after finishing: it should retain the original one-interval behavior.
4. **Plan → Eisenhower**: existing tasks should appear under Needs sorting. Edit one task to important with urgency Auto and a deadline within 24 hours: it should move to Do first. Move it to Schedule using the dropdown: its urgency becomes a manual override; its deadline and notes remain unchanged. Edit back to Auto if desired.
5. **Pick for today**, set a small available-time budget, and check the overload indicator. Remove the pick and confirm the estimate changes. A task with an upcoming block still counts its scheduled minutes. Schedule on a card should open the manual form without adding a block until you save it.
6. Export a backup, reload, and verify the quadrant, day selection, budget, and any pending phase remain. Test at your usual narrow side-panel width and in both themes. Use Settings to set your preferred Pomodoro defaults afterward.

Automated coverage: see the current release count at the top; the timer, matrix and budget regressions remain included, along with `npm run check`. Tests use mocked browser APIs and UI fixtures. Live browser rendering and real extension alarm delivery still require this walkthrough; the previous preview attempt was blocked in this environment. Chrome may deliver alarms after waking from sleep; only the elapsed phase should be reconciled.

## Check minimal tracking — no Gemini needed

1. In Settings, inspect the older **Website time today** collector. It starts off. Click **Enable website tracking** and approve tab/idle access. Denial must leave tracking off; no Gemini connection is required.
2. Browse one ordinary website for about a minute, keeping the browser focused and interacting normally. Close the panel during part of this test. Reopen it and choose **Refresh totals**; its hostname and elapsed time should appear, not its full URL or title.
3. Switch to another website, then another Windows app. Only the foreground browser site's time should accrue. Refresh after returning; the time away must not be backfilled.
4. Stop input for over a minute, lock the device, or focus a private window. Counting should pause once the relevant idle/focus event is detected. Passive reading/video without input can be undercounted; this is an intentional MVP limitation.
5. Pause tracking, browse, and refresh: saved totals should remain unchanged. Re-enable only if desired. Clearing requires confirmation, removes all tracked days, and pauses tracking without deleting tasks or memory.
6. For a recovery check, suspend the computer for over two minutes or restart Chrome. Resume/refresh: no sleep or closed-browser time should be added. Up to one unfinished minute may be lost.

Snapshots are refreshed manually in this minimal UI; the background counts while the panel is closed. Do not enable debug text or spend a Gemini request merely to test tracking. Report any issue with the window/tab sequence and approximate times; the Gemini debug export excludes browsing data.

## Check the model dropdown

1. Open **Settings → Gemini connection**. If connected, **Gemini model** should already be visible as a dropdown, with the active model labeled separately. If disconnected, choose **Set up Gemini** to see the setup dropdown.
2. Pick a listed model. This must not send a request or switch the active connection yet.
3. Choose **Custom model ID…**. An ID field should appear. Switch back to a listed model: the custom field should hide and not affect submission. In setup, changing the dropdown must not clear a key already pasted into the form.
4. When ready to spend one test request, choose **Use & test model**, or **Connect & test** during setup. A successful test selects that model; a failed model change keeps the current connection.

The catalog and its last-checked date are unchanged in this patch. No automatic model discovery or background connection tests are added.

## Check the review-dialog fix

After your next normal capture with **Allow multiple focus blocks** enabled:

1. Click **Task details and assumptions**. It should expand to show Notes, Deadline, Energy, Priority, and the returned assumptions. If the model supplied none, it should say **No assumptions were provided for this task.** Optional notes/deadlines can still be blank.
2. Collapse it, then focus the summary with Tab and use Enter or Space to expand it again.
3. Toggle **Include block** using both its checkbox and label. The selected-block count should follow your choice; nothing should be saved yet.
4. Edit a task field and use the **Add selected blocks** button (with its displayed count). One confirmation should save the selected blocks; the timer should stay idle.
5. On another draft, check that the close button or a click outside the dialog discards it, but clicking inside does not.

Expanding, editing, selecting, saving, and discarding a draft do not send another Gemini capture request. The automated regressions check click cancellation and handlers; native pointer/keyboard behavior still needs this Chrome check.

## Start without API calls

1. Open **Settings**, enable **Planning assistance**, and select **Guide me**.
2. Expand **Create a task or block**. Write a task yourself, choose its minutes, and save. It should appear in Open tasks without a schedule or running timer.
3. Choose **A scheduled focus block**, select that task, and enter a future start and your own duration. Save: one manual block should appear in Plan; the timer must remain idle.
4. Try another block at the same time. It should refuse the overlap and retain the form.
5. In Settings, add an explicit memory. Edit it and try Undo under Recent memory changes. Custom Instructions must remain unchanged.

## Try Gemini sparingly

Each action below uses one request. Stop after the feature that interests you most.

1. Type a planning question under **Optional Gemini brainstorming** and choose **Help me think it through**. Questions/ideas should appear; your manual form must remain unchanged.
2. Switch to **Suggest my next step** and ask once. Existing tasks should not be duplicated or renamed. **Review focus setup** must open review, not start a timer.
3. In the connection card on Today or Settings, use the visible **Gemini model** dropdown. Select only the model you want, then **Use & test model**. No key re-entry is needed. Failure should keep the prior model.

## Try asynchronous memory

1. Read the disclosure under **Settings → Saved memory → Learn from my activity**, then enable it if you accept sending that data.
2. Add an observation for learning, for example “A short reading session felt manageable today.” Or save/edit a task or record a timer after opting in.
3. Choose **Refresh memory now** once. The result may be tentative, an observation, a conflict, or no change. One note need not establish a lasting preference.
4. Inspect **Why this is saved** and **Recent memory changes**. Confirm an entry only if you agree; otherwise edit or forget it.
5. Request planning help again. **What informed the last Gemini request?** should identify relevant selected memories.
6. Forget a test entry and check that it and its supporting learning evidence disappear. Forget cannot be undone; original tasks/timers and exported files remain separate.

Automatic learning runs near the configured local workday end, or catches up after reopening. Chrome must be running; it does not wake a sleeping device. Active timers or interactive Gemini work defer automatic updates. A manual update uses that day's automatic slot; all memory calls share a three-per-local-day cap. Failure retains evidence and imposes a 15-minute backoff before a manual retry.

## Report an issue

Open **Settings → Gemini diagnostics → Export debug report** and attach the JSON to the development chat. Text is excluded by default. To share the actual prompt, memories/evidence, and provider error, enable **Include prompt and custom instructions in debug reports** before one retry, then inspect the export. Keys remain redacted.

Mention the mode, action, result, and what you expected. A screenshot helps with layout issues.

Automated tests use simulated DOM/storage/browser APIs and mocked provider responses. Real Chrome permission prompts, tab/focus/idle events, and visual behavior still need this walkthrough. Whole-device and native-app tracking are not present.
