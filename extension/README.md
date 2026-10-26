# Soma for Canvas

A Chrome extension (Manifest V3) that brings what the Canvas calendar feed
leaves out into Soma: assignment descriptions, points and group weights,
whether each one was handed in, current grades, and recent announcements —
and Gradescope, where much of that work is actually handed in.

## How it works

```
Canvas tab ── canvas.js ──▶ chrome.storage.local ──▶ bridge.js ── postMessage ──▶ Soma tab
 (student's own session,                               (on somastudy.app)          (saves under the
  same-site GETs to /api/v1)                                                        student's account)
```

- **canvas.js** runs on Canvas pages. When the student is on Canvas it reads
  `/api/v1/courses`, each course's `assignment_groups` and `assignments`
  (with the student's own submission), and the last 30 days of
  `announcements`, then stores one snapshot per Canvas site. On its own it
  syncs on a visit at most every 30 minutes; the popup's **Sync now** syncs
  immediately.
- **background.js** keeps it current without visits: every two hours while
  Chrome is open, and whenever the student opens Soma (if older than 20
  minutes), it re-reads each site they have synced before. The readers run in
  a hidden offscreen page (`offscreen.html`), since a service worker has no
  DOM. The popup can turn this off. Signed out of a site, it records "Sign in
  …" and keeps the last sync. It also turns the extension on for a school's
  own Canvas domain after the student allows it.
- **gradescope.js** runs on `www.gradescope.com`. Gradescope has no student
  API, so it reads the pages the student can open: the course list (newest
  term, student courses only) and each course's assignments table (name, due
  and late due dates, No Submission / Submitted / score). If no table can be
  read it keeps the last good sync instead of storing "nothing due". The app
  joins each Gradescope course to the Canvas course with the same department
  and number; a Canvas entry that links to Gradescope learns it was handed in,
  and Gradescope-only work is added, labelled "Gradescope".
- **webassign.js** runs on `www.webassign.net`. The class home page
  (`/v4cgi/student.pl`) carries the current assignments as JSON in
  `#js-student-myAssignmentsWrapper[data-assignments]` (id, name, due time in
  epoch seconds); each assignment's page gives its progress from the question
  parts (`td.points.questionGrade[id^="dashboard_box"]`, `td.submissions`).
  All parts answered is done, some is in progress. Past assignments are only
  ids there and aren't read. Checked against a real Emory PHYS 151 class.
- **due.js** decides what's due in the next 48 hours and not handed in, from
  all three sites, counting a Canvas entry and its Gradescope or WebAssign
  twin once (done on either clears both) and skipping Canvas work handed in
  on paper. The toolbar badge shows the count; `background.js` sends a
  notification a day before and three hours before each, and the popup lists
  them. Reminders and the badge each have a switch. Notifications are made
  in the browser; nothing about them leaves it.
- **What changed:** `common.js` compares each sync with the last one for that
  site (`diff`): new work (not already handed in), a moved due date, a grade
  posted, a new announcement. Nothing on a site's first sync. Changes ride on
  the snapshot (`changes`, 14 days, newest first), so Soma's Deadlines and
  AI get them through the normal bridge. `background.js` notifies each new
  change once, or one summary when a sync brings more than three; the popup
  lists the last week and has a switch.
- **common.js** is shared by the readers: when to sync and how a read is stored.
- **bridge.js** runs on Soma's pages and hands the snapshot to the app with
  `window.postMessage`. The app (`src/lib/canvasExtension.ts`) validates it
  (`src/lib/canvasDeepSync.ts`), saves it to `canvas_snapshots` under the
  signed-in student, and merges it into the feed's assignments, so Deadlines,
  the dashboard and the AI all see it.
- **popup** shows what synced, turns the extension on for a school whose
  Canvas isn't on `*.instructure.com` (it asks Chrome for that one site only),
  turns grade syncing off, and removes synced data.

What it never does: hold a Soma session, call Soma's servers, read or send a
cookie, password or token, write to Canvas or Gradescope, or read a site the
student hasn't synced themselves at least once.

## Try it locally

1. Run `canvas_snapshots_migration.sql` in the Supabase SQL editor. Without it
   the sync still works, but only in the browser that received it.
2. `npm run dev`, and sign in to Soma at http://localhost:5173.
3. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load
   unpacked** → choose this `extension/` folder.
4. Open your Canvas in another tab. It syncs on load; or click the Soma icon →
   **Sync now**. Back in Soma, Deadlines shows submitted work as done, and
   Settings → Integrations shows "Canvas extension · synced …".

## Publishing to the Chrome Web Store

`npm run build:extension` makes the upload,
`dist-extension/soma-for-canvas-<version>.zip`: it takes the localhost and PR
preview addresses out of the bridge, checks the store's limits (name,
description length, version, https-only matches) and that every file the
extension names is in the build. `STORE_LISTING.md` has the listing text,
the permission justifications, the data-usage answers, notes for the
reviewer and a checklist; screenshots are in `store/`.

## Known limits

- The Gradescope reader is written against Gradescope's page structure
  (`#assignments-student-table`, `.submissionStatus`,
  `.submissionTimeChart--dueDate`) and tested on synthetic copies in
  `tests/fixtures/gradescope/`. Check it against a real course page before
  release; if Gradescope changes its markup, update those fixtures from a
  saved page (with names and ids replaced) and the reader together.
- If two Soma accounts are used in one browser, the snapshot goes to whichever
  is signed in on the open Soma tab.
- Very large courses are capped at 1,000 assignments per course (10 pages).
- Turning grades off applies from the next sync.
