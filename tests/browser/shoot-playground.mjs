/**
 * Screenshots of the addon on a real Statamic page, for eyes rather than for CI.
 *
 * tests/browser/run.mjs proves the behaviour against a fixture, which is what
 * belongs in a pipeline. This one signs in to a running Statamic install and
 * photographs the demo page in four states, so the look can be judged by
 * someone who is not the person who built it.
 *
 *   SIE_URL=http://127.0.0.1:8137 \
 *   SIE_USER=… SIE_PASS=… \
 *   node tests/browser/shoot-playground.mjs <output-dir>
 *
 * The password comes from the environment on purpose. It is a login, and a
 * login does not belong in a file in a repository that goes to GitHub.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SIE_URL || 'http://127.0.0.1:8137';
const USER = process.env.SIE_USER;
const PASS = process.env.SIE_PASS;
const OUT = process.argv[2] || '.';
const EXECUTABLE = process.env.CHROME_PATH || '/usr/bin/google-chrome';

if (!USER || !PASS) {
    console.error('SIE_USER and SIE_PASS are required.');
    process.exit(2);
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

async function shot(name) {
    await page.screenshot({ path: OUT + '/' + name + '.png' });
    console.log('  ' + name + '.png');
}

// Signed out first: the whole promise is that a visitor's page is untouched.
await page.goto(BASE + '/inline-edit', { waitUntil: 'domcontentloaded' });
const guestMarkers = await page.locator('[data-sie-field]').count();
const guestScript = await page.locator('#statamic-inline-edit-config').count();
console.log('signed out: ' + guestMarkers + ' markers, ' + guestScript + ' config blocks');
await shot('1-visitor');

await page.goto(BASE + '/cp/auth/login', { waitUntil: 'domcontentloaded' });
await page.fill('input[type="email"], input[name="email"]', USER);
await page.fill('input[type="password"], input[name="password"]', PASS);
await page.press('input[type="password"], input[name="password"]', 'Enter');
// Not /\/cp/: the login page's own URL matches that, so the wait would be
// satisfied before the form was even submitted and the next navigation would
// race it. Wait for the login page to be left behind instead.
await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 30000 });
await page.waitForLoadState('domcontentloaded');
console.log('signed in as ' + USER + ', landed on ' + new URL(page.url()).pathname);

await page.goto(BASE + '/inline-edit', { waitUntil: 'domcontentloaded' });

const markers = await page.locator('[data-sie-field]').count();
const cacheHeader = (await page.request.get(BASE + '/inline-edit')).headers()['x-statamic-uncacheable'];
console.log('signed in: ' + markers + ' markers, X-Statamic-Uncacheable: ' + cacheHeader);

await shot('2-editor-idle');

await page.locator('.sie-toggle').click();
await shot('3-editing-on');

await page.locator('[data-sie-field="title"]').dblclick();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.type('Zuerst die Technik');
await page.locator('.ie-demo .note').click();
await shot('4-one-change');

await page.locator('.sie-save').click();
await page.waitForFunction(() => document.querySelector('.sie-status').textContent !== '', { timeout: 15000 });
const status = await page.locator('.sie-status').textContent();
console.log('save said: ' + status);
await shot('5-saved');

// Put it back, so the demo is not left carrying a test edit.
await page.locator('[data-sie-field="title"]').dblclick();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.type('Zuerst die Stimme');
await page.locator('.ie-demo .note').click();
await page.locator('.sie-save').click();
await page.waitForFunction(() => document.querySelector('.sie-status').textContent === 'Gespeichert' || document.querySelector('.sie-status').textContent === 'Saved', { timeout: 15000 });
console.log('restored the original title');

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'domcontentloaded' });

// Edit mode survives a reload through sessionStorage, so clicking the toggle
// here would switch it off and photograph the wrong state. Wait for it to
// restore itself instead, and only click if it did not.
await page.waitForSelector('.sie-bar');
if (!(await page.locator('.sie-toggle').evaluate((el) => el.classList.contains('sie-on')))) {
    await page.locator('.sie-toggle').click();
}
await shot('6-phone');

// The state the critique could not judge from a still: a field opened by a
// single touch tap, with a change pending, at phone width. This is the whole
// point of the touch path, so it gets its own picture.
const field = page.locator('[data-sie-field="title"]');
await field.dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.type('Getippt auf dem Telefon');
console.log('phone: field open = ' + (await field.evaluate((el) => el.isContentEditable)));
await shot('7-phone-editing');

await page.keyboard.press('Escape');

// The three ways version 2 added, on the desktop. Opened and photographed,
// never saved: a save of any of them reloads the page on purpose, and this
// script must not leave the demo carrying a test edit.
await page.setViewportSize({ width: 1280, height: 900 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.sie-bar');
if (!(await page.locator('.sie-toggle').evaluate((el) => el.classList.contains('sie-on')))) {
    await page.locator('.sie-toggle').click();
}

await page.locator('[data-sie-field="promoted"]').dblclick();
await shot('8-toggle');
await page.keyboard.press('Escape');

await page.locator('[data-sie-field="belegung"]').dblclick();
await shot('9-select');
await page.keyboard.press('Escape');

await page.locator('[data-sie-field="body"]').dblclick();
await shot('10-markdown-source');
await page.keyboard.press('Escape');

await page.locator('[data-sie-field="schlagworte"]').dblclick();
await page.waitForTimeout(3000);
console.log('cp overlay open = ' + (await page.locator('.sie-panel').isVisible()));
await shot('11-control-panel');

// The two v2 surfaces that get tight on a phone, and for which the last
// review had no picture at all.
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + '/inline-edit', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.sie-bar');
if (!(await page.locator('.sie-toggle').evaluate((el) => el.classList.contains('sie-on')))) {
    await page.locator('.sie-toggle').click();
}

await page.locator('[data-sie-field="body"]').dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
await page.waitForTimeout(500);
await shot('12-phone-markdown');
await page.keyboard.press('Escape');

await page.locator('[data-sie-field="schlagworte"]').dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
await page.waitForTimeout(3000);
await shot('13-phone-control-panel');

await browser.close();
