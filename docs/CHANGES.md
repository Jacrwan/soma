# Soma change log

Every change to Soma goes here, newest first. Before changing an area, read its
entries: they say what each fix protects, and the test that guards it. A change
that breaks one of those tests is a regression, not a cleanup.

Format: date · what changed and why · where · the test that guards it · setup
still needed.

---

## 2026-10-09

### Editing a session: move it to another day
- **Why:** the Edit form on a past session (Length / Start and end) had no way
  to change the day, so a session saved to the wrong day had to be deleted and
  added again.
- **What:** Edit now has the same Day choice as Add (Today, Yesterday, Earlier
  with a date picker), set to the session's own day. Moving a session in Length
  mode keeps its clock time and length; Start and end uses the typed times on
  the chosen day. The summary says the day before saving ("Moves to Thu, Oct 8
  · 25 minutes."). The saved row's `date` follows its start, as before, so the
  dashboard, calendar and Insights all move it together.
- **Where:** `src/components/DashboardV2/PlanEditor.tsx` (`logDate`,
  `logEarlier`), `LiveDashboard.tsx` (`onEditSession` takes `date`),
  `DashboardV2.tsx` (type).
- **Guard:** `tests/session-times-and-calendar.spec.ts` › "editing a session can
  move it to another day…".

### Adding a session: pick the day (Today, Yesterday, Earlier)
- **Why:** "i just added a past session but it added it to oct9, not oct 8 which
  is when it happened. allow the user to select the day". The form had a date
  box, but it defaulted to today, sat above the times unlabelled by purpose, and
  the cursor jumped past it to Start; at 1 AM, last night's session landed on
  the new day.
- **What:** the add form opens with a Day choice: Today, Yesterday, Earlier
  (Earlier shows a date picker, starting two days back). The summary line under
  the times now names the day before saving ("Thu, Oct 8 · 137 minutes."),
  in both Length and Start-and-end modes. The default is still today.
- **Calendar:** unchanged. It reads sessions fresh each time it opens, so an
  added session shows there on the day it was saved to.
- **Where:** `src/components/DashboardV2/PlanEditor.tsx` (`dayLocal`, `dayName`,
  `addEarlier`), `DashboardV2.module.css` (`.logAddDay`).
- **Guard:** `tests/session-times-and-calendar.spec.ts` › "a session can be
  added to yesterday or an earlier day…".

### Dashboard: the arrows step one day, not a week
- **Why:** "when i go back or forward using the arrow button just go back a day
  and not the entire 7 days same with going forward".
- **What:** the arrows beside the day strip ("Previous day", "Next day") move
  the strip and the chosen day together by one day, so the chosen day keeps its
  place in the strip. "Back to this week" is now "Back to today" (it returns to
  today, first in the strip, chosen).
- **Where:** `src/components/DashboardV2/DashboardV2.tsx` (`step`, `backToToday`).
- **Guard:** `tests/ai-plan-changes.spec.ts` › "past days: the arrows step back
  a day at a time…".

### Calendar: a clicked day opens that day, not today
- **Why:** "when i click on the dates on top here in the calendar week view it
  takes me to today's dashboard. can it take me to the dashboard of the day i
  clicked on? in the month view - when i click on a day it should take me to the
  week view of that day."
- **What:** in the week and three-day views, a day's header (or the empty part
  of its column) opens the dashboard with that day selected, on a seven-day
  strip that holds it (in whole weeks from today). The
  picked day is used once: a reload or a later visit opens on today. In the
  month view, a day opens the week that holds it; Month then returns to the
  month it came from.
- **Where:** `src/lib/calendarView.ts` (`dashboardDayFor`),
  `src/components/Calendar/CalendarTab.tsx` (`onOpenDay`, `handleMonthDayClick`),
  `src/App.tsx` (passes the day as router state), `LiveDashboard.tsx` (reads it,
  then clears it), `DashboardV2.tsx` (`initialDay`).
- **Guard:** `tests/calendar-view.spec.ts` › "a picked day opens the dashboard
  on that day…", "clicking a day in the month opens the week that holds it",
  "clicking a date in the week view opens the dashboard on that day".

## 2026-10-08

