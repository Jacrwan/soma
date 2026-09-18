# UI refresh plan — Calendar, AI, draggable timer

Written 2026-09-17, before starting work. Scope agreed: a three-day Calendar
view with corrected view-switching, an AI tab redesign, and a movable timer
pill. Nothing here is implemented yet.

Ground rules for this work are unchanged: branch → Vercel preview → merge,
run the Playwright suite before and after, and flag any Supabase schema change
rather than making it. None of the three items below needs a migration.

---

## 1. Calendar — three-day view and "keep me on today"

### The bug being fixed

`switchViewMode` ([CalendarTab.tsx:587](../src/components/Calendar/CalendarTab.tsx))
anchors the week on the **first of the displayed month**:

```ts
if (mode === 'week') {
  setOriginMonth(viewMonth);
  setViewWeekStart(getSundayOfWeek(viewMonth));   // ← week of the 1st, not today
}
```

So on 17 September, viewing September in month view and pressing **Week** lands
on the week of 1 September. That is the behaviour to replace.

### The rule

One rule covers every transition:

> **When switching views, if today is visible in the view you are leaving, the
> new view anchors on today. Otherwise it anchors on the start of the range you
> were looking at.**

Worked through all six transitions:

| From → To | Today visible in "from" | Result |
| --- | --- | --- |
| Month → Week | yes | week containing today |
| Month → Week | no | week containing the 1st of that month (today's behaviour) |
| Month → 3-day | yes | three days starting today |
| Month → 3-day | no | three days starting the 1st of that month |
| Week → 3-day | yes | three days starting today |
| Week → 3-day | no | three days starting that week's Sunday |
| Week → Month | yes | month containing today |
| Week → Month | no | existing `getMonthToRestoreFromWeek` behaviour |
| 3-day → Week | yes | week containing today |
| 3-day → Week | no | week containing the first of the three days |
| 3-day → Month | yes | month containing today |
| 3-day → Month | no | month containing the first of the three days |

"Today is visible" means: month view → today falls in `viewMonth`; week view →
today is within `[viewWeekStart, +6d]`; 3-day view → today is within
`[viewStart, +2d]`.

### Implementation

- Widen `ViewMode` ([CalendarTab.tsx:12](../src/components/Calendar/CalendarTab.tsx))
  to `'month' | 'week' | 'threeDay'`.
- Replace the separate `viewWeekStart` anchor with a single `rangeStart` plus a
  `rangeLength` derived from the mode (7 or 3). The week grid already renders
  from a start date and a day count, so the 3-day view should reuse
  `weekHourSlots` and the same column renderer at a different width rather than
  becoming a second grid implementation.
- Extract `isTodayVisible(mode, anchors)` and `anchorFor(targetMode, fromMode,
  anchors)` as pure functions so the table above can be unit-tested without a
  browser.
- `goToPrev` / `goToNext` step by `rangeLength` in the day views; month
  unchanged. `goToToday` sets `rangeStart` to today (week view keeps snapping to
  that week's Sunday).
- Header title and the prev/next `aria-label`s need a third case — currently
  they are a month/week ternary
  ([CalendarTab.tsx:603](../src/components/Calendar/CalendarTab.tsx),
  [:678](../src/components/Calendar/CalendarTab.tsx)).
- The view toggle gains a third button; check it still fits at 1280px.

### Decided

**The 3-day view starts on today** — today, tomorrow, the day after — rather
than centring today. Confirmed 2026-09-17. So "anchor on today" in the table
above means today is the *first* of the three columns, and stepping forward
moves to the next three days.

Note this makes the 3-day view asymmetric with the week view, which still snaps
to that week's Sunday. That is intentional: the week view is a calendar grid,
the 3-day view is a near-term working window.
### Tests

Pure-function tests for all twelve rows of the table (fast, no browser), plus
browser tests for: switching month→week→3-day while today is on screen lands on
today each time; the same switches from a month with no today keep their
anchor; prev/next steps by three days; the 3-day grid renders events in the
right columns; no horizontal overflow at 1280px and on mobile.

---

## 2. AI tab redesign

1439 lines of TSX, 844 of CSS. The surfaces in play: session sidebar, message
list, composer, suggestion chips, "thinking" indicator, `<soma-action>`
confirmation cards, and the premium-locked state.

This is the least specified of the three — "it's just so ugly" is a direction,
not a spec. Plan is to do a design pass first and get it approved before
touching much code, because a 1400-line rewrite done blind is the easiest way
to burn a lot of effort on the wrong thing.

**Step 1 — capture the current state.** Screenshot every state (empty, mid
conversation, thinking, action confirmation, locked, mobile) so there is a
before to compare against and nothing gets silently dropped.

**Step 2 — propose a direction, then build.** Anchor on the dashboard, which is
now the app's best surface: DM Sans, restrained neutral palette, subject colour
used only where it carries meaning, generous spacing, no nested cards. Likely
moves: give the composer real presence instead of a thin input, make messages
readable at a comfortable measure rather than full-bleed, turn the action
confirmations into proper review cards (they are the highest-stakes thing on
the page — they write to the user's plan), and rebuild the thinking state so it
doesn't look like a placeholder.

**Step 3 — keep behaviour identical.** Same caveat as the subject dropdown: the
AI tab writes real data through `<soma-action>` parsing
([AITab.tsx:156](../src/components/AI/AITab.tsx) onward). A visual pass must not
touch action parsing, session persistence, or the premium gate. Verify by
running the existing suite plus new tests asserting an action still produces the
same writes.

---

## 3. Movable timer pill

Currently fixed at bottom-right
([TimerOverlay.module.css](../src/components/Timer/TimerOverlay.module.css)).

- Drag by the pill body using Pointer Events (works for mouse and touch);
  buttons keep their click behaviour, so start dragging only past a small
  threshold (~4px) to avoid swallowing taps on pause/stop.
- Persist the position in `localStorage` under `soma_timer_pos`, same
  per-device pattern as `soma_nav_collapsed`. Store it as a corner plus offset,
  or clamp on read, so a position saved on a wide monitor doesn't put the pill
  off-screen on a laptop.
- Clamp to the viewport on drag and on window resize; keep it clear of the
  footer as it is now.
- Keyboard: the pill body is already a button; add arrow-key nudging while it
  has focus so the feature isn't mouse-only.
- Double-click (or a small "reset position" affordance) returns it to the
  default corner.
- Tests: drag moves it, the position survives a reload, a stored off-screen
  position is clamped back into view, and pause/stop still fire on click rather
  than being eaten by the drag handler.

---

## Suggested order

1. Timer pill dragging — smallest, self-contained, no open questions.
2. Calendar — well specified once the 3-day anchoring question is answered.
3. AI tab — design pass and approval first, then build.

## Still open from earlier sessions

- Settings → Integrations must fit one screen. Measured: the **expanded Google
  calendar picker** is the only thing that overflows (64px at 1366×768, 112px at
  1280×720 with 12 calendars); the collapsed page already fits. Fix is a
  two-column picker with a capped height, not tighter row padding.
- Pricing page still advertises "Day View & schedule blocks"
  ([PricingPage.tsx:22](../src/components/Pricing/PricingPage.tsx)) although Day
  View is unlinked. Copy decision.
- Free-text task label needs a new `todos` column — `notes` is already used by
  Day View and by the AI's `update_todo`. Needs a migration and sign-off.
