# Stuđiô release history

**1.0.0 is the first official release.** Earlier versions record development history. Newest releases appear first.

## 1.0.0 — First official release (2026-10-07)

- Promote the approved v0.14.0 feature set to the first official release; no new features, permission grants or data-schema changes.
- Use Stuđiô as the installed English/Vietnamese name. Remove active prototype/beta labels from Settings and website tracking, and retire evaluation-software wording.
- Correct stale privacy documentation to include optional media-site access and desktop notifications.
- Add a concrete launch-readiness review covering real-browser acceptance, public disclosures, Gemini audience/provider terms, local-data protection, support and usability.
- Package `manifest.json` at the archive root for unpacked installation and store upload. Public submission/publishing remains a separate action.

## 0.14.0 — On-demand help and separate AI controls (2026-10-07)

- Redesign Paper/Night surfaces, Today hierarchy and timer presentation with original visual elements. Add Choose another without changing the saved plan. Credit MD Studio and its reference apps in About.
- Default new connections to Gemini 3.5 Flash-Lite while preserving explicit saved model choices.
- Add a final local-extras toggle with a warning and exact site/permission review. Keep AI, key persistence and debug text separate. Cancel, denial and partial failures display saved state.
- Add ten inactive media-site presets to Privacy and Activity, plus explicit Chrome site-access revocation. Updates cannot auto-grant added sites.
- Add manual-only AI mode for new profiles, a separate automatic-mode confirmation and a serialized daily allowance shared by sorting, Activity and memory. Preserve existing automation opt-ins once; disconnect/restore pauses automation. Failed attempts count, manual requests remain separate, and existing feature limits still apply. Discard stale automatic responses after pause; keep unsent work retryable when the allowance runs out.
- Replace action-driven lesson cards with optional invitations and user-started spotlight overlays. Nineteen bilingual explanations have Next/Back/Skip/Close, keyboard trapping, Escape, target fallback and reduced-motion support. Tour controls preserve underlying form drafts and never activate the highlighted feature.
- Keep app schema 12; migrate guide metadata to version 2 and add separate AI-policy version 1. No new required permissions, analytics, website/backend deployment or Telegram integration.
- Pass 407 automated cases using mocked Chrome/DOM and Gemini. Browser installation failed in the build environment; real browser visuals, permission prompts, media players and usability remain manual acceptance checks.

## 0.13.0 — Progressive, interactive onboarding (2026-10-05)

- Add nine contextual guides with fifteen bilingual steps: first task/focus, priorities/budget, scheduling, Activity, Insights, optional AI/personalization, privacy, Kanban and Smart Capture. Guidance appears as a feature is opened, not in one mandatory tour.
- Show me where reveals and focuses the real target without clicking it. Guides are non-modal, skippable, pausable and replayable from Help & tours, with an independent automatic-tip preference. Escape pauses a lesson when no existing dialog/capture takes precedence. Automatic tips do not interrupt timers or post-session review.
- Record basic milestones after successful task/timer/proposal actions. Information acknowledgments and skipped steps stay distinct. Existing app history seeds first-use progress once; explicit replays remain replayable.
- Store bounded lesson IDs/states only in a separate local store. Serialize extension guide writes; preserve app data on guide-write failures. No guide data goes to AI, backups or telemetry. Backup restore preserves this device's progress; local-data erase resets it. App schema remains 12.
- Keep privacy onboarding and consent independent. Opening or finishing a guide does not enable a feature, request permission, submit AI input, apply a schedule or complete a task. Required/optional Chrome permissions and host access are unchanged.
- Add core, mocked-DOM and background regression tests, including progress persistence, bilingual text, replay, failed saves, concurrency, sender restrictions and consent boundaries. Installed-Chrome visual/permission QA remains a documented manual step.

## 0.12.0 — A simpler day and explicit privacy choices (2026-09-30)