### Soma remembers conversations (notes per chat)
- **Why:** "I recall talking to Soma about what I'm gonna do for my CS midterm
  prep but it has no memory of it." Every chat was forgotten when it ended; the
  fact memory only keeps lasting facts about the student.
- **What:** each conversation keeps one short, dated note (title + up to ~6
  lines) of what was discussed, decided and planned, updated after each real
  reply by a small Haiku call (not after first-pass small talk, not for
  commands). A later reply gets back at most 3 notes that clearly match the
  student's message (two matching words, or one in the title), never the
  current chat's own. They ride on the newest message as "EARLIER
  CONVERSATIONS". The owner chose: notes per chat, recalled only when relevant,
  managed in Settings → Memory.
- **Control:** Settings → Memory has "Conversations" (edit, delete) and "About
  you" (the existing facts). Pausing memory stops notes being written or
  recalled; "Forget everything" and `/memory clear` delete notes too. Account
  deletion clears them.
- **Fails soft:** without the table, or if it errors, notes are skipped and the
  rest of memory and every reply keep working.
- **Untouched:** the fact memory (`api/_memory.ts`) is unchanged. An earlier
  attempt that stretched it to hold plans was reverted at the owner's request.
- **Where:** `api/_notes.ts` (store, matching, writer), `api/chat.ts` (recall,
  then write after the reply; `conversationId`), `api/memory.ts` (list, edit,
  delete, clear), `src/lib/assistant.ts` and `src/lib/ai.ts` (send the chat's
  id), `LiveDashboard.tsx`, `AITab.tsx`, `SettingsTab.tsx`, `src/lib/aiMemory.ts`,
  privacy pages, `api/_deleteUserData.ts`.
- **Guard:** `tests/conversation-notes.spec.ts`.
- **Setup:** run `soma_conversation_notes_migration.sql` once. Until then nothing
  is saved or recalled.
- **Cost:** about 0.2¢ more per real reply (the note writer), plus the matching
  notes' few hundred tokens when one is recalled.

### A time the student states can run past four hours
- **Why:** at 7 PM, "study for my CS midterm from now til 12" got "Suggested:
  now until midnight" and then "Couldn't place: Study proposals must be between
  1 minute and 4 hours". The 4-hour cap applied even to times the student gave.
- **What:** a block whose time the student stated (typed clock times, "now",
  an event) may run up to 12 hours, the editor's limit. A block Soma sizes on
  its own still stops at 4 hours, and the error says to give the times for a
  longer one. Accepting re-checks with the 12-hour limit (the cap was applied
  when it was proposed).
- **Where:** `src/lib/aiPlanning.ts` (`validateProposal` takes `maxMinutes`;
  `SOMA_MAX_MINUTES`, `STATED_MAX_MINUTES`), `src/lib/assistant.ts` (passes it).
- **Guard:** `tests/ai-whole-day.spec.ts` › "a five-hour block the student asked
  for…" (fails without this) and "a block Soma sizes on its own still stops at
  four hours".

## 2026-10-06

### Calendar: a short session no longer covers the block after it
- **Why:** an 8-minute session that ended as a block began was drawn across the
  whole day column, on top of that block, with the names overlapping. The layout
  judged overlap by minutes, but draws anything shorter than 18 minutes at
  18px (the minimum so its name fits), so it covered the next item.
- **Not a regression:** nothing in the calendar had changed since 2026-09-29.
  The flaw is older and only shows when a 5–18 minute session ends right where
  another item starts.
- **Where:** `src/components/Calendar/CalendarTab.tsx`. Lanes are worked out
  from the drawn height (`MIN_EVENT_HEIGHT`).
- **Guard:** `tests/calendar-view.spec.ts` › "a short session just before a
  block gets its own lane instead of covering it", with no gap and with a
  one-minute gap (the reported case: an ~11-minute session, then a block a
  minute later).

### Soma's plan data sent as short lines
- **Why:** a question cost ~4¢, mostly ~12,000 tokens of plan data written as
  repetitive JSON.
- **What:** each entry is one line, `"<id> <time> <title> · <course> · <flags>"`.
  Plan and last week are keyed by date, and tasks by course (only the 20 due
  soonest). Reading lists show the next 10 sections, and estimating history is
  sent only when planning. On a realistic week that's ~3,500 tokens instead of ~5,900.
