/**
 * The screenshots the README and the docs site show, against the live demo.
 *
 * Separate from `shoot-playground.mjs`, which exists for review rounds and
 * shoots whatever the current round argues about. This one shoots the fixed
 * set that ships: one image per distinct surface, at the width the studio's
 * marketplace checklist asks for, always the same names.
 *
 * The studio's rule says light mode and dark mode of every control panel
 * screen. This addon has no control panel screen of its own, and the surface
 * it does have is somebody else's public page, whose colours are theirs. So:
 * one mode, and the page it runs on is the demo everybody can open.
 *
 *   SIE_USER=… SIE_PASS=… node tests/browser/shoot-screenshots.mjs
 *
 * Credentials come from the environment, never from a file. The vault has
 * them under `statamic-addon-familie-demo-control-panel`.
 */
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'screenshots');
const BASE = process.env.SIE_BASE || 'https://demo.adriangoldner.dev';
const PAGE = BASE + '/inline-edit';

// 1440 wide, because the checklist asks for at least that much content width
// and a 1280 shot of a centred measure loses the margin the toolbar lives in.
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

if (!process.env.SIE_USER || !process.env.SIE_PASS) {
    console.error('SIE_USER and SIE_PASS are required.');
    process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
});

async function signIn(context) {
    const page = await context.newPage();
    await page.goto(BASE + '/cp/auth/login', { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', process.env.SIE_USER);
    await page.fill('input[name="password"]', process.env.SIE_PASS);
    await page.press('input[name="password"]', 'Enter');
    await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 30000 });
    await page.close();
}

/** The demo's cookie banner belongs to the page, not to this addon. */
async function dismissCookies(page) {
    const button = page.locator('button:has-text("Alle akzeptieren")').first();

    if (await button.isVisible().catch(() => false)) {
        await button.click();
        await page.waitForTimeout(400);
    }
}

async function shoot(page, name) {
    await page.screenshot({ path: resolve(OUT, name + '.png') });
    console.log('  ' + name);
}

// ---- desktop --------------------------------------------------------------

const desktop = await browser.newContext({ viewport: DESKTOP });
await signIn(desktop);

const page = await desktop.newPage();
await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
await dismissCookies(page);
await page.waitForSelector('.sie-launch', { timeout: 15000 });

await page.locator('.sie-launch').click();
await page.waitForTimeout(400);
await shoot(page, '01-editing-on');

/** Scroll a field to the middle of the viewport, clear of the bar below. */
async function middle(page, selector) {
    await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
}

// Example 2: markdown in a rich editor. A selected word brings up the toolbar.
await middle(page, '[data-sie-field="body"]');
await page.locator('[data-sie-field="body"]').first().dblclick();
await page.waitForSelector('.sie-rich', { timeout: 20000 });
await page.waitForTimeout(700);
await page.locator('.sie-rich p').first().dblclick({ position: { x: 120, y: 10 } });
await page.waitForTimeout(500);
await shoot(page, '02-inline-editor');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Example 3: a small control (the dropdown) opens next to the word.
await middle(page, '[data-sie-field="availability"]');
await page.locator('[data-sie-field="availability"]').first().dblclick();
await page.waitForTimeout(500);
await shoot(page, '03-control');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// Example 10: everything the page cannot edit itself opens as one control
// panel field in an overlay. The tags are a field of that kind. (The article
// of example 9 is a Bard edited in the page, so it never opens this frame.)
await middle(page, '[data-sie-field="tags"]');
await page.locator('[data-sie-field="tags"]').first().dblclick();

const frame = page.frameLocator('.sie-frame');

await frame.locator('.sie-cp-field').waitFor({ timeout: 20000 });

// The demo runs the suite without a licence and says so in a toast, which
// the control panel raises inside this frame like on any other CP screen.
// It is the demo's notice, not this addon's, so it does not belong in a
// picture of this addon. It can arrive after the form, hence the retries.
const understood = frame.locator('button:has-text("Verstanden"), button:has-text("Got it")').first();

await understood.waitFor({ timeout: 8000 }).catch(() => {});

if (await understood.isVisible().catch(() => false)) {
    await understood.click().catch(() => {});
    await page.waitForTimeout(800);
}

// The card is sized from a height the form reports once it has mounted, so
// the picture has to wait for the second size, not the first.
await page.waitForTimeout(1500);
await shoot(page, '04-control-panel');
await desktop.close();

// ---- phone ----------------------------------------------------------------

const mobile = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
await signIn(mobile);

const small = await mobile.newPage();
await small.goto(PAGE, { waitUntil: 'domcontentloaded' });
await dismissCookies(small);
await small.waitForSelector('.sie-launch', { timeout: 15000 });

// Clicked at the measured centre rather than through the locator: the button
// is a full-radius pill, and Playwright's hit test lands on the element under
// its rounded corners.
const centre = await small.evaluate(() => {
    const box = document.querySelector('.sie-launch').getBoundingClientRect();

    return [box.left + box.width / 2, box.top + box.height / 2];
});

await small.mouse.click(centre[0], centre[1]);
await small.waitForTimeout(600);

// A single tap opens on a touchscreen; a double-click is a mouse gesture and
// on a phone it is zoom.
// Scrolled so the editor and its toolbar sit well clear of the bar.
await small
    .locator('[data-sie-field="body"]')
    .first()
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
await small.evaluate(() => window.scrollBy(0, -200));
await small.waitForTimeout(300);
await small
    .locator('[data-sie-field="body"]')
    .first()
    .dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
await small.waitForSelector('.sie-rich', { timeout: 20000 });
await small.waitForTimeout(700);
await small.locator('.sie-rich p').first().dblclick({ position: { x: 90, y: 10 } });
await small.waitForTimeout(600);
await shoot(small, '05-phone');

await mobile.close();
await browser.close();
