# Branch bug fixes: handoff for the next AI

## Request and scope

The owner asked to review the additions on `exam-prep-v1` for bugs. The review
compared the branch with `master` and found six reproducible issues. The owner
then asked whether they had been fixed; all six are now implemented and verified.

The owner also explicitly requested an MD handoff recording their request,
all edits, and the reasoning and logic, so they can continue with another AI.
This file records implementation decisions and evidence. Keep it current.

- Starting commit: `8f800a4` on `exam-prep-v1`.
- This pass started on the night of November 10 and continued into November 11.
- Keep the Muse-style context, learned routines, saved braindumps, priority
  slider, and Compare UI. Fix bugs without removing these features.
- Update the existing preview after verification. Do not merge to `master`
  or deploy production as part of this fix pass.
- No database migration is needed or authorized for these fixes.
- Leave the owner's existing untracked files alone.

## Earlier work to preserve

The owner is coordinating Cursor, Claude, and Codex. Do not restart their work
or remove functionality to make tests pass. See `docs/MUSE_PLAN.md` and
`docs/CHANGES.md` for the full earlier history.

- Muse-style context: learn course routines from Focus and checked-off work;
  read uploaded dated homework/reading guides as week rows. The owner expects
  Soma to infer the right week's work without repeatedly asking for sections.
- Latency: keep the bounded context loads and current low-effort reply setup.
  The original complaint was a simple homework request hanging or timing out.
- UI requests already implemented: continuous green-to-red priority sliders,
  aligned checklist metadata, lengths informed by history, saved full braindumps
  on Rebuild, and Compare splitting the actual plan into Now/Earlier.
- `fd29247` finished priority dragging, phone alignment, account braindump
  recovery/retry, and pausing automatic moves during plan editing.
- `8f800a4` addressed the owner's Plan an exam screenshot: aligned Time with
  the other fields, kept its optional label inline, improved phone scrolling,
  simplified text/actions, and added course reload/error/retry states.
- The six fixes below address the subsequent branch audit. They are separate
  from those completed UI requests; their implementation must preserve them.

## Baseline evidence

The production build and 76 affected feature checks passed during review.
Six additional synthetic-account reproductions failed on the starting commit.
These expose gaps in the existing tests; a green suite did not cover them.
The reproductions are preserved in `tests/branch-regressions.spec.ts`.

## Fixes and decisions

### 1. Calendar failure must prevent automatic rescheduling

- Cause: `readPlan` catches a calendar failure and returns `calendarError`
  with no calendar events. Catching a rejected promise in `runReclaim` therefore
  does not prevent moves into apparently empty time.
- Reproduction: a reading block moved from 09:00 to 10:30 while the calendar
  error was visible; its real calendar had a lecture at that time.
- Intended fix: inspect the fresh calendar result before automatic writes.
  Also guard late-finish rescheduling; marking work complete should still work
  during an outage, without moving other blocks. Allow recovery after a
  successful calendar reload.
- Status: implemented and verified; see release results below.

### 2. Accept must retain an explicitly requested day

- Cause: proposal creation passes `asked` to the deadline check when the owner
  names the exact day. Accept checks again without that exception.
- Reproduction: “do the lab tomorrow,” with the lab due today, produces the
  promised warning but cannot be accepted.
- Intended fix: attach the exact requested date as app-derived proposal
  metadata; Accept grants the exception only while the proposed date matches.
  Exam/prep deadlines remain hard. Do not trust a model-provided override.
- Status: implemented and verified; see release results below.

### 3. Reclaim must use persisted exam-item priorities

- Cause: reclaim reads `p5` from a temporary proposal note. Saved blocks loaded
  by `readPlan` have no such note and fall back to priority 3.
- Reproduction: a linked item persisted at priority 5 reaches reclaim as 3.
- Intended fix: resolve priority from linked open exam items when loading the
  plan, using the highest priority for a block covering multiple items.
  Keep the old note fallback for callers without persisted coverage metadata.
- Status: implemented and verified; see release results below.

### 4. Replacing pending exam suggestions must not reserve their old times

- Cause: `snapshotFor` already adds all pending suggestions; excluding this
  exam from a second pending list does not remove it from that snapshot.
- Reproduction: with one free hour, Add today succeeds once, then a second
  click reports no room and deletes the first valid suggestion.
- Intended fix: start from the saved plan; add other pending suggestions once,
  excluding the exam being regenerated before calculating free time.
- Status: implemented and verified; see release results below.

### 5. Exam titles are not identifiers

- Cause: pending suggestions are matched and removed by an `Exam plan` note
  containing only the exam title.
- Reproduction: planning Calc “Midterm 2” deletes Physics “Midterm 2” suggestions.
- Intended fix: tag generated proposals with the unique exam-plan ID and use
  it for regeneration/removal. Keep the human-readable note for display only.
