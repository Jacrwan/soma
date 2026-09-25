import { test, expect, type Page } from '@playwright/test';

// /privacy and /terms exist twice: vercel.json serves the static HTML files on
// a direct visit, while links inside the app render LegalPage.tsx. They drifted
// apart once (prices, trial length, Google scopes), so their text must match.
async function legalText(page: Page, url: string) {
  await page.goto(url);
  await page.locator('h2').first().waitFor();
  return page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, p, li, th, td')]
      .map(el => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
      .filter(Boolean));
}

for (const name of ['privacy', 'terms']) {
  test(`the static and in-app ${name} pages say the same thing`, async ({ page }) => {
    const inApp = await legalText(page, `/${name}`);
    const staticPage = await legalText(page, `/${name}.html`);
    expect(staticPage).toEqual(inApp);
  });
}

test('no legal page claims Google Drive, Docs or Slides access Soma never requests', async ({ page }) => {
  for (const path of ['/privacy', '/terms', '/data-deletion', '/ai-disclaimer', '/privacy.html', '/terms.html']) {
    await page.goto(path);
    await page.locator('h2').first().waitFor();
    await expect(page.locator('body')).not.toContainText(/Google Drive|Google Docs|Google Slides|drive\.file|drive\.readonly/);
  }
});
