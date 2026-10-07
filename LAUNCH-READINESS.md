# Stuđiô v1.0.0 — public-launch assessment

Reviewed 2026-10-07. **v1.0.0 is the first official release**, promoting the approved v0.14.0 feature set. This package has not been submitted or published. My recommendation is to freeze features, resolve the concrete launch gaps below, and then launch with a small initial audience. Calling it official does not require broad distribution on the same day.

## What this release establishes

- App, manifest and package identify v1.0.0; the installed EN/VI name is Stuđiô. Active pre-release labels are removed. Historical changelog entries remain historical.
- Tasks, focus, local planning, optional Activity/media estimates, reminders, reviewed recovery, separate AI controls and on-demand help retain their existing behavior. App schema remains 12 and the upgrade introduces no permission or consent changes.
- The package contains source, tests and documentation, with `manifest.json` at the ZIP root. There is no Git repository attached to this project; this is a recorded package release, not a newly created Git tag.
- Verification uses 407 automated cases with simulated Chrome/DOM APIs and mocked Gemini, plus the release audit. These checks cover logic, not real permission dialogs, visual usability, screen readers, OS delivery or provider account eligibility. Installed Chromium was unavailable after failed browser downloads.

## Decisions and evidence required before broad public launch

| Priority | Current evidence | Concrete next action | Completion evidence |
| --- | --- | --- | --- |
| Before submission | Public privacy-policy content and dashboard disclosures have not been verified. The bundled policy describes current behavior. | Publish an accurate policy; match it to every current data category, permission justification and user-facing promise. Resolve the AI/storage questions below before certifying compliance. | Public URL opens while signed out; publisher reviews the form against the current data inventory. |
| Before AI distribution | Gemini accepts a user-supplied key; the extension has no age, distribution-region or billing-eligibility checks. | Decide the intended audience/regions and an eligible provider arrangement. An AI opt-in or user-supplied key does not itself settle eligibility. | Documented audience and provider decision, reflected in the actual product and listing. |
| Before submission | Tasks, browsing records and optional remembered credentials persist without application-level encryption. | Review storage protection, key persistence and content-script access. Resolve secure-handling requirements; disclosure alone does not establish compliance. | Reviewed protection design and tested implementation where changes are needed. |
| Before broad launch | Automated behavior is covered; real Chrome acceptance is outstanding. | Run the five scenarios below on an actual installation, including upgrade and recovery. | Recorded Chrome/OS version and pass/fail results; no unresolved data-loss or consent failures. |
| Before broad launch | In-app feedback is a local note. No public support destination is configured in the package. | Establish a monitored support route and explain how reports reach it. Provide a small release history and known-issues page. | A new user can find the route and understand that local notes are not submitted. |
| Before claiming effortless use | No observation of unfamiliar users has been completed. | Observe 3–5 people without coaching; repeat a task the next day. | Most can complete the core flow and correctly explain privacy choices without help. Record the failures, not just the average. |

## AI and data protection deserve a separate decision

Google's current [Gemini terms](https://ai.google.dev/gemini-api/terms) restrict API use to adults and clients not directed toward or likely accessed by under-18s; EEA/UK/Switzerland distribution requires paid services. Unpaid inputs can be used for product improvement and human review; sensitive/personal information must not be submitted. These are material constraints for a study planner.

Chrome's [Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use) restricts downstream use, transfer and human access. **My assessment:** do not assume broad AI consent makes the current unpaid-provider path suitable for task/browsing data. Resolve the provider arrangement or keep that path unavailable for the affected audience/data. This report does not determine compliance on the publisher's behalf.

