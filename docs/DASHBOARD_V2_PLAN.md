> September 17 release update: the approved design is now integrated at `/dashboard`. See [Live integration plan](LIVE_DASHBOARD_INTEGRATION.md) for the implemented scope, validation, and rollback. The standalone `/dashboard-v2` mock remains preview-only.

# Soma Dashboard V2

Status: interactive mock dashboard implemented at `/dashboard-v2`, with a live
clock, agenda/progress, seven-day navigation, optional focus timer, sample
proposals, priorities, and Study Pulse. Build and targeted browser/configuration
tests pass. The user chose the existing Vercel Preview workflow and deferred
separate backend setup. Mock mode requires no database access; real scheduling,
persistence, migrations, and AI integration remain pending. See
`DASHBOARD_V2_PREVIEW.md` for current setup and limitations.

This document is the source of truth for the proposed Dashboard V2, scheduling reliability work, and preview-only release process. Read it before changing code. Do not deploy these changes to production until the user explicitly approves the tested Vercel preview.

## Product objective

Replace Day View as Soma's eventual default home with a calmer dashboard that answers:

1. What matters today?
2. When will I do it?
3. What am I working on now?
4. How much of today's plan is complete?
5. What context should Soma remember?

Keep time blocking. Planned time creates commitment and makes a large workload concrete. Keep focus tracking as an optional feature because actual time by task and subject powers useful insights. Planned time and actual work must remain separate data concepts.

## Non-negotiable product rules

- The header shows the full local date and exact local time, including seconds and time-zone abbreviation.
- Google Calendar events are read-only commitments.
- Planned sessions represent intended work.
- Focus sessions represent actual work.
- Starting or stopping a timer never changes a planned session's timestamps.
- AI-generated schedules are previews until the user accepts them.
- The UI never reports success until the backend confirms and refetches the saved records.
- Time tracking can be disabled without disabling tasks, planning, completion, or AI assistance.
- Notifications are deferred. Do not add a dead bell or placeholder control.
- Detailed week/time-grid editing belongs in Calendar, not on the dashboard.

## Dashboard information architecture

### Header

- Full weekday and date.
- Exact time with seconds.
- Time-zone abbreviation.
- A single segmented Day Progress Rail.
- Compact completion label, such as `3 of 6 study blocks completed`.

### Today's Plan

The primary area is a compact chronological agenda combining:

- Google Calendar commitments.
- School and work constraints.
- AI-planned study sessions.
- Manually planned study sessions.
- The active focus session.

This is not a full 24-hour grid.

### Priorities

A short ordered list containing:

- Task and subject.
- Due date.
- Priority.
- Estimated effort.
- Status.
- Start Focus action.
- A concise reason for AI ordering when useful.

### Ask Soma

A compact brain-dump and planning surface. It can extract tasks, propose priorities, ask clarifying questions, and generate a plan preview. Long conversations and full history remain in the dedicated AI page.

### Focus

An optional timer panel linked to a task and subject. It records actual focus sessions. Settings control whether tracking and the panel are visible.

### Next seven days

A restrained date strip showing deadline density, planned workload, subject markers, the selected date, and overloaded days.

### Study Pulse

Initially limited to:

- Study time this week.
- Current streak.
- One useful comparison such as actual versus estimated time.

Detailed analysis remains in Insights. Grade correlations are a later phase.

## Visual state system

Use one consistent state vocabulary in the progress rail and Today's Plan:

| State | Treatment | Actions |
| --- | --- | --- |
| AI proposal | Subject-colored full outline | Accept, move, dismiss |
| Planned | Pale subject tint | Start, reschedule |
| Active | Strong subject color with progress fill | Pause, finish |
| Partially completed | Proportional subject-color fill | Continue later |
| Completed | Full color and checkmark | Review |
| Missed | Muted neutral | Reschedule, dismiss |
| Google event | Solid neutral, read-only | Open event |

Use restrained color overall. Subject colors communicate meaning. Avoid glassmorphism, decorative gradients, large motivational headlines, repeated metric cards, nested cards, and heavy inactive-state saturation.

## Core data model

### Task

The existing todo/task record, extended only where required for priority and planning metadata.

### Planned session

Represents intended work:

- `id`
- `user_id`
- `todo_id`
- `start_time`
- `end_time`
- `state`
- `source` (`manual` or `ai`)
- `timezone`
- `version`
- timestamps

### Focus session

Represents actual work:

- Task and subject.
- Actual start and end.
- Duration and pauses.
- Optional `planned_session_id`.

### External calendar event

A normalized, read-only event used as a scheduling constraint. Support timed and all-day events.

## Required migration

Soma currently has two scheduling systems: localStorage `timeBlocks` and Supabase `todo_sessions`.

1. Introduce a single persisted `planned_sessions` model.
2. Migrate `todo_sessions` into it.
3. Add a guarded one-time client migration for recoverable local blocks.
4. Stop creating local-only schedule blocks.
5. Keep `timer_sessions` as actual focus history.
6. Remove automatic timer-driven block stretching, splitting, and deletion after migration is verified.

The migration must be idempotent and have a rollback plan.

## Scheduling architecture

