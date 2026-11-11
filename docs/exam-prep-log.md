# Exam prep log

Running notes for the exam-prep work on branch `exam-prep-v1`
(PR [#16](https://github.com/Jacrwan/soma/pull/16)). Newest updates at the top
of **Now**. The project changelog (`docs/CHANGES.md`) still records each
shipped change and the test that guards it. This file is the longer story:
what was decided, what shipped, what went wrong, and what v2 is doing.

Times are Pacific (America/Los_Angeles).

---

## Now (Tue Nov 10, 2026, evening)

**Wired on the live dashboard.** Still no model calls.

- About once a minute, and whenever the plan reloads, today is checked. A
  study block whose time has ended and that was never started (no Focus time,
  no check) is missed. It and later never-started study are saved into the
  gaps left today, highest priority first. The move is applied directly, not
  as an Accept card.
- A time the student set (pinned) is left alone, and so is anything already
  started. Classes stay put.
- Study hours are the wall unless Settings → Study hours is **Use personal
  time**. What does not fit is taken off the clock and waits for catch-up.
- Focus still running past the planned end holds the day. Checking the block
  off writes that clock time as the end and shifts whatever it now overlaps.
- **Compare** on today’s plan opens a split peek. Left is the day now. Right
  is an earlier version from the dropdown (original, then each move). Versions
  live in this browser only (`soma_day_versions`).
- A short note appears under the dashboard header when something moved.

**Known, not from this step:** `tests/ai-whole-day.spec.ts` › “work moved past
its due date says so on the card” fails on this branch. v1 deadline anchors
changed when that note appears. Decide before merging to master.

---

## What v2 is (agreed)

Scoped after v1, still no model unless a feature actually needs one.

1. **Within the day only.** If a study block’s time passes and it was never
   started (no Focus, no check), redistribute today’s remaining never-started
   study by priority into open time. After that day, the existing catch-up
   card places leftovers. Do not invent a second catch-up.
2. **Overrun.** If a block runs past its end, wait. When it is checked off,
   that clock time is the new end, then shift the rest of today.
3. **Personal time** is a settings toggle. Study hours stay the default wall.
   Invading past them is opt-in.
4. **Auto-apply** the within-day moves (not Accept cards). Wired.
5. **Compare peek on the dashboard, not Insights.** Split screen: left is the
   latest version of the day, right is an older version chosen from a
   dropdown (original, then each iteration). Wired. This browser only.

Out of v2: multi-day auto-replan, putting the peek in Insights, using Sonnet
to decide the moves. Versions do not sync across devices.

---

## v1 — shipped on this branch

The Nov 6 exam study plans were reverted the same day (`4e48a40`): vague
titles like “Midterm 1 study block”, random days, no use of soft context.
v1 is the replacement.

**Decisions locked with Juwan**

- Braindump is the source of truth. Uploaded files confirm names and fill
  gaps. “Use braindump as-is” skips the model.
- The approved list is the whole outline, kept even when time is short.
  **Add today** / **Add this week** only place that horizon.
- Titles are concrete: `Calc midterm: Worksheet 3 — do problems 1–12`.
- Priority is a 5-step bar, Low to High, color cool to warm. The model
  defaults it; the student can override. Placement sorts 5 → 1.
- Hard deadline anchors are code, not a prompt: exam prep never on or after
  the exam; exam/quiz tasks may land on the due day; assignments may not land
  after due unless already late and still open. Accept checks the same gate.
- Soma chat sees exam lists only when the message is about an exam, midterm,
  final, quiz, or coverage. Open items in that context are capped at 8.

**What landed**

| Piece | Where |
| --- | --- |
| Coverage list, sittings, today/week placement | `src/lib/examPlan.ts` |
| Save / load / “make my list” | `src/lib/examPlansStore.ts` |
| Deadline anchors | `src/lib/deadlineAnchor.ts` |
| Documents UI + priority bar | `src/components/Documents/ExamPlans.tsx`, `PriorityBar.tsx` |
| Chat rules + Accept gate | `src/lib/assistant.ts` |
| SQL | `exam_priority_migration.sql` (`priority` on `course_items`, `exam_time` on `exam_plans`). Juwan ran it. `exam_study_migration.sql` was already applied Nov 6. |
| Tests | `tests/exam-plans.spec.ts`, `tests/deadline-anchor.spec.ts` |

Commits: `69b97d8` (v1), `c94ac5c` (Vercel types), `b3343ea` (drag-and-drop
onto the exam modal, course picker when subjects load late, optional exam
time, clearer “checklist” copy).

Preview: `https://soma-git-exam-prep-v1-jacrwans-projects.vercel.app`
Production (`somastudy.app`) does not have this branch.

---

## Preview felt stuck — what it actually was

Juwan: scheduling on the preview took forever and looked expensive. Live
felt fine, including “im gonna do the math homework after ruf large group
today”.

Tried, in order:

1. **Shorter exam prompt + load exam lists only for exam messages** (`33c4109`).
   Real, but not why one reply sat there.
2. **Plan replies at low effort instead of medium** (`0834f66`). Dashboard
   still sends `effort: 'low'`.
3. **`thinking: { type: 'between_tools' }`** (`1ebeaad`, removed in `6db6475`).
   Wrong. On Sonnet 5.5 that field is how you turn off up-front thinking, but
   plans got worse and it was not the stall. `/api/chat` again matches
   production: no `thinking` field. Do not add it back.
4. **The actual stall** (`4f079bf`). Vercel showed the cheap first pass, then
   no full reply at all. After triage, `askSoma` loads the plan, history,
   documents, and exam lists with no time limit. One of those loads never
   finished, so the UI sat on “Soma is thinking…” and nothing was sent.
   Each load now has a 20s limit. The plan is required (retry message, nothing
   sent). The others are skipped if they stall. Guard: `tests/ai-load-limit.spec.ts`.

Previews have no Soma memory. `SOMA_MEMORY_ENABLED` is Production only, so
the student portrait shows on somastudy.app and not on the preview.

---

## Token rule

If a step does not need a model, it does not call one. Placement, deadline
checks, within-day reclaim, and overrun shifts are TypeScript. The model is
used for drafting a checklist from files (and normal Soma chat). Braindump
as-is skips that draft.
