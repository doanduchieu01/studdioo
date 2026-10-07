# Store submission notes for v1.0.0

This is Stuđiô's first official release. The archive places `manifest.json` at its root and includes the source, tests and release documents. Nothing has been uploaded to Chrome Web Store. Official release status does not imply store approval or completed real-browser acceptance.

Update and check the public privacy-policy URL against `PRIVACY.md` before submission. A hostname-only explanation is insufficient for optional titles/resource IDs, per-site media signals, reminders and AI attribution. The live policy, developer account, distribution settings, screenshots and support destination have not been verified in this release review. Open decisions are recorded in `LAUNCH-READINESS.md`.

The approved feature set includes user-started explanation overlays, an inactive media catalogue, and local AI mode/allowance metadata. Required/optional permissions and host declarations are unchanged. The bulk local shortcut presents a warning and exact selected sites before the native permission prompt; it does not enable AI, sharing, remembered keys or debug text. Existing feature consent stays independent of guide completion. Include this local metadata behavior and separate automatic-AI mode in the published privacy policy. No live website update has been performed.

## Purpose

Stuđiô helps users plan study/work, track estimated browser sessions, review their task/project labels and receive reminders. Collection and AI attribution are separately optional; records do not claim to establish attention or productivity.

## Permissions

| Permission | Justification |
| --- | --- |
| `storage` (required) | Keep tasks, timers, settings, local activity/review data, notification state and device-local guide progress. |
| `sidePanel` (required) | Display the planner, timer, Activity review and settings in Chrome's side panel. |
| `alarms` (required) | Reconcile timers and opted-in tracking/reminders while the panel is closed. Delivery depends on browser/device availability. |
| `tabs` (optional) | Read the current normal-tab URL/title after tracking consent; derive hostname and optionally resource identity/title. No history import. |
| `idle` (optional) | Detect lack of input/device lock and label or bound passive estimates. It cannot establish attention. |
| `notifications` (optional) | Show opted-in block/deadline/timer/review reminders with Open/Snooze controls. |
| `scripting` (optional) | Run packaged playback/visibility sampling code only on individually approved media sites. No remote code or page-content scraping. |
| Optional HTTP(S) hosts | Permit the user to add a specific media site's origin. No blanket host grant is requested by the UI; only that site's player/visibility metadata is used. |
| `generativelanguage.googleapis.com` (required host) | Send explicitly requested or separately opted-in AI requests to Gemini with the user's configured key. |

All extension JavaScript is packaged locally. Activity AI inputs are minimized and excluded from debug prompt text. Review the store's current disclosure form against the actual behavior in `PRIVACY.md`; this file is a technical submission aid, not a claim of store approval.

Before publishing, run the installed-browser walkthrough in `TESTING.md`, including permission denial/revocation, site playback compatibility, notifications and English/Vietnamese layout. The release's automated tests simulate Chrome APIs and Gemini; they are not a substitute for that live check.

## Data-disclosure review

Local processing still needs disclosure. The current implementation handles browsing records, user activity and an optional authentication credential; optional features count even when they start off. Compare every current dashboard category with the full data inventory, including user-entered text, retained imported profile fields and page/player metadata. Do not claim that no user data is handled, that no browsing records exist, or that all processing is local when Gemini is enabled. The extension reads current tabs, not Chrome's historical browsing database.

AI responses are treated as data and validated; they are not executed as remotely supplied JavaScript. All executable extension code is packaged. No analytics SDK, account service or advertising service is included.

Resolve the provider-data-use and local-storage questions in `LAUNCH-READINESS.md` before certifying Limited Use compliance. Do not paste an affirmative compliance statement merely because this file contains permission justifications.

## Reviewer route

1. Open the side panel and complete onboarding with optional features off. Add a title-only task and start/end focus. No account or API key is needed for core planning.
2. Open Privacy choices. Inspect local extras, cancel its warning, then enable one feature. Denial must leave the feature off. AI remains independent.
3. Open an on-demand guide, advance/close it, and confirm no task, permission or timer was changed by guide controls.
4. Test Activity, reminders and recovery using the focused cases in `TESTING.md`. Use dummy task titles and disposable records.
5. AI needs a user's Gemini key and provider access. The publisher must supply an appropriate private reviewer testing arrangement if requested; do not embed credentials in this ZIP, the public listing or screenshots. Provider eligibility and data handling must be resolved first.

## Listing and publication

Lead with the local task → focus → resume workflow. Disclose optional browser-time estimates prominently if advertising tracking. Show real, redacted screenshots of Today, recovering a delayed day and privacy choices. Avoid promises of measured attention, guaranteed media compatibility, free AI for every account, all-device tracking, automatic task completion or cloud backup.

The store can link to a support site and provides a support hub. Set up a reachable channel; the current in-app feedback note is saved locally and is not a support submission. Verify the public privacy/support links while signed out. Check publisher-account security and keep a copy of the exact submitted package/version.

When ready, deferred publishing allows review to finish before you manually release the item. That is an optional launch-control choice, not a change to v1.0.0's official status. No store submission, rollout or contact with reviewers has been performed here.

Official references checked 2026-10-07: [prepare the package](https://developer.chrome.com/docs/webstore/prepare), [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use), [listing/support](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), [publish](https://developer.chrome.com/docs/webstore/publish).