- Today now begins with one-field local capture and a direct, editable-duration focus start. Timer setup, budgets and scheduling remain available under a secondary disclosure. Gemini connection/model management stays in Settings.
- Onboarding has a short defaults path and a privacy screen with independent saved switches, purpose/data explanations and exact Chrome permission disclosures. Tracking, detail recording, site signals, background listening, desktop reminders, optional daily review, Gemini, sorting, instruction sharing, memory sharing/learning and debug text remain separate choices. Existing legacy tracking is visible when enabled.
- Permission requests happen only from the corresponding user gesture. Declined permissions and unsuccessful Gemini tests leave features off. Media access requests target one explicit origin; wildcard hosts, credential-bearing URLs and non-web schemes are rejected. Disabling a feature does not claim to erase history or revoke retained Chrome grants.
- New installations default custom-instruction and saved-memory sharing off, as well as daily activity-review reminders. Existing saved choices survive schema-12 migration and onboarding replay.
- Activity opens as a grouped day summary. Unlabeled/estimated sessions no longer create review obligations; optional review surfaces unresolved association conflicts. Raw sessions and batch corrections remain accessible.
- Delayed-work recovery is discoverable on Today and still requires remaining-work confirmation, proposal review and Apply. Ending any task timer offers an explicit completion choice; timer completion alone never completes a task.
- EN/VI coverage, regression tests and consent/migration tests added. This remains an extension release; website/backend and Telegram are not deployed.

## 0.11.0 — Activity, reminders and reviewed recovery (2026-09-30)

- Add opt-in session tracking with estimated passive reading, bounded reading mode, adaptation from confirmed reviews, per-site player evidence, optional background listening, restart/sleep-gap handling and seven-day retention.
- Add separate project/tag catalogs, exact-resource and explicit domain associations, explainable local candidates and optional bounded Gemini suggestions. Preserve uncertainty and keep browsing out of timers, budgets, task completion, learned memory and debug prompt text.
- Add the Activity tab with batch attribution, duration confirmation, trim/split/merge/exclude, revision-guarded Undo, association management, gap explanations and a separate activity backup. Keep drafts across unrelated renders and escape imported/user content.
- Add optional desktop reminders for planned blocks, deadlines, timer phases and daily activity review, with local quiet hours, focus suppression, restart deduplication and 10-minute snooze.
- Confirm the old scheduler did not recover missed blocks. Add local delayed-block detection and remaining-work review → proposal → Apply → Undo. Preserve future commitments, honor deadlines/workday limits/calendar-day budgets and breaks, and reject stale plans or writes.
- Migrate the app to schema 11, preserve existing data and legacy tracking, and keep new data/AI/site/notification consent off by default. Add optional notifications/scripting and per-site optional host permissions; required permissions and Gemini host stay unchanged.
- Add English/Vietnamese controls, regression tests, updated privacy/install/test guides and shared type/core documentation for future website/backend integration. Telegram, cloud sync and deployed web/backend changes remain deferred.

## 0.10.0 — Optional, explainable Kanban (2026-09-20)

- Keep Eisenhower and the daily budget as the default Plan view. Offer read-only Preview, explicit Enable and persistent Not now; keep controls in Settings and avoid a new Today card. Existing proposal review still opens Schedule.
- Add Backlog, Ready and Doing metadata to existing tasks; derive Done from explicit completion and exclude archived tasks. Show compact collapsible columns, blocker reasons and a soft WIP limit of 2. Manual starts beyond the limit require confirmation; actual timer starts stay visible with a warning.
- Add opt-in local Ready sync from today's picks/confirmed blocks and Doing sync from new task timers. Never import old timer starts, start timers, reschedule, change priorities, unblock work or complete tasks automatically. Manual moves and Undo pause automation per task until allowed again.
- Explain automatic moves with reason/time/evidence and retain the last 100 with guarded Undo. Serialize writes with timers; preserve current Kanban data across stale app saves. Undo leaves task text, schedules, priorities and live timers unchanged.
- Add explainable next-task suggestions, aging/deadline hints, an in-app seven-day review and honest flow measures with sample counts. Each rule group is configurable. Completed-session UI asks before marking the task done. Turning off retains board history.
- Localize all controls/explanations in English and Vietnamese. Migrate schema 9 to 10, preserving existing data and adding board metadata to backups. No new permissions, network calls, learning evidence or AI context.

