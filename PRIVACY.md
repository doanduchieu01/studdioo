# Stuđiô v0.12.0 privacy notes

There is no Stuđiô server or analytics SDK. App data is in Chrome extension-local storage, without application-level encryption. Optional website tracking estimates foreground browser use, not whole-device screen time or other apps. Neither timer nor website records prove attention or productivity.

## Onboarding and ongoing control

The privacy screen is available during onboarding and at **Settings → Privacy choices**. It explains purpose, data use and permissions for tracking, titles/resource IDs, per-site signals, background listening, desktop reminders, daily review, Gemini connection, automatic sorting, instruction sharing, saved-memory sharing, background memory learning and debug text. An enabled older website-total collector is shown separately so it can be paused. No switch silently enables its prerequisites.

Core planning requires `storage`, `sidePanel` and `alarms`. The Gemini host is declared at installation, but the grant alone neither connects Gemini nor sends task data. Optional permissions are requested only when enabling the related feature or adding a named site. Denial, setup cancellation and failed key tests leave the relevant feature off. Media access never requests a wildcard hostname or all-sites grant. Declining all optional features leaves task entry and timers usable.

New installations default instruction and saved-memory sharing off; existing saved choices are preserved, including previously enabled sharing. Daily-review reminders now default off and, if enabled, concern conflicting resource associations rather than mere estimates or missing labels. `profile.privacyReviewVersion` records completion of this local explanation, not blanket consent; the individual feature stores remain authoritative. Disabling does not delete history, provider data or exported files. Media site removal stops signals but Chrome may retain previously granted host access until revoked manually.

## Optional Activity sessions (v0.11.0)

Session tracking is off by default and requires optional **tabs** and **idle** access. It stores a separate rolling 7-day observation history, bounded to 1,500 sessions, 240 intervals per session, 100 gaps and 20 guarded edit records. Seven-day pruning runs on reads/writes; inactive storage is pruned when the extension next checks it. Sessions record start/end, hostname, evidence kind, uncertainty, editable task/project/tag assignments, suggestions, confirmation/exclusion and revision metadata. Project/tag catalogs (100 each) and saved resource associations (200) remain until removed or cleared. Undo history includes the before-edit session; raw observations remain after trim/exclude. The tracker persists its outstanding cursor locally and a random browser-session marker in session storage so restarts do not fill unknown time.

**Record titles and exact resource IDs** is separately off by default. When enabled, titles (200 characters) and HTTP(S) origin/path resource keys (700 characters) can be saved. URL fragments and arbitrary query parameters are removed; supported YouTube video IDs are retained. Paths and titles can themselves contain sensitive information. Turning this option off stops new detailed collection and disables Activity AI; existing records, associations and backups are retained until removed/expired/cleared. Page content, typed input, screenshots and visit history are not collected.

Optional **scripting** and per-site HTTP(S) host access allow an isolated top-frame script to read video/audio playback and page-visibility/Picture-in-Picture booleans. Site access is requested one origin at a time. There is no static script on all sites. Scripts are registered only for enabled sites while tracking runs; removing a site or pausing stops collection/unregisters future injection. Current scripts stop on the next denied heartbeat. Signals live in session storage for freshness checking and include tab/resource/time metadata, not page text or keystrokes. Granted Chrome site permissions remain until revoked through Chrome. Private windows/tabs and browser/file pages are excluded.

Reading and media durations are estimates, never attention/completion evidence. Reading adaptation is a local bounded median of confirmed examples; no model training or provider request is involved. Rules and review edits never complete tasks or change deadlines. Browser time is excluded from budgets, learned-memory evidence, ordinary assistance context and timer history.

Activity's AI switch is separately off by default and requires detailed recording plus a connected Gemini key. It authorizes automatic and manual suggestion batches: at most 8 closed unclear sessions, session IDs, titles, hostnames, rounded minutes, local candidate IDs/reasons, up to 40 active task IDs/titles and catalog names/IDs. Full resource URLs, task notes/deadlines, page content, Custom Instructions and learned memories are omitted. Up to 3 attempts per local day, including failures; unchanged batches are not automatically repeated, with 30 minutes between automatic requests. Manual corrections, disabled AI, changed tasks/catalogs and stale revisions invalidate in-flight results. Data already sent cannot be recalled. Suggestions remain unconfirmed until saved explicitly.