- Status: implemented and verified; see release results below.

### 6. Distributed subject credit does not prove a block started

- Cause: `readPlan` distributes unmatched subject study time across that
  subject's blocks for progress display. Reclaim treats this allocated credit
  as evidence that each block was started.
- Reproduction: unrelated lecture catch-up prevents an untouched missed
  reading block from moving.
- Intended fix: carry directly matched Focus seconds separately from display
  credit. Reclaim uses the direct value, while progress retains existing credit.
  Preserve compatibility for callers that only supply `actualSeconds`.
- Status: implemented and verified; see release results below.

## Edit record

- Added this handoff file at the owner's request.
- Restored the six review reproductions as `tests/branch-regressions.spec.ts`.
- Added optional proposal/block metadata types in `PlanEditor.tsx`:
  `priority`, `focusedSeconds`, `requestedDate`, and `examPlanId`. These are
  client metadata, not new database fields.
- `LiveDashboard.tsx`: reject automatic `applyMoves` with a calendar error;
  check the freshly loaded calendar before reclaim; skip overrun moves on a
  failed calendar while still saving completion. An old cached failure does
  not permanently disable recovery.
- `liveData.ts`: retain `focusedSeconds` before allocating unmatched subject
  credit; resolve `priority` from the highest-priority linked open exam item.
  Existing progress calculations remain unchanged.
- `reclaimToday.ts`: prefer the explicit priority and directly matched Focus
  seconds. Fall back to old note/actual-seconds inputs for older callers.
- `assistant.ts`: derive `requestedDate` from the actual user message for new
  and edited proposals. Accept checks equality with the proposed date before
  applying the requested-day exception. Existing exam checks still run.
- `examPlan.ts`: generated suggestions carry `examPlanId`; their readable
  note still shows the exam title and priority.
- `examPlansStore.ts`: remove title-based matching; use the exam ID for
  replacement and deletion. `snapshotFor` returns the saved snapshot;
  `scheduleHorizon` adds only other pending suggestions, once, before placing.
- `tests/branch-regressions.spec.ts`: kept all six reproductions and added
  calendar recovery, genuine Focus protection, same-title deletion isolation,
  requested-date/exam limits, and completion during a calendar outage. The
  outage check now asserts no writes rather than waiting for the buggy move.
- `docs/CHANGES.md`: linked this file and recorded the owner's request,
  implementation summary, regression coverage, and verification status.
- `tests/dashboard-ai-context.spec.ts`: fixed the clock to noon in “a block
  Soma cannot place keeps the rest of the answer.” The full run crossed
  midnight, when its assumed-past 00:01 block was actually still allowable.
  Reproduced the same failure on an isolated copy of `8f800a4`. No assertion
  or planner behavior changed; only the test's assumed time is now explicit.

## Verification and release

- Baseline: six focused reproductions failed; build and 76 existing checks passed.
- Fix verification: all 50 targeted checks passed, including the original six reproductions.
- Production build: passed (`npm run build`).
- Final focused regression run: 8 passed, including deletion isolation.
- Full suite: 770 passed, 8 skipped, and one pre-existing midnight-dependent
  check failed. Its failure was confirmed on `8f800a4`, its clock was made
  explicit, and `npm test -- --last-failed` passed it. Total: 771 checks verified.
- No existing assertion was removed or weakened.
- Fix commit: `8d1f5a42082adff86befc199bc23f686c27b37b4`.
- Pushed to `origin/exam-prep-v1` on November 11, 2026.
- Fix deployment: READY, confirmed with `vercel inspect --wait`:
  <https://soma-kzez034w4-jacrwans-projects.vercel.app>.
- Stable preview alias:
  <https://soma-git-exam-prep-v1-jacrwans-projects.vercel.app>.
- This release-status update is a follow-up documentation commit; it does not
  change the tested application code. Use `git log -1 -- docs/BRANCH_FIX_HANDOFF.md`
  to identify the latest handoff revision.
- Production and `master` were not changed.

The tests use synthetic rows and mocked auth, calendar, and model responses.
They verify application behavior and persistence logic, not live model quality.
No production account data was edited. No database schema was changed.

Commands for the next AI:

```sh
npm test -- tests/branch-regressions.spec.ts
npm test
npm run build
```

Longer-term learning work remains described in `docs/MUSE_PLAN.md`; this pass
does not implement its next phase. Do not report it as completed.

## Continuing with another AI

Read `docs/CLAUDE.md`, this file, `docs/CHANGES.md`, and `docs/MUSE_PLAN.md`
before editing. The six fixes above are complete; use their regression tests
when changing scheduling. Continue from the owner's next request rather than
reimplementing these fixes or the earlier UI work. Keep new edits and their
verification logged, and do not claim the remaining Muse learning phase shipped.