- **Where:** `src/lib/assistant.ts` (context and INSTRUCTIONS), `src/lib/courseItems.ts`.
- **Guard:** `tests/context-size.spec.ts` (size cap, every fact present). Tests
  read entries with `lineOf` / `idOf` / `lines` in `tests/event-day.ts`.
- **Not yet checked against the real model.**

### Cheap first pass sorts each message
- **Why:** "hello" cost 8¢. Sonnet read the plan, the instructions and every
  uploaded document to say hi.
- **What:** Haiku (`purpose: 'triage'`) sees only the message, the last 4 turns
  and the document names. It answers small talk itself, or routes the message:
  `ask` goes to Sonnet at low effort, `plan` to Sonnet at medium. Document text
  is sent only when it says `docs`. Memory commands skip the first pass, and
  anything unreadable goes to the full Soma. Soma no longer recaps the plan unasked.
- **Where:** `src/lib/assistant.ts` (`triage`), `api/chat.ts` (`effort`,
  `purpose`; the first pass skips memory lookup and memory learning), `src/lib/ai.ts`.
- **Guard:** `tests/ai-triage.spec.ts`. Other AI tests answer the first pass
  with `triaged()` from `tests/triage.ts`.
- **Setup:** run `ai_usage_triage_migration.sql`.

### Monthly Soma budget, top-ups, cached chat history
- **What:** each plan includes a monthly AI budget in dollars, shown as % used. It
  resets on the billing date (every month, even on the 4-month plan). Trials
  get $1.50 for 7 days. At the limit only asking Soma pauses (HTTP 402
  `ai_budget_used`); everything else works. A top-up is $2.99 for $2 more, via
  Stripe Checkout with an inline price, recorded by the webhook in `ai_topups`.
  Subscribers only. The `DEVELOPER_EMAIL` account is unlimited. If the budget
  can't be read, Soma keeps answering.
- **Caching:** the live plan and memory now ride on the newest message, so
  earlier chat turns are read from cache.
- **Where:** `api/_budget.ts` (all amounts: `MONTHLY_AI_BUDGET_USD = 4` is a
  placeholder), `api/stripe.ts` (`get-ai-budget`, `create-topup-session`),
  `api/stripe-webhook.ts`, `src/lib/aiBudget.ts`,
  `src/components/UI/AiBudgetMeter.tsx` (dashboard chat, AI page, Settings →
  Subscription), `src/lib/pricing.ts` (`TOPUP_PRICE`). The Terms, Billing and
  Refund pages describe it; the refund rule for top-ups is a draft.
- **Guard:** `tests/ai-budget.spec.ts`, and the caching layout in `tests/ai-memory.spec.ts`.
- **Setup:** `ai_topups_migration.sql` was run. Pick the real monthly amount
  from measured usage. Test one top-up with a Stripe test card.

### Per-user AI cost logging
- **What:** every Soma reply, first pass and memory-learning call saves token
  counts and `cost_usd` to `ai_usage`. It stores numbers only, never text.
  Account deletion clears it, and the privacy and deletion pages say so.
- **Where:** `api/_usage.ts`, `api/chat.ts`, `api/_memory.ts`.
  Report: `ai_usage_report.sql`.
- **Guard:** `tests/ai-backend.spec.ts`, `tests/delete-account.spec.ts`.
- **Setup:** `ai_usage_migration.sql` was run.

### Every reply on Sonnet 5.5; weeks worked out by the app
- **Why:** Haiku answered most messages, and mixed up "last week's homework"
  with homework done last week.
- **What:** Sonnet 5.5 (`claude-sonnet-5-5`) with the default refusal fallback.
  The context carries `weeks` (this week and last week, Monday–Sunday).
  Same-named tasks ignore punctuation, and a copy whose twin is checked off isn't
  offered as open.
- **Where:** `api/chat.ts`, `src/lib/assistant.ts`, `src/components/DashboardV2/liveData.ts`.
- **Guard:** `tests/ai-backend.spec.ts`, `tests/ai-whole-day.spec.ts`.

