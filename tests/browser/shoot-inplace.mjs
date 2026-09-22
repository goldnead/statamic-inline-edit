/**
 * Photographs the in-place Bard on a real page, and measures it.
 *
 * shoot-playground.mjs photographs the four states of the demo page. This one
 * is for the mode that has to match a page it did not build: it signs in,
 * opens the field, and prints the numbers the screenshots cannot prove —
 * where the frame sits, what the editor is set in, and where the first line
 * of the paragraph breaks in both states. Those two numbers are the whole
 * promise of this mode, and a screenshot of them looks identical either way.
 *
 *   SIE_URL=https://example.test \
 *   SIE_USER=… SIE_PASS=… \
 *   [SIE_BASIC_USER=… SIE_BASIC_PASS=…] \
 *   [SIE_FIELD=content] \
 *   node tests/browser/shoot-inplace.mjs <out-dir> [path]
 *
 * The passwords come from the environment on purpose. They are logins, and a
 * login does not belong in a file in a repository that goes to GitHub.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SIE_URL || 'http://127.0.0.1:8137';
const USER = process.env.SIE_USER;
const PASS = process.env.SIE_PASS;
const OUT = process.argv[2] || '.';
const PATHNAME = process.argv[3] || '/inline-edit';
const FIELD = process.env.SIE_FIELD || 'inhalt';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
const page = await browser.newPage({
    viewport: { width: 1280, height: 950 },
    ...(process.env.SIE_BASIC_USER
        ? { httpCredentials: { username: process.env.SIE_BASIC_USER, password: process.env.SIE_BASIC_PASS } }
        : {}),
});

page.on('console', (m) => { if (m.type() === 'error') console.log('  console error: ' + m.text()); });
page.on('pageerror', (e) => console.log('  page error: ' + e.message));

await page.goto(BASE + '/cp/auth/login', { waitUntil: 'domcontentloaded' });
await page.fill('input[type="email"], input[name="email"]', USER);
await page.fill('input[type="password"], input[name="password"]', PASS);
await page.press('input[type="password"], input[name="password"]', 'Enter');
await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 30000 });
console.log('signed in, landed on ' + new URL(page.url()).pathname);

// `SIE_VIA` reaches the page the way a reader does, through a link on another
// page. On a site that draws itself that is not a request: the response is
// JSON, nothing is injected into it, and the markers arrive after the script
// did. It is the path where this used to be silently dead, so it is the path
// worth photographing.
if (process.env.SIE_VIA) {
    await page.goto(BASE + process.env.SIE_VIA, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // The named target if that page links to it, otherwise whatever it does
    // link to under the same prefix. Which article is reached matters less
    // than that it was reached without a request.
    let link = page.locator('a[href="' + PATHNAME + '"]').first();

    if (await link.count() === 0) {
        link = page.locator('a[href^="' + PATHNAME.replace(/\/[^/]*$/, '/') + '"]').first();
        console.log('via ' + process.env.SIE_VIA + ': the target is not linked there, taking the first one that is');
    }

    await link.scrollIntoViewIfNeeded();
    await link.click();
    await page.waitForTimeout(2500);

    console.log('landed on ' + new URL(page.url()).pathname + ' (no reload in between)');
} else {
    await page.goto(BASE + PATHNAME, { waitUntil: 'domcontentloaded' });
}

await page.waitForTimeout(1200);

// The playground's own consent banner sits over the bottom half of the page.
for (const label of ['Alle akzeptieren', 'Accept all']) {
    const button = page.getByRole('button', { name: label });

    if (await button.count()) { await button.first().click(); break; }
}
await page.waitForTimeout(600);

const field = page.locator('[data-sie-field="' + FIELD + '"]');
console.log('markers: ' + (await page.locator('[data-sie-field]').count()));
console.log('config blocks: ' + (await page.locator('#statamic-inline-edit-config').count()));
console.log('editor script: ' + (await page.locator('script[src*="inline-edit.js"]').count()));
console.log('mode on ' + FIELD + ': ' + await field.getAttribute('data-sie-mode'));
console.log('field url: ' + await field.getAttribute('data-sie-field-url'));

await page.screenshot({ path: OUT + '/1-gelesen.png', fullPage: true });

if (!(await page.evaluate(() => document.documentElement.classList.contains('sie-editing')))) {
    await page.locator('.sie-launch').click();
}
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '/2-bearbeiten-an.png', fullPage: true });

const lineOf = (locator) => locator.evaluate((el) => {
    const p = el.matches('p') ? el : el.querySelector('p');
    if (!p) return null;
    const range = document.createRange();
    range.selectNodeContents(p);
    const rects = Array.from(range.getClientRects());
    return rects.length ? { lines: rects.length, first: Math.round(rects[0].width), text: p.textContent.slice(0, 40) } : null;
});

console.log('reading line: ' + JSON.stringify(await lineOf(field)));

await field.scrollIntoViewIfNeeded();
await field.dblclick();
await page.waitForTimeout(3500);

const frame = page.locator('.sie-inplace-frame');
console.log('frame: ' + (await frame.count()));

if (await frame.count()) {
    const box = await frame.boundingBox();
    console.log('frame box: ' + JSON.stringify(box));
    await frame.scrollIntoViewIfNeeded();
}

await page.waitForTimeout(800);
await page.screenshot({ path: OUT + '/3-offen.png', fullPage: true });
await page.screenshot({ path: OUT + '/4-offen-viewport.png' });

// The strip with the toolbar and the buttons sits at the bottom of the frame,
// which on a long article is a long way down.
if (await frame.count()) {
    await page.evaluate(() => {
        const f = document.querySelector('.sie-inplace-frame');
        const box = f.getBoundingClientRect();
        window.scrollTo({ top: box.bottom + window.scrollY - window.innerHeight + 80, behavior: 'instant' });
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + '/5-streifen.png' });
}

// What the editor is actually set in, read from inside the frame.
try {
    const inner = page.frameLocator('.sie-inplace-frame');
    const has = await inner.locator('.ProseMirror').count();
    console.log('ProseMirror in frame: ' + has);

    if (has) {
        const style = await inner.locator('.ProseMirror').first().evaluate((el) => {
            const s = getComputedStyle(el);
            const p = el.querySelector('p');
            const h = el.querySelector('h2, h3');

            return {
                root: s.fontFamily + ' / ' + s.fontSize,
                p: p ? getComputedStyle(p).fontFamily + ' / ' + getComputedStyle(p).fontSize : null,
                h: h ? getComputedStyle(h).fontFamily + ' / ' + getComputedStyle(h).fontSize : null,
                width: Math.round(el.getBoundingClientRect().width),
            };
        });
        console.log('typography: ' + JSON.stringify(style));
    }

    console.log('styles arrived: ' + (await inner.locator('style').count()) + ' style tags');
    console.log('editing line: ' + JSON.stringify(await lineOf(inner.locator('.ProseMirror').first())));
} catch (e) {
    console.log('frame read failed: ' + e.message);
}

await browser.close();
console.log('done → ' + OUT);
