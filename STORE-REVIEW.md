# Store submission notes for v0.14.0

This ZIP is an unpacked development release; nothing has been uploaded to Chrome Web Store. Update the public privacy-policy page to reflect `PRIVACY.md` before submitting this version. The previous hostname-only explanation does not describe optional titles/resource IDs, per-site media signals or AI attribution.

The v0.14 redesign adds user-started explanation overlays, an inactive media catalogue, and local AI mode/allowance metadata. Required/optional permissions and host declarations are unchanged. The bulk local shortcut presents a warning and exact selected sites before the native permission prompt; it does not enable AI, sharing, remembered keys or debug text. Existing feature consent stays independent of guide completion. Include the new local metadata behavior and separate automatic-AI mode in the published privacy policy. No Web Store submission or live website update has been performed.

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
| `notifications` (optional, new) | Show opted-in block/deadline/timer/review reminders with Open/Snooze controls. |
| `scripting` (optional, new) | Run packaged playback/visibility sampling code only on individually approved media sites. No remote code or page-content scraping. |
| Optional HTTP(S) hosts (new) | Permit the user to add a specific media site's origin. No blanket host grant is requested by the UI; only that site's player/visibility metadata is used. |
| `generativelanguage.googleapis.com` (required host, existing) | Send explicitly requested or separately opted-in AI requests to Gemini with the user's configured key. |

All extension JavaScript is packaged locally. Activity AI inputs are minimized and excluded from debug prompt text. Review the store's current disclosure form against the actual behavior in `PRIVACY.md`; this file is a technical submission aid, not a claim of store approval.

Before publishing, run the installed-browser walkthrough in `TESTING.md`, including permission denial/revocation, site playback compatibility, notifications and English/Vietnamese layout. The release's automated tests simulate Chrome APIs and Gemini; they are not a substitute for that live check.