Validation: 293 automated tests and package audit pass, including 42 new Kanban/background/UI checks. Chrome APIs and rendering fixtures are simulated; actual Chrome layout, keyboard behavior and alarm delivery still require TESTING.md. No Gemini quota used.

## 0.9.1 — Multi-source daily budget (2026-09-19)

- Blend recent manual-budget medians with daily recorded focus plus estimated breaks. Use up to seven recorded days per source within the prior 28 local days; default budget supports sparse history. Missing days remain unknown. Exclude today's partial history, future dates and generated budgets from learning signals.
- Cap estimates by configured workday hours, including overnight windows. Compare today's tasks, blocks and timer work against the budget without inflating capacity to hide overload. Keep all calculations local, with no new AI requests, permissions or website/calendar access.
- Show values, sample counts and the simple weighting rule in a collapsed English/Vietnamese explanation. Add Use estimate to explicitly clear only today's manual override; keep task selections and preserve zero-minute manual values otherwise.
- Keep schema 9 and all existing preferences, data and unrelated features.

Validation: 251 automated tests and package audit pass, including 23 new multi-source and UI regressions. Browser APIs are mocked; live Chrome rendering and actual extension delivery still need the TESTING.md walkthrough. No Gemini quota used.

## 0.9.0 — Sorting, planning controls and Vietnamese (2026-09-18)

- Add AI automatic sorting inside Needs sorting: explicit local rules, bounded Gemini batches, conservative uncertainty handling, reasons, manual overrides and retry controls. Validate task IDs and revisions; stale results and disabled sorting cannot change tasks.
- Move Planning assistance to Settings with an enable switch. Keep manual scheduling in a separate dialog. Offer a one-time invitation after seven days when counted AI requests average at least three per day over the previous seven full days.
- Add optional daily budget estimates from recent manually saved availability. Preserve explicit daily overrides, including zero.
- Add English/Vietnamese switching in Settings and onboarding, localized Chrome metadata, locale-aware dates, brief AI response instructions, and shorter UI copy. Preserve all user-authored text.
- Migrate app schema 8 to 9 with no new permissions. Preserve classifications, Pomodoro state and existing app data; all new optional features begin off.

Validation: 228 automated checks and package audit pass. Coverage includes prompt thresholds and dismissal, local/AI sorting, stale edits and toggle cancellation, quota-safe retry behavior, usage counters, budget history and overrides, language switching, escaping and preserved user text. Gemini responses and Chrome APIs are mocked; live Chrome rendering and a real Gemini call were not verified.

Upgrade: replace files in the same unpacked extension folder and click Reload at `chrome://extensions`. See TESTING.md.

## 0.8.0 — Pomodoro, Eisenhower, and daily time budget (2026-09-17)

- Implement adjustable Pomodoro focus/break rounds, long-break cadence, explicit phase starts, skip/finish, pause/resume, and cumulative summaries. Retain one-off timers; count focus only in history.
- Add the four Eisenhower quadrants and an unsorted section. Preserve task IDs and old priorities; importance is explicit, and urgency can follow deadlines or a manual override.
- Add a daily time budget and task selection, account for scheduled work and remaining timer rounds without duplicate task estimates, and show spare time/overload plus estimated breaks.
- Serialize timer actions, alarm reconciliation, app saves, and restore operations. Preserve timer history across stale form saves; rebuild alarms after worker startup. Mark completion at the stored deadline, avoiding sleep-related date drift or unattended extra rounds.
- Migrate app schema 7 to 8, preserving tasks, settings, memory, and the existing timer. Backups include new fields and daily plans. Required/optional permissions and remote host access are unchanged.

Validation: 210 automated checks and static package audit pass. New coverage includes round/break sequencing, pause/reload, late alarms, duplicate/concurrent actions, migration/backup, urgency boundaries, time-budget accounting, and UI flows. Browser rendering was not verified: the available browser blocked the local preview address. Gemini remains mocked in tests; no quota was consumed.

Update: export a backup, replace files inside the same unpacked extension folder, click Reload at `chrome://extensions`, and confirm Settings shows v0.8.0. See TESTING.md for a five-minute acceptance walkthrough.

## 0.7.0 — Minimal local website-time tracking (2026-09-12)

