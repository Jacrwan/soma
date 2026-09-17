# Live dashboard integration — September 17, 2026

Authorized: integrate the approved dashboard into the live product and push it.

## Release plan

1. Keep the approved dashboard layout and shared editor/progress calculations. Add an authenticated `/dashboard` route and make it the signed-in entry point. Keep Day View, Calendar, Canvas, Documents, Insights, Settings, and the existing AI page available.
2. Read existing Supabase subjects, todos, todo_sessions, and timer_sessions. Include connected Google Calendar events as read-only commitments. No production schema migration or replacement of existing data.
3. Save edits against the existing task/session model, check database errors, and refetch before showing success. A scheduled session belongs to a task: title, subject, and completion are task-level and apply to its other sessions too. State this in the editor. New blocks create a task plus a schedule; compensate if the second write fails. Manual commitments use a dedicated Personal commitments subject and remain editable.
4. Use the shared focus timer across navigation. Check focus-history saves before clearing the session; keep a retryable paused timer if saving fails. Subject progress combines planned allocation with measured time and completion credit. Historical records only have subject + task text, so identical titles within one subject cannot be distinguished; never count the same history twice.
5. Connect dashboard chat to the existing authenticated AI endpoint. Give it freshly read tasks, plans, and calendar context. Validate proposed blocks, show them for review, recheck availability before acceptance, and save only accepted proposals. An unavailable calendar must not be treated as empty availability.
6. Match the preview's DM Sans typography, neutral palette, lowercase text-only soma wordmark, and study with intention tagline in the app shell. Default new users to light mode; preserve existing explicit theme preferences.
7. Run production build and browser regressions, including failed writes, reload persistence, task completion/undo, overlaps, AI acceptance, authentication, and mobile layout. Deploy the integrated preview, inspect it, then release the tested build and push the source commit. Keep the standalone sample dashboard excluded from production.

## Practical boundaries

- Existing tasks and imported assignments are reused; this release does not migrate tables or change Canvas/Google authorization.
- User-entered overlaps are allowed. AI proposals require a currently free interval and explicit acceptance.
- Existing task completion semantics are retained: completing a task completes its scheduled sessions. Per-session independent completion would require a schema extension in a later release.
- Supabase's existing row-level security remains the authorization boundary. Every dashboard query/write is also scoped to the signed-in user.
- Two-record edits cannot be a database transaction without a new RPC. Failed new-session creation removes the new task where possible; partial existing edits are reported and reloaded, never reported as success.

## Rollback

Revert the release commit or promote the previous Vercel production deployment. No schema rollback is needed. Existing routes and records remain compatible.

## Implemented and verified

- `/dashboard` is authenticated and uses existing records. Login and fallback navigation land there; existing routes stay available.
- Dashboard editor handles timed and unscheduled tasks, manual overlaps, commitments, and completion undo. Existing multi-session task semantics are explained in the editor.
- Calendar aggregation now reports partial failures and follows pagination. AI refuses to schedule against incomplete availability, rechecks before acceptance, and checks overnight sessions too.
- Focus saves are idempotent across retries/reload, use explicit UTC timestamps, and retain paused sessions on failure. Focus no longer stretches or splits the planned legacy blocks.
- Historical time with no matching task title is distributed across that subject's blocks; it is never duplicated. Insights retains the original history.
- Shared typography and text branding applied to app shell, auth, and pricing; public wordmarks no longer use the icon. Explicit saved dark-mode preferences remain respected.
- Browser coverage uses mocked services, never edits production accounts. Desktop/mobile screenshots inspected. An outdated onboarding test was updated to go through the already-existing age and education steps.

## Release checks

- Production build: passed locally and on Vercel.
- Browser/API regression suite: **52 passed**.
- Integrated preview: https://soma-jgateimjl-jacrwans-projects.vercel.app/dashboard
- GitHub base before release: `96364de`, synchronized with origin/master.
- Preview is Vercel-auth protected; service availability checked with the authenticated CLI. Authenticated product flows were tested against mocked services, without writing to production accounts.
