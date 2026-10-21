# Soma change log

Every change to Soma goes here, newest first. Before changing an area, read its
entries: they say what each fix protects, and the test that guards it. A change
that breaks one of those tests is a regression, not a cleanup.

Format: date · what changed and why · where · the test that guards it · setup
still needed.

---

## 2026-10-20

### Soma makes room instead of asking; a failed move keeps its slot
- **Why:** "this needs your call thing is actually pissing me the fuck off
  ... unless ive specificially said ... a specific time for a specific
  session soma should have the ability to move stuff around". And Accept on
  the 10.5 review failed: "That time overlaps a scheduled session".
- **Cause (overlap):** every block a reply changes is lifted out of the plan
  first. The 10.5 review was placed at 9:30 PM, the 10.9 review's slot; 10.9's
  own move then failed and it went back, under 10.5. Pre-existing since
  2026-09-27.
- **What:**
  - A reply whose failed change sits under something else placed in it is
    read again with that block left where it is (`settled`, `stuck`).
  - When work doesn't fit, the app moves the student's other blocks to make
    room (`makeRoom`): as few as will do, each to the next open time that day
    or a later day, never past its due date. Each move is its own card,
    "Moves from … to make room for X". Accepting X applies those moves first;
    dismissing X drops them.
  - Never moved: calendar events, checked-off, started, past or timed blocks,
    blocks this reply already changes, and blocks whose time the student set:
    a time told to Soma and accepted, or one set by hand in Edit plan
    (`src/lib/pinnedBlocks.ts`, browser storage, per task, date and start).
  - Still no room, on a day Soma chose (not today, not a day the message
    names): the next day with room, noted "<day> was full". Today's work never
    rolls to another day on its own (2026-10-06 rule kept).
  - "Needs your call" is left only for what none of that can place.
- **Where:** `src/lib/assistant.ts` (`place`, `makeRoom`, `settled`,
  `applyProposal`, `dismissProposal`, prompt DATES line),
  `src/lib/pinnedBlocks.ts`, `LiveDashboard.tsx` (`save`), `PlanEditor.tsx`
  (`pinned`, `bumps` on PlanBlock).
- **Guard:** `tests/ai-make-room.spec.ts` (5 tests; all fail without this).
- **Setup:** none. Times set before today aren't remembered as the student's,
  so Soma may suggest moving one once; it still needs Accept. Pins are per
  device.

### "Some other day" / "a different day" no longer lands on today
- **Why:** "you gotta move all the cs lecture videos to some other day i cant
  watch them today", then "DELETE THE CS LECTURE REVIEW SESSIONS FROM TODAY
  AND THEN MAKE NEW ONES ON A DIFFERENT DAY". Soma said tomorrow evening; the
  cards put them on Tue (today) and asked about slots that don't exist.
- **Cause:** the "Today by default" rule (2026-10-06) forces work onto today
  unless the message names a day. "Some other day" and "a different day" named
  none, so Soma's tomorrow was overridden. Pre-existing, not a regression.
- **What:** `namesOtherDay` also counts asking for work off today: "another /
  a different / some other / later / next day", "not today", "off today",
  "anything but today". Then Soma's choice of day stands. The prompt says the
  same. "I'm not going to lecture today" still doesn't count (it's a skip).
- **Where:** `src/lib/statedTime.ts` (`namesOtherDay`), `src/lib/assistant.ts`
  (DATES line of the prompt).
- **Guard:** `tests/ai-whole-day.spec.ts` › "asking for another day ("a
  different day") is not read as today" and ""not today" and "some other
  day" count as naming another day; a skipped class does not" (both fail
  without the fix).
- **Setup:** none. The blocks proposed earlier are still on today: ask again.

## 2026-10-19

### Renaming one block of a task renames only that block
- **Why:** "instead of physics 5a homework, i did gemini generated practice
  quizzes from 3 to 4". "Physics 5A: HW 6" had two blocks that day, 1:40 and
  3:00. Soma renamed the 3:00 one; the 1:40 one changed too. Renaming it back
  changed both back, and Soma went in circles telling the student the other
  block "stays".
- **Cause:** a block has no name of its own; it shows its task's. The two
  blocks were two times of one task, so a rename (from Soma or Edit plan)
  renamed the task, and with it every block of it. All the time logged on the
  task moved to the new name too.
