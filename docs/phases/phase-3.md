# Phase 3 — Canvas Tab

## Goal
User connects their Canvas account, sees their active courses and upcoming assignments, and can mark assignment status locally.

## Deliverable
Canvas tab shows a working assignment list filtered by course. Status persists in localStorage.

## Auth Setup

On first visit (no token stored), show a centered setup card:

```
┌─────────────────────────────────────────┐
│  Connect Canvas                         │
│                                         │
│  Canvas URL  [https://canvas....]       │
│  API Token   [____________________]     │
│                          [Connect]      │
│                                         │
│  How to get your token:                 │
│  Canvas → Account → Settings →         │
│  Approved Integrations → New Access     │
│  Token                                  │
└─────────────────────────────────────────┘
```

On Connect:
- Validate by calling `GET /api/v1/courses?per_page=1` with the token
- If 200: save token + base URL to storage, show the main Canvas UI
- If error: show "Invalid token or URL" below the form

Show a small "Disconnect" link in the top-right corner of the Canvas tab once connected. Clicking clears token + base URL from storage and returns to setup card.

## lib/canvas.ts

```typescript
export async function canvasFetch(token: string, baseUrl: string, path: string) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Canvas error: ${res.status}`);

  // Handle pagination via Link header
  const data = await res.json();
  const linkHeader = res.headers.get('Link');
  const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
  if (nextMatch) {
    const nextData = await canvasFetch(token, '', nextMatch[1]); // full URL
    return [...data, ...nextData];
  }
  return data;
}

export async function getCourses(token: string, baseUrl: string)
export async function getAssignments(token: string, baseUrl: string, courseId: number)
```

Fetch:
- Courses: `GET /api/v1/courses?enrollment_state=active&per_page=50`
- Assignments per course: `GET /api/v1/courses/:id/assignments?per_page=50&order_by=due_at&include[]=submission`

Filter assignments: only those with `due_at` not null and due within the next 30 days or past 7 days.

## Canvas Tab Layout

Two columns:
- Left sidebar (220px): course list
- Main area: assignment list

### Course Sidebar
- "All" pill at top (default selected)
- One pill per course (course name, truncated)
- Active pill: accent color bg, white text
- Inactive: light gray bg

### Assignment List
Sorted by `due_at` ascending.

Each assignment row:
```
[●] Assignment Name                          Due: Mon May 20
    Course Name                         [ Not started ▾ ]
```

- Colored dot = subject color (assign colors to courses in order from subject color list — course 1 gets color 1, etc.)
- Status dropdown: `Not started` / `In progress` / `Done`
- Status saved to `storage.getAssignmentStatus()` keyed by assignment ID
- Done assignments: text color fades to `var(--text-muted)`, dot fades

### Loading State
While fetching: show a simple centered spinner or "Loading assignments..."

### Error State
If Canvas fetch fails: "Failed to load assignments. Check your token and URL." with a retry button.

### Study Plan Section
Below assignment list, a section divider and:
```
Study Plan
──────────────────────────────────────────
[Generate Study Plan]   ← disabled button, gray
Coming in Phase 4
```

## ✅ Done When
- Setup card appears with no token stored
- Connecting with a valid token + URL loads courses and assignments
- Course sidebar filters the assignment list correctly
- Status dropdown changes save to localStorage and persist on refresh
- Done assignments visually de-emphasized
- Disconnect clears everything and returns to setup card
