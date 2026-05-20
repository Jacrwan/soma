# Phase 0 — Scaffold + Design System + Tab Shell

## Goal
Working Vite app in the browser with correct fonts, colors, and three navigable tabs. No functionality yet.

## Deliverable
User can open the app and click between Today, Canvas, and AI tabs. Each tab shows a placeholder heading. Looks like YPT.

## Steps

### 1. Scaffold
```bash
npm create vite@latest soma -- --template react-ts
cd soma
npm install
```

### 2. Clean up
Delete: `src/App.css`, `src/assets/`, all content in `src/App.tsx`, all content in `index.css`.

### 3. index.html
Add Pretendard font in `<head>`:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" />
```
Set title to `Soma`.

### 4. Global CSS (index.css)
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-tertiary: #eeeeee;
  --border: #e0e0e0;
  --text-primary: #1a1a1a;
  --text-secondary: #555555;
  --text-muted: #999999;
  --accent: #4f6ef7;
  --accent-hover: #3a59e0;
  --danger: #e53935;
  --success: #43a047;
  --subject-1: #ef5350;
  --subject-2: #42a5f5;
  --subject-3: #66bb6a;
  --subject-4: #ab47bc;
  --subject-5: #ffa726;
  --subject-6: #26c6da;
  --subject-7: #ec407a;
  --subject-8: #8d6e63;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 40px;
}

body {
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.5;
}

button { cursor: pointer; font-family: inherit; }
input, textarea { font-family: inherit; }
```

### 5. File structure
Create these empty files (fill in subsequent phases):
```
src/
  components/
    DayView/
      DayView.tsx
      DayView.module.css
    Timer/
      TimerOverlay.tsx
      TimerOverlay.module.css
    Canvas/
      CanvasTab.tsx
      CanvasTab.module.css
    AI/
      AITab.tsx
      AITab.module.css
    shared/
      SubjectDot.tsx
  hooks/
    useTimer.ts
  lib/
    storage.ts
    canvas.ts
    ai.ts
  types/
    index.ts
  App.tsx
  main.tsx
```

### 6. types/index.ts
```typescript
export type SubjectColor =
  | '#ef5350' | '#42a5f5' | '#66bb6a' | '#ab47bc'
  | '#ffa726' | '#26c6da' | '#ec407a' | '#8d6e63';

export interface Subject {
  id: string;
  name: string;
  color: SubjectColor;
  totalTimeToday: number; // seconds
}

export interface TimeBlock {
  id: string;
  subjectId: string;
  task: string;
  startTime: string;   // ISO
  endTime: string;     // ISO
  source: 'manual' | 'ai' | 'canvas';
  timerSessionId?: string;
}

export interface TimerSession {
  id: string;
  subjectId: string;
  task: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  linkedBlockId?: string;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  courseId: number;
  courseName: string;
  dueAt: string;
  htmlUrl: string;
  status: 'not_started' | 'in_progress' | 'done';
}

export interface CanvasCourse {
  id: number;
  name: string;
  courseCode: string;
}
```

### 7. lib/storage.ts
```typescript
import { Subject, TimeBlock, TimerSession } from '../types';

const KEYS = {
  subjects: 'soma_subjects',
  timeBlocks: 'soma_blocks',
  timerSessions: 'soma_sessions',
  canvasToken: 'canvas_token',
  canvasBaseUrl: 'canvas_base_url',
  assignmentStatus: 'canvas_assignment_status',
};

const DEFAULT_SUBJECTS: Subject[] = [
  { id: '1', name: 'Math',     color: '#ef5350', totalTimeToday: 0 },
  { id: '2', name: 'Science',  color: '#42a5f5', totalTimeToday: 0 },
  { id: '3', name: 'English',  color: '#66bb6a', totalTimeToday: 0 },
  { id: '4', name: 'History',  color: '#ab47bc', totalTimeToday: 0 },
  { id: '5', name: 'Language', color: '#ffa726', totalTimeToday: 0 },
  { id: '6', name: 'Other',    color: '#26c6da', totalTimeToday: 0 },
];

function get<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function set(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const storage = {
  getSubjects: (): Subject[] => get(KEYS.subjects, DEFAULT_SUBJECTS),
  setSubjects: (v: Subject[]) => set(KEYS.subjects, v),

  getTimeBlocks: (): TimeBlock[] => get(KEYS.timeBlocks, []),
  setTimeBlocks: (v: TimeBlock[]) => set(KEYS.timeBlocks, v),

  getTimerSessions: (): TimerSession[] => get(KEYS.timerSessions, []),
  setTimerSessions: (v: TimerSession[]) => set(KEYS.timerSessions, v),

  getCanvasToken: (): string => get(KEYS.canvasToken, ''),
  setCanvasToken: (v: string) => set(KEYS.canvasToken, v),

  getCanvasBaseUrl: (): string => get(KEYS.canvasBaseUrl, ''),
  setCanvasBaseUrl: (v: string) => set(KEYS.canvasBaseUrl, v),

  getAssignmentStatus: (): Record<number, string> => get(KEYS.assignmentStatus, {}),
  setAssignmentStatus: (v: Record<number, string>) => set(KEYS.assignmentStatus, v),
};
```

### 8. App.tsx — Tab navigation
```tsx
import { useState } from 'react';
import styles from './App.module.css';

type Tab = 'today' | 'canvas' | 'ai';

export default function App() {
  const [tab, setTab] = useState<Tab>('today');

  return (
    <div className={styles.app}>
      <nav className={styles.nav}>
        <button className={tab === 'today'  ? styles.active : ''} onClick={() => setTab('today')}>Today</button>
        <button className={tab === 'canvas' ? styles.active : ''} onClick={() => setTab('canvas')}>Canvas</button>
        <button className={tab === 'ai'     ? styles.active : ''} onClick={() => setTab('ai')}>AI</button>
      </nav>
      <main className={styles.main}>
        {tab === 'today'  && <div>Today tab</div>}
        {tab === 'canvas' && <div>Canvas tab</div>}
        {tab === 'ai'     && <div>AI tab</div>}
      </main>
    </div>
  );
}
```

### 9. App.module.css
```css
.app { display: flex; flex-direction: column; height: 100vh; }

.nav {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  flex-shrink: 0;
}

.nav button {
  padding: 14px 24px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  margin-bottom: -1px;
}

.nav button:hover { color: var(--text-primary); }
.nav button.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.main { flex: 1; overflow: hidden; }
```

## ✅ Done When
- `npm run dev` opens in browser with no errors
- Three tabs visible, clicking switches between them
- Font is Pretendard (inspect element to verify)
- Colors match the design system
