# Soma change log

Every change to Soma goes here, newest first. Before changing an area, read its
entries: they say what each fix protects, and the test that guards it. A change
that breaks one of those tests is a regression, not a cleanup.

Format: date · what changed and why · where · the test that guards it · setup
still needed.

---

## 2026-10-28 (Blog for search)

### A blog at /blog, built as plain HTML pages
- **Why:** the owner asked for an SEO blog. The app is a React page that
  search engines see as an empty `<div id="root">`, so posts rendered by
  React would barely be indexed.
- **What:** each Markdown file in `content/blog/` becomes a static page at
  `/blog/<file name>`: title, description, canonical link, Open Graph tags,
  BlogPosting and breadcrumb structured data, reading time, a "Try Soma free"
  box and links to other posts. Also `/blog` (the list), `/blog/rss.xml` and
  `/blog/sitemap.xml` (added to `robots.txt`; `/blog` added to the main
  sitemap). Styled like the landing page (light, Figtree, slate and blue).
  Production pages load Vercel Web Analytics with the same path-only rule as
  the app. A "Blog" link was added to the landing page footer. Three starter
  posts: weighted grades, making a study schedule, keeping track of Canvas
  assignments. To add a post: a new `.md` file with `title`, `description`
  and `date` at the top (see the comment in `config/blog.ts`); `draft: true`
  leaves it out.