Detailed Activity has a separate JSON export/import; it is excluded from the ordinary app backup. Export includes observations, labels, associations and suggestions but omits cursor, Undo and quota fields. Import restores tracking/AI paused and removes active site grants from its settings; existing Chrome permission grants are unaffected. **Clear activity** deletes this store's observations, labels, associations, suggestions and Undo, pauses collection, and retains daily quota counters. **Erase local data** clears it too. Task-backup restore pauses Activity and preserves its existing local history. Previous exported files and provider-held data are separate copies.

## Optional reminders and local recovery

**notifications** is optional and granted only through the reminder setting. Notifications may reveal task titles on the desktop/lock screen according to OS settings. Reminder preferences, up to 500 delivered event IDs/timestamps, 50 snoozes and 50 recent notification entries (including title/message) live locally in a separate store. Turning off stops delivery and clears visible notifications; Erase local data or task-backup restore clears reminder state. No Telegram, email, push server or external calendar is contacted. Quiet hours and eligibility use local time. Browser closure/sleep can delay or prevent delivery.

Recovery stores one pending proposal and up to 10 applied histories locally: selected task/block IDs, confirmed remaining minutes, replaced/new blocks and a snapshot fingerprint for conflict checks. Fingerprints include scheduling-related task/preferences/timer data, not browsing details. Apply and Undo require explicit actions; they do not establish task completion. Recovery/reminder histories are excluded from app backups and cleared on task-backup restore/reset. New schedule blocks themselves are ordinary app data and are included in app backups.

## Legacy website-total tracking

Off by default, requiring a click and optional **tabs** and **idle** access. Tab metadata is used to obtain the active HTTP(S) site's hostname in the focused normal browser window. No Chrome history API, historical visit import, website host permissions, or content scripts are used. Private tabs/windows and browser/file pages are excluded.

The separate local store contains daily hostname totals (subdomains included) and a hostname/time/session cursor for recovering from service-worker suspension. Full URLs, query strings, paths, titles, content, and screenshots are never persisted. Up to seven local-calendar days are retained and pruned on the next tracker check, capped at 100 distinct hostnames per day; overflow contributes only to an aggregate total. A random recovery-session ID lives in Chrome session storage and prevents backfilling a new browser session.

Website data is not sent to Gemini and is excluded from learned memory, task/timer evidence, diagnostics (including opted-in debug text), and app backups. Tracking is independent of focus timers and makes no network requests.

Pause stops collection and keeps saved totals, discarding the unfinished interval. Clear tracking data asks for confirmation, permanently removes all website totals, and pauses tracking. Erase local data clears them too. Backup restore pauses tracking without importing or deleting local website totals. Optional permission grants remain until revoked through Chrome; revoking access stops collection. Previously exported tasks and memory are unaffected.

The display is an estimate: samples occur on browser events and about once a minute. No input for 60 seconds reports idle and stops further counting, so passive reading/video may be undercounted. Browser UI use can remain attributed to the active website. Long gaps over 90 seconds are skipped. No inference of attention, productivity, or health is made.

## Optional Kanban

Off by default. Preview does not change tasks; enabling is explicit and can be reversed in Settings without deleting history. Local rules may move today's picked/scheduled tasks to Ready and newly started task timers to Doing. Manual choices and Undo pause task automation. No task completion, timer start, rescheduling or additional AI request is automatic.

The app store keeps opt-in/dismissal, limits and switches, review dates, per-task stage/start/Ready timestamps, manual holds and blocker text (up to 300 characters). It retains the last 100 automatic moves with before/after board metadata, reason, local date and relevant task/block/session IDs for guarded Undo. These records and blockers are included in app backups. They are excluded from Gemini prompts, learned-memory evidence and diagnostics. Kanban adds no network access, permissions, remote service or website/calendar collection.

