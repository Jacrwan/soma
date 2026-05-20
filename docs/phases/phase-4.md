# Phase 4 — AI Tab: Chat + Schedule Generation

## Goal
User chats with an AI that knows their Canvas assignments and current schedule, then generates a daily schedule and todo list they can push to the Today tab.

## Deliverable
AI tab has a working chat interface. User can describe their day/goals, AI responds with a proposed schedule and todo list, user can accept it (writes to Today tab).

## API Setup

On first visit (no key stored), show a setup card identical in style to Canvas setup:

```
┌────────────────────────────────────────┐
│  Anthropic API Key                     │
│  [sk-ant-___________________] [Save]   │
│                                        │
│  Get a key at console.anthropic.com    │
└────────────────────────────────────────┘
```

Store key in localStorage as `anthropic_api_key`. Show "Clear key" link once saved.

## lib/ai.ts

```typescript
export async function sendMessage(
  apiKey: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt: string,
): Promise<string>
```

Direct call to Anthropic API (`/v1/messages`). Model: `claude-sonnet-4-20250514`.

## System Prompt

Build the system prompt dynamically at chat start, injecting:
1. Today's existing time blocks (from storage)
2. Canvas assignments due in the next 14 days (from storage cache)
3. Subject list (from storage)

```
You are Soma, a personal study assistant. Help the user plan their day.

Today is {date}.

Their subjects: {subjects}

Upcoming assignments:
{assignments — name, course, due date, status}

Current schedule:
{existing time blocks for today}

When the user asks you to generate a schedule or todo list, respond with:
1. A friendly natural language explanation
2. A JSON block wrapped in <schedule> tags containing an array of TimeBlock objects
3. A JSON block wrapped in <todos> tags containing an array of todo strings

TimeBlock format: { subjectId, task, startTime (ISO), endTime (ISO), source: "ai" }
Match subjectId to the user's existing subjects by name (case-insensitive).

If you can't match a subject, use the "Other" subject.
Always ask clarifying questions if the user's request is vague.
Never generate a schedule without asking what time the user wants to start and end their day.
```

## AI Tab Layout

Full-height chat interface.

### Header
```
AI Scheduling                    [Clear key]
──────────────────────────────────────────
```

### Chat area
Scrollable message list. 
- User messages: right-aligned, accent color bg, white text, rounded bubble
- Assistant messages: left-aligned, light gray bg, dark text

### Input area (pinned to bottom)
```
[____________________________________________] [Send]
```
Text input + Send button. Enter key sends.

### Generated Schedule Card
When assistant response contains `<schedule>` tags, parse the JSON and render a preview card inline in the chat:

```
┌──────────────────────────────────────────┐
│ 📅 Proposed Schedule                     │
│                                          │
│  9:00 AM  Math — Problem Sets      1.5h  │
│ 10:30 AM  Science — Lab Report     1h    │
│ 11:30 AM  Break                    30m   │
│ 12:00 PM  English — Essay Draft    2h    │
│                                          │
│  [Accept Schedule]   [Dismiss]           │
└──────────────────────────────────────────┘
```

Accept: writes all blocks to `storage.setTimeBlocks()`, switches user to Today tab.
Dismiss: removes the card from chat.

### Generated Todos Card
When response contains `<todos>` tags, render a todo preview card:

```
┌──────────────────────────────────────────┐
│ ✅ Todo List                             │
│                                          │
│  • Finish Chapter 5 problems             │
│  • Write lab report intro                │
│  • Review essay outline                  │
│                                          │
│  [Accept Todos]   [Dismiss]              │
└──────────────────────────────────────────┘
```

Accept: save todos to localStorage as `soma_todos` (array of `{ id, text, done }`). 
Display accepted todos as a small list below the Today tab's right panel (add a "Todos" section below the subject list).

## ✅ Done When
- Setup card appears, key saves and persists
- Chat sends messages and receives AI responses
- AI has correct context (assignments + schedule injected into system prompt)
- Schedule card renders from AI response and Accept pushes blocks to Today tab
- Todo card renders and Accept saves todos
- Switching to Today tab shows AI-generated blocks on the schedule
