# Activity, reminders and recovery — integration contract v1

This release implements the extension and its local browser preview. It does **not** deploy a website, backend, account system, cross-device synchronization or Telegram bot. The separation below is the starting point for those clients without rewriting the tracking policy.

## Ownership

| Layer | Current implementation | Future website/backend use |
| --- | --- | --- |
| Observation and attribution policy | `src/core/activity.js` | Reuse normalization, interval union, rules, corrections and AI validation. |
| Browser observation adapter | `src/activity-controller.js`, `src/activity-signal.js` | Extension only. A website cannot use this adapter to observe other browser tabs. |
| Task/planned/timer state | `src/core/state.js`, schema 12 | Reuse stable task/block IDs; keep browser observations out of timer totals and completion rules. |
| Reviewed recovery | `src/core/recovery.js` | Reuse detection, allocation, snapshot checks and guarded Undo behind transactional storage. |
| Reminder eligibility | `src/core/reminders.js` | Reuse event identities and eligibility; delivery belongs to a channel adapter. |
| Chrome persistence/delivery | `src/background.js`, controllers | Replace Chrome storage, alarms and notifications with account-aware database/jobs/channel adapters. |
| UI adapter | `src/platform.js` | Current extension runtime messages or localStorage preview; future authenticated API calls can implement the same operations. |
| Shared record types | `src/core/contracts.d.ts` | Structural types for frontend/backend TypeScript. Runtime normalization remains mandatory. |

The core modules require modern JavaScript, `Date`, `URL`, `structuredClone` and `crypto.randomUUID`; they do not depend on Chrome, DOM or network access. Their tests run with Node. Current date/quiet-hour decisions use the device's local timezone; a server must supply a user's IANA timezone explicitly instead of treating its own timezone as theirs. Store UTC instants and retain the chosen timezone for future scheduling.

## Data boundaries

Schema 12 adds `profile.privacyReviewVersion` (0 or 1) as a local UI acknowledgment, not a blanket consent grant. Each feature's existing setting remains authoritative. New clients must copy the granular opt-in and failure behavior, not infer consent from onboarding completion or a connected Gemini key. Existing true/false choices survive migration; new instruction/memory sharing and review-reminder defaults are false. `src/core/daily-flow.js` is a pure next-action selector, not a timer or scheduling side effect. `needsReview` now identifies unresolved association conflicts, not estimated attention or missing labels.

- **Observed intervals:** start/end, hostname and evidence (`browser`, `reading`, `media`, `background-media`), uncertainty and reason codes. Optional title/resource identity is separately consented. Player evidence does not establish attention.
- **Review overlay:** confirmation, exclusion, included bounds, manual attribution and revision. Trimming keeps raw intervals. Split/merge preserve interval time; union prevents overlap being counted twice.
- **Attribution:** task/project/tag IDs, optional overlapping planned-block ID, source and reasons. AI suggestions are candidates; a manual Save or saved local resource rule chooses the assignment. A planned overlap alone never proves identity or completion.
- **Plan:** task estimate, deadline, future blocks and an explicit reviewed remaining amount. Browser intervals never implicitly decrease the estimate or move blocks.

`studioActivity` is version 1, separate from `studioState` schema 12. Activity export/import has envelope `{format:"studio-activity-backup",version:1,exportedAt,activity}`. It contains sensitive optional titles/paths; do not make it public or use it as telemetry. Projects/tags are attribution catalogs in this release, not new task entity fields. App and Activity backups are separate; sharing IDs matters when moving both.

Resource keys keep origin/path and only supported content IDs (currently YouTube `v`). Arbitrary queries/fragments are removed, so two URLs differing only in an unsupported query can collapse. Entire-host rules are explicitly selected; exact rules win. Restored/unknown IDs can remain historical text, but new assignments validate against the current task/catalog state. Names are display text and must be escaped, never used as identity.

## Operations and concurrency

The current platform surface is `getActivity`, `performActivityAction`, `requestActivityAI`, `getReminders`, `performReminderAction` and `performRecoveryAction`. Activity actions are settings, reading, rule-save/delete, assign, confirm, exclude, trim, split, merge, reclassify, undo, clear and restore; site grants are Chrome-specific.

For an API adapter, use authenticated owner/device scoping, stable operation IDs and optimistic per-session revisions. Reject a stale edit rather than merge it blindly. Preserve immutable observations and manual corrections ahead of derived labels. Deduplicate device imports by device/session/segment identity; union time for reports instead of summing overlapping clients. These server controls are requirements for the future adapter, not implemented cloud features.

Current single-worker queues serialize local writers. AI quota is persisted before the request, including failures. Responses apply only to unchanged unknown sessions, with unchanged consent/catalog/task context. Manual edits are locked. Undo validates the resulting revisions; remembered rules remain independently editable. For server delivery, put quota reservation, operation deduplication and writes in database transactions. Never trust client-supplied owner IDs, time ranges, candidate IDs or consent flags without server validation.

Recovery stores a pending snapshot and the last 10 applied histories. Apply marks selected old blocks skipped and adds the proposal in one Chrome storage write. Scheduling revisions prevent an older app form from restoring a pre-recovery schedule. The local algorithm greedily orders deadlines/priority, places chunks sequentially within a seven-day horizon and keeps existing future blocks fixed. It is a feasible-slot heuristic, not an optimal solver; infeasible tasks keep their old blocks. Both dates of an overnight interval must satisfy their budgets. Undo requires an unchanged relevant snapshot; even relevant preference/timer changes can invalidate it.

## AI and privacy

The existing Gemini provider is optional. Rule-only collection/review/recovery works offline. Activity AI uses its own opt-in, batch limit 8, active-task limit 40, 3 attempts per local day and 30-minute automatic cooldown. The payload is titles/hosts/minutes/candidate IDs and label catalogs. It excludes full URLs, content, task notes/deadlines, Custom Instructions and learned memory. AI cannot invent IDs, create tasks, complete tasks, alter deadlines or change schedules. Activity prompt text is excluded even from opted-in debug reports.

A future backend should enforce the same per-account quota server-side, separate collection consent from cloud sync and AI consent, honor deletion/retention, and use data minimization before any provider call. Existing local exports are not an authorization to upload them. No cloud credential or Telegram secret belongs in the extension bundle.

## Reminder delivery and Telegram later

Event IDs identify a block plus start time, a task plus deadline, a timer phase, or one review date. The controller applies quiet hours/focus suppression, eligibility expiry, persistent deduplication and ten-minute snooze. Chrome delivery needs the browser running and may be delayed by sleep. A web client alone cannot guarantee delivery while closed.

The future backend can store channel-neutral events and delivery receipts with a unique `(accountId,eventId,channel)` key, then attach web push, extension or Telegram adapters. Coordinate suppression/snooze across channels to avoid duplicate reminders. Telegram would need explicit account linking, authenticated webhook handling, bot credentials on the server and unlink/revoke controls. None is configured or active here.

## Acceptance gates for a future integration

1. Replay the same fixtures through extension and API adapters; normalized intervals, labels and recovery decisions must match.
2. Test duplicate/offline/out-of-order uploads, timezone/DST changes and overlapping devices without doubling totals or discarding manual corrections.
3. Apply and undo recovery transactionally while tasks/timers change; a conflict must fail visibly.
4. Prove per-account authorization, consent revocation and deletion across all copies before enabling sync.
5. Verify reminder deduplication/snooze across two clients and two channels before introducing Telegram.

Extension acceptance is documented in `TESTING.md`; `PRIVACY.md` describes current data use, not planned server behavior.