- Add **Website time today** on Today and Settings: opt-in enable, pause, manual refresh, today's total, top five hostnames, and confirmed clear-and-pause.
- Request only optional tabs/idle permissions from the enable gesture. Keep required permissions and remote hosts unchanged; no content scripts, history import, or Gemini calls.
- Count the active HTTP(S) site in the focused normal browser window. Use tab/focus/idle events and a one-minute heartbeat. Exclude private windows/tabs and internal/file pages; pause after 60 seconds without input or when locked/unfocused.
- Persist bounded daily totals and a recovery cursor atomically in a separate store. Split midnight locally, retain seven days/100 hostnames per day with aggregate overflow, serialize writes, and invalidate in-flight snapshots when clearing. Browser-session IDs and a 90-second maximum gap avoid long downtime backfill.
- Keep all website data out of Gemini, memory evidence, diagnostics, and backups. Restore pauses tracking while keeping its local totals; Erase local data clears them. App schema 7 and all earlier features remain unchanged.

Limits: estimates rather than full screen-time measurement; passive reading/video and delayed events can undercount, while browser UI time can remain attributed to the active site. Pausing drops the unfinished interval. No native-app tracking, automatic classification, AI advice, detailed-history UI, or cross-device sync is included.

Validation: 191 automated tests and static package audit pass, including 14 new tests for permissions, privacy, foreground/idle boundaries, midnight/retention, restart recovery, serialized writes, failure/clear handling, and the UI/heartbeat. Tests use simulated browser APIs and mocked Gemini; no API quota used. Actual Chrome permission/event behavior and visual rendering remain for the short manual walkthrough in TESTING.md.

Update: export a backup, replace the existing unpacked files, reload, and confirm v0.7.0. Tracking stays off until enabled and optional access is approved. No app-data migration is needed.

## 0.6.2 — Visible Gemini model dropdowns (2026-09-11)

- Replace the setup text-input/datalist with a labeled native **Gemini model** dropdown.
- Show the connected-model dropdown directly, without expanding a disclosure, and make the connection card available in both Settings and Today. Label the active model separately from an untested draft choice.
- Retain the existing model catalog and add an explicit **Custom model ID…** choice in both dropdowns. Reveal only the relevant custom-ID field; hide and disable it for listed models.
- Preserve draft selections across renders and update the custom field without rebuilding the API-key form. Choosing an option makes no request. An explicit Connect & test or Use & test model action sends one test; a failed model change retains the active connection.
- Keep the v0.6.1 dialog fix, app schema 7, memory, permissions, model catalog, and API limits unchanged.

Validation: 177 automated tests and the static package audit pass with mocked responses and no Gemini quota used. Four added tests cover discoverability, setup/custom IDs, no request on selection, no key-form rebuild, draft persistence, subsequent request routing, and failure handling. Native Chrome visual/keyboard checks remain manual; see TESTING.md.

Update: export a backup, replace files in the same unpacked extension folder, reload at `chrome://extensions`, and confirm Settings shows v0.6.2. No data migration is needed.

## 0.6.1 — Review-dialog interaction fix (2026-09-11)

- Fix delegated click handling that mistook inner dialog controls for the surrounding close-on-click backdrop. It cancelled native disclosure toggling, checkbox/label actions, and submit-button behavior. Inner controls now retain browser defaults; explicit action buttons and direct backdrop clicks still work.
- Show **No assumptions were provided for this task.** when a captured task has an empty assumptions list. Notes, Deadline, Energy, and Priority remain available regardless of optional model text.
- Add five regression tests using cancelable click events and ancestor-aware targets, covering summaries, inner controls, selection changes, submission, close buttons, backdrops, and escaped/empty assumptions. Existing tests bypassed native click cancellation and missed this interaction.
- Keep app schema 7, memory, settings, permissions, Gemini schemas/models, and request limits unchanged. No new feature work or API calls are included.

Evidence: the supplied v0.6.0 report's latest multiple-block capture completed successfully with HTTP 200 and nonempty model text. Source inspection and failing-before/passing-after click regressions identify a local interaction bug. The report excludes model output, so it cannot establish the exact notes or assumptions for that response. Separate earlier timeouts in the report are not addressed by this patch.