The language model decides task meaning, priority, duration suggestions, and sequencing. Application code assigns and validates times.

Planning pipeline:

1. Fetch fresh Google Calendar events for the exact requested date range.
2. Load school hours, work hours, personal availability, and existing planned sessions.
3. Normalize time zones and all-day events.
4. Merge busy intervals.
5. Calculate valid free intervals.
6. Ask the AI for structured task priorities, duration estimates, and constraints.
7. Fit tasks into valid intervals deterministically.
8. Validate every proposed session again.
9. Return a preview with assumptions, conflicts avoided, unscheduled work, and tasks that do not fit.
10. Save only after user acceptance.

Replace regex-parsed `<soma-action>` text with schema-validated structured actions. Validate ownership, IDs, dates, time ordering, availability, and collisions server-side.

## Transaction and confirmation requirements

- Save an accepted plan through one transactional operation.
- Use idempotency keys to prevent duplicate submissions.
- Roll back when a required item fails.
- Return persisted IDs for all created records.
- Refetch persisted data before the UI displays success.
- Never swallow a session failure and still claim the plan succeeded.
- If an intentionally partial operation is allowed, show the status of every item.

## Existing defects to fix

- AI sees only today's Google Calendar events.
- AI ignores all-day Google events.
- AI can plan from a calendar cache up to 24 hours old.
- No deterministic collision check exists.
- Prompt instructions can create todos without sessions for a schedule request.
- A todo can save while its sessions fail, followed by a false success confirmation.
- AI sees only today's existing planned sessions.
- AI checklist acceptance can overwrite existing todos.
- AI preferences in Settings do not affect behavior.
- Subject-specific chat state is not exposed coherently.
- Canvas announcements and modules are referenced but not populated.
- Chat context uses only a short slice of one conversation and has no durable memory layer.

## Optional timer behavior

Settings:

- Enable time tracking.
- Show Focus panel on dashboard.
- Show seconds.
- Ask for a task before starting.
- Show estimated versus actual time.

When tracking is disabled, tasks, scheduling, completion, and AI planning remain fully functional.

When a timer stops, show an inline choice:

- Finished.
- Continue later.
- Stopped for now.

`Continue later` calculates remaining estimated effort and creates a new plan proposal for a valid free interval.

## Preview-only development policy

- Build behind a `dashboard_v2` feature flag.
- Develop at `/dashboard-v2` first.
- Preserve `/day-view` as the fallback.
- Use a separate preview Supabase project or an isolated preview schema.
- Use preview-only Google OAuth redirects and webhook endpoints.
- Keep preview and production service keys separate.
- Seed dedicated test users and fixtures.
- Do not merge or deploy to production without explicit user approval.

Do not assume a Vercel preview is isolated merely because it has a preview URL. Verify its environment variables and database target before any migration or write test.

## Test gates

### Planner unit tests

- Adjacent and overlapping events.
- Timed and all-day events.
- Multiple Google accounts.
- Existing planned sessions.
- School and work constraints.
- Tasks too long to fit.
- Insufficient total time.
- Midnight boundaries.
- Daylight-saving transitions.
- Time-zone changes.
- Duplicate submissions.

### Backend integration tests

- Whole-plan success.
- Required-item failure rolls back.
- Unauthorized IDs are rejected.
- Stale task and subject IDs are rejected.
- Calendar failures cannot produce misleading success.
- Refetched data matches the committed plan.
- Focus sessions link to planned sessions.
- Timer activity never changes planned timestamps.

### Browser tests

- Brain dump to proposal.
- Proposal preview to accepted plan.
- Conflict-free rendering.
- Every plan-state visual.
- Timer enabled and disabled modes.
- Timer recovery after refresh.
- Rescheduling and carry-over.
- Responsive dashboard.
- Empty, loading, offline, and error states.
- Dark and light themes.
- Keyboard and screen-reader behavior.

## Implementation order

1. Verify preview isolation and add the feature flag.
2. Add the planned-session schema and migration path.
3. Build interval normalization, availability, and conflict validation.
4. Build the transactional plan-preview API.
5. Replace text-tag AI actions with structured actions.
6. Fix the listed high-risk defects.
7. Build the dashboard shell and live date/time header.
8. Build Today's Plan and the progress state system.
9. Add the optional Focus timer.
10. Add Priorities and the seven-day strip.
11. Add the compact Ask Soma surface.
12. Add Study Pulse.
13. Run the full automated and manual preview test matrix.
14. Prepare a reviewed production migration and rollback plan.
15. Wait for explicit user approval before production release.

## Deferred work

- Notifications.
- Grade ingestion.
- Study-to-grade correlations.
- Durable cross-chat memory and a user-facing memory manager.
- Production rollout.

## Instructions for the next Codex model

Before implementing:

1. Read this document, `PRODUCT.md`, and any repository `AGENTS.md` files.
2. Inspect the current git status and preserve unrelated user changes.
3. Confirm the Vercel preview uses isolated backend resources.
4. Start with implementation item 1 unless the user selects another item.
5. Keep changes on the preview path and behind the feature flag.
6. Add verification proportional to each change.
7. Do not publish, merge, migrate production data, or change production environment variables without explicit user authorization.
