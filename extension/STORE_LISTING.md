# Chrome Web Store submission: Soma for Canvas

Everything the developer console asks for, in the order it asks. Build the
upload with `npm run build:extension` → `dist-extension/soma-for-canvas-<version>.zip`.
Screenshots are in `extension/store/` (regenerate with
`STORE_SHOTS=1 npx playwright test tests/store-screenshots.spec.ts`).

## Before you submit

- [ ] PR #4 is merged and deployed, so `somastudy.app` can receive what the
      extension syncs. Published earlier, it would sync, but Soma would show
      nothing.
- [x] Icons in `extension/icons/` (16, 32, 48, 128 px) are Soma's logo, scaled
      from `public/favicon.png`.
- [ ] Terms check: some schools' acceptable-use policies, and Gradescope's and
      Cengage's (WebAssign) terms, restrict automated access. Have this
      looked at before publishing.
- [ ] Decide the publisher account. The developer name is shown on the
      listing, so a Soma account is better than a personal one.
- [ ] Bump `version` in `manifest.json` for every upload after the first.

---

## Store listing tab

**Name**
Soma for Canvas

**Summary** (132 characters max; this is the manifest description, 118)
Keeps Soma up to date with your Canvas, Gradescope and WebAssign work: what's due, what's handed in, and what changed.

**Category**
Education

**Language**
English

**Description**

```
Never lose track of what's due across Canvas, Gradescope and WebAssign.

Soma for Canvas keeps your Soma study planner in sync with the sites your
classes actually use, so your deadlines, plan and AI study help reflect
what's really assigned and what you've already handed in.

WHAT IT DOES
• Brings your assignments from Canvas, Gradescope and WebAssign into Soma,
  with descriptions, points, and how much each part of your grade is worth.
• Knows what you've handed in, even when you submit on Gradescope and
  Canvas never finds out, so finished work drops off your list.
• Shows WebAssign progress, like "6 of 17 parts answered".
• Reminds you before work is due: a notification a day before and three
  hours before anything you haven't handed in, and a count on the icon.
• Tells you what changed: new assignments, moved due dates, grades posted
  and new announcements.
• Stays current on its own while Chrome is open, and whenever you open Soma.

PRIVATE BY DESIGN
• It reads these sites in your own browser, with the sign-in you already
  have. Your passwords, cookies and tokens never leave your browser.
• It only reads. It never submits, changes or posts anything.
• It only reads sites you've visited yourself, and only your own work:
  never classmates' information.
• Turn off grades, reminders or background syncing any time, and remove
  everything it synced from Soma's Settings in one click.

WORKS WITH
• Canvas on instructure.com, and schools that run Canvas on their own
  address (for example canvas.yourschool.edu): turn it on for your school
  from the extension's menu.
• Gradescope (gradescope.com)
• WebAssign (webassign.net)

You need a Soma account at somastudy.app.

Soma is not affiliated with Instructure, Canvas, Gradescope, Turnitin,
Cengage or WebAssign.
```

**Screenshots** (1280×800)
1. `extension/store/screenshot-1-popup.png`: Due soon and What changed in the popup
2. `extension/store/screenshot-2-deadlines.png`: Soma's Deadlines with Canvas, Gradescope and WebAssign work together

**Small promo tile** (440×280): optional; not made yet.

**Official URL / Homepage URL**
https://somastudy.app

**Support URL**
https://somastudy.app/contact

---

## Privacy tab

**Single purpose**

```
Sync the signed-in student's own coursework from Canvas, Gradescope and
WebAssign into their Soma study planner, and remind them before it is due.
```

**Permission justifications**

| Permission | Justification to paste |
|---|---|
| `storage` | Keeps the student's most recent sync of each site (their courses and assignments), their settings, and which reminders were already shown, so Soma and the reminders work without reading the sites again. |
| `alarms` | Re-syncs the sites the student has already synced every two hours while Chrome is open, and checks every 15 minutes whether anything has come within a day or three hours of being due, so reminders arrive on time. |
| `offscreen` | Background syncs read Gradescope's and WebAssign's pages, which needs an HTML parser (DOMParser). Service workers don't have one, so the reading runs in an offscreen document with reason DOM_PARSER. Nothing is shown to the user. |
| `notifications` | Reminds the student before work they haven't handed in is due, and tells them when something changed (a new assignment, a moved due date, a grade posted, an announcement). Each type can be turned off in the popup. |
| `scripting` | Starts the Canvas reader on a school's own Canvas domain (e.g. canvas.yourschool.edu) after the student grants access to that one site, and on tabs already open there, without a reload. |
| `activeTab` | When the student opens the popup on a site that isn't recognised, it checks whether that tab is a Canvas site, so it can offer "Use Soma on this site". Nothing is read until the student agrees. |
| Host: `https://*.instructure.com/*` | Canvas sites hosted by Instructure. The extension reads the student's own courses, assignments, submission status, grades and announcements from Canvas's API on that site, with the student's existing sign-in. Read-only. |
| Host: `https://www.gradescope.com/*` | Reads the student's own Gradescope course list and assignment table (names, due dates, submitted or not, score). Read-only. |
| Host: `https://www.webassign.net/*` | Reads the student's own WebAssign class page and assignment pages (names, due dates, how many question parts are answered). Read-only. |
| Optional host: `https://*/*` | Many schools run Canvas on their own domain (canvas.emory.edu, bruinlearn.ucla.edu). Access is requested for one site at a time, only when the student clicks "Use Soma on this site" in the popup, and only for a page that is a Canvas site. It's never requested in bulk and never for anything else. |
| Content script on `somastudy.app` | Hands the synced coursework to the student's open Soma tab with window.postMessage, where Soma saves it to their account. The extension itself never holds a Soma session or calls Soma's servers. |

**Remote code**
No, I am not using remote code. (All JavaScript is in the package; nothing is
fetched and run.)

**Data usage**: what to tick

- **Website content**: yes. Assignment names, descriptions, due dates,
  points and course names from the student's own Canvas, Gradescope and
  WebAssign pages.
- **Personal communications**: yes. Canvas course announcements (title and
  text) from the student's courses.
- **Personally identifiable information**: yes. Grades and scores are
  education records tied to the student's account. They can be turned off.
- Health, Financial and payment, Authentication information, Location, Web
  history, User activity: **no**.

Certify all three:
- I do not sell or transfer user data to third parties, outside of the
  approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes.

**Privacy policy URL**
https://somastudy.app/privacy (its "Soma for Canvas extension" paragraph
covers exactly the above).

---

## Notes for the reviewer (Distribution tab, or a reply if asked)

```
Soma for Canvas reads a student's own coursework from Canvas, Gradescope and
WebAssign while they are signed in to those sites in their own browser, and
passes it to their open Soma tab (somastudy.app). It is read-only and only
uses same-site requests to sites the user has visited.

To try it without a school account: create a free Canvas account at
canvas.instructure.com (Canvas Free for Teacher), enroll in or create a
course with an assignment, open it with the extension installed, then open
the extension's menu: the assignment appears under "Due soon" and in the
synced list. Gradescope and WebAssign behave the same way for any student
account.

The optional https://*/* permission is requested for one origin at a time,
only from the "Use Soma on this site" button, for schools that host Canvas
on their own domain.
```
