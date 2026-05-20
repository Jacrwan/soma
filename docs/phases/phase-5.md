# Phase 5 — Polish + Mobile Layout

## Goal
App feels complete and works on mobile browser (iPhone).

## Deliverable
No visual bugs, smooth interactions, works at 390px viewport width.

## Polish Items

### Scrollbars
Custom thin scrollbar for webkit:
```css
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
```

### Empty States
- No time blocks today: centered message "No blocks yet. Click a slot to add one."
- No subjects: "Add a subject to get started."
- Canvas not connected: handled by setup card
- AI chat empty: centered prompt suggestion buttons:
  - "Plan my day"
  - "What should I study first?"
  - "Generate a schedule for today"
  Each button pre-fills the chat input.

### Transitions
- Tab switching: no animation (instant is fine)
- Overlay: already handled in Phase 2
- Block popover: `opacity 0 → 1`, `transform: scale(0.97) → scale(1)`, 150ms ease

### Mobile Layout (≤768px)
- Stack panels vertically: schedule on top, subject list below (collapsible)
- Subject list collapsed by default on mobile, tap "Subjects ▾" to expand
- Timer overlay: full screen on mobile (100vw, 100vh)
- Nav tabs: full width, equal columns
- Canvas sidebar: becomes a horizontal scroll of pills above the list
- AI tab: no changes needed, already full-height chat

### Misc
- Favicon: use a simple "L" in accent color (can be SVG inline in index.html)
- Page title updates per tab: "Soma — Today", "Soma — Canvas", "Soma — AI"
- Prevent body scroll when timer overlay is open (`overflow: hidden` on body)

## ✅ Done When
- App looks correct on desktop (1280px+) and mobile (390px)
- No horizontal scroll on mobile
- Empty states visible when applicable
- Scrollbars are thin and subtle
- Timer overlay prevents background scroll
- Prompt suggestions work in AI tab