In-app aging/weekly-review hints are calculated when the board renders; they are not notifications or background monitoring jobs. Flow counts are derived from existing tasks and observed board starts, not a productivity judgment. Turning off keeps saved metadata; Erase local data removes it, but previously exported backups are separate copies. Existing opt-in memory learning may still use ordinary task completion/timer events under its own settings, independently of Kanban.

## Data sent to Gemini

All AI requests use Google's Interactions API with `store: false`. Assistance requires a named action or an enabled automatic feature. **AI automatic sorting** authorizes classification while the panel is open. **Learn from my activity** separately authorizes background memory requests. Activity AI separately authorizes the limited browser-summary requests below. All three are off by default.

| Operation | Request data |
| --- | --- |
| Connection/model test | Small fixed prompt; no instructions, tasks, or memories. |
| Single capture | Entered note and prompt time/default duration context. |
| Multiple-block capture | Note, timezone/time, focus/workday settings, buffers, and nearby busy intervals; no existing task records directly. |
| Plan explanation | Proposal and task titles, estimates, deadlines, priority, and energy. |
| Reflection | Aggregate timer/task statistics; no task records directly. |
| Guide me brainstorming | Submitted reflection, up to 20 active tasks with short notes, upcoming blocks, timer totals. |
| Suggest my next step | Current task/schedule/timer snapshot. |
| Opted-in automatic sorting | Up to 10 unsorted task titles, short notes, estimates, priorities, deadlines, urgency and the chosen goal, plus enabled instructions and relevant memories. |
| Opted-in Activity attribution | Up to 8 session summaries, 40 open task titles/IDs and project/tag catalogs; no full URLs, page text, task notes, instructions or memories. |
| Opted-in learning update | Up to 40 pending evidence events, all saved-memory texts/status/topics, enabled Custom Instructions. |

Except for connection tests and Activity attribution, saved enabled Custom Instructions accompany assistance and learning updates, in full up to 10,000 characters. Unsubmitted drafts are not sent. Task details you write there are consequently sent too.

**Use saved memory in assistance** defaults off on new installations (existing choices are preserved) and, when enabled, selects up to eight relevant explicit/confirmed/supported entries with up to 4,000 text characters. Expired, tentative, and conflict entries are excluded. Reflection selects only explicit/confirmed preferences. Memories can contain task details even when raw task records are excluded.

Disabling saved memory in assistance does not disable the updater's access to existing memories. Turn learning off to stop updates too. Saving the local guided form, manual memory edits, settings, exports, local scheduling, and timer operations make no direct AI call. Eligible task/timer evidence may later be sent if learning is enabled.

## Evidence and user control

Learning starts with new activity after opt-in: saved task titles/estimates, changed-field names and before/after durations, reviewed block-duration edits, task completion, recorded timer outcomes, and notes explicitly submitted for learning (up to 1,600 characters). Historic activity, old feedback, diagnostics, unsubmitted forms, and planning-chat text are not imported.

Accepted Gemini drafts, user edits, and timer events have distinct provenance. The model is instructed not to infer health, personality, motivation, attention, or measured device usage. Local count thresholds do not prove an observation true; inspect and correct entries.

Updates can change only the separate learned store. They cannot overwrite Custom Instructions or explicit/confirmed entries; conflicts wait for review. Inferred preferences remain tentative until confirmed. There is no model-weight training.

Pausing learning invalidates in-flight results, deletes unprocessed evidence, and keeps saved entries/supporting history. Re-enabling starts with future events. Data already sent cannot be recalled.

Forget purges the entry, its memory revisions, and supporting learning evidence. Non-text fingerprints suppress exact regeneration. This does not delete original tasks/timer history, other entries, previous exports, opted-in debug copies, or provider-held data. New evidence could support a similar inference.

Clear learned data removes entries, evidence, memory history, and context traces, and pauses learning. Quota/backoff counters remain to avoid unintended repeated calls. Custom Instructions and tasks remain. Erase local data additionally clears app tasks/history, instructions, diagnostics/text consent, and credentials.

Retention is bounded: 100 memories, 500 evidence events, 40 memory changes. Old evidence/history can age out. Context explanations reference memory IDs, not extra copies of text, and edits invalidate them.

