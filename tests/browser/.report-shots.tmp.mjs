/**
 * The pictures for the report: the same piece of page, read and being edited.
 *
 * Both are taken at the same scroll position and the same viewport, because
 * the claim is that they look the same. Two shots framed differently would
 * prove nothing either way.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SIE_URL;
const OUT = process.argv[2];
const PATHNAME = process.argv[3];
const FIELD = process.env.SIE_FIELD || 'content';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
    ...(process.env.SIE_BASIC_USER
        ? { httpCredentials: { username: process.env.SIE_BASIC_USER, password: process.env.SIE_BASIC_PASS } }
        : {}),
});

await page.goto(BASE + '/cp/auth/login', { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"], input[type="email"]', process.env.SIE_USER);
await page.fill('input[type="password"]', process.env.SIE_PASS);
await page.press('input[type="password"]', 'Enter');
await page.waitForURL((u) => !u.pathname.includes('/auth/login'), { timeout: 30000 });

await page.goto(BASE + PATHNAME, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

for (const label of ['Alle akzeptieren', 'Accept all']) {
    const b = page.getByRole('button', { name: label });
    if (await b.count()) { await b.first().click(); break; }
}

const field = page.locator('[data-sie-field="' + FIELD + '"]');

// The top of the field, a little below the viewport top so the page's own
// frame is visible around it.
const parked = await field.evaluate((el) => Math.max(0, el.getBoundingClientRect().top + window.scrollY - 120));

await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), parked);
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '/gelesen.png' });

if (! await page.evaluate(() => document.documentElement.classList.contains('sie-editing'))) {
    await page.locator('.sie-launch').click();
}
await page.waitForTimeout(500);
await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), parked);
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/markiert.png' });

await field.dblclick();
await page.waitForTimeout(4000);
await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), parked);
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '/offen.png' });

// And the strip at the end of the field, where the controls live.
await page.evaluate(() => {
    const f = document.querySelector('.sie-inplace-frame');
    if (!f) return;
    const box = f.getBoundingClientRect();
    window.scrollTo({ top: box.bottom + window.scrollY - window.innerHeight + 60, behavior: 'instant' });
});
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '/streifen.png' });

console.log('done → ' + OUT);

await browser.close();