- **What:** renaming one of a task's several blocks makes that block its own
  task under the new name, on the block's day. Only the timer sittings under
  the old name that overlap where the block was go with it; the rest stays
  with the task's other blocks. The new task keeps the course and kind, and
  takes the block's checkmark state, but not the old task's Canvas
  assignment, reading-list sections or notes: it is other work.
- **Unchanged:** a task with a single block is renamed in place as before
  (the 2026-10-01 rule that moves its logged time still applies). Checking
  off, moving and removing are untouched. Reading-progress retitles ("read
  through 4.3") still rename the whole task.
- **Where:** `src/components/DashboardV2/liveData.ts` (`savePlanBlock`).
- **Guard:** `tests/ai-plan-changes.spec.ts` › "renaming one block of a task
  with two blocks renames only that block, with the time logged during it"
  (3 tasks without the fix, 4 with).
- **Setup:** none. Blocks already renamed together stay one task: rename the
  one that should differ once more and it splits off.

## 2026-10-12

### Calendar: a session whose task was renamed is drawn once, not twice
- **Why:** "whats going on here theres duplicates". Tue Oct 6 showed the
  9:20 PM and 9:31 PM Math 53 sessions twice each, side by side. Past sessions
  and the server both list them once.
- **Cause:** the timer keeps a copy of each session in this browser
  (`soma_blocks`), under the task's name at the time. The task was renamed
  afterwards ("…Chapters 14.3–14.5" to "…Chapters 14.3, 14.4"): renaming
  renames the sessions on the server, not the browser's copies. Since
  2026-10-09 the calendar joins records only when they are the same task, so a
  copy under the old name stopped joining its own session and was drawn beside
  it. Not caused by the entry below; it came from the 2026-10-09 change and
  showed up on any day with a renamed task.
- **What:** a copy that names its session (by id) goes by that session's task
  and course, so it always joins it. And "same task" ignores case, spacing and
  punctuation, as it does on the dashboard ("Homework - Ch 14" is
  "Homework — Ch 14").
- **Kept:** two different tasks in one course are still two blocks (the
  2026-10-09 guard passes unchanged). Consecutive sittings of one task still
  draw as one stretch.
- **Where:** `src/components/Calendar/CalendarTab.tsx` (`studySpans`).
- **Guard:** `tests/session-times-and-calendar.spec.ts` › "a session is drawn
  once when its task was renamed after the timer recorded it" (6 blocks
  without the fix, 2 with).

### Calendar: only logged study time, nothing from the plan
- **Why:** "when i logged time for a study block before the scheduled time and
  i check off on it the block itself like the timed section appears in the
  calendar but obviously the calendar should onl show the times that you logged
  study time right ?" A checked-off block was drawn at its planned time unless
  a session for that task had started on the same calendar day. Study a block
  early, on the day before (an overnight plan does this all the time), check it
  off, and the calendar showed both the evening that was studied and the
  planned hours that weren't.
- **What:** the calendar draws recorded sessions and nothing else from Soma,
  in the week view and the month chips. No planned block appears on it,
  checked off or not.
