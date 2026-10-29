import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';

// The blog is static HTML made from content/blog/*.md (config/blog.ts), not the
// React app: search engines must get the post text without running JavaScript.
const slugs = readdirSync('content/blog').filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));

test('the blog index lists every post, as server-rendered HTML', async ({ request, page }) => {
  const res = await request.get('/blog');
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).not.toContain('id="root"');
  expect(html).toContain('<link rel="canonical" href="https://somastudy.app/blog" />');
  for (const slug of slugs) expect(html).toContain(`href="/blog/${slug}"`);

  await page.goto('/blog');
  await page.getByRole('link', { name: /weighted grade/i }).click();
  await expect(page).toHaveURL(/\/blog\/how-to-calculate-weighted-grade$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to calculate your weighted grade (with examples)');
});

test('a post has its title, description, canonical and structured data in the HTML', async ({ request }) => {
  const html = await (await request.get('/blog/how-to-calculate-weighted-grade')).text();
  expect(html).toContain('<title>How to calculate your weighted grade (with examples) | Soma</title>');
  expect(html).toMatch(/<meta name="description" content="Work out your real course grade/);
  expect(html).toContain('<link rel="canonical" href="https://somastudy.app/blog/how-to-calculate-weighted-grade" />');
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  expect(ld.map(d => d['@type'])).toEqual(['BlogPosting', 'BreadcrumbList']);
  expect(ld[0].datePublished).toBe('2026-10-28');
  // Markdown became HTML: a table, and headings with ids to link to.
  expect(html).toContain('<table>');
  expect(html).toContain('<h2 id="courses-graded-by-points">');
  // Analytics are added to production builds only.
  expect(html).not.toContain('_vercel/insights');
});

test('RSS and the blog sitemap list every post; unknown posts are a 404', async ({ request }) => {
  const rss = await (await request.get('/blog/rss.xml')).text();
  const sitemap = await (await request.get('/blog/sitemap.xml')).text();
  for (const slug of slugs) {
    expect(rss).toContain(`<link>https://somastudy.app/blog/${slug}</link>`);
    expect(sitemap).toContain(`<loc>https://somastudy.app/blog/${slug}</loc>`);
  }
  expect((await request.get('/blog/no-such-post')).status()).toBe(404);
});
