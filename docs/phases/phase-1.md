# Phase 1 — Today Tab: Day View + Subject List

## Goal
Today tab shows a two-column layout: left = time-blocking schedule, right = subject list with CRUD.

## Deliverable
User sees a time grid for today (6am–midnight), can add/delete time blocks manually, and can add/edit/delete subjects.

## Left Panel — Schedule / Day View

### Layout
Two columns inside `.main` when `tab === 'today'`:
- Left: 65% width, scrollable vertically
- Right: 35% width, scrollable independently
- Divider: 1px solid var(--border)

### Time Grid
Rows = 30-minute slots from 06:00 to 24:00 (36 rows).
Each row: time label on left (e.g. "06:00"), empty slot area on right.

Slot height: 40px per 30 minutes.

Current time indicator: red horizontal line (`position: absolute`) calculated from current time. Update every 60 seconds via `setInterval`.

### Time Blocks
Render blocks as absolutely positioned rectangles overlaid on the grid.
- Top = (minutesFromMidnight - 360) / 30 * 40px  (360 = 6am offset)
- Height = durationMinutes / 30 * 40px
- Left border: 3px solid [subject color]
- Background: subject color at 12% opacity
- Text: subject name (bold) + task name

Load blocks from `storage.getTimeBlocks()` on mount. Filter to blocks whose date matches today.

### Add Block
Click any empty slot area → inline form appears in that slot:
- Subject `<select>` populated from `storage.getSubjects()`
- Task `<input>` text
- Duration `<select>`: 30m / 1h / 1.5h / 2h
- Save button / Cancel button

On save: generate a new `TimeBlock` with `source: 'manual'`, save to storage, re-render.

### Block Detail
Click an existing block → small popover appears:
- Subject name + colored dot
- Task
- Time range (e.g. "9:00 AM – 10:30 AM")
- Delete button (red)

Click outside popover to close.

## Right Panel — Subject List

Matches YPT subject picker card:
- Each row: colored circle dot + subject name + today's total study time (formatted as "0:00")
- Tap row → will trigger timer in Phase 2 (for now, just highlight the row)
- "+" button at top right → add subject modal

### Add Subject Modal
- Name input
- Color picker: 8 colored circles, click to select
- Save / Cancel
- Save appends to `storage.getSubjects()`

### Edit/Delete
Small edit icon (pencil) on hover per subject row.
Click → inline edit: name input + color picker + Save/Delete buttons.

### Subject time display
Pull from `subject.totalTimeToday` (seconds). Format as `H:MM`.
This value is updated when a timer session is saved (Phase 2).

## ✅ Done When
- Today tab shows two-column layout
- Time grid renders 6am–midnight with correct slot heights
- Current time red line is visible and in the right position
- Can add a time block by clicking a slot, filling form, saving — block appears on grid
- Can click a block to see detail popover, can delete it
- Subject list shows all 6 default subjects with colored dots
- Can add a new subject with a name and color
- Can edit and delete subjects
