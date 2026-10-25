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
  syncs at most every 3 hours; the popup's **Sync now** syncs immediately.
- **gradescope.js** runs on `www.gradescope.com`. Gradescope has no student
  API, so it reads the pages the student can open: the course list (newest
  term, student courses only) and each course's assignments table (name, due
  and late due dates, No Submission / Submitted / score). If no table can be
  read it keeps the last good sync instead of storing "nothing due". The app
  joins each Gradescope course to the Canvas course with the same department
  and number; a Canvas entry that links to Gradescope learns it was handed in,
  and Gradescope-only work is added, labelled "Gradescope".
- **common.js** is shared by both readers: when to sync and how a read is stored.
- **bridge.js** runs on Soma's pages and hands the snapshot to the app with
  `window.postMessage`. The app (`src/lib/canvasExtension.ts`) validates it
  (`src/lib/canvasDeepSync.ts`), saves it to `canvas_snapshots` under the
  signed-in student, and merges it into the feed's assignments, so Deadlines,
  the dashboard and the AI all see it.
- **popup** shows what synced, turns the extension on for a school whose
  Canvas isn't on `*.instructure.com` (it asks Chrome for that one site only),
  turns grade syncing off, and removes synced data.

What it never does: hold a Soma session, call Soma's servers, read or send a
cookie, password or token, write to Canvas, or crawl Canvas in the background.

## Try it locally

1. Run `canvas_snapshots_migration.sql` in the Supabase SQL editor. Without it
   the sync still works, but only in the browser that received it.
2. `npm run dev`, and sign in to Soma at http://localhost:5173.
3. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load
   unpacked** → choose this `extension/` folder.
4. Open your Canvas in another tab. It syncs on load; or click the Soma icon →
   **Sync now**. Back in Soma, Deadlines shows submitted work as done, and
   Settings → Integrations shows "Canvas extension · synced …".

## Before publishing to the Chrome Web Store

- Add icons (16, 48, 128) and a `"icons"` entry in `manifest.json`.
- Remove the `localhost` matches from the bridge content script.
- Fill in the store's privacy section from the Soma privacy policy's
  "Soma for Canvas extension" paragraph; the single purpose is "sync the
  student's own Canvas and Gradescope coursework into Soma".
- Have the terms checked: some schools' acceptable-use policies, and
  Gradescope's terms, restrict automated access.

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
