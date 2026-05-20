# Soma

Personal study OS. YPT-inspired. AI-powered scheduling and todo generation.

## Stack
- Vite + React + TypeScript
- CSS Modules (no Tailwind, no UI libraries)
- localStorage for all persistence
- Canvas LMS API (client-side, user-supplied token)
- Anthropic API (Phase 4+)

## Design Rules
- Match YPT aesthetic: white bg, dense layout, minimal chrome, no gradients, no shadows on flat elements
- Font: Pretendard (CDN)
- Colors: defined in phase-1. Never deviate.
- Borders: 1px solid #e0e0e0, 8px radius
- Accent: #4f6ef7

## Architecture
- No backend. Ever. All data in localStorage.
- Canvas API calls are client-side with user token.
- Anthropic API calls are client-side with user key.
- All types defined in src/types/index.ts
- All localStorage logic in src/lib/storage.ts
- Canvas API logic in src/lib/canvas.ts
- AI logic in src/lib/ai.ts (Phase 4+)

## Phases
- Phase 0: Scaffold + design system + tab shell
- Phase 1: Today tab — schedule/day view
- Phase 2: Timer overlay + session saving
- Phase 3: Canvas tab — auth + assignment list
- Phase 4: AI tab — chat + schedule generation
- Phase 5: Polish + mobile layout

## Rules
- Complete each phase fully before starting the next.
- Test in browser before calling a phase done.
- Never build AI features before Phase 4.
- Keep components small. One job per component.
- When in doubt, do less.