## Keys, quotas, and provider terms

Keys live in Chrome session storage unless Remember on this device is selected. A remembered key is stored in extension-local storage. It is sent only to the configured Gemini host in the `x-goog-api-key` header, never a URL, and excluded from backups as a credential field.

Free-tier availability/billing depend on the Google project. A free-tier model does not make a paid project free. `store: false` disables Interactions storage, not other data handling. Google's [pricing page](https://ai.google.dev/gemini-api/docs/pricing) states that free-tier content may be used to improve its products. Submit content only if you accept applicable terms.

The memory updater allows at most three requests per local day, including failures, and at most one automatic batch. Activity attribution has its own separate three-attempt daily cap. Other Gemini actions and automatic sorting have no app-enforced daily cap. Sorting reserves each task revision before sending and requires an edit or explicit retry after uncertainty/failure. The counter does not know remaining project quota. There is no automatic model switching.

## Diagnostics and backups

The last 20 attempts are kept locally. By default reports include technical metadata/counts, not text.

Include prompt and custom instructions in debug reports is off by default. When on, future reports can include prompts (30,000 characters), instructions (10,000), selected-memory context (10,000), and provider errors (4,000). Learning-update prompts can contain task/timer evidence and existing entries. Activity attribution never logs its prompt, titles, URLs or model reasons even when debug text is enabled. Truncation is marked.

Active and recognizable Gemini keys are redacted on logging/export. Complete provider bodies, request headers, and model output are excluded. Turning debug text off purges text and blocks in-flight restoration of it. Clearing diagnostics does likewise. Previously downloaded reports are separate files.

Export downloads JSON, uploads nothing, and makes no API call. Inspect optional text before sharing. Diagnostics are never learning evidence.

App backups include tasks, schedule, settings, instructions, task/timer history, feedback, memories, and evidence. They exclude credentials, diagnostics/settings, updater jobs/quota, memory undo history, and context traces. Restore writes app/memory together, pauses learning, and retains device quota/backoff. Imported memory-use choices are retained, so enabled memories can accompany the next assistance request.

Arbitrary text in tasks, feedback, and Custom Instructions is not automatically scrubbed for credentials in backups. Do not paste keys there. Memory/debug redaction is a best-effort guard, not encryption or data-loss prevention.

This is evaluation software. It imports no external conversation history or user profile automatically.

## Time management (v0.9.0)

Eisenhower importance/urgency, daily selected tasks and time budgets (up to 90 days), and Pomodoro settings/progress are stored with app data on this device and included in app backups. Only focus intervals are recorded as focus sessions; break and paused time is excluded. Pomodoro, manual sorting and budgets do not require an API call or additional permissions. Opted-in AI sorting sends the data listed above. Existing optional memory learning can still use timer records under its existing settings. Toolbar phase badges use the existing extension action; v0.11.0 adds optional desktop reminders separately. No audio playback is added.


## Usage prompt, language and automatic budgets

App-local usage stores an observation start, daily request counts (up to 35 recorded dates), and whether the one-time planning invitation was shown. It counts user-requested Capture, explanation, reflection and planning-help API attempts, including provider failures after sending. Connection tests, sorting, Activity attribution and memory updates are excluded. Counts are never sent to an analytics service or used as AI context. They are included in app backups and erased with local data.

The invitation uses the seven preceding completed local days, including zero-use days, and never enables planning automatically. Dismissal persists. Existing installations begin observation on upgrade without reconstructing earlier use.

Automatic budgets combine existing manually saved budgets, recorded focus sessions plus estimated breaks, default budget and workday settings, locally. Today's selected tasks, scheduled blocks and current timer are compared against the estimate to flag overload; task demand cannot increase capacity. No extra history store, API call, permission, calendar access, or website-tracking inference is added. Missing recorded days are not treated as zero availability. Focus time does not prove attention or productivity. Manual daily overrides take precedence until explicitly cleared with Use estimate. Language choice, sorting metadata and saved budget sources remain in app backups. Changing language preserves user text; new AI assistance requests ask for brief responses in the selected language.
