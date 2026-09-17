> September 17 release update: the approved design is now integrated at `/dashboard`. See [Live integration plan](LIVE_DASHBOARD_INTEGRATION.md) for the implemented scope, validation, and rollback. The standalone `/dashboard-v2` mock remains preview-only.

# Dashboard V2 preview setup

## Inspection: September 16, 2026

`vercel env ls preview` on the linked `soma` project shows the same environment
entries assigned to Preview and Production for `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and Stripe credentials.
Preview isolation is **not verified**. Do not run migrations or write tests there.
Google OAuth client variables have preview-specific entries, but their redirects
have not yet been verified.

## Build gate

`DASHBOARD_V2` defaults off. Enabling it fails the build unless:

- `VERCEL_ENV=preview`.
- `VITE_SUPABASE_URL` matches `SOMA_PREVIEW_SUPABASE_URL`.
- `SOMA_PRODUCTION_SUPABASE_URL` is present and differs from the preview target.
- `SOMA_PREVIEW_ISOLATION_VERIFIED=true` records completed manual verification.

All three URLs must be HTTPS origins. This first implementation supports a
separate Supabase project, not schema-only isolation. The browser receives only
the computed `features.dashboard_v2` boolean, not the server environment.

The gate checks configuration, not remote ownership of credentials. The
verification marker must only be set after checking the items below. Existing
routes and APIs are not sandboxed by this flag; shared preview credentials must
be replaced before any live preview write testing.

## Required setup before enabling

1. Create or select a dedicated preview Supabase project with synthetic test users.
2. Override preview URL, anon key, and service-role key with that project's values.
3. Set both explicit project URL variables above using verified project settings.
4. Verify preview Google OAuth redirects and credentials; use test accounts.
5. Use Stripe test credentials and preview webhook endpoints, with separate secrets.
6. Verify every other integration that can write data is isolated or disabled.
7. Set the verification marker and enable the flag in Preview only.

No remote settings, database records, migrations, or deployments were changed
during this initial setup. The `/dashboard-v2` route and remaining implementation
are pending; this is the configuration foundation, not a completed dashboard.

## Mock preview implementation

The user chose to keep the existing GitHub/Vercel preview workflow and defer
separate backend setup. `DASHBOARD_V2=true` together with
`DASHBOARD_V2_DATA_MODE=mock` enables `/dashboard-v2` locally or on Preview without
requiring isolated Supabase credentials. Production explicitly rejects this mode.
The route loads independently of App, authentication, storage, and timer providers.
All sample interactions are in memory and reset on refresh. Ask Soma creates a
fixed-time example proposal, not an AI-generated or conflict-validated plan.

Implemented: local live date/time, seven-day selection, agenda state labels,
completion/proposal acceptance and dismissal, optional focus timer with pause and
stop outcomes, priorities, sample study pulse, and light/dark responsive layouts.
Continue later marks partial completion; automatic carry-over is still pending.
Timer recovery, real scheduling, AI integration, and database migration remain pending.

Validation: production build passed; 7 targeted configuration/browser tests passed,
including no Supabase/API requests from the mock route, preservation of planned
times during focus, and mobile layout. Desktop and mobile screenshots inspected.

## September 17 layout revision

Ask Soma now occupies the upper-right panel with a conversation log and composer.
The appearance toggle was removed. Today's Plan sorts entries chronologically and
renders explicit free-time labels between entries; external commitments use a
neutral fill while study work uses a lightly tinted outlined row. Priorities and
Study Pulse sit below the agenda. Four browser tests pass, including no-scroll
initial desktop layouts at 1280×720, 1366×768, and 1440×900. Chat responses and
proposals remain illustrative mock interactions, not real AI task extraction.

## Overlaps and weighted progress

Overlapping intervals are grouped using their latest end time, rendered in a
maximum of two columns (additional overlaps wrap). Free-time gaps are calculated
between complete groups, so nested events cannot create false gaps.

Scheduled work gets segment widths proportional to planned minutes. Actual
focus seconds fill each segment, capped at 100%. Completion gives full visual
credit and a checkmark without changing actual time. Tooltips report actual and
planned minutes separately. With no scheduled work, each assignment gets equal
weight. Mixed days currently weight scheduled work only; unscheduled items remain
in the agenda and completion count. External events and proposals are excluded.
Sample unscheduled tasks are available two days ahead; today includes an overlap.
Focus time persists between demo sessions in memory, but still resets on reload.
Eight layout, interaction, overlap, progress, and timer tests pass.

## Subject-level progress revision

The progress rail now groups assignments by subject instead of rendering one
segment per block. Biology's 45-minute review and 30-minute report form one
75-minute segment; finishing the review credits 45/75 of that segment. Actual
work remains separate from completion credit. Work exceeding an assignment's
allotment increases its subject's relative width, with an overtime label; the
original planned total remains displayed. Without scheduled work, assignments
have equal weight within their subject. Bar checkmarks and the completed-block
headline were removed in favor of planned minutes and subject labels. Fills use
a subtle gradient and a one-time sheen at full progress, with reduced-motion
support. Concurrent blocks retain a left-hand time column. Eight tests pass.

## Plan editor

Edit plan expands free intervals into add controls and exposes editing on study
sessions and manual personal commitments. A separate Add block action permits
intentional overlaps, which the form names before saving. Fields include title,
type, subject, start/end, and study status. Imported Google events remain read-only;
active focus blocks must be stopped before editing. Undoing completion preserves
actual time and removes only completion credit. Invalid time order is rejected.
All changes feed the same in-memory agenda, priority, progress, and day-strip data.
The demo proposer now finds the first 30-minute gap after 09:00 using current
entries and reports the current plan totals; it is still not a live AI integration.
The editor replaces chat temporarily, and Edit mode may scroll as gaps expand.
Eleven relevant tests passed, including three editor integration scenarios.
