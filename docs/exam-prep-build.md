# Exam prep: what you asked for, and how it was built

Branch `exam-prep-v1`, PR [#16](https://github.com/Jacrwan/soma/pull/16).
The day-by-day work log is `docs/exam-prep-log.md`. This file is the map:
each request, the decision it became, and where that lives in the app.

The Nov 6 exam study plans were reverted the same day. They made vague
blocks (“Midterm 1 study block”) on arbitrary days. This build replaces
that, in two passes.

---

## How the build is split

Two passes, on purpose.

**v1 makes the list and places a horizon.** The approved checklist is the
whole outline, kept even when the exam is soon. Only **Add today** or **Add
this week** puts blocks on the real plan.

**v2 moves today when the day doesn’t go as planned.** It never replans the
rest of the week. Tomorrow’s leftovers stay on the existing catch-up card.

The model is used in two places only: drafting a checklist from files, and
normal Soma chat. Placement, deadline checks, within-day moves, and the
compare peek are TypeScript. “Use braindump as-is” skips the draft call.

```
Documents → Exam study plans
  braindump and/or files
        │
        ▼
  checklist (course_items + exam_plans)     ← whole outline, priorities 1–5
        │
        ├─ Add today / Add this week        ← code, before the exam
        │
        ▼
  today’s plan
        │
        ├─ missed, never started            ← reclaim, auto-saved
        ├─ checked off after the end        ← overrun, then shift the rest
        └─ Compare                          ← now vs an earlier version
        │
        ▼
  next day → existing catch-up
```

---

## What you asked for

### A real study list, not vague blocks

You wanted long-term prep for a midterm or final, from a braindump and/or
dropped course files. Block names had to say the work: “Midterm 1 review:
read chapters x to y” or a problem set, not “Midterm 1 study block”.

**How it works.** Documents → Exam study plans. You pick the course and the
exam (date, and a time if you have one). You can type a braindump, tick
files already uploaded, or drop files on the popup itself. **Make my study
checklist** asks Sonnet, at low effort, to turn that into items. Each item
is a short name, a detail that starts with a verb when it can, a length,
and a priority. **Use braindump as-is** builds the same rows without a
model call.

Approving saves every item. The list is not trimmed to the days left.

Titles on the plan look like `Calc midterm: Worksheet 3 — do problems 1–12`.
Several items that fit in one sitting (up to two hours) share a block.

### Braindump first, files second

You wanted both, with the braindump as the source of truth and the files
used to confirm names, problem numbers, and gaps.

**How it works.** The checklist prompt says that. If there is no braindump,
the draft comes from the files and the note asks you to confirm it. You
can edit every row, including priority, before approving.

### A priority you can see and change

You first described a silent priority the model would use. Then a visible
control: a 5-step bar, Low to High, color shifting from cool to warm. The
model picks the default. Your override sticks.

**How it works.** `PriorityBar` is that control on each checklist row.
Priorities are 1–5, default 3. Placement sorts 5 first. Soma chat is told
the same order when you ask it to plan an exam that already has a list.
It does not get to invent a different scale.

### Schedule a day or a week, not the whole calendar at once

You wanted the full outline stored, and only ~today or ~this week put on
the plan. Days should not be a dumb even spread.

**How it works.** Approve does not write study blocks. **Add today** and
**Add this week** do. They fill open study time before the exam, higher
priority first, and skip items already sitting in a block that hasn’t
ended. Busy days (the day of another quiz or exam, and the day before)
get less room. Nothing in this step calls the model.

### Never schedule past the thing itself

You didn’t want the model to guess. Exam prep must not land on or after
the exam. Assignment work must not land after the due date unless it is
already late and still not submitted. Quizzes and exams themselves may
land on their day. One exception, decided Nov 10: when you name the day
yourself ("do the lab tomorrow"), an open assignment goes there anyway,
with "After its due date (…), still open" on the card. What you say now
wins; Soma never picks a day past the due date on its own.

**How it works.** `deadlineAnchor.ts` is the rule, in code. It is checked
when a horizon is placed, when Soma proposes a time, and again when you
press Accept. A request to push a block past the exam is refused with the
latest legal day. The model is told the rule so it doesn’t argue with it.

### Use context that isn’t written as a rule

You wanted Soma to notice rhythms you didn’t spell out: quizzes on Monday,
Tuesday, and Wednesday because you study before those discussions; a
holiday like Veterans Day, where it should ask whether the day is for
catch-up or a light day; not a blunt guess.

**How it works.** This stayed a chat instruction, not a new planner. When
you are planning an exam that has a list, the short exam note tells Soma
to prefer a lighter load on days that already look full (portrait, other
quiz or exam tasks due that day or the next), to cite one fact when that
changes the plan, and to ask once about an odd calendar day. It does not
build a hidden quiz calendar. If it can’t point at a fact, it should not
invent one.

### Don’t spend tokens when code can do it

You said not to call the model for anything that isn’t actually an AI job.

**How it works.**

| Job | Who does it |
| --- | --- |
| Draft a checklist from files | Sonnet, low effort |
| Braindump copied onto the list | No model |
| Place today / this week | Code |
| Refuse a time after the exam or due date | Code |
| Move a missed block inside today | Code |
| Shift the day after you finish late | Code |
| Compare versions of today | Code, stored in this browser |
| “Plan my afternoon” in chat | Normal Soma reply. Exam lists are loaded only if the message is about an exam, midterm, final, quiz, or coverage, and only the top 8 open items are sent |

Plan replies on the dashboard use low effort. `/api/chat` does not send a
`thinking` field. Sending `between_tools` to turn thinking off made plans
worse and was removed. The long “Soma is thinking…” stall on the preview
was a load with no time limit before the reply was sent. Those loads now
stop at 20 seconds. The plan is required. History, documents, and exam
lists are skipped if they stall.

### Drop files on the exam popup, pick the course, set a time

On the preview, Make my list was disabled, the course list was empty until
subjects loaded, and files had to be uploaded from the Documents page
first. You also wanted a time next to the date.

**How it works.** The popup accepts a drop and a file picker. Subjects
refresh when they finish loading, and a course fix appears if the exam’s
course isn’t in the list. The exam time is optional. The button stays
disabled until there is a course and either a braindump or a file, and the
hint says which one is missing.

### Within the day, move what you never started

Like a reclaim, but only today. Example you gave: English 10–11, a study
block, CS 12–1, a study block, math discussion 2–3. If you miss a study
block — you never press Focus and never check it — the remaining
never-started study should refill the gaps by priority and by your work
hours. After that day, catch-up does the next placement. Don’t reshuffle
a block you already started, or the day will jump around.

**How it works.** About once a minute, and whenever the plan reloads, today
is checked. A study block whose end has passed, with no logged time and no
check, is missed. It and later never-started study are packed into the
gaps still left, priority 5 first. Classes and calendar events stay.
A time you set yourself (a pin: you told Soma the time, or you edited it)
stays. The new times are saved directly. There is no Accept card.

What does not fit before study hours end comes off the clock. Tomorrow,
the existing catch-up card can pick it up. There is no second catch-up.

### If you run long, wait, then shift

If you don’t check a block off at its planned end, don’t move the rest of
the day yet. When you do check it off, that moment is the new end, and
the rest of today updates.

**How it works.** While Focus is still running past the planned end, today
is held. Checking the block off after the planned end writes that clock
time as the end and pushes never-started study that now overlaps it.
Finishing early does not shuffle the day.

### Personal time is a choice

If your study hours end at 9, a missed block should not be forced past 9
unless you want that.

**How it works.** Settings → Study hours. **Stop at study hours** is the
default. **Use personal time** lets a missed block land after the latest
end. The toggle is saved with the other study-hour settings.

### A compare peek on the dashboard

You wanted to see the original day, each later version, and what you
actually did. Split screen: left is the latest, right is an older version
from a dropdown. On the dashboard, not in Insights.

**How it works.** **Compare** on today’s plan. Left is the day now. Right
is Original, or “After a missed block”, or “After you finished a block”,
with the time of that version. Rows whose time changed are marked. The
versions are kept in this browser (`soma_day_versions`). They do not sync
to another device. Insights was left alone.

---

## Where each piece lives

| What | File |
| --- | --- |
| Checklist types, prompt, sittings, today/week placement | `src/lib/examPlan.ts` |
| Save, load, and the one model call that drafts a list | `src/lib/examPlansStore.ts` |
| Exam / quiz / assignment deadline rules | `src/lib/deadlineAnchor.ts` |
| Exam popup and checklist editor | `src/components/Documents/ExamPlans.tsx` |
| Low–High priority bar | `src/components/Documents/PriorityBar.tsx` |
| Chat instructions, when exam lists are loaded, Accept gate | `src/lib/assistant.ts` |
| Pure “repack today” and “finish late” | `src/lib/dayReclaim.ts` |
| Turn live blocks into that plan (pins, Focus, study hours) | `src/lib/reclaimToday.ts` |
| Apply it, and shift on check-off | `src/components/DashboardV2/LiveDashboard.tsx` |
| Compare peek | `src/components/DashboardV2/DayCompare.tsx` |
| Stored versions of the day | `src/lib/dayVersions.ts` |
| “Use personal time” | `SomaSettings.invadePersonalTime`, Settings → Study hours |
| Database | `exam_study_migration.sql` (already run Nov 6). `exam_priority_migration.sql` adds `priority` and `exam_time`. You ran that. |

Reading-list rebuilds ignore exam rows, so a reading refresh does not wipe
a study checklist.

Tests: `tests/exam-plans.spec.ts`, `tests/deadline-anchor.spec.ts`,
`tests/day-reclaim.spec.ts`, `tests/reclaim-today.spec.ts`.

---

## What this build does not do

- It does not lay the whole outline onto the calendar on approve.
- It does not auto-replan tomorrow. Catch-up already does the next day.
- It does not put the compare peek in Insights, and it does not sync
  versions across devices.
- It does not infer a standing quiz schedule of its own. Chat may use a
  fact it already has. It may not invent one.
- It does not move a block you already started, or a time you set.
- Production (`somastudy.app`) does not have this branch yet. The preview
  is `https://soma-git-exam-prep-v1-jacrwans-projects.vercel.app`.
  Previews also have no Soma memory, so the student portrait only shows
  on production.

The deadline-card test (`tests/ai-whole-day.spec.ts` › “work moved past
its due date says so on the card”) failed on this branch until Nov 10,
when the owner chose: a day you name passes the due date with a warning.
It passes now.
