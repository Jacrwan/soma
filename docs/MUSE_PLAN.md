# Soma that knows you (the "Muse" plan)

The owner wants Soma's AI to feel like Meta's Muse: not more things it can
do, but more context, and context it forms on its own. After two months of
use it should know, without being told again, that Math 53 homework happens
Tuesday night and Wednesday morning before discussion, and that it's always
the previous week's set. The same goes for every course.

This file is the shared plan. Cursor and Claude both work from it. Read
`docs/CLAUDE.md` (rules) and `docs/CHANGES.md` (what changed, and the test
that guards it) before changing anything here.

## Working with two AIs

- One AI per branch, one at a time. Hand over by branch name.
- Write what you did in `docs/CHANGES.md`, with the guard test.
- Update this file when a phase starts, changes scope, or ships.
- Previews have no Soma memory (`SOMA_MEMORY_ENABLED` is Production only),
  so the portrait only shows on somastudy.app.

## Principles

- Code before model. If a fact can be worked out from the data, work it out
  in TypeScript and hand the model the answer, not the raw data.
- What the student did beats what they said once. Checkmarks and Focus time
  are the record; chat is not (see CHANGES: past work = checkmarks + logged
  time).
- What the student says now beats any routine.
- Soma decides, the student confirms: one-tap plans with a plain reason
  ("Tuesday night, like usual"), not questions.
- Token-lean: a routine is one short line.

## Phases

### 1. Portrait — shipped 2026-11-10 (live)

Every full reply carries a standing picture: up to 8 saved memories
(preferences, goals, facts) and the 3 newest chat notes. Memories are
extracted from what the student types. `api/_memory.ts`, `api/_notes.ts`.

### 2. Routines from history — built 2026-11-10 (branch `exam-prep-v1`)

- **Guides read as week rows** (`src/lib/weekGuide.ts`). A dated homework or
  reading guide becomes rows: lecture dates → section numbers. Each reply
  gets `guideWeeks`: every course guide's rows for this week and last week.
  "Last week's homework" no longer depends on keyword search (a typo used to
  drop the row).
- **Routines** (`src/lib/routines.ts`). The last 8 weeks of Focus sessions
  (10+ minutes) and checked-off blocks, grouped by course and kind of work
  (homework, reading, …). A weekday held in 3+ weeks, and in at least half
  the weeks with that work, is a routine, with its usual start time ("Tue
  around 20:00"). When titles name
  sections, the gap to the guide row's lectures gives which week's set
  ("the previous week's set"), and so the set it points to now.
- **Soma uses them** (`assistant.ts` ROUTINES rule): names work from the
  routine or guide instead of asking which, prefers the routine's days when
  no time is given, and says so in a few words.
- **Old tasks don't rename new work.** A task more than a week old whose
  name pins sections the new title doesn't is that week's work, not the new
  request.

### 3. Next — not started

- **Show what Soma learned.** A small "What Soma has noticed" list (Settings
  → Memory, or on the AI page): each routine in plain words, with "That's
  wrong" to drop it. Nothing hidden.
- **Said many times → kept.** When the student states a habit, save it as a
  routine-type memory, and let checkmarks confirm or retire it.
- **Routines for placement in code**, not only in the prompt: when a block
  has no time, place it in the routine's slot first.
- **Later:** Soma messaging first (outbound), on the same brain. Needs a new
  server function; the Vercel plan is at its 12-function limit.