Validation: 173 automated tests and the static package audit pass with mocked Gemini responses and no API quota used. The regression harness checks cancellation and application handlers, not native Chrome rendering. Pointer/keyboard walkthrough steps are in TESTING.md; live Chrome verification remains pending.

Update: export a backup, replace files in the same unpacked extension folder, reload at `chrome://extensions`, and confirm Settings shows v0.6.1. Do not remove the extension. No data migration is needed from v0.6.0.

## 0.6.0 — Guided planning, learning memory, and model choices (2026-09-10)

- Add **Guide me · I make the plan**, selected by default for the new planning assistant. Local questions and a blank user-authored form work offline; optional Gemini brainstorming supplies questions, steps, and ideas without prefilling or saving the form. Manual focus blocks are checked for overlaps and deadlines and never start automatically.
- Offer **Suggest my next step** as the alternative mode. It reads a fresh bounded task/schedule/timer snapshot, validates existing task references, and opens manual review before any action.
- Keep Custom Instructions user-controlled and add a separate memory store with explicit, confirmed, supported-observation, tentative, and conflict statuses; topics, expiry, evidence, history, corrections, and forget/undo controls.
- Add opt-in learning from new task/review/timer events and explicitly submitted learning notes. Old feedback, diagnostics, and planning-chat text are excluded. Inferred preferences require confirmation. The model cannot update tasks, timers, schedules, or Custom Instructions.
- Persist update jobs, quota reservations, and evidence. Limit automatic work to one batch per local day and total memory calls to three; cap batches at 40 events. Pause during focus/interactive calls; retain evidence on errors with backoff and reject stale results after edits, forget, clear, pause, or restore.
- Add seven verified standard-text free-tier Gemini options. Test a selected model with the current key and preserve the prior model on failure. Keep the default model unchanged; no automatic switching.
- Expand diagnostics to report version 4 with memory/planning actions and bounded, separately opted-in memory-context text. Default reports remain metadata-only.
- Add memory/evidence backup support and app schema 7. Restore app and memory in one storage operation, with learning paused. Preserve existing tasks, capture choices, and Custom Instructions.
- Restrict peak-hour analytics to the stated seven-day window.
- Explicitly distinguish recorded timer time from actual device usage. Measured screen/app/browser time and cross-device tracking remain a future core workstream, not implemented telemetry in this release.

Validation: 168 automated tests and the static package audit pass. Logic, app/storage, and provider-boundary tests use fabricated credentials and mocked Gemini responses; no API quota is consumed. The audit checks release consistency, script syntax, permissions, host boundaries, and embedded-key absence. Live API acceptance remains unverified. The cloud browser blocked the local preview with ERR_BLOCKED_BY_CLIENT, so visual Chrome rendering is unverified. See TESTING.md for the test drive.

Update: back up first, replace files in the same unpacked extension folder, reload, and check Settings for v0.6.0. Learning is off by default; enabling it sends new activity evidence, existing saved-memory texts, and enabled Custom Instructions in later background requests. The new guided mode does not disable the existing Capture or Plan features.

## 0.5.4 — Multiple-block schema compatibility and provider errors (2026-09-10)

- Send separate task and focus-block arrays with zero-based task references. Remove nested block arrays and array-size constraints from the multiple-block API schema to reduce schema complexity. Regroup blocks locally for the existing review screen, retaining all task/block limits, duration totals, date checks, and atomic saving. Single-task capture keeps its existing API schema.
- Recognize flat and nested provider errors, single-element array wrappers, and Interactions error lists. Normalize known status/code forms and give an export-debug-report action for an unexplained HTTP 400.
- With debug text enabled, retain the specific provider error message alongside the prompt and instructions, capped at 4,000 characters and with API keys redacted. Complete response bodies, other debug details, headers, and model output remain excluded. Turning the option off or clearing history also removes these error messages and prevents in-flight requests from restoring them.
- Identify the new schema and error envelope in report version 3. Earlier records cannot recover provider messages that were discarded.
- Clarify that explicit requests for suggestions may use relevant projects or goals in enabled custom instructions. Suggestions remain drafts with assumptions; capture cannot retrieve existing task titles or the actual plan.