- **Where:** `config/blog.ts` (a Vite plugin: `vite build` writes
  `dist/blog/`, `vite` serves the pages from memory), `vite.config.ts`,
  `content/blog/`, `vercel.json` (`/blog` and `/blog/<slug>` rewrites before
  the app's catch-all), `public/robots.txt`, `public/sitemap.xml`,
  `src/components/Landing/LandingPage.tsx` (footer link only). `marked`
  added as a dev dependency (build time only, nothing ships to the browser).
- **Guard:** `tests/blog.spec.ts` (pages are server HTML, every post listed,
  meta and structured data, RSS, sitemap, unknown post is a 404). Full
  suite: 625 passed, 7 skipped.
- **Setup:** after deploy, submit `https://somastudy.app/blog/sitemap.xml`
  in Google Search Console. Posts have no share image: `index.html` points at
  `/og-image.png`, which isn't in `public/`.

---

## 2026-10-28 (Deadlines: no "Everything due" button)

### The lone "Everything due" tab is gone
- **Why:** the owner asked what it was. It did nothing: the only tab left of
  the old sub-nav when the page became "everything due" (2026-09-22,
  07bfdc1), drawn as selected, with nothing to switch to.
- **What:** removed with its styles. The top bar keeps the Canvas sync line
  and refresh button at the right, at the same height (45px), and is left out
  when there's nothing to show in it (no sync, no extension, no error).
- **Where:** `src/components/Deadlines/DeadlinesTab.tsx` and its CSS.
- **Guard:** none for a removed button; `tests/deadlines.spec.ts` and the full
  suite pass: 622 passed, 7 skipped.
- **Setup:** none. The onboarding guide's drawing of Soma (`CanvasGuide.tsx`)
  still labels its mock page "Everything due"; left as is.

---

## 2026-10-28 (Grades: two decimals)

### Percents show two decimals
- **Why:** the owner asked for grades with two digits after the point, not one.
- **What:** every percent on the Grades page (course grade, category
  averages, each score, "Canvas shows …") and in the AI's grade line shows
  two decimals: 85.11%, 88.50%; whole numbers stay "90%". Scores, category
  averages and the course grade are rounded to two decimals instead of one,
  and a weighted grade is worked out from the unrounded category averages.
- **Where:** `src/lib/grades.ts` (`round2`, `showPercent`).
- **Guard:** `tests/grades.spec.ts` (74.67% weighted, 66.67% on a score;
  expectations moved to 88.50% and 85.11%). Full suite: 622 passed, 7 skipped.
- **Setup:** none.

---

## 2026-10-28 (Grades: sort the scores)

### Scores sort by date, name, category or score
- **Why:** the owner asked to order a course's assignments by a click: by
  date, category, score.
- **What:** the Scores headers are buttons: Assignment (A–Z), Date (newest
  first), Category (syllabus order; Canvas group name without categories)
  and Score (by percent, highest first). A second click reverses; an arrow
  marks the one in use. Ties fall back to newest first; work with no date or
  no percent goes last. The choice is remembered on this device
  (`soma_scores_sort`), for every course. Default is newest first, as before.
- **Where:** `src/components/Grades/CourseGrades.tsx` (`sortItems`,
  `SortButton`), `GradesTab.module.css`.
- **Guard:** `tests/grades.spec.ts` (each order, reversing, remembered after a
  reload). Full suite: 621 passed, 7 skipped.
- **Setup:** none.

---

## 2026-10-28 (Grades: spreadsheet import, Grading folds)

### Import scores from a spreadsheet
- **Why:** the owner asked for a way to bring in a sheet of grades instead of
  typing each one.
- **What:** "Import spreadsheet" beside "+ Add a score". Takes a .csv/.tsv
  file, an .xlsx (Google Sheets and Excel downloads), or pasted cells
  (Sheets, Excel, or the table on a Gradescope course page). Read in the
  browser only: no AI, no upload; only the imported scores are saved, as
  typed-in scores. The .xlsx reader is ours (`readXlsx`: the zip's central
  directory, the browser's `DecompressionStream`, `DOMParser`), not the npm
  `xlsx` package, which has unpatched advisories. Columns are found by header
  ("Name/Assignment", "Score/Status/Points", "Out of/Possible",
  "Category/Type", "Date/Due/Released") or by what they hold, and can be
  changed; scores read as "18.0 / 20.0", "18/20", "92%" or a number with an
  Out of column; dates as ISO, 9/5/2026, "Sep 05 at 11:59PM" or a sheet day
  number. A preview says per row: New, Replaces yours (a typed-in score of
  the same name, keeping its category unless the sheet names one), No score
  yet, or Already synced (Canvas or Gradescope has it, so it never counts
  twice), all left out but the first two. A Category column picks the
  syllabus category it names; otherwise Soma guesses by name as for typed
  scores. Up to 500 rows, 5 MB.
- **Where:** `src/lib/gradeImport.ts` (new), `src/components/Grades/ScoreImport.tsx`
  (new), `CourseGrades.tsx`, `GradesTab.module.css`.
- **Guard:** `tests/grade-import.spec.ts` (CSV quoting, tabs, semicolons;
  score and date formats; "9/1/2026" is a date, not 9 out of 1; columns by
  header and by content; row statuses). `tests/grades.spec.ts` (Gradescope
  paste → preview → import, replacing a score by name; an .xlsx built in the
  test, with a Canvas duplicate left out).
- **Setup:** none.

### Grading folds to one line
- **Why:** the owner asked for the weights/points section to be collapsible.
- **What:** once a course's grading is set up, the Grading heading is a
  toggle; folded it reads "Total points · 300 pts · 4 categories" or
  "Weights · 9 categories". Folded by default; opening is remembered per
  course on this device (`soma_grading_open`). Setting up, editing, Read
  again and just saving always show it open.
- **Where:** `CourseGrades.tsx`, `GradesTab.module.css`.
- **Guard:** `tests/grades.spec.ts` (folded summary, opening it). Full suite:
  620 passed, 7 skipped.

---

## 2026-10-28 (Grades: courses graded by a total of points)

### A points course stays in points
- **Why:** reading CS 61A's syllabus gave "Midterm 1 6.67%, Projects
  33.33%…" adding to 99.99%. 61A has no weights: 300 points, each part worth
  some of them, letter cutoffs in points. The prompt told the AI to turn
  points into percents.
- **What:** a category can carry `points` (null in a weights course); a book
  is graded by points when every category has them (`byPoints`), and its
  weights are then each one's share of the total (`normalizeCategories`), so
  the two never disagree. No schema change: it rides in the categories JSON.
  - The AI replies in the course's own system (`"mode":"points"` with points
    and cutoffs in points, or weights), told never to convert; a stray
    number of the other kind is dropped.
  - `weigh` by points: the grade is points earned over points graded so far,
    after drops; a category's graded points never exceed what it's worth (a
    midterm scored 60/80 and worth 20 counts 15/20); the letter is where that
    pace lands on the total, against cutoffs in points.
  - Editor: "Graded by: Weights (%) / Total points", Points column in pts,
    "300 points in all"; cutoffs in points. View: "100 pts" per category,
    "15 / 20 pts" earned, "40 of 47 points graded so far, out of 300", "A
    285+ pts"; the list row says "by points". "Read again" re-reads the
    syllabus (nothing changes until saved). The example placeholders show on
    the first editor row only.
  - The AI context line says "graded the way the syllabus says".
- **Where:** `src/lib/gradeBooks.ts`, `src/lib/grades.ts`,
  `src/components/Grades/CourseGrades.tsx`, `GradesTab.tsx` and its CSS,
  `src/lib/aiContext.ts`.
- **Guard:** `tests/grades.spec.ts` (points course: total, scaled midterm,
  letter by points, editor keeps points; a points syllabus is read as points
  and saved with them). Full suite: 613 passed, 7 skipped.
- **Setup:** none. A course already saved in percents: Grading → Read again.

---

## 2026-10-28 (Grades: syllabus weights, typed-in scores, stars)

### One grade per course from Canvas, Gradescope and scores the student types in
- **Why:** Gradescope's terms bar reading it, so the store extension can't;
  students need to type those scores in. A course's scores come from several
  places and must add up to one grade, weighted the way its syllabus says.
  The owner also asked for stars to pick which courses show, the dot beside
  the name instead of above it, and less empty space at the sides.
- **What:**
  - **Grade books** (`grade_books`, one row per course): categories (name,
    weight, what counts, lowest N dropped, words that put an assignment in
    it), letter scale, typed-in scores, the category picked for each synced
    score, starred.
  - **Reading the syllabus:** on a course with no categories, "Read grading
    from <syllabus>" (the course's documents Soma has read, syllabus first),
    "Paste the grading section", "Use Canvas's weights" (when Canvas weights
    its groups; no AI) or "Add them yourself". One Haiku call through
    `/api/chat` (`readGrading`); a long syllabus is cut to the lines about
    grading (`gradingPart`). The result opens in an editor (weights total
    shown) and nothing is saved until "Save grading". Edit reopens it.
  - **One course, one grade:** courses are keyed by the Soma course
    (`subject:<id>`), else the synced one; every key a course is known by is
    an alias, so a book is found however it was saved. Every active Soma
    course has a row, synced or not, so scores can be typed in for any of
    them. With categories, the headline is weighted (`weigh`): points within
    a category after drops, categories by weight over those graded so far.
    A score goes in its picked category, else the Canvas group of that name,
    else the category whose words its name holds (`guessCategory`); "Not
    counted" keeps it out. Without categories the headline is Canvas's grade
    as before, and the course says how many outside scores it leaves out.
  - **Course page:** Grading (each category: weight, what counts, average,
    count; notes for weights not adding to 100, how much is graded so far,
    scores in no category, the scale) and Scores ("+ Add a score": name,
    score / out of, category from the syllabus's, date; Edit/Remove on typed
    ones; a category picker on every score). "Canvas shows 88.5%" when its
    own grade differs.
  - **Stars:** when any course is starred only those show, with "N other
    courses" to reveal the rest. Saves run one at a time, each on the last
    saved book.
  - **Layout:** dot in its own column left of the name; max width 1080px,
    side padding 16–28px; bar column next to the grade.
  - **Views agree:** the AI's CURRENT COURSE GRADES now come from the Grades
    page (`buildGrades`/`headline`), marked when weighted. It reads the books
    cached on this device (`soma_grade_books`, per account), refreshed when
    Grades opens; "Clear local Soma data" clears it.
  - Direct visits to /grades load the courses themselves (loading them
    announces nothing, so the page stayed on "No grades yet").
  - Account deletion clears `grade_books`; the privacy policy (both copies)
    and Data Deletion page list entered grades; both dated October 28, 2026.
- **Where:** `src/lib/gradeBooks.ts` (new), `src/lib/grades.ts`,
  `src/components/Grades/CourseGrades.tsx` (new), `GradesTab.tsx` and its
  CSS, `src/lib/aiContext.ts`, `src/lib/storage.ts`, `api/_deleteUserData.ts`,
  `public/privacy.html`, `src/components/Legal/LegalPage.tsx`.
- **Guard:** `tests/grades.spec.ts` (weighted grade from Canvas plus a typed-in
  score; adding a score in a picked category; Not counted; stars and "1 other
  course"; syllabus read → editor → save, nothing saved before; a course with
  nothing synced has a row; empty state). Full suite: 611 passed, 7 skipped.
  Checked in screenshots at 1280px and 375px.
- **Setup:** run `grade_books_migration.sql` in Supabase. Until then synced
  grades show as before, and starring or saving says it needs it.

---

## 2026-10-28 (Plan it)

### Plan it: spread a due assignment into sittings before it's due
- **Why:** the owner wants a manual way to put due work into time slots so
  it gets done before the due date, and to log time on it.
- **What:** "Plan it" on dashboard due cards and on Deadlines rows (not
  exams, which keep Plan review; Deadlines opens the dashboard with it). A
  panel: total time (Soma's guess from past work of the same kind in the
  course, else the course average, else a guess), sittings (one up to an
  hour, else ~50 min each), finish by (the day before it's due; today when
  due today). `placeSittings` puts them in open study time with `freeTime`
  (the slot finder Soma uses; no AI call), one a day where there's room,
  as ordinary suggestions to accept; finding times again replaces them.
  Sittings are tasks named "Title · 2 of 3"; the due card shows "1 of 3
  sittings done · 40 min logged", or "Not planned yet" within 3 days.
  "Already worked on it?" logs time under the assignment's name. One sitting
  of several doesn't count as finishing the assignment for Soma
  (`isPartSitting` in `aiContext.ts`). A due card stays beside a suggestion
  with its name until it's accepted. Demo mode now carries a Canvas sync
  (Canvas comes only from the extension since 2026-10-27; the demo still
  wrote the old feed cache, so it had no due cards).
- **Where:** `src/lib/planIt.ts`, `src/components/DashboardV2/PlanIt.tsx`,
  `DashboardV2.tsx`, `LiveDashboard.tsx`, `DashboardV2.module.css`,
  `src/components/Deadlines/DeadlinesTab.tsx`, `src/lib/aiContext.ts`,
  `src/demo/client.ts`.
- **Guard:** `tests/plan-it.spec.ts` (spread and order, never past the
  finish day, around classes and not before now, two on one day with a
  break, what doesn't fit is counted, defaults, estimate, sitting names).
  Checked in the demo preview. Full suite: 607 passed, 7 skipped.
- **Setup:** none (no schema change).

### Focus panel: no Start focus form
- **Why:** the owner asked to remove it. Focus starts from a study block or
  a due assignment; Plan it puts due work on the plan to focus on.
- **What:** the course picker, task field and Start focus button
  ("start focus anytime", 2026-10-27, b21acc9) are gone; the panel says
  "Choose Focus on a study block or a due assignment to begin." as it did
  before, now naming due assignments. `QuickFocus.tsx` and its styles
  deleted. `ai-plan-changes.spec.ts`'s past-days test checks for no Start
  focus button at all again.
- **Where:** `LiveDashboard.tsx`, `DashboardV2.module.css`.
- **Guard:** full suite 606 passed, 7 skipped; `calendar-deadline-colours`
  failed once under the full parallel run and passed three times alone
  (timing, it doesn't touch the Focus panel). Checked in the demo preview.

---

## 2026-10-28 (course-site import: no more reworded duplicates)

### Re-importing a course site matches the same deadline worded differently
- **Why:** the owner's Deadlines listed "Project 4: Animator - Checkpoint",
  "Project 4: Animator (TypeScript) checkpoint" and "Project 4: Animator
  checkpoint", all CS 61A, due Nov 13.
- **Cause:** only the course-site import (`CourseSiteImport.tsx`) gives
  tasks a deadline kind, so all three came from importing cs61a.org. Each
  read of a page words a deadline a little differently, and the import
  matched only titles equal apart from case and punctuation: "(TypeScript)"
  made a new task. The "- Checkpoint" / "checkpoint" pair needed even that,
  which came on 2026-10-06 (most likely imported before). Also, the import
  checked each item against the task cache from before it started
  (`saveTodo` doesn't update it), so two items of one import never saw
  each other.
- **What:** `sameDeadline`: the same title, or the same due day, the same
  kind (or one unknown) and every word of the shorter title in the longer
  (at least two words). Used to offer a deadline once when one read lists it
  twice, and to find the existing task on re-import (exact title first). An
  import keeps its own running list of the course's tasks. A match keeps
  the stored task's wording, and the receipt names it so.
- **Existing duplicates:** `dedupe_imported_deadlines.sql` (one-off, PART 1
  preview, PART 2 delete). Same rule; keeps a used task, else the fullest
  title; deletes only untouched ones (not started, no Canvas link, no notes,
  never scheduled, no reading sections, no study time under the title).
  Checked against sample data in PGlite (Postgres in WASM): the three
  Animator rows leave "(TypeScript)"; used tasks, other kinds, other days,
  other students and one-word titles stay.
- **Where:** `src/components/Settings/CourseSiteImport.tsx`,
  `dedupe_imported_deadlines.sql`.
- **Guard:** `tests/course-site-import.spec.ts` (a reworded re-import
  matches; one read listing it twice offers it once; another kind or day
  stays apart; the first two fail on the old code). Full suite: 600 passed,
  7 skipped.
- **Setup still needed (owner):** run `dedupe_imported_deadlines.sql` in the
  Supabase SQL editor, PART 1 first.

---

## 2026-10-28 (Deadlines: study blocks stay off, rows tidied)

### A deadline's study time under another name is its own task; What changed reads like the rows below it
- **Why:** the owner's Deadlines showed "Review: past midterm 3 missed
  problems", a study block, as overdue CS 61A work. Also: the "What changed"
  announcement read "Announcement · title · Learning about Translation thr ·
  Canvas"; the owner wants the kind on top, then the course's dot and name
  like the deadline rows, then the announcement. And "Plan review" sat
  between "All day" and the status, which looked off.
- **Cause (pre-existing):** `savePlanBlock` (`liveData.ts`) renames a task
  in place when the block is its only one, keeping its due date, kind and
  Canvas link. Renaming a deadline's block, or Soma scheduling an
  unscheduled deadline task under a new title (EXAM PREP titles review
  "Review: …" and schedules tasks by their id), turned the deadline itself
  into the study block: it stayed on Deadlines under the new name, and the
  real deadline's name was gone. The owner's own task couldn't be read (the
  Soma connector needs reconnecting), so the exact path for it is inferred.
  What changed: the extension cuts a change's course name to 30 characters,
  and the row showed that name, not the student's course.
- **What:**
  - A rename that gives a deadline's time (a block with a time, on a task
    with a due date) another piece of work's name makes that block its own
    task: no due date, no kind, no assignment; the block and the time
    logged during it move to it; the deadline keeps its name and stays on
    Deadlines. Same work (`sameWork`: "Hog project review" → "Hog project
    review: final") or a rename with no time still renames the deadline.
  - What changed rows: kind on its own line, then the course's dot (its
    colour) and name, then the change; the site only when not Canvas.
    `canvasCourseOfChange` finds the Canvas course from the synced
    assignment or announcement the change names (then by name or its cut
    prefix); the student's course name and colour come from
    `subjectForChange`. The dashboard brief's "Changed" uses the same name.
  - Deadlines: "Plan review" comes before the time label.
- **Where:** `src/components/DashboardV2/liveData.ts`,
  `src/lib/canvasDeepSync.ts`, `src/lib/brief.ts`,
  `src/components/Deadlines/WhatChanged.tsx`, `DeadlinesTab.tsx`,
  `DeadlinesTab.module.css`.
- **Guard:** `tests/ai-plan-changes.spec.ts` (a deadline's block renamed to
  other work is its own task and the deadline stays, also on the page; an
  unscheduled deadline scheduled under another name stays; the same work
  still renames it; the first two fail on the old code),
  `tests/canvas-course-mapping.spec.ts` (What changed: kind, course, title,
  in that order, by the student's course name and colour from a cut-off
  Canvas name). Checked by screenshot. Full suite: 597 passed, 7 skipped.
- **Setup still needed (owner):** the existing "Review: past midterm 3 missed
  problems" task keeps its due date until cleared (SQL given in chat). The
  deadline it was made from kept no record of its old name.

---

## 2026-10-28 (Canvas work under the student's own courses)

### Synced Canvas work and announcements go under the course the student already has
- **Why:** the owner asked whether assignments and announcements from the
  extension land on the right Soma courses. Not reliably (checked with a
  throwaway test before the fix):
  (1) a course the student made ("Physics 5A") got a Canvas twin
  ("PHYSICS 5A - LEC 001 - Fall 2026") holding all the synced work, because
  only an identical name counted as the same course; (2) a Canvas-made
  course the student renamed showed its Canvas name on Deadlines, in the
  Calendar's chips, the brief and to Soma, and lost its colour there;
  (3) archiving a renamed course didn't hide its work on Deadlines or from
  Soma, which checked "archived" by name. Pre-existing: the sync's
  name-only rule dates from the calendar feed; the pages each kept their own
  rule.
- **What:** one match, `subjectForCourse` in `src/lib/canvasDeepSync.ts`:
  the course linked by Canvas id, else the same name (any case), else the
  same department and number (`sameCourse`, Gradescope's matcher), never an
  archived course or one linked to another Canvas course by that last rule
  (last term's MATH 1A doesn't take this term's). `subjectForChange` does
  the same for "What changed" records, which carry only a course name.
  - Sync (`storage.syncCanvasSubjects`): a match is linked
    (`canvas_course_id` saved on it) instead of a new course being made. Its
    name, colour and `source` stay the student's, so disconnecting Canvas
    never archives a course they made.
  - Used by: dashboard due items (`liveData.ts`), Deadlines (name, colour,
    course filter, archived), Calendar's due chips, the brief (`brief.ts`),
    Grades colours (`grades.ts`), onboarding's course dots
    (`ExtensionSetup.tsx`), What changed (`WhatChanged.tsx`), Soma's
    context (`aiContext.ts`: assignments, grades, announcements and changes
    under the student's course name; archived by the match), a done task in
    the same course finishing its assignment, and `inferSubjectId`.
  - Not changed: Day View (retired, still routed) keeps its name match.
- **Where:** the files above.
- **Guard:** `tests/canvas-course-mapping.spec.ts` (the match's rules; a
  made course is linked, not duplicated, and its name reaches Deadlines and
  Soma; a renamed course keeps its name; an archived one hides its work and
  announcements; last term's archived course doesn't take this term's work).
  The three page tests fail on the old matching. `tests/ai-past-work.spec.ts`
  now expects the student's "COMLIT R1B", not Canvas's "COMLIT R1B-LEC-005".
  Full suite: 593 passed, 7 skipped.
- **Setup:** none. Duplicates the old rule already made stay until the
  student archives or deletes them: the sync now links new work to the
  Canvas twin (it holds the Canvas id), not back to their original.

---

## 2026-10-28 (tests run in a folder with a space)

### The extension, store-screenshot and past-days tests pass again
- **Why:** 22 tests failed on master before any change today (noted in the
  entry below).
- **Cause:** (1) `tests/extension-readers.spec.ts`,
  `tests/extension-reminders.spec.ts` and `tests/store-screenshots.spec.ts`
  found the project folder with `new URL(import.meta.url).pathname`, which
  keeps a space as "%20", so in "02. soma" they couldn't open their
  fixtures or the logo. (2) `ai-plan-changes.spec.ts` "past days … without
  Focus" checked for no button named like /Start focus/ at all, which the
  Focus panel's own "Start focus" (start anytime, 2026-10-27) now matches.
- **What:** the three files use `fileURLToPath(import.meta.url)`. The
  past-days test checks block buttons only (`/^Start focus:/`); the panel's
  button starts a session now, so it belongs on any day. No app code
  changed.
- **Also fixed (owner asked, same day):** `extension/build-release.mjs`
  (`npm run build:extension`) found its folder the same way and stopped at
  "no such file … 02.%20soma/extension/manifest.json". It uses
  `fileURLToPath` too, and builds `dist-extension/soma-for-canvas-0.1.0.zip`
  with its store checks passing. The zip's contents are unchanged by this.
- **Guard:** the full suite, 588 passed, 7 skipped (store screenshots run
  only with STORE_SHOTS=1).
- **Setup:** none.

---

## 2026-10-28

### Soma writes no study material: practice questions removed
- **Why:** the owner wants Soma to stay an academic life organizer (what to
  work on, when, for how long, what's done), not a maker of study material.
  Practice questions came in with "Study features and cheaper AI"
  (2026-10-25, bfa006f).
- **What:** the Focus panel's "Practice questions on this" card is gone
  (`PracticeCard.tsx`, `PracticeCard.module.css`, `src/lib/practice.ts`
  deleted; `LiveDashboard.tsx` no longer shows it). `api/chat.ts` refuses
  `purpose: 'study'` (400 invalid_purpose), so nothing can ask the server
  for it; `src/lib/ai.ts` no longer offers it. Soma's instructions gain a
  SCOPE rule (`assistant.ts`): no practice questions, quizzes, flashcards,
  summaries, notes, outlines, content explanations or answers; it says in
  one line that it plans rather than makes material, and offers to plan the
  time. Kept from the same change: exam mode (Plan review), grade-aware
  priorities, Find dates in a syllabus, document search, streaming, the
  metered importer. Those organize; they write nothing to study from.
  Today's cached practice sets in a browser's localStorage are left to
  expire with the day (the key holds the date).
- **Where:** `api/chat.ts`, `src/lib/ai.ts`, `src/lib/assistant.ts`,
  `src/components/DashboardV2/LiveDashboard.tsx`.
- **Guard:** `tests/study-features.spec.ts` (a running Focus block shows no
  practice and makes no AI call; the server refuses a study request). The
  two practice tests and the Haiku study-cost test were removed with the
  feature.
- **Pre-existing failures, not from this change** (same on origin/master;
  fixed the same day, entry above):
  `tests/store-screenshots.spec.ts` and the extension reader/reminder specs
  can't open their files when the project folder's path has a space ("02.
  soma" becomes "02.%20soma"); `ai-plan-changes.spec.ts` "past days … without
  Focus" fails because the new "Start focus anytime" button is on the page.
- **Setup:** none.

---

## 2026-10-27 (assignments show as blocks)

- Synced Canvas work that isn't handed in now shows in the dashboard agenda as
  a block on its due day, under "Due today", with its due time, a **Focus**
  button (starts the timer on that assignment) and a **Handed in** check that
  marks it done and removes it. An assignment that already has a plan block
  with the same title isn't shown twice. `liveData.ts` (`DueItem` gains id,
  subjectId, dueAt), `DashboardV2.tsx` (`dueCard`), `LiveDashboard.tsx`.
  No test yet (tests not run, per the owner's request).

## 2026-10-27 (start focus anytime)

- The Focus panel on `/dashboard` no longer needs a plan block. With no
  session running it shows a course picker (last used preselected), an
  optional "what are you working on" field and **Start focus**. With no
  courses at all the session is filed under a "General" subject so it still
  saves. The Focus button on blocks works as before.
  `src/components/DashboardV2/QuickFocus.tsx`, `LiveDashboard.tsx`,
  `DashboardV2.module.css`. Only `LiveDashboard` loads it, so the
  `/dashboard-v2` mock still makes no backend calls. No test yet (tests not
  run, per the owner's request).

## 2026-10-27 (dashboard shows synced work)

### Dashboard: the subject bar and week strip show what's due

They only counted study blocks planned on the dashboard, so with Canvas synced
but nothing planned the bar was empty and every day said "Open day" (the brief
above it listed the same work as due today). With nothing planned, the bar now
shows the day's due Canvas work by subject ("Due, by subject"), and each day in
the strip says "N due". Planned blocks still take over as before. Where:
`DashboardV2/liveData.ts` `dueItems`, `LiveDashboard.tsx` (refreshes on
CANVAS_CHANGED and subject changes), `DashboardV2.tsx`. Not tested, by request.

## 2026-10-27 (Canvas walkthrough)

### An animated walkthrough of setting up the extension

`Onboarding/CanvasGuide.tsx` plays a short, silent walkthrough drawn in the page
(no video file): the Web Store with a cursor clicking Add to Chrome and Add
extension, Canvas being read with a "Synced" toast, the work landing in Soma
with a grade, and the extension's popup. It autoplays, has play/pause and four
clickable chapters with progress bars, starts at the step the student is
actually on, and shows final frames only under reduced motion. It sits above
the live checklist (`ExtensionSetup`) in onboarding and now also replaces the
plain-text "Open Canvas to sync" card on an empty Deadlines page. Checked by
eye in the browser; no tests run. Setup needed: none.

## 2026-10-27 (interactive Canvas onboarding)

### Onboarding: a live checklist driven by the extension

Step 3 ("Bring in Canvas") is now a three-part checklist that ticks itself off:
1. Add to Chrome (Web Store link). Back from the store tab, it offers
   "I added it, reload", because Chrome only connects an extension to pages
   opened after install; the answers so far survive the reload
   (`sessionStorage` `soma_ob_progress`). Done when the bridge says `present`.
2. Open Canvas: the student types their Canvas address and opens it, then
   sees "Waiting for the first sync" until the first snapshot lands. A
   non-instructure address gets the popup's "Use Soma on this site" hint.
3. You're connected: the courses found (in their subject colours, with the
   letter grade), the next three things due, and how to pin the extension and
   what its popup shows (Due soon, What changed, Sync now, reminders, grades).
Continue appears once something has synced; until then it's Skip for now.
Where: `Onboarding/ExtensionSetup.tsx`, `OnboardingFlow.tsx`. Guarded by:
`tests/regressions.spec.ts` (onboarding), updated but not run. Setup needed: none.

## 2026-10-27 (calendar feed removed)

### Canvas comes only from the Soma for Canvas extension

The Canvas calendar (ICS) feed is gone: no feed step in onboarding, no
Connect/Disconnect row in Settings, no feed setup card or Refresh on Deadlines.
Deadlines, the AI and Grades read what the extension synced
(`mergeDeepSync([])` in `storage.getCachedIcalAssignments`); a feed cached by an
older version is ignored. With nothing synced, Deadlines, onboarding and
Settings offer the Chrome Web Store link (`EXTENSION_STORE_URL`), and Refresh
asks the extension to sync. Onboarding is now three steps plus the welcome.
Landing copy, the privacy policy and the terms no longer describe the feed.
Guarded by: `tests/canvas-extension.spec.ts`, `tests/deadlines.spec.ts`,
`tests/regressions.spec.ts` (onboarding). Setup needed: none. `api/canvas-ical.ts`
is now unused and can be deleted to free a serverless function slot.

## 2026-10-27

### Onboarding explains the Soma for Canvas extension, with the Web Store link

The extension is on the Chrome Web Store, but nothing in Soma pointed to it.
Onboarding has a new optional step after Canvas ("Add the Soma for Canvas
extension"): three plain steps for how it works, what it reads (never the
Canvas password), and an "Add to Chrome" link that turns into "Installed" once
the extension answers. Settings → Canvas extension shows the same link while it
isn't installed. Onboarding is now 4 steps and then the welcome screen.

- Where: `OnboardingFlow.tsx` (step 4) and its CSS, `CanvasDeepSyncRow.tsx`,
  `EXTENSION_STORE_URL` in `src/lib/canvasExtension.ts`.
- Guard test: `tests/regressions.spec.ts` ("onboarding Canvas sync creates
  courses in the already mounted Day View") now goes through the new step and
  checks the heading and the Web Store link.
- Setup: none.

### Settings: "Clear local Soma data" now removes the synced grades too

The button only cleared this browser's copy of what the extension synced. The
copy in the student's account (and the extension's own) stayed, and came back
on the reload, so Grades and Deadlines looked untouched. It now removes all
three first, the same way "Remove synced data" does, and says so if that
fails instead of reloading. Where: `SettingsTab.tsx` `handleClearLocalData`.
Guarded by: `tests/canvas-extension.spec.ts` ("Clear local Soma data also
removes the synced grades from the account"). Setup needed: none.

## 2026-10-26

### Extension popup: "Remove synced data" now clears every card

The button deleted the extension's saved data but only redrew the list of
synced sites, so "Due soon" and "What changed" kept showing the old work and it
looked as if nothing had happened. All three cards (and the Sync everything
now button) now reset. It removes this browser's copy only; the popup says to
use Settings in Soma for the copy in the student's account.

- Where: `extension/popup.js` (`renderDue`, `renderChanged`, `renderSites` now
  handle "nothing left", and the button re-renders them).
- Guard test: `tests/extension-popup.spec.ts`. Fails without the fix.
- Setup: ships with the next extension version (the store review in progress
  has the old popup); reload the extension to use it unpacked.

### Privacy policy: the extension reads Canvas only

The Chrome Web Store build of the extension reads Canvas only, but the privacy
policy still said it read Gradescope and WebAssign. A store review compares the
two, so the paragraph now describes Canvas alone, and adds the statement the
store's User Data Policy asks for: the extension's data is used only to run
Soma's features, is not sold, shared or used for advertising, and follows the
Limited Use requirements. "Last updated" is October 26, 2026.

- Where: `public/privacy.html` and `src/components/Legal/LegalPage.tsx`, kept
  word for word the same.
- Guard test: `tests/legal-pages.spec.ts` (the two copies say the same thing).
- Setup: none. Live as soon as it deploys.

### Grades page redesigned: a ledger of courses, not a grid of cards

The cards were identical gray boxes that didn't line up and left most of the
page empty. The page is now one row per course: the course code with a dot in
the student's colour for it, the title, a progress bar in that colour, and the
grade big and right-aligned (the letter with the percent under it, or the
percent alone). Opening a course shows the grade at 72px, then a table of
assignments (score, a bar, percent); scores under 70% show their percent in red.
The courses refresh when subjects load, which is when their colours arrive.
On a phone the bar drops under the title and nothing scrolls sideways.

- Where: `src/components/Grades/GradesTab.tsx` and its CSS; `src/lib/grades.ts`
  (each course now has a `color`, from the subject with its Canvas course id,
  else its name).
- Guard test: `tests/grades.spec.ts` (rows, big grade, colour dot, course
  view, empty state).
- Setup: none. The store screenshot of this page (`extension/store/screenshot-3-grades.png`,
  PR #6) shows the old design until it is regenerated.

### The store build of the extension reads Canvas only

Cengage's terms (WebAssign) bar scripts, scrapers and data mining, and
Gradescope's bar scraping and any access other than through their interface.
So the Chrome Web Store build leaves both out: no Gradescope or WebAssign
permissions, content scripts, reader files or words in the popup, and the
listing text, permission justifications and screenshots describe Canvas only.
The source keeps the readers: `npm run build:extension -- --all` builds all
three, for loading unpacked. Soma itself still understands their snapshots.

- Where: `extension/build-release.mjs` (store build drops them and fails if
  any trace is left in the manifest, popup, offscreen page or worker);
  `extension/STORE_LISTING.md`; `tests/store-screenshots.spec.ts` and the
  screenshots in `extension/store/` (now three, on Soma's colours and logo with
  a headline each, instead of plain captures).
- Guard test: the build itself checks the zip; there is no Playwright test.
- Setup: none. Still open before publishing: Instructure's terms and schools'
  own policies. `public/privacy.html` still describes Gradescope and WebAssign
  reading; it needs the owner's call before the extension goes public.

### The extension uses Soma's logo

The extension's icons were placeholders (a blue ring). They are now Soma's
four-point star, scaled from `public/favicon.png`, at 16, 32, 48 and 128 px:
toolbar, extensions page, notifications and the store listing.

- Where: `extension/icons/icon-*.png`; `extension/STORE_LISTING.md` checklist.
- Guard test: none; images only, no code changed.
- Setup: reload the extension in `chrome://extensions` to see them.

### Grades page: each course's grade and every score, from Canvas and Gradescope

The extension already collected grades and scores, but nothing showed them: the
Grades tab was an empty placeholder with no menu entry. There is now a Grades
page in the sidebar: one card per course with its grade shown big (Canvas's
course grade, or the average of the scores when Canvas gives none). Clicking a
card opens the course: the big grade again, points earned, and the score on
each graded assignment with a bar, newest first. Gradescope scores join the
Canvas course of the same department and number, tagged "Gradescope", or get
their own card; work Canvas already shows a score for is not listed twice.
Ungraded and excused work is left out, and a course with nothing to show has
no card. It reads the local synced copy: no AI, no server call, no database
change.

- Where: `src/lib/grades.ts` (`buildGrades`), `src/components/Grades/GradesTab.tsx`
  and its CSS, route `/grades` and sidebar entry in `src/App.tsx`;
  `sameWork` in `src/lib/canvasDeepSync.ts` is now exported.
- Guard test: `tests/grades.spec.ts` (cards, merge, dedupe, excluded work, empty state).
- Setup: none. Needs the extension with "Include grades and scores" on.

### The app and the extension no longer answer each other forever

The app said "hello" every time the extension said "present", and the extension
answers every "hello" with "present" and all its snapshots. Opening Soma with
the extension installed sent thousands of messages a second, so the page was
being hammered. The app now says hello once, the first time it hears "present".

- Where: `src/lib/canvasExtension.ts` (`startCanvasBridge`).
- Guard test: `tests/canvas-extension.spec.ts` › "the app answers the extension
  once, not every time it says it is here". Fails without the fix (2,796 hellos
  in half a second), passes with it.
- Setup: none. Reload the page; the extension needs no change.

### Soma as an agent: email drafts, calendar events, and the morning brief
- **Why:** the owner asked for Soma to act more like Meta's Muse, an agent
  that does things in your apps, while keeping AI use cheap.
- **What:**
  - **Actions** (`src/lib/agentActions.ts`, `AI/ActionCards.tsx`): the
    assistant may return `"actions"`: an email draft (to, subject, body) or a
    calendar event (title, date, optional times). Each shows as a card:
    Open in Gmail / Open in Mail / Copy, or Add to Google Calendar /
    Download .ics. Soma never sends or saves anything; the student does,
    in their own app. No new permissions: Google Calendar stays read-only,
    no Gmail access. Everything from the model is checked (known kinds,
    real-looking addresses only, lengths, exact date and time formats, at
    most three) and the .ics text is escaped. New AGENT ACTIONS rules: say
    "drafted", never "sent"; the student's voice with "[Your name]"; an
    address only if given or in their documents; nothing that asks for
    answers, gets around course rules or impersonates anyone. Dashboard
    replies note the drafts and keep them on the saved chat, so the cards
    appear on the AI page.
  - **Morning brief** (`src/lib/brief.ts`, `DashboardV2/AgentBrief.tsx`):
    under the date on the dashboard: due today, due tomorrow (not done;
    Canvas, Gradescope, WebAssign and tasks), what changed in the last day,
    and what was planned yesterday but not checked off. Worked out in the
    browser with no AI call. "Plan my day" opens the AI page with a request
    naming those items (sent once). Hidden for the day on request; absent
    when there's nothing to say.
- **Cost:** the brief is free; Plan my day is one ordinary planning call,
  only when clicked; actions are part of the same reply.
- **Not done (on purpose):** talking to Soma by SMS or WhatsApp needs a
  new server function, and the Vercel plan is at its 12-function limit.
  Writing straight to Google Calendar would need the calendar.events
  scope and another Google verification.
- **Where:** `src/lib/agentActions.ts`, `brief.ts`, `assistant.ts`,
  `dashboardChatMemory.ts`, `src/types/index.ts`,
  `src/components/AI/ActionCards.*`, `AI/AITab.tsx`,
  `DashboardV2/AgentBrief.*`, `DashboardV2.tsx`, `LiveDashboard.tsx`.
- **Guard:** `tests/soma-agent.spec.ts` (action checks, links, .ics
  escaping a title that tries to add a field, cards on the AI page, brief
  contents with no AI call, Plan my day's request, hide and empty, drafts
  from the dashboard kept for the AI page). Checked by screenshot, desktop
  and phone width.
- **Setup still needed:** none.

## 2026-10-25

### Study features and cheaper AI: practice, exam mode, syllabus dates, streaming, document search
- **Why:** Soma only answered "when"; students also need "what" and "do I
  know it". The owner asked for this with AI use kept cheap.
- **What:**
  - **Grade-aware priorities** (`assistant.ts`): tasks carry "worth N%
    group / N pts" from deep sync; new PRIORITIES rules weigh worth against
    due date, with the reason given. No extra AI calls.
  - **Exam mode:** Deadlines shows "Plan review" on upcoming exams (task
    kind exam, or a name with exam/midterm/final/test). It opens the AI tab
    with "Plan my review for … on …", sent once (cleared so a reload doesn't
    repeat it). New EXAM PREP rules: spaced sessions before the exam, open
    reading first, then review and practice; ask when the date or coverage
    isn't known. One normal planning call.
  - **Practice in focus blocks** (`PracticeCard.tsx`, `practice.ts`): four
    multiple-choice questions from the matching passages (about 6,000
    characters) of the course's own documents, checked as answered. A new
    `purpose: 'study'` in `api/chat.ts`: Haiku, max 2,000 output tokens,
    no memory or notes, nothing learned. Counted as a reply. A set is cached
    for the day; at most 3 new sets per block per day. Marking sections done
    stays with the student's check-off.
  - **Syllabus dates:** a syllabus or guide in Documents gets "Find dates",
    which runs the existing course-site importer on its extracted text, in
    place; the student picks what to keep (exams then get Plan review).
  - **Document search** (`docSearch.ts`): documents are split into passages
    and ranked with BM25 in the browser; about 9,000 characters of the best
    matches travel with the message instead of every document (cut at
    45,000) in the cached instructions. Students rarely send two messages
    within the 5-minute cache window, so the old way paid the cache-write
    price nearly every time; this is roughly 4× cheaper per message on
    documents and searches all of them.
  - **Streaming** (`api/chat.ts` `relayStream`, `ai.ts` `readStream`,
    `aiResponse.ts` `partialReply`): Soma's replies stream on the AI page
    and the dashboard's Ask Soma; the reply text is decoded from the
    partial JSON. Usage is recorded from the stream's totals, including
    when it fails part-way; nothing is learned from an unfinished reply.
    Thinking never leaves the server. A non-streamed answer (an error, or a
    host that buffers) is read as before.
  - **Importer metered:** `api/import-schedule.ts` used Sonnet 4.6 (not in
    the price table, so unpriced) and never counted against the budget. It
    now uses Sonnet 5.5 at low effort, refuses at the budget (402
    ai_budget_used), and records usage.
- **Behaviour change in tests:** `tests/ai-triage.spec.ts` now finds
  documents in the message context rather than the cached system prompt
  (the guarantee is the same: documents only when they matter, framed as
  untrusted data), and gains a long-document test.
- **Where:** `api/chat.ts`, `api/import-schedule.ts`, `src/lib/ai.ts`,
  `aiResponse.ts`, `assistant.ts`, `aiContext.ts`, `docSearch.ts`,
  `practice.ts`, `src/components/AI/AITab.tsx`,
  `DashboardV2/DashboardV2.tsx`, `LiveDashboard.tsx`, `PracticeCard.*`,
  `Deadlines/DeadlinesTab.*`, `Documents/DocumentsTab.*`,
  `Settings/CourseSiteImport.tsx`.
- **Guard:** `tests/study-features.spec.ts` (practice on Haiku from the
  course's passage, checked and cached; unreadable answer; exam mode sends
  once; Find dates; study requests use no memory and are counted; the
  importer stops at the budget and records usage), `tests/ai-streaming.spec.ts`
  (relay, no thinking leaked, usage counted on success, max tokens and a
  dropped connection; dashboard stream and failure), `tests/ai-triage.spec.ts`.
- **Setup still needed:** none (no schema change; study calls are recorded
  under kind `reply`). Streaming relies on Vercel streaming Node function
  responses; check on a preview deployment that replies appear as they're
  written.

### Soma for Canvas: a Chrome Web Store release package
- **Why:** to publish the extension rather than load it unpacked.
- **What:** `npm run build:extension` (`extension/build-release.mjs`) copies
  the extension to `dist-extension/` (ignored by git), limits the bridge to
  `somastudy.app` (localhost and the PR preview would otherwise receive
  students' coursework from a published build), checks name and description
  length, version format, https-only matches and that every named file is
  present, and zips it. The manifest description is now 118 characters (the
  store allows 132; it was about 160). `extension/STORE_LISTING.md` has the
  listing, single purpose, a justification per permission, data-usage
  answers, reviewer notes and a pre-submit checklist.
  `tests/store-screenshots.spec.ts` renders two 1280×800 screenshots with
  made-up coursework into `extension/store/`; it runs only with
  `STORE_SHOTS=1`.
- **Where:** `extension/build-release.mjs`, `STORE_LISTING.md`, `store/`,
  `manifest.json`, `README.md`, `package.json`, `.gitignore`,
  `tests/store-screenshots.spec.ts`.
- **Guard:** the build fails on any of the checks above; checked that the
  zip's bridge matches only somastudy.app.
- **Setup still needed:** merge and deploy PR #4, final icons, a terms check,
  a publisher account; then upload the zip.

### What changed: new work, moved due dates, grades and announcements
- **Why:** deadlines move and grades land without anyone noticing; the
  extension already had every sync, so it can say what's different.
- **What:**
  - Extension (`common.js`): each sync is compared with the previous one
    for that site. New work (unless already handed in or long past), a
    moved due date, a grade posted (Canvas graded or scored; Gradescope
    graded), a new Canvas announcement. Nothing on a site's first sync.
    Changes are kept on the snapshot for 14 days (at most 50), newest first.
    Storage is re-read after the site read, so a sync of another site in
    the meantime isn't overwritten.
  - `background.js` notifies each new change once (a moved due date at
    higher priority), or one summary when more than three arrive together;
    clicking opens the work, or Soma's Deadlines for a summary. The popup
    lists the last week, with a "Tell me when something changes" switch.
  - App: `normalizeChanges` checks every change like the rest of a snapshot
    (known types only, same-site links only, the snapshot's own site).
    Deadlines shows a "What changed · last 7 days" panel
    (`WhatChanged.tsx`, four rows, then Show all), which shows the day as
    well as the time, since a moved due date often keeps its time, and
    wraps on phones. The AI gets "WHAT CHANGED THIS WEEK" (not
    announcements, which it already has).
- **Where:** `extension/common.js`, `background.js`, `popup.*`,
  `README.md`, `src/lib/canvasDeepSync.ts` (`SnapshotChange`,
  `recentChanges`), `src/lib/aiContext.ts`,
  `src/components/Deadlines/WhatChanged.tsx`, `DeadlinesTab.tsx`,
  `DeadlinesTab.module.css`, privacy text (both copies).
- **Guard:** `tests/extension-reminders.spec.ts` (what counts as a change
  per site, none on first sync, 14-day keep, one notice per change, summary
  for many, never twice, the switch) and `tests/canvas-extension.spec.ts`
  (panel order and details, off-site links and unknown types dropped,
  older than a week hidden, hidden when empty). Checked by screenshot in
  light and dark at 1280×720 and at phone width, with no horizontal overflow.
- **Setup still needed:** reload the extension. Changes start from the
  second sync after that.

### Soma for Canvas reminds you before work is due
- **Why:** the point of syncing Gradescope and WebAssign was not forgetting
  them, and that needs a nudge, not just a list in Soma.
- **What:** `extension/due.js` works out what's due in the next 48 hours and
  not handed in across Canvas, Gradescope and WebAssign. A Canvas entry and
  its platform twin (same name, due within a day) count once, and done on
  either clears both; Canvas work handed in on paper or with no submission
  (`submissionTypes`, now recorded by `canvas.js`) is skipped. The toolbar
  badge shows the count. `background.js` sends a notification a day before
  and again three hours before each item, once per stage, checking every 15
  minutes and after every sync; clicking opens the assignment. The popup
  lists Due soon and has switches for reminders and the badge (both on by
  default). Placeholder icons added (`extension/icons/`), since
  notifications need one. The bridge also matches the PR's Vercel preview
  address, for testing.
- **Where:** `extension/due.js`, `background.js`, `canvas.js`,
  `popup.*`, `manifest.json` (`notifications`, icons, preview match),
  `icons/`, `README.md`.
- **Guard:** `tests/extension-reminders.spec.ts` (what counts as due soon,
  twins once, paper work skipped, badge count, one notice per stage, the
  three-hour notice after the day-before one, click opens the work, both
  switches). Checked against the owner's real synced data: one item in the
  next 48 hours (CS 170 Coding Problem 3, Gradescope).
- **Setup still needed:** reload the extension; Chrome asks to allow
  notifications. Remove the preview match before publishing.

### Soma for Canvas reads WebAssign
- **Why:** at Emory, PHYS 151's Canvas lists one exam; every homework lives
  in WebAssign, so Soma couldn't see it.
- **What:** `extension/webassign.js` reads the class home page
  (`/v4cgi/student.pl`): its current assignments are JSON in
  `#js-student-myAssignmentsWrapper[data-assignments]` (id, name, due in epoch
  seconds). Each assignment's page gives progress from its question parts:
  all answered is complete, some is in progress, with points only when
  grades are on. Course name from the page title, id from the class context
  id. Past assignments (ids only) are not read. Runs on visit, in the
  background and from Sync now, like the others. App: `webassign` snapshots
  (only from `www.webassign.net`) join the Canvas course with the same number
  and department; Canvas courses for joining now include deep sync's own
  list, busiest first, so PHYS 151 lands in PHYS-151-1 rather than its empty
  lab section. Deadlines shows "· WebAssign" and "n of m parts answered", and
  partly done work is in progress; the AI is told the same.
- **Where:** `extension/webassign.js`, `manifest.json` (host and content
  script), `background.js`, `offscreen.html`, `popup.html`,
  `src/lib/canvasDeepSync.ts`, `src/lib/aiContext.ts`, `src/types/index.ts`,
  `src/components/Deadlines/DeadlinesTab.tsx`, privacy text (both copies),
  `extension/README.md`, `docs/extension-plan.md`.
- **Guard:** `tests/extension-readers.spec.ts` (WebAssign: due times,
  complete / in progress / not started from parts, grades off, signed out
  keeps the last sync; synthetic fixtures in `tests/fixtures/webassign/`
  modelled on the real page) and `tests/canvas-extension.spec.ts` (joins
  its Canvas course with progress shown; wrong-host snapshot refused). The
  reader was also run once in the owner's signed-in WebAssign and read both
  current PHYS 151 assignments correctly.
- **Setup still needed:** reload the extension; visit WebAssign once so
  background sync knows it.

### Soma for Canvas keeps itself in sync, without visits to Canvas or Gradescope
- **Why:** a site synced only when the student visited it (at most every 3
  hours), so a student who lives in Soma saw stale work, and something handed
  in just after a sync stayed "not done" for hours.
- **What:** `extension/background.js` re-reads every site the student has
  synced before, every two hours while Chrome is open (alarm), and whenever
  Soma opens (bridge asks; skipped if under 20 minutes old). The readers now
  take an origin (`canvasReader`, `gradescopeReader`) so they run either in
  the site's tab or in a hidden offscreen page (`offscreen.html`/`.js`; a
  worker has no DOM). Sync logic is shared in `common.js` (`runSync`, one run
  per site at a time). Visits sync at most every 30 minutes, down from 3
  hours. Popup: "Keep in sync in the background" toggle (on by default) and
  Sync everything now. Soma's Settings row: Sync now (via the bridge), with
  each site's result; it lists every synced site.
- **Where:** `extension/` (`background.js`, `common.js`, `canvas.js`,
  `gradescope.js`, `offscreen.*`, `bridge.js`, `popup.*`, `manifest.json`
  adds `alarms` and `offscreen`), `src/lib/canvasExtension.ts`
  (`requestSync`), `src/components/Settings/CanvasDeepSyncRow.tsx`, privacy
  text (both copies), `extension/README.md`, `docs/extension-plan.md`.
- **Guard:** `tests/canvas-extension.spec.ts` (Sync now reports each site),
  `tests/extension-readers.spec.ts` (a reader run by origin from another
  page, as the offscreen page does, reads the site and starts no sync of its
  own). The alarm and offscreen document themselves are checked in Chrome.
- **Also:** reloading the extension left the old copies of its scripts in
  open tabs throwing "Extension context invalidated" on every message.
  `bridge.js` now notices it was cut off and goes quiet; `runSync` never
  rejects. Guard: the "goes quiet" test in `tests/extension-readers.spec.ts`
  (fails on the previous bridge with that error).
- **Setup still needed:** reload the extension. Background requests use the
  student's sign-in cookies; if Chrome blocks those for extension requests,
  background sync records an error and visits still work.

### Soma for Canvas: turning on a school's own Canvas domain works; Emory course names match
- **Why:** first real use, at Emory (`canvas.emory.edu`). Chrome granted the
  site, but nothing synced: Chrome's permission prompt closes the popup, and
  the popup was the one meant to register the script and start the sync
  afterwards. Separately, Emory names courses `CS-170-1: … - Fall 2026` in
  Canvas and `FA26_CS_170_1` on Gradescope; dashes and underscores never
  matched, and a shared "Fall 2026" could have joined unrelated courses.
- **What:** `extension/background.js` (new service worker) registers the
  Canvas reader for any site the student grants and starts it in open tabs,
  on grant and again on every start or reload, so an earlier grant catches
  up; a removed grant unregisters it. The popup only asks and says it's
  syncing. `sameCourse` treats any punctuation as a separator and ignores
  term, section and year parts (`Fall 2026`, `LEC 001`, `FA26`).
- **Where:** `extension/background.js`, `extension/manifest.json`,
  `extension/popup.js`, `src/lib/canvasDeepSync.ts`.
- **Guard:** `tests/course-matching.spec.ts` (Emory names match their
  course and not each other; terms and sections never match). The service
  worker has no automated test; checked by reloading the extension.
- **Setup still needed:** reload the extension in `chrome://extensions`.

### Soma for Canvas reads Gradescope too
- **Why:** much STEM work is handed in on Gradescope. Canvas either shows
  nothing for it or shows a linked entry that never learns it was submitted,
  so Soma kept such work "not done" or missed it entirely.
- **What:**
  - `extension/gradescope.js` on `www.gradescope.com`: reads the course list
    (newest term, student courses, never an instructor section or a menu
    link) and each course's assignments table: name, due, late due, and No
    Submission / Submitted / score (score dropped when grades are off).
    Same-site GETs only, on visit or Sync now. If no course page can be read
    it records an error and keeps the last good sync.
  - `extension/common.js`: the sync runner both readers share (moved out of
    `canvas.js`, behaviour unchanged); the popup's probe is now site-neutral.
  - App: snapshots carry `kind` (`canvas`, or none for older ones;
    `gradescope` only from `www.gradescope.com`). `mergeDeepSync` joins each
    Gradescope course to the Canvas course with the same number and
    department (`sameCourse`: BIO 101 = Biology 101, COMPSCI = CS). A Canvas
    entry with the same name learns it was handed in and links to
    Gradescope; other work is added with a negative id, labelled
    "· Gradescope" on Deadlines; the AI is told it is handed in on
    Gradescope and its late due date. Gradescope courses don't create
    Subjects. Stored in `canvas_snapshots` under host `www.gradescope.com`
    (no schema change).
  - Privacy policy (both copies) lists what is read on Gradescope.
- **Where:** `extension/` (`common.js`, `gradescope.js`, `canvas.js`,
  `manifest.json`, `popup.*`, `README.md`), `src/lib/canvasDeepSync.ts`,
  `src/lib/canvasExtension.ts`, `src/lib/aiContext.ts`, `src/types/index.ts`,
  `src/components/Deadlines/DeadlinesTab.tsx`, legal pages.
- **Guard:** `tests/extension-readers.spec.ts` (both readers in a real page
  against synthetic sites: term and section filtering, statuses, due and
  late due times, grades off, unreadable pages keep the last sync) and
  `tests/canvas-extension.spec.ts` (Gradescope twin marked done and not
  listed twice; Gradescope-only work added and labelled; a Gradescope
  snapshot from another host refused).
- **Setup still needed:** check the reader against a real Gradescope course
  page; fixtures are synthetic, modelled on Gradescope's markup.

### Soma for Canvas: a browser extension for what the calendar feed leaves out
- **Why:** the feed gives a title and a due date, so Soma couldn't tell a
  2-hour problem set from a discussion post, kept listing work already handed
  in, and knew nothing of weights, grades or announcements. Collecting Canvas
  tokens is against most schools' policies; an extension reading the
  student's own session in their own browser isn't collecting anything.
- **What:**
  - `extension/` (Manifest V3, unpacked for now): `canvas.js` reads
    `/api/v1` on the Canvas site the student is on — active courses (current
    grade), assignment groups and weights, assignments with their own
    submission, the last 30 days of announcements — at most every 3 hours, or
    on Sync now. `bridge.js` posts the snapshot to an open Soma tab. The
    extension holds no Soma session, never calls Soma's servers, sends no
    cookie or token, and never writes to Canvas. Grades can be turned off;
    a school on its own domain is enabled one site at a time.
  - App: `src/lib/canvasDeepSync.ts` validates a snapshot (types, lengths,
    links only to the same Canvas site, assignments only for listed courses)
    and merges it into `getCachedAssignments`/`getCachedIcalAssignments`:
    descriptions, points, group weights, and handed-in work marked done.
    Dated work the feed missed is added (due from two weeks ago on).
    `src/lib/canvasExtension.ts` listens for the bridge, saves to
    `canvas_snapshots` under the signed-in student (never an id from the
    message), ignores older snapshots, loads other devices' copies, and
    removes everything on request.
  - AI context (`buildCanvasSection`): points, group weight, "missing",
    a 280-character brief, current grades and the last two weeks'
    announcements, framed as untrusted data. Submitted work is left out.
  - Deadlines: a Canvas item handed in counts as done unless the student set
    a status; the page refreshes when a sync lands; extension-only students
    aren't shown the setup card.
  - Settings → Integrations: "Canvas extension" row with last sync and
    Remove synced data. Privacy policy (both copies), Data Deletion page and
    account deletion (`canvas_snapshots` in `USER_TABLES`) cover it.
- **Where:** `extension/`, `src/lib/canvasDeepSync.ts`,
  `src/lib/canvasExtension.ts`, `src/lib/storage.ts`, `src/lib/aiContext.ts`,
  `src/types/index.ts`, `src/App.tsx`,
  `src/components/Deadlines/DeadlinesTab.tsx`,
  `src/components/Settings/CanvasDeepSyncRow.tsx`,
  `src/components/Settings/SettingsTab.tsx`,
  `src/components/Legal/LegalPage.tsx`, `public/privacy.html`,
  `api/_deleteUserData.ts`, `docs/extension-plan.md`.
- **Guard:** `tests/canvas-extension.spec.ts` (submission becomes done and
  missed work is added, saved under the signed-in student; malformed
  snapshots ignored; an older snapshot can't replace a newer one; Settings
  removes it everywhere, scoped to the student).
- **Setup still needed:** run `canvas_snapshots_migration.sql` (new table,
  RLS; until then a sync stays in the browser that got it). Before the Chrome
  Web Store: icons, drop the localhost matches, store privacy answers, and a
  terms check. See `extension/README.md`.

---

## 2026-10-21

### Billing: trials reach the AI, canceled students can come back, a failed check never asks for money
- **Why:** a read-only audit of the subscription code (notes in the session
  folder, `subscription-audit-2026-10-21.md`). No live data was read; the
  owner's checks below still decide how many students were affected.
- **Causes (pre-existing):** (1) Checkout trials never had `trial_start`, and
  the AI's status check timed trials from it, so the AI (chat, course-site
  import, Claude connector) could refuse a student Settings showed as on a
  free trial. Three copies of the status check disagreed. (2) A canceled
  subscription kept its id, and checkout refused anyone with one ("Already
  subscribed"), so a canceled student could never subscribe again; Pricing
  offered them a free trial. (3) `invoice.payment_succeeded` set `active`,
  including for the $0 invoice that starts a trial: trials could be stored as
  paying (subscriber budget, top-ups, "Premium"). (4) When billing couldn't
  be checked, the AI tab showed "Start free trial — $10.99/mo", Pricing
  treated the student as free, Settings said "Free". (5) Deleting an account
  canceled the Stripe subscription only if trialing or active; past due and
  unpaid ones kept charging. (6) The webhook saved the plan as 'premium',
  ignored failed writes (Stripe never retried), and read fields newer Stripe
  API versions moved.
- **What:**
  - One `computeStatus` in `api/_trial.ts`, used by `api/stripe.ts`,
    `api/chat.ts`, `api/google-calendar-oauth-callback.ts`. A row with a Stripe
    subscription has Stripe's status; only a trial without one is timed, and
    a missing start date still counts as ended.
  - Webhook (`api/stripe-webhook.ts`): every subscription event and a paid
    invoice store Stripe's own status (`subscriptionRow`), the plan from the
    price charged (`planOf`), Stripe's trial start when none is on file, and
    the period end from either payload shape. The old 'trial_extended'
    mapping is gone (extensions ended 2026-09-24). An event about an old,
    ended subscription can't overwrite the new one. A failed write answers
    500 so Stripe retries; the trial-will-end flag stays best-effort.
  - Checkout (`createCheckoutSession`): a failed read answers 503 instead of
    looking like a new student. A stored subscription that Stripe says has
    ended can be replaced, charged today with no second trial; one Stripe
    can still bill answers 409.
  - Failed check (`unavailable`): the AI tab shows "Couldn't check your
    subscription" with Try again; Pricing shows the same and sells nothing;
    Settings says "Not checked" with Try again; the AI nav isn't locked.
  - Pricing for a canceled student: "Welcome back", Subscribe, charged today.
  - Account deletion cancels any Stripe subscription not already canceled,
    and stops with nothing deleted if billing can't be read.
  - The canceled full-app paywall is unchanged (owner's call, 2026-10-21).
- **Where:** `api/_trial.ts`, `api/chat.ts`, `api/stripe.ts`,
  `api/stripe-webhook.ts`, `api/delete-account.ts`,
  `api/google-calendar-oauth-callback.ts`, `src/App.tsx`,
  `src/components/AI/AITab.tsx`, `src/components/Pricing/PricingPage.tsx`,
  `src/components/Settings/SettingsTab.tsx`.
- **Tests:** `tests/billing.spec.ts`.
- **Still needed (owner, read-only):** confirm in Stripe that the price in
  Vercel's `STRIPE_PRICE_ID_MONTHLY` is $10.99 every month and
  `STRIPE_PRICE_ID_SEMESTER` is $28.99 every 4 months (the monthly variable
  was created 2026-05-26, before the $10.99 price). Check the webhook
  endpoint's events and failed deliveries. Rows written before this fix
  correct themselves on each student's next Stripe event; trials stored as
  `active` and missing `trial_start` stay until then (SQL in the audit notes).

### Soma: your times go where you said; everything else works around them
- **Why:** "I SAID MATH 53 HOMEWORK 14.3 to 14.6 FROM NOW UNTIL LIKE 1:00PM ...
  ESSAY 1 until 7:15 PM ... UNTIL 10:00PM PROJECT 3 Checkpoint 2 and CS LAB 7",
  reviews after. Soma sent those times; the app refused five ("That time
  overlaps a scheduled session"), asked about four reviews ("Needs your
  call", options like "Thu at 1:50 AM"), and Accept on one card said "it is
  waiting to move. Accept all moves them together". "im sick of the needs
  your call shit".
- **Causes (pre-existing):** (1) a stated time was refused when the
  student's own flexible blocks sat there; only Soma's picks could move
  blocks (2026-10-20). (2) A failed move went back to its slot and blocked
  the next one: a cascade. (3) "After the 10.5 review" was read as where
  10.5 was, not where it was moving in the same reply. (4) What didn't fit
  was asked about, not placed. (5) A card that needed other moves first
  couldn't be accepted alone.
- **What:**
  - Placement order: deletes, renames, check-offs and every stated time
    first, then what Soma times itself (`doChange`, `doNew`, `fixed`).
  - A stated time (or a start and end Soma was given) moves the flexible
    blocks in its way (`clearFor`), on cards of their own. Another piece of
    the same task inside that time is taken into it instead ("Takes in its
    other piece there"). Pinned, started, checked-off blocks and events are
    never moved.
  - "After X" / "before X" where X moves in the same reply uses X's new time
    (`resolveLate`).
  - What doesn't fit runs on: later that day past a "before" it couldn't fit
    ("Didn't fit before 4:00 PM"), else the next day with room, never past
    its due date ("Today is full after 10:00 PM"). "Needs your call" is left
    only when nothing fits in the week before the due date. This replaces
    the 2026-10-06 "when it doesn't fit, ask" part of Today by default; Soma
    still can't pick another day for work that fits today.
  - With study hours off, Soma doesn't start work it times itself between
    2 and 8 AM. Work chained from "now" ("I'm not sleeping") still runs
    through the night; stated times go anywhere.
  - A card that needs other cards' moves first (`needs`, set on every card
    whose time is where a moving block sits now) is accepted with all of
    them, as Accept all would; a trade or a loop goes in together.
- **Where:** `src/lib/assistant.ts` (`interpret`: `place`, `makeRoom`,
  `relocate`, `clearFor`, `resolveLate`, `autoPlace`'s `wake`; `applyProposal`),
  `PlanEditor.tsx` (`needs` on PlanBlock).
- **Guard:** `tests/ai-replay-2026-10-21.spec.ts` (the real plan, events and
  message; fails on the old code with "Needs your call"). Rewritten on
  purpose: `auto-placement.spec.ts` › "when it doesn't fit before its bound,
  it runs on past it…", "…a split that would leave a scrap goes whole after
  the window…"; `ai-plan-changes.spec.ts` › "accepting one half of a trade
  moves both", "moving onto a block that can move moves that block…";
  `ai-proposal-reliability.spec.ts` › "…moves that session, never overlaps
  it"; `ai-make-room.spec.ts` › "a full morning runs on later that day".
- **Setup:** none. Not yet checked against the real model
  (`tests/ai-real-model.spec.ts` needs ANTHROPIC_API_KEY).

## 2026-10-20

### Insights: the study streak month starts on Sunday
- **Why:** "can it start on sunday so sunday is far left before monday".
- **What:** the month grid's weeks run Sunday to Saturday (S M T W T F S),
  and the 1st sits under its own weekday. Only this grid; nothing else in
  Insights or the Calendar changed.
- **Where:** `src/components/Insights/InsightsTab.tsx` (`leadingBlanks`).
- **Guard:** `tests/insights.spec.ts` › "the study streak month starts its
  weeks on Sunday".

### Calendar: paused time is drawn faint inside its session
- **Why:** "what happens to the calendar view when you pause the timer?" A
  paused session is saved as one row from Start to Stop that counts only the
  running time, and the calendar drew it solid, so a break read as studied.
  The owner asked for "a really faint of the same color", not split blocks.
- **What:** the timer records each pause (start and end) while it runs, in
  the local mirror so a reload keeps them, and saves them with the session
  as `pauses` ([from, to] seconds after start). The week view fills those
  stretches with the block's colour at a quarter strength. A session
  corrected by hand afterwards no longer adds up with its pauses and is
  drawn solid. Minutes studied are unchanged everywhere.
- **Also fixed (same pause path):** the 5-second sync could read the shared
  timer row before this window's own Pause had saved, take it as "resumed
  elsewhere" and restart the timer, counting the pause as studied. The sync
  now ignores reads made while this window's write is in flight, or begun
  before its last change. Pre-existing.
- **Where:** `src/contexts/TimerContext.tsx`, `src/lib/activeTimerMirror.ts`,
  `src/lib/storage.ts` (`saveTimerSession`, `fetchTimerSessions`),
  `src/types/index.ts`, `src/components/Calendar/CalendarTab.tsx`
  (`studySpans`, `withPauses`).
- **Guard:** `tests/timer-recovery.spec.ts` › "pausing records when the pause
  was, and it survives a reload" (counted the pause before the sync fix),
  "before the pauses column exists, the session still saves without them";
  `tests/session-times-and-calendar.spec.ts` › "a paused stretch is drawn
  faint inside its session; a corrected session is drawn whole".
- **Setup:** run `timer_sessions_pauses_migration.sql` in Supabase. Until
  then sessions save without pauses and draw solid, as before. Sessions
  recorded before this have no pauses. A session picked up on another device
  mid-way knows only a pause still running there.

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
