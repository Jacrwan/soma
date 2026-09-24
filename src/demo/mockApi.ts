/** Answers the app's /api routes locally while in demo mode. */
import { calendarEvents, canvasAssignments } from './seed';
import { chatReply, dashboardReply } from './mockAi';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const CONNECTION = {
  id: 'demo-google',
  googleEmail: 'maya.chen.demo@gmail.com',
  selectedCalendars: [
    { id: 'primary', summary: 'Maya', backgroundColor: '#33b679', primary: true },
    { id: 'umich-classes', summary: 'UMich Classes', backgroundColor: '#4285f4' },
  ],
  createdAt: '2026-08-25T16:00:00Z',
};

async function handle(path: string, body: Record<string, unknown>): Promise<Response> {
  switch (path) {
    case '/api/stripe':
      return json({ status: 'active', plan: 'annual', currentPeriodEnd: new Date(Date.now() + 200 * 86_400_000).toISOString(), cancelAtPeriodEnd: false });
    case '/api/google-calendar-connections':
      if (body.action === 'list') return json({ connections: [CONNECTION] });
      if (body.action === 'list_calendars') return json({ calendars: CONNECTION.selectedCalendars });
      return json({ ok: true });
    case '/api/google-calendar-events':
      return json({ events: calendarEvents(String(body.timeMin), String(body.timeMax)) });
    case '/api/canvas-ical':
      await wait(400);
      return json({ assignments: canvasAssignments() });
    case '/api/chat': {
      const messages = (body.messages ?? []) as { role: string; content: unknown }[];
      const last = messages[messages.length - 1];
      const text = typeof last?.content === 'string' ? last.content
        : Array.isArray(last?.content) ? String((last.content as { text?: string }[])[0]?.text ?? '') : '';
      const prompt = String(body.systemPrompt ?? '');
      await wait(1100 + Math.random() * 900);
      const reply = prompt.includes('Reply ONLY with JSON') ? dashboardReply(prompt, text) : chatReply(prompt, text);
      return json({ content: [{ type: 'text', text: reply }], stop_reason: 'end_turn' });
    }
    case '/api/memory':
      return json({ memories: [] });
    case '/api/import-schedule':
      return json({ items: [] });
    case '/api/delete-account':
      return json({ error: 'Disabled in demo mode' }, 403);
    default:
      return json({ ok: true });
  }
}

export function installMockApi() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init);
    let body: Record<string, unknown> = {};
    try { body = init?.body ? JSON.parse(String(init.body)) : {}; } catch { /* not JSON */ }
    return handle(url.pathname, body);
  };
}