Evidence: the supplied v0.5.3 report showed a successful connection test and HTTP 400 for multiple-block capture before model text returned. Its saved instructions were present. The specific rejected parameter was absent from the report. Schema complexity is a compatibility hypothesis, not a confirmed root cause; the error-parser limitation is confirmed in the code. See Google's [structured-output limitations](https://ai.google.dev/gemini-api/docs/structured-output) and [SDK error handling](https://github.com/googleapis/python-genai/blob/main/google/genai/errors.py).

Validation: 124 automated tests and the static package audit pass, using mocked Gemini responses and no API quota. Flat responses now exercise the app's review, editing, deselection, and save flow. Tests cover task ownership, invalid references, error envelopes, redacted error text, purging, and in-flight setting changes. An unauthenticated connectivity probe timed out; live Gemini acceptance of the new schema and visual Chrome rendering remain unverified.

Update: replace files in the existing unpacked extension folder and reload in Chrome. Keep multiple blocks on and, for diagnosis, enable debug text before retrying once. If it still fails, export a fresh debug report. Backup schema 6 and existing memory/toggle choices are preserved; no automatic API retries are added.

## 0.5.3 — Optional debug text and instruction defaults (2026-09-10)

- Add **Include prompt and custom instructions in debug reports**, off by default, in Gemini diagnostics. Opted-in future attempts record the actual request prompt and the saved instructions sent with it. API keys are redacted; headers, raw provider errors, generated responses, disabled instructions, and connection-test text remain excluded.
- Remove saved debug text when the toggle is turned off. Changes to the setting and history clearing also prevent in-flight attempts from restoring text. Keep the setting across restarts, separately from app backups, and reset it to off with local-data erasure.
- Mark debug reports that contain request text and any truncation. Limit captured prompts to 30,000 characters and instructions to 10,000.
- Default **Use with Gemini** to on for new instructions. Empty text sends nothing; saving remains explicit. Preserve saved off choices through edits, replay, and backups. Schema 6 migrates only empty, untouched memory from the old off default.
- Keep debug-text inclusion independent of instruction usage. The toggles, exports, and local saves make no API calls.

Validation: 120 automated tests and the static package audit pass, using mocked Gemini responses and no API quota. Coverage includes Settings defaults, exported text, key redaction, text removal, in-flight requests, storage failures, and memory migration. Live Gemini behavior and visual Chrome rendering remain unverified.

Update: replace the existing unpacked extension files and reload in Chrome. To include text when reporting the current Gemini issue, enable the debug-text toggle before reproducing it, then export the debug JSON. Existing instructions previously saved off remain off; check **Use with Gemini** and save to enable them.

## 0.5.2 — Gemini debug reports (2026-09-09)

- Add **Settings → Gemini diagnostics → Export debug report** and **Clear debug history**. Keep the last 20 attempts locally, including successful attempts for comparisons between capture modes.
- Record the app version, model, capture mode, failure stage, HTTP/provider status, error category, timing, and character counts. Reconstruct records from an allowlist on write and export; exclude API keys, prompts, custom-instruction text, task data, raw provider errors, and model output.
- Distinguish API rejections from returned drafts that fail parsing or local validation. Recognize schema-related failures, empty task lists, inconsistent durations, invalid dates, timeout/network errors, and usage limits.
- Give an explanatory message when Gemini returns no task drafts. Capture cannot retrieve an existing plan from an overview question because existing task titles are excluded from its context.
- Preserve debug records through worker reloads, exclude them from app backups, and clear them with local-data erasure. Diagnostic storage errors do not change the outcome of an assistance request. No new Chrome permissions or API calls are added.

Validation: 109 automated tests and the static package audit pass, using mocked provider responses and no API quota. Coverage includes the downloaded JSON, privacy boundaries, record retention, concurrent attempts, and storage recovery. The reported live multiple-block rejection has not been reproduced against Gemini; this release adds the evidence needed to diagnose it. Visual Chrome rendering remains unverified.

Update: replace files in the existing unpacked extension folder and reload it in Chrome. Reproduce the issue on this version, export the debug JSON, and attach it to the support chat. Failures from earlier versions cannot be recovered. Backup schema 5 and the 10,000-character instruction limit remain unchanged.