The [data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including its encryption-at-rest guidance, and [secure handling policy](https://developer.chrome.com/docs/webstore/program-policies/data-handling) need to be reconciled with the present local-storage design. Do not describe local-only storage as encrypted or safe for secrets. Session-only keys are the default, but remembering a key persists it. A key saved beside encrypted content is not a meaningful protection against someone reading the profile. Chrome also supports [restricting storage access to trusted extension contexts](https://developer.chrome.com/docs/extensions/reference/api/storage); the current code does not set that restriction. This is a hardening recommendation, not evidence of an observed exploit.

No provider terms, authentication flow, encryption scheme or feature consent was silently changed during this release promotion. These remain explicit launch decisions.

## A practical acceptance session

Use dummy data and a disposable profile for destructive cases. Preserve the current working installation and export **both** app and Activity backups first. Detailed steps are in `TESTING.md`.

| Scenario | What a passing result looks like |
| --- | --- |
| First five minutes | Decline optional features, add one title-only task, start focus, close/reopen the panel and end the session. No AI key, permission detour, lost task or surprise completion. |
| A disrupted day | Start/pause/resume, let the device sleep, restart Chrome, and recover delayed blocks with review → Apply → Undo. No invented sessions, lost work or silent schedule change. |
| Consent under pressure | Cancel/deny the bulk warning and native permissions; enable one site; revoke it; pause AI during a pending response. UI states reflect actual grants and settings; future collection/requests stop as documented. |
| Media and reminders | Try foreground reading, paused video, background audio, an unsupported/embedded player and quiet hours. Time stays honestly estimated; no simultaneous double count or duplicate notification. Do not advertise every preset as verified compatible. |
| Upgrade, recovery and access | Upgrade in the same unpacked folder; restore both backups in a disposable profile; inspect EN/VI, Paper/Night, narrow widths, 200% zoom, keyboard and a screen reader. Tasks and choices survive; guides remain dismissible and do not conceal controls. |

Moving from a local unpacked installation to a different Chrome Web Store extension ID needs its own backup/import check; do not assume the new listing inherits local storage. Never uninstall the working copy until both restored datasets have been checked. This release does not provide account sync or automatic cloud backup.

## My product criticism

The core route is now coherent: add a task, choose what fits, start. The remaining risk is **decision load**. There are many useful controls; new users can still mistake configuring the planner for making progress. Keep the first visit focused on one successful session. Keep AI setup, catalogs, memory and detailed tuning available when needed rather than making them prerequisites.

For an observed usability session, use these provisional targets: first focus within a minute after essential setup; returning focus in one or two deliberate actions; no unwanted overlay during focus; and a correct explanation of what leaves the device. These are proposed targets, not measured results. If someone misses one, repair that specific interaction before adding a feature.

The current two-backup design is another real source of effort. Someone can reasonably believe the app backup includes Activity when it does not. Clear backup instructions are required now; a unified backup/restore preview is a strong candidate for the next compatible release.

## Useful next improvements, in order

1. **Recovery confidence:** one backup entry point that clearly includes/excludes Activity, shows what restore will replace, and displays the last successful export. Preserve the separation of credentials and consent. Validate with someone restoring their own dummy project.
2. **A quick privacy pause:** a prominent temporary pause and a persistent compact status showing local tracking and AI separately. Add a per-site do-not-record list if early users need it; excluding a saved session is different from preventing collection. Do not turn this into a productivity score.
3. **A support handoff users control:** show version, browser/OS and reproduction steps, preview/redact diagnostics, and let the user choose what to submit. No automatic task, browsing or key upload. Local feedback should be labeled clearly or connected to this flow.

Defer Telegram, accounts, sync and additional automation until repeated usage identifies a need. Each would add another setup or reliability obligation. Maintain the goal of making the next action easier, and treat fewer corrections, fewer interruptions and successful return visits as better signals than more tracked minutes.

## Release operation

Keep this package as the reproducible v1.0.0 baseline. Any subsequent shipped change gets a new version and a short changelog entry. Confirm publisher-account security, prepare real screenshots using dummy data, make public links reachable, and keep a repair/recovery procedure ready. [Deferred publishing](https://developer.chrome.com/docs/webstore/publish) can separate store review from the announcement. The available [listing support fields](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) can provide the initial support route.

Recommended order: resolve audience/provider/storage questions → verify the installed workflows and public disclosures → observe unfamiliar users → submit for review → publish at the chosen time. No public release or external messages were sent as part of this work.
