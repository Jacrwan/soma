# Phase 2 — Timer Overlay + Session Saving

## Goal
Tapping a subject opens a timer overlay. User can start, pause, and stop a session. Stopping saves the session and creates/updates a block on the schedule.

## Deliverable
Full YPT-style timer flow works end to end.

## Timer Overlay

### Trigger
Clicking a subject row in the right panel opens the overlay.

### Overlay structure
Slides up from bottom of screen. Full-width card, sits above everything.
Backdrop: `rgba(0,0,0,0.4)` behind the card.

Animations:
```css
@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```
Apply `slideUp 300ms cubic-bezier(0.32, 0.72, 0, 1)` to card.
Apply `fadeIn 200ms ease` to backdrop.

### Step 1 — Task input (before timer starts)
- Subject name + colored dot at top
- Text input: placeholder "What are you working on? (optional)"
- Large "Start" button (accent color)
- Small "Cancel" link

### Step 2 — Timer running
After start:
- Large time display: `HH:MM:SS`, centered, large font (48px)
- Subject name + color dot above it
- Task label below (if entered)
- Pulsing dot next to subject name:
  ```css
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  animation: pulse 1.5s infinite;
  ```
- Pause button + Stop button (side by side)

Pause: freezes the timer display, changes button to "Resume".
Stop: ends session, triggers save logic.

### useTimer hook (src/hooks/useTimer.ts)
```typescript
// Manages: running, paused, elapsed seconds, startTime (ISO)
// useTimer() returns: { elapsed, isRunning, isPaused, start, pause, resume, stop }
// Uses setInterval(1000) when running
```

## Session Save Logic

On stop:
1. Create a `TimerSession` object: id, subjectId, task, startTime, endTime, durationSeconds
2. Save to `storage.getTimerSessions()` + append + `storage.setTimerSessions()`
3. Update subject's `totalTimeToday` += durationSeconds, save subjects
4. Block logic:
   - Find a `TimeBlock` for today where `subjectId` matches AND the session's start time falls within the block's time range
   - If found: update `block.endTime` to session's endTime (grow the block), set `block.timerSessionId`
   - If not found: create a new `TimeBlock` with `source: 'manual'`, start/end = session start/end
5. Save updated blocks
6. Close overlay

## Schedule: Live Block Growth

While timer is running:
- If there's a matching scheduled block for the active session, update its visual height every 60 seconds
- Re-render the block on the grid to show it growing

## ✅ Done When
- Clicking a subject opens the overlay with slide-up animation
- Timer counts up correctly
- Pause/resume works
- Stop saves the session and closes the overlay
- Subject time updates in the right panel after stopping
- A new block (or grown block) appears on the schedule after stopping