### Settings saves merge instead of replacing; import matches titles loosely
- **Why:** Settings → Save replaced the whole stored settings record with this
  browser's copy. That wiped the Canvas feed link, and with it every Canvas deadline.
- **What:** `storage.saveSettings` reads, merges, and refuses to write if the
  read fails. The Settings page sends only theme, time format, study hours and
  smallest piece. The course-site import treats titles that differ only in
  case, spacing or punctuation as one task.
- **Where:** `src/lib/storage.ts`, `src/components/Settings/SettingsTab.tsx`,
  `src/components/Settings/CourseSiteImport.tsx`.
- **Guard:** `tests/study-hours.spec.ts` (Canvas link survives a save),
  `tests/course-site-import.spec.ts`.
- **Do not:** write `settings.data` wholesale, or let a failed read fall back to defaults.

### Today by default
- **What:** if the latest message names no other day, new or moved work goes on
  today, and undated work is placed today. A day from an earlier message,
  Soma's earlier reply or the day on screen doesn't carry over. Work placed
  after its task's due date shows "After its due date".
- **Where:** `src/lib/statedTime.ts` (`namesOtherDay`), `src/lib/assistant.ts`.
- **Guard:** `tests/ai-whole-day.spec.ts`.

### Delete blocks by hand
- **What:** a Delete button on your own blocks in Edit plan, and "Delete block"
  in the block editor, after a confirm. Same delete as accepting Soma's: a task
  with other blocks keeps them, and recorded time stays.
- **Where:** `DashboardV2.tsx`, `PlanEditor.tsx`, `LiveDashboard.tsx`,
  `liveData.ts` (`deletePlanBlock`).
- **Guard:** `tests/live-dashboard.spec.ts`.

### Whole-day planning
- **What:**
  - No five-block cap (40 is the safety limit; output up to 8,192 tokens).
  - Before 5 AM, "tomorrow" and "when I wake up" mean today (`lateNight`).
  - Skipped classes are remembered for the day and shown as "Skipping" (`attend` takes a skip back).
  - Deleting a block and making the same work anew is a move.
  - Ids in replies are shown as names.
- **Where:** `src/lib/assistant.ts`, `src/lib/skippedEvents.ts`, `api/chat.ts`.
- **Guard:** `tests/ai-whole-day.spec.ts`.

### Study hours can be turned off
- **What:** an On/Off switch in Settings → Study hours. Off means any hour, and
  free time runs through midnight. A start within 5 minutes of now counts as "now".
- **Where:** `clockRange.ts` (`activeWindow`), `aiPlanning.ts`, `SettingsTab.tsx`.
- **Guard:** `tests/study-hours.spec.ts`, `tests/auto-placement.spec.ts`.

## 2026-10-05

### Skips and a retry for replies the app can't use
- A reply has a `skip` list, and a change aimed at a calendar event means
  skipping it. A move without a date stays on its day. A reply with an unknown
  id, a missing start or end, an invalid time or no JSON goes back to the model
  once. **Guard:** `tests/ai-event-times.spec.ts`.

### Tasks without a day have ids
- Soma schedules the task itself instead of making a copy (`taskBlocks` in
  `liveData.ts`). **Guard:** `tests/ai-event-times.spec.ts`.

### Times named by event and "now"
- Every plan entry, calendar events included, has an id. A start, end, after or
  before can be "now", a clock time, or an entry; the app works out the time.
  Events are matched by name loosely (`namesEvent`).
  **Guard:** `tests/ai-event-times.spec.ts`. The real-model check is
  `tests/ai-real-model.spec.ts` (needs `ANTHROPIC_API_KEY`).

## 2026-10-04

### Same-named blocks check off together
- Checking or unchecking a block does the same to every same-named block in that
  course. Personal blocks and commitments are excluded.
  **Where:** `liveData.ts` (`setTaskStatus`). **Guard:** `tests/live-dashboard.spec.ts`.

### Past work is judged by checkmarks and logged time
- The dashboard's "today" rolls over at midnight. Chat turns carry when they were
  sent. Past blocks carry their recorded sessions. Past-due dates say so.
  **Guard:** `tests/ai-past-work.spec.ts`.