## 0.5.1 — Longer custom instructions (2026-09-09)

- Raise the custom-instruction limit from 2,000 to 10,000 characters across the editor, character counter, save validation, stored memory, backups, and Gemini requests.
- Preserve existing saved instructions. This patch keeps backup schema 5 and requires no data migration.
- Explain that enabled instructions are sent in full with each assistance request, and that older releases retain only 2,000 characters when restoring longer instructions.

Validation: 101 automated tests and the static package audit pass. Existing memory checks now exercise longer text through save/reload, backup round-trips, and all three assistance request types, plus the new length boundary. Tests use mocked Gemini responses and no API quota. Live Gemini and visual Chrome checks remain unverified.

Update: replace files in the existing unpacked extension folder and reload it in Chrome. Existing memory and settings are preserved.

## 0.5.0 — Gemini capture with multiple focus blocks (2026-09-09)

- Add **Allow multiple focus blocks** in Smart Capture and Settings. Default it on for **I'm just starting out** and off for **I have my own system**; preserve explicit overrides through upgrades, backups, and onboarding replay.
- Let one Gemini request propose up to six tasks and twelve focus blocks with meaningful stages, variable lengths, and suggested start times. Keep the original single-task flow when the toggle is off.
- Add an editable review with block selection and one confirmation that saves tasks and scheduled blocks together. This path does not require Plan or use its rule-based splitting.
- Validate all selected blocks before saving, including work hours, deadlines, buffers, and conflicts that appeared during review. Preserve drafts after failed saves and reject duplicate submissions.
- Display individual block labels in the schedule and focus views. Timers remain manually started.
- Send only the note and scheduling context, including busy intervals without existing task titles or notes, plus enabled saved custom instructions.
- Upgrade to backup schema 5 while preserving existing tasks, settings, onboarding choices, and memory. Save toggle overrides, block labels, and capture provenance in backups.

Validation: 101 automated tests and the static package audit pass. Tests exercise the app and background handlers with a DOM/storage harness and mocked Gemini responses; no API quota is used. Live Gemini output remains unverified. The browser environment blocked access to the local preview, so visual rendering in Chrome could not be checked.

Update: export a backup, replace files in the existing unpacked extension folder, and reload it in Chrome. The app migrates existing data automatically. Automatic focus/break cycles and asynchronous usage-based memory remain deferred.

## 0.4.1 — Visible release versions (2026-09-07)

- Show the installed release number at the top of Settings.
- Name the download `Studio-B2-v0.4.1-Chrome-Extension.zip`.
- Introduce this changelog and document the feature/patch numbering policy.
- Check agreement between the app, Chrome manifest, package metadata, README, and changelog during the package audit.
- Retain the manual memory behavior and backup schema 4 from v0.4.0.

Validation: 74 automated tests and the static package audit pass. Tests use a DOM/storage harness and mocked Gemini responses; no API quota is used. Live Gemini behavior and visual rendering in Chrome remain unverified by these automated checks.

Update: replace files in the existing unpacked extension folder and reload it in Chrome. Export a backup first. This patch requires no app-data migration.

## 0.4.0 — Manual memory (2026-09-07)

- Add editable custom instructions in Settings, with explicit save, on/off, discard, and clear controls.
- Include enabled, saved instructions in requested Gemini task drafts, plan explanations, and reflections; exclude them from connection tests.
- Persist instructions locally and in backups; migrate earlier states to empty, disabled memory using schema 4.
- Disclose what is sent to Gemini and what happens when instructions are disabled, cleared, or restored.

Validation: 74 automated tests and the static package audit passed with mocked Gemini responses. Automatic, asynchronous usage-based memory was deferred for later discussion.

## 0.3.0 — Onboarding and Gemini setup

- Require explicit onboarding selections and Continue actions; offer Gemini setup now or later.
- Add replayable onboarding without erasing app data.
- Update the default Gemini model and structured-response schema handling; improve request-error messages.

Validation recorded for this delivery: 54 automated tests and the static package audit passed. A successful live Gemini request was not established.

Earlier A/B1 milestone labels predate this changelog. No numeric release history is invented for them.
