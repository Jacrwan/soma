# From "Soma for Canvas" to Soma Capture

The Canvas extension is the first adapter of something bigger: one browser
extension that brings everything a student's coursework lives in into Soma,
always read in their own browser, with their own sign-in.

## The pattern to keep

Every source works the way Canvas does today:

1. **An adapter** runs only on that site, reads only what the student can
   already see, and only while they're there (or when they press Sync now).
2. **A snapshot** of plain, typed fields goes into `chrome.storage.local`,
   one per site. No cookies, tokens or passwords ever leave the browser.
3. **The bridge** hands snapshots to an open Soma tab; the app validates them
   and saves them under the student's account.
4. **The app** merges them into the things Soma already has (Subjects, tasks,
   deadlines, course items, documents) instead of growing a new page per
   source. "What's due Thursday" doesn't care where it came from.

To generalise the code: move each adapter into `extension/adapters/<name>.js`
exporting `matches`, `looksLikeIt()` and `read() → snapshot`, give snapshots a
`kind` (`canvas`, `gradescope`, …), and let `canvas_snapshots` become
`source_snapshots (user_id, kind, host, payload)`. `canvasDeepSync.ts`
becomes one normaliser per kind behind a shared `mergeSources()`.

## Adapters, in order of value

| # | Source | What it adds | Why it matters | Effort |
|---|--------|--------------|----------------|--------|
| 1 | **Canvas files & modules** (same site, more endpoints) | Module order, readings and lecture slides as files | Course items and documents fill themselves: no more uploading the syllabus by hand. Feeds exam mode and practice questions. | S |
| 2 | **Gradescope** — built (2026-10-25) | Real due dates and submission status for psets graded outside Canvas (most STEM courses) | The biggest gap in "what's due": Canvas often just says "submit on Gradescope". | M |
| 3 | **Ed Discussion / Piazza** | Staff posts, pinned clarifications, exam logistics | Like announcements: deadlines move here first. Only staff and pinned posts, never classmates' posts. | M |
| 4 | **Course websites** (cs61a.org style) | Schedules, readings, homework links | Soma already has a course-site import; the extension can run it on the page the student is viewing, including pages behind CalNet. | S |
| 5 | **Other LMSs**: Blackboard Ultra, Brightspace (D2L), Moodle, Google Classroom | The Canvas data, for the schools that don't use Canvas | Opens the market beyond Canvas schools. Each has a JSON API the signed-in page uses. Google Classroom has an official API and should use OAuth instead. | M each |
| 6 | **Lecture video** (YouTube, Kaltura, Panopto) | Title, length, transcript where the page exposes one | "Watch lecture 12" gets a real length estimate, and transcripts become searchable course material. | M |
| 7 | **Anything else: "Send to Soma"** | Right-click or press a shortcut on any page or PDF: save it as a task, reading or document for a course | Covers everything without an adapter, and is the habit loop: the student captures, Soma plans. | S |
| 8 | **Exam & quiz dates in email** | Room, time, allowed materials | Leave to the email-forwarding address, not the extension. | — |

## What it turns Soma into

- **Deadlines that are actually complete.** Canvas, Gradescope and course
  sites in one list, with submitted work disappearing on its own.
- **An AI that knows the course, not just the calendar.** With descriptions,
  weights, grades, staff posts and the readings themselves, Soma can say
  "the 25% project is behind; the 2% quiz can wait" and build exam prep from
  the actual modules.
- **A moat.** Logged study time per task, compared against what was actually
  assigned and how it was graded, is data no calendar or notes app has.

## Rules that keep it defensible

- Read only, only the student's own view, only on sites they turn on (one
  optional host permission each, asked for at the moment they click).
- Sync on visit or on request, never constant background crawling.
- Never other students' content: no rosters, no classmates' discussion posts.
- Grades stay optional, and everything a source synced can be removed in one
  click, in the extension and in Soma.
- One Chrome Web Store "single purpose": bring the student's coursework into
  Soma. Each new adapter is described in the store listing and privacy policy
  before it ships.
- Where a source has a real student API (Google Classroom, Gradescope's
  calendar feed), prefer it over reading the page.

## Next steps

1. Ship Canvas as it is: icons, store listing, privacy review, a small beta
   with one school.
2. Canvas files and modules: make course items and documents fill themselves.
3. Refactor into adapters + `source_snapshots`, then Gradescope.
4. "Send to Soma" capture on any page.
5. Ed/Piazza staff posts, then other LMSs, by where users are.
