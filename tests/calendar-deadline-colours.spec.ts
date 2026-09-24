import { test, expect, type Page } from '@playwright/test';

/**
 * Deadlines in the all-day row.
 *
 * They were every one of them the same solid red, so a week with four due
 * dates read as an alarm and said nothing about which course each belonged
 * to. They carry their course's colour now, as a tint rather than a fill.
 */

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'student@example.com', aud: 'authenticated', role: 'authenticated', created_at: '2025-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const day = (n: number) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };

async function openWeek(page: Page) {
  await page.addInitScript(a => {
    localStorage.setItem('sb-soma-regression-auth-token', JSON.stringify({ access_token:'t', refresh_token:'r', token_type:'bearer', expires_at: Math.floor(Date.now()/1000)+3600, expires_in:3600, user:a }));
  }, account);
  await page.route('https://soma-regression.supabase.co/**', route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').pop()!;
    if (url.pathname.includes('/auth/v1/')) return route.fulfill({ json: account });
    if (table === 'settings') return route.fulfill({ json: { data: { onboardingCompleted: true, theme: 'light' } } });
    if (table === 'subjects') return route.fulfill({ json: [
      { id:'cs', user_id:account.id, name:'CS 61A', color:'#66bb6a', archived:false },
      { id:'math', user_id:account.id, name:'MATH 53', color:'#42a5f5', archived:false },
    ]});
    if (table === 'todos') return route.fulfill({ json: [
      { id:'t1', user_id:account.id, text:'Lab 3: Lists', subject_id:'cs', status:'nothing', date:day(0), due_date:day(0), kind:'lab' },
      { id:'t2', user_id:account.id, text:'Quiz Prep', subject_id:'math', status:'nothing', date:day(0), due_date:day(0), kind:'homework' },
      { id:'t3', user_id:account.id, text:'Unfiled deadline', status:'nothing', date:day(0), due_date:day(0), kind:'homework' },
    ]});
    const single = req.headers().accept?.includes('vnd.pgrst.object');
    return route.fulfill({ json: single ? null : [] });
  });
  await page.route('**/api/stripe', r => r.fulfill({ json: { status: 'active' } }));
  await page.route('**/api/google-calendar-events', r => r.fulfill({ json: { events: [], incomplete: false } }));
  await page.route('**/api/google-calendar-connections', r => r.fulfill({ json: { connections: [] } }));
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
}

/** The chip itself. The wrapper around it and the panel inside it share the
 *  same class prefix, and the wrapper carries none of the colour. */
const chip = (page: Page, name: string) =>
  page.locator('span[class*="weekViewAllDayChip"]').filter({ hasText: name }).first();

test('a deadline takes the colour of the course it belongs to', async ({ page }) => {
  await openWeek(page);
  await expect(chip(page, 'Lab 3: Lists')).toBeVisible();

  const cs = await chip(page, 'Lab 3: Lists').evaluate(el => getComputedStyle(el).getPropertyValue('--chip').trim());
  const math = await chip(page, 'Quiz Prep').evaluate(el => getComputedStyle(el).getPropertyValue('--chip').trim());
  expect(cs).toBe('#66bb6a');
  expect(math).toBe('#42a5f5');
  expect(cs).not.toBe(math);
});

test('a deadline with no course keeps the due-date red', async ({ page }) => {
  await openWeek(page);
  const loose = await chip(page, 'Unfiled deadline').evaluate(el => getComputedStyle(el).getPropertyValue('--chip').trim());
  expect(loose).toContain('oklch');
});

test('deadlines are tinted, not filled', async ({ page }) => {
  await openWeek(page);
  // A solid fill would be the course colour at full strength; a tint is
  // mostly transparent, which is what stopped the row reading as an alarm.
  const bg = await chip(page, 'Lab 3: Lists').evaluate(el => getComputedStyle(el).backgroundColor);
  // Reported as either "rgba(r, g, b, a)" or "color(srgb r g b / a)".
  const alpha = Number(bg.match(/\/\s*([\d.]+)\s*\)/)?.[1] ?? bg.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/)?.[1] ?? '1');
  expect(alpha, `expected a tint, got ${bg}`).toBeLessThan(0.5);
});