- **Changed on purpose, replacing the 2026-09-29 rule:** a block checked off
  with no time logged used to appear at its planned time ("A finished session
  from your plan"). It no longer appears: there is no record of when it was
  done, and Insights never counted it either, so the two now agree. To put it
  on the calendar, add the time from the task's Past sessions ("Forgot to start
  the timer? Add a session").
- **Untouched:** recorded sessions and how they merge and draw, Google
  Calendar events, deadlines, the dashboard and its checkmarks, Insights.
- **Where:** `src/components/Calendar/CalendarTab.tsx` (`planSpans`,
  `onlyUnrecorded` and the plan branch of the block dialog removed).
- **Guard:** `tests/session-times-and-calendar.spec.ts` › "nothing from the
  plan is drawn on the calendar: checked off or not, only logged time shows".
  It replaces "a finished past block from the plan shows on the calendar;
  upcoming ones do not", whose first half is the behaviour removed.

---

## 2026-10-11

### Claude connector: every task says how its time is chosen
- **Why:** after agreed times and `move_tasks` shipped, Claude still replied
  "the tools I have can't set a clock time or move tasks", and seven blocks of
  an agreed overnight plan landed at times Soma picked ("bro im actually gonna
  crashout"). The live log shows those calls reached the new version: Claude
  was working from the tool list it saved when the student first connected, so
  it sent tasks with no time, and a task with no time meant "Soma picks".
- **What:** `start` is required on every task and every move: the agreed time
  as HH:mm, or `"auto"` for Soma to pick. A request without it is refused
  before anything is saved, and the refusal says what to send and that `start`
  is accepted even if Claude's list doesn't show it. This is how Claude learned
  to send `timezone`. Nothing is placed by default any more.
- **Fixing what's there without `move_tasks`:** sending a task that is already
  on that date with an HH:mm `start` moves it to that time instead of skipping
  it (reported under `given_a_time` with where it was). Blocks retimed together
  step aside for each other. `"auto"` on a task that has a time leaves it alone.
- **A block in progress saves:** an agreed time is refused as passed only when
  the whole block is over, not when its start has gone by. (5:15–8:45 PM
  entered at 5:30 PM is the block the student is in.) This differs from the
  app, which goes by the start.
- **Logging:** each tool call logs which tool and which fields it carried, and
  each `tools/list` logs that it happened. Names only, never a value.
- **Where:** `api/_connector.ts` (`needStart`, `whenOf`, `saveTime`,
  `add_tasks`, `move_tasks`), `api/_placement.ts` (`exactSpot`), `api/_mcp.ts`
  (`callShape`).
- **Guard:** `tests/claude-connector.spec.ts` › "a task sent without saying how
  its time is chosen is refused, with what to send", "sending a task that is
  already there with its agreed time moves it, instead of adding it twice",
  "each tool call is logged by its shape only…".
- **Setup still needed:** in Claude, remove the Soma connector and add it
  again so it reads the current tool list (`move_tasks`, calendar events in
  the plan). Agreed times work without that.

### Claude connector: agreed times are saved as given, and Claude can move blocks
- **Why:** an all-nighter planned with Claude could not be entered. Claude's
  reply: "Soma ignored the overnight again. It only places tasks between about
  8am and midnight … I can't set clock times, so you'll need to drag the
  blocks", then a table of blocks to move by hand and two to "add manually".
  The owner: "bro what is this". The connector placed only inside study hours,
  gave Claude no way to use a time the student had agreed to, and no way to
  move a block once placed.
- **What, adding:** a task may carry `start`, the time the student agreed to
  (their own plan, or a schedule Claude proposed and they accepted). It is
  saved exactly there: any hour, overnight and outside study hours included,
  up to 12 hours, and over a calendar event (the reply names the event). It is
  refused only when the time has passed (15 minutes' grace) or lands on another
  of the student's blocks, which the reply names. This is the app's own rule
  for a time the student states. Without `start`, Soma still picks, inside
  study hours, as before.
- **What, moving:** a new tool, `move_tasks`: another day, another time, a new
  length, or a time for a task that has none. Ids come from `get_plan`, which
  now gives one for every task and block. Blocks moved together step aside for
  each other, so two can swap. One that can't go where asked stays where it
  was. A checked-off task is not moved. The task's day follows its only block,
  as in the editor.
- **Still true:** nothing is deleted, renamed or checked off. The only change
  to an existing task is its day.
- **Told to Claude:** use `start` for agreed times, report the times the tools
  return, and do not tell the student to drag blocks or add tasks by hand for
  something the tools can do. The approval page now says "Add tasks, move them
  to another time, and add reading-list sections".
- **Where:** `api/_placement.ts` (`exactSpot`), `api/_connector.ts`
  (`placeOn`, `add_tasks`, `move_tasks`, `get_plan` ids),
  `src/components/Connect/ConnectApproval.tsx`.
- **Guard:** `tests/claude-connector.spec.ts` › "a time the student agreed to
  is saved exactly, overnight and outside study hours included", "an agreed
  time is refused only when it has passed or lands on another block", "Claude
  can move a block to another time or day…", "blocks moved together make room
  for each other…", "finished work, another student's blocks and made-up ids
  are not moved".
- **Test changed on purpose:** "…and Claude cannot name a clock time" is now
  "no tool can delete or check work off; what the connector may write is listed
  here". Claude can now pass a time the student agreed to; the test pins the
  exact writes instead (an existing task is only ever given a new day).
- **Not verified:** with a real Claude session; whether Claude uses `start`
  rather than leaving it out is up to how it reads the tool description.

### Block editor: pick the date a block is on
- **Why:** "we have to allow the user to be able to choose the date for the
  schedule time as well similar to logging the past sessions". Edit block had
  a start and an end time only, so a block could be planned only on the day on
  screen, and a block on the wrong day had to be deleted and made again.
- **What:** with "Schedule a time" on, the editor shows Starts on [date]
  [Start time] and Ends on [date] [End time], for both Edit block and a new
  block. It opens on the block's own date. The end date follows the start: the
  same day, or the next day when the end time runs past midnight. It can be
  changed, but a block is still at most a day long, so an end date the times
  can't reach is refused with the reason. Saving on another date moves the
  block there, and the dashboard says "Saved on Wed, Oct 14." because the
  block leaves the day on screen.
- **Two things fixed in saving, which the date field would otherwise have hit:**
  a block saved on another day at the same clock time used to keep its old
  day (the save treated an unchanged time as nothing to do); and a moved block
  left its task on the old day, where it would reappear once its time was
  taken off. The task's day now follows when the block is its only one; a task
  planned in several sittings keeps its day and only that sitting moves.
  Soma's own moves go through the same save, so "move it to tomorrow, same
  time" is fixed with it.
- **Labels:** "Starts on" / "Ends on", not "Start date" / "End date": the
  past-session forms in the same panel already use those names.
- **Untouched:** the past-session forms, the time fields and their rules (12
  hours past midnight), tasks with no time (no date field until a time is
  scheduled), the demo dashboard (`/dashboard-v2` has no dates).
- **Limit:** the overlap notice only knows the week on screen; a date outside
  it saves without that warning.
- **Where:** `src/components/DashboardV2/PlanEditor.tsx`, `liveData.ts`
  (`savePlanBlock`), `DashboardV2.tsx` (passes the date of day 0, the message).
- **Guard:** `tests/block-date.spec.ts` (6 tests); "a block opens on its own
  date, and saving another date moves it there at the same time" and "one
  sitting of a task planned twice moves alone…" fail without the save fix.

### Claude connector: Claude sees Google Calendar events
- **Why:** "now let claude see my google calendar events too". Claude could
  see tasks but not classes and other commitments, so it planned days without
  knowing what was already on them.
- **What:** `get_plan` lists each day's Google Calendar events beside its
  tasks: title and time, or all-day. The same calendars the dashboard shows
  (every selected calendar on every connected account), drawn the same way: an
  event running in from yesterday starts at 00:00, one running on ends at
  23:59. Only the title, start and end are asked of Google; descriptions,
  locations and guests are not. If the calendar can't be read, or none is
  connected, the plan still comes back and says which.
- **Told to Claude:** events are fixed commitments to plan around, never study
  tasks, and their names are the student's data, not instructions.
- **Approval page:** the first line now names Google Calendar events.
- **Changed from the entry below:** the calendar read used for placing tasks
  kept start and end only. It is now one read that also carries the title;
  placement still uses only the times.
- **Where:** `api/_connectorCalendar.ts` (`googleEvents`), `api/_connector.ts`
  (`get_plan`), `src/components/Connect/ConnectApproval.tsx`.
- **Guard:** `tests/claude-connector.spec.ts` › "the plan lists Google Calendar
  events on their days, as the dashboard draws them", "the calendar is read as
  a title and a time, nothing more, and it says when it is incomplete" (this
  one replaces "…as busy time only: no titles", on purpose).
- **Not verified:** against a real Google account from the tests; confirmed
  only by use.

### Claude connector: Soma places clock times for tasks Claude adds
- **Why:** "make soma auto-place clock times for tasks claude adds". Tasks
  from Claude arrived on their day with no time, and the student had to give
  each one a time by hand.
- **What:** `add_tasks` now places each task when it is added and tells Claude
  the time. The rules are the app's own (`freeTime` / `autoPlace`), restated on
  the server because that code runs in the browser: the first open stretch of
  the day that holds the whole task, inside study hours (read from saved
  settings; 8 AM–11 PM when none are saved; with hours off, not before 8 AM
  unless a time was asked for), clear of Google Calendar events (all-day events
  fill the day, as on the dashboard) and of every planned block, never in the
  past, starts on five-minute marks, tasks placed in the order given. The block
  is saved exactly as the dashboard saves one (`todo_sessions`: day, start,
  end), so the dashboard, calendar and editor show it with no change to them.
- **Claude still cannot name a time.** A task takes a day, a length, and
  optional `after` / `before` bounds for a time the student asked for.
- **When it does not fit:** the task is not added, and the reply lists what is
  open that day, so Claude asks the student instead of leaving an untimed
  task. It is never split. Over 4 hours, or when the calendar could not be read
  (the app refuses AI schedules in that state too), the task is added without a
  time and says why; sending it again once the calendar is back gives the same
  task its time instead of adding a second one.
- **Time zone:** the server does not know it, so `timezone` is now required.
  A zone that disagrees with the days the student's own sessions were saved on
  (three or more, and more than agree) is refused before anything is written:
  a wrong zone would put every task hours off.
- **Different from the app:** an event the student marked "Skipping" on one
  device still counts as busy here, because that mark is kept in the browser.
- **Where:** `api/_placement.ts` (new: rules, zone arithmetic),
  `api/_connectorCalendar.ts` (new: calendar as busy time, start and end
  only), `api/_connector.ts` (`add_tasks`), `api/_mcp.ts`.
- **Guard:** `tests/claude-connector.spec.ts` › "Soma places each task in the
  first open stretch of its day and says when", "today's tasks start from now…",
  "a task that does not fit on its day is not added…", "a calendar Soma cannot
  read…", "study hours decide where a day starts and ends…", "a time zone that
  does not match…", "clock times are worked out in the student's zone, across a
  clock change too", "the calendar is read as busy time only…".
- **Test changed on purpose:** "no tool can delete, check work off, or write a
  clock time" is now "…and Claude cannot name a clock time": the connector does
  write blocks now; what it guards is that Claude has no way to choose the time.
- **Not verified:** the Google Calendar read against a real account, and a real
  task added from Claude; the tests use stand-ins for both.

### Claude connector: first real connection, and what it took
- **Outcome:** connected and working on 2026-10-11 (live logs: Claude's
  requests to `/api/mcp` answer 200 with its token).
- **What failed first:** "Authorization with Soma failed" in Claude. Supabase's
  log showed the sign-in request accepted and the code exchange
  (`POST /auth/v1/oauth/token`) refused with 400. The Claude client had been
  registered in Supabase as Confidential, with a secret. Supabase refuses the
  exchange when the secret is wrong or is sent a different way from the one the
  client is registered for; which of the two it was is not known. A **Public**
  client (no secret) worked first time.
- **A wrong turn, undone:** before the Supabase log was available I read the
  401s on `/api/mcp` as Claude's token being refused, and made the connector
  also accept an app's token on its signature. Those 401s were requests with
  no token. That fallback is removed: it would have kept a revoked connection
  working for up to an hour. Supabase's user endpoint is the only judge again.
- **What stays:** a refused token logs why (`connector_token_refused`: status
  and error code only, never the token).
- **Where:** `api/_mcp.ts` (`authorizeConnector`).
- **Guard:** `tests/claude-connector.spec.ts` › "a token is judged by Supabase,
  then by the subscription, and a refusal logs why".

### Claude connector: Claude reads the plan and adds tasks and reading-list sections
- **Why:** "i cant give soma the entire pdf doc of a texbook, but i can give it
  to claude and then give like more specific things from the texbook (like more
  detialied then the chapters) and even ask claude what problems to solve".
  The textbook stays in Claude; Claude works out what to study and puts it into
  Soma.
- **What:** Soma is a connector a student adds in Claude at
  `https://somastudy.app/api/mcp`. Claude can read courses, the plan, deadlines,
  reading lists, recorded study time and uploaded documents, and can add tasks
  (title, course, day, minutes, optional due date and the sections it covers)
  and add, rename, re-date or reorder reading-list sections.
- **Rules it keeps:** Claude picks what, which day and how long, never a clock
  time (as first built a task arrived with no time; Soma now places it, see
  "Soma places clock times for tasks Claude adds" above). Nothing is deleted and nothing is marked
  done; a reading list keeps its progress, its planned blocks and every section
  left out of a save. A task already on that day, or already checked off under
  the same name in the course, is skipped. One invalid task and none are saved.
  Needs an active subscription or trial, like Soma's own AI.
- **Sign-in:** Supabase's OAuth server. Claude sends the student to
  `/oauth/consent`, a new page outside the app shell, where they sign in if
  needed and press Allow. An app is named by where it sends the student back,
  not by the name it gives itself; anything other than claude.ai / claude.com
  gets a warning.
- **Touched outside the new files, and why:** `api/import-schedule.ts` (its
  default export also serves the connector, because the plan deploys twelve
  functions and this is the twelfth; the import itself is unchanged),
  `vercel.json` (five rewrites ahead of the catch-alls), `src/App.tsx` (the
  route, the trial prompt kept off it, and the return to it after a Google
  sign-in).
- **Where:** `api/_connector.ts` (tools, database boundary), `api/_mcp.ts`
  (protocol, sign-in discovery), `src/components/Connect/ConnectApproval.tsx`.
- **Guard:** `tests/claude-connector.spec.ts` (21 tests), including "no tool can
  delete, check work off, or write a clock time", "every query is limited to
  the signed-in student", and "the connector rides on an existing function, and
  the course-site import is unchanged" (fails if a thirteenth function appears).
- **Setup still needed (Supabase dashboard, by the owner):** Authentication →
  OAuth Server: turn it on and set the authorization path to `/oauth/consent`.
  Authentication → OAuth Apps: add a **Public** client for Claude with redirect
  URIs `https://claude.ai/api/mcp/auth_callback` and
  `https://claude.com/api/mcp/auth_callback`, and paste its id (no secret) into
  the connector's advanced settings in Claude. Done by the owner 2026-10-11.
  Leave dynamic registration off:
  a token from this sign-in is the student's full Soma session, so only apps
  registered by hand should be able to ask for one.
- **Not covered:** Canvas assignments not yet turned into tasks are not
  visible to Claude. (Google Calendar events are, since the entry above.)

---

## 2026-10-09

### Calendar: two tasks in one course never draw as one block
- **Why:** Fri Oct 9 showed one block, "Linked Lists, 11:36 PM – 1:27 AM, 1h 51m
  studied", but that task had only 90 minutes (11:36 PM – 1:06 AM). The other
  21 minutes (1:06 – 1:27 AM) were on "Practice Midterm instances", which is
  also why Insights showed 21 minutes on Friday. "if tasks are different, then
  even if the course is the same it shouldn't combine".
- **What:** records of study time merge only when they are the same subject
  and the same task (a record with no task name may still join, as a copy of
  the same stretch). Two places mixed tasks: the merge of overlapping spans,
  and the timer's own block copy, which took in every same-subject session
  starting inside its window, including one starting the moment it ended.
- **Untouched:** Insights still counts a session on the day it started (the
  owner's choice); a sitting past midnight is not split.
- **Where:** `src/components/Calendar/CalendarTab.tsx` (`studySpans`, `sameTask`).
- **Guard:** `tests/session-times-and-calendar.spec.ts` › "two tasks in the
  same course never draw as one block" (draws 1 block without the fix, 3 with).

### Sessions: a start date and an end date, typed like Google Calendar
- **Why:** "forget the today, yesterday and earlier stuff, just let me manually
  put the freaking date like this except for the end time let me pick a date
  too (default should be the same as the start day though unless it goes past
  12 am". Replaces the Today / Yesterday / Earlier choice in the two entries
  below, the same day.
- **What:** Start and end, in both Add and Edit, is two rows: Start [date]
  [time] and End [date] [time]. The end date follows the start date: the same
  day, or the next day when the end time is before the start and within 12
  hours (11:25 PM to 12:35 AM). Further back than that (3 PM to 2 PM) it stays
  on the start's day and is refused as an end before the start, as before,
  unless the student sets the end date, which then allows up to 24 hours. A
  picked end date moves with the start date. Length mode has a Date beside the
  minutes. The summary still names the day ("Fri, Oct 9 · Ends 1:35 AM on Oct
  10 · 137 minutes."). The date boxes no longer clip in the narrow panel.
- **Where:** `src/lib/sessionSpan.ts` (new: `autoEndDate`, `sessionSpan`),
  `src/components/DashboardV2/PlanEditor.tsx` (`SessionWhen`, both forms),
  `DashboardV2.module.css` (`.sessionWhen`, `.logDate`, `.logAddLength`;
  `.logAddDay` removed).
- **Guard:** `tests/session-span.spec.ts`; `tests/session-times-and-calendar.spec.ts`
  › "a session is added on the start date typed…", "an end date picked by hand…",
  "adding by length takes a date too", "editing a session can move it to another
  date…".

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
