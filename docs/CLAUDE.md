# Soma

A study-planning web app for students. Live in production at
**somastudy.app** with real users and paid subscriptions, deployed on Vercel
from `master`.

Treat every change as a production change.

## Stack

- Vite + React + TypeScript, CSS Modules (no Tailwind, no UI library)
- **Supabase** for auth and data — Postgres with row-level security
- Vercel serverless functions in `api/` for anything needing a secret
- Stripe for subscriptions; Canvas (iCal feed) and Google Calendar for imports
- Playwright for tests (`npm test`)

## Where things live

- `src/types/index.ts` — shared types
- `src/lib/storage.ts` — Supabase reads/writes and the localStorage cache
- `src/lib/` — focused helpers (`timeFormat`, `calendarView`, `subjectColors`,
  `activeTimerMirror`, `googleCalendarConnections`, `subscription`)
- `src/components/DashboardV2/` — `/dashboard`, the signed-in home
- `api/` — serverless routes; every secret lives here, never in the client
- `docs/` — release notes and plans; read before changing the area they cover

Day View (`/day-view`) is retired from the navigation but still routable, kept
as a fallback. Do not link to it without being asked.

## Security

This app holds student coursework, calendars and payment status. The rules
below are not optional, and they outrank speed or convenience.

**Secrets**

- Never put a secret in client code. Anything in `src/` ships to the browser,
  including `VITE_*` environment variables. Service-role keys, Stripe secret
  keys, Anthropic keys and OAuth client secrets belong only in `api/`.
- Never log tokens, keys, or full request bodies that might carry them.
- Never commit a `.env`, a key, or a real user's data — including in tests and
  fixtures. Test data is synthetic.

**Authorization**

- Supabase row-level security is the real boundary. Client-side filtering is a
  convenience, never a control: assume a user can call the API directly.
- Every query and write is scoped to the signed-in user as well. `storage.ts`
  does this with `uid()`; keep it that way.
- Serverless routes verify the caller before doing anything: read the
  `Authorization: Bearer` header, resolve it with `admin.auth.getUser(token)`,
  and return 401 when it fails (see `api/chat.ts`). A route that takes a
  `userId` from the request body and trusts it is a vulnerability.
- The service-role key bypasses RLS. Use it only where a route genuinely needs
  it, and always with an explicit `user_id` filter you derived from the
  verified token — never from user input.

**Input and output**

- Validate anything crossing a boundary: request bodies, OAuth callback
  parameters, webhook payloads, imported Canvas and Google data. Check shape
  and ownership, not just presence.
- Treat imported calendar events, Canvas assignments and AI output as
  untrusted. Never render them as HTML, and never let them drive a write
  without validation — AI actions are schema-checked and confirmed by the user
  before anything is saved.
- Verify Stripe webhooks by signature before acting on them.
- Keep rate limiting on routes that cost money or can be abused
  (`api/_rateLimit.ts`).

**Data handling**

- Collect the minimum. Do not add analytics, third-party scripts or new
  external calls without being asked.
- Deleting an account must actually delete the data (`api/delete-account.ts`).
- Errors shown to users must not leak internals — no raw database messages,
  stack traces or IDs belonging to someone else.

**When reviewing or writing code, assume the request is hostile.** Ask who is
allowed to do this, what happens if the ID belongs to someone else, and what
happens if the value is missing, enormous or malformed.

## Working rules

- **Verify before you push.** Run `npm test` (Playwright) and `npm run build`
  before and after a change. Both must pass.
- **Branch → Vercel preview → merge.** Do not commit straight to `master`
  unless explicitly told to.
- **Never change the Supabase schema or run a migration without flagging it
  first** and getting an explicit yes.
- **Do not weaken a test to make it pass.** A failing test is information. If a
  test needs to change because behaviour intentionally changed, say so plainly
  in the commit.
- When you fix a bug, add the test that would have caught it, and confirm it
  fails without the fix.
- Report honestly: if something is unverified, say which part and why.

## Design

Match the dashboard — it is the reference surface.

- DM Sans; restrained neutral palette; colour carries meaning (subjects) rather
  than decoration
- No glassmorphism, decorative gradients, nested cards, or large motivational
  headlines
- Respect `prefers-reduced-motion`
- Both light and dark themes must work; light is the default for new users
- Keep it usable at 1280×720 without scrolling where the surface claims to fit
  one screen, and check mobile for horizontal overflow
- Accessibility is part of done: real labels, keyboard paths, and no control
  that announces a name it does not visibly have

## Gotchas learned the hard way

- Planned session times are canonical 24-hour `HH:MM` strings. They are parsed
  (overlap grouping, saving, `<input type="time">`). Format for display only.
- A task's subject is resolved **by name** to set `todo.subject_id`. Anything
  constraining that field must still offer the course the task already belongs
  to, including archived ones, or saving silently reassigns the task.
- `/dashboard-v2` is a standalone mock that renders without the app shell and
  must issue **no** backend requests. Do not import `storage` into anything it
  loads.
- The focus timer is mirrored in `localStorage` as well as `active_timer`, so a
  reload survives an auth or network failure. Do not make recovery depend on
  the network alone, and do not swallow errors on that path.
- Hooks must sit above `AppShell`'s early returns (paywall, redirect), or hook
  order changes between renders.
