import { chromium } from 'playwright-core';

const BASE = process.env.SIE_URL;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({
    viewport: { width: 1280, height: 950 },
    ...(process.env.SIE_BASIC_USER
        ? { httpCredentials: { username: process.env.SIE_BASIC_USER, password: process.env.SIE_BASIC_PASS } }
        : {}),
});

await page.goto(BASE + '/cp/auth/login', { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"], input[type="email"]', process.env.SIE_USER);
await page.fill('input[type="password"]', process.env.SIE_PASS);
await page.press('input[type="password"]', 'Enter');
await page.waitForURL((u) => !u.pathname.includes('/auth/login'), { timeout: 30000 });

await page.goto(BASE + process.argv[2], { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const field = page.locator('[data-sie-field="content"]');

// What the page really renders, and what a probe of the same kind reports.
const before = await field.evaluate((el) => {
    const real = el.querySelector('h1');
    const probe = document.createElement('h1');
    probe.textContent = 'x';
    probe.style.setProperty('position', 'absolute', 'important');
    probe.style.setProperty('visibility', 'hidden', 'important');
    el.appendChild(probe);
    const measured = getComputedStyle(probe).fontSize + ' / ' + getComputedStyle(probe).fontFamily;
    probe.remove();

    return {
        real: real ? getComputedStyle(real).fontSize + ' / ' + getComputedStyle(real).fontFamily : 'kein h1 im Feld',
        probe: measured,
        firstChild: el.firstElementChild ? el.firstElementChild.tagName : '-',
    };
});

console.log('Seite  ' + JSON.stringify(before, null, 1));

if (! await page.evaluate(() => document.documentElement.classList.contains('sie-editing'))) {
    await page.locator('.sie-launch').click();
}
await page.waitForTimeout(400);
await field.scrollIntoViewIfNeeded();
await field.dblclick();
await page.waitForTimeout(4500);

const inner = page.frameLocator('.sie-inplace-frame');

const after = await inner.locator('.ProseMirror').first().evaluate((el) => {
    const h1 = el.querySelector('h1');
    const style = document.querySelector('style[data-v-app], style');
    const blobs = Array.from(document.querySelectorAll('style')).map((s) => s.textContent.length);

    return {
        h1: h1 ? getComputedStyle(h1).fontSize + ' / ' + getComputedStyle(h1).fontFamily : 'kein h1 im Editor',
        firstChild: el.firstElementChild ? el.firstElementChild.tagName : '-',
        styleTags: blobs,
        hasH1Rule: Array.from(document.querySelectorAll('style')).some((s) => s.textContent.includes('.ProseMirror h1')),
    };
});

console.log('Editor ' + JSON.stringify(after, null, 1));

await browser.close();
