/**
 * Browser tests for inline-edit.js.
 *
 * The PHP suite proves the server: who may write, to which field, with what
 * validation. It cannot reach any of this — double-click to edit, the dirty
 * count, Escape reverting, what the request body actually looks like, and the
 * fact that the bar survives a host stylesheet that styles every button on the
 * page. This runs the shipped file against a fixture page, no Statamic and no
 * PHP, which is cheap enough to run on every push.
 *
 *   node tests/browser/run.mjs [--shot <path>]
 */
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + resolve(here, 'fixture.html');
const EXECUTABLE = process.env.CHROME_PATH || '/usr/bin/google-chrome';

const shotIndex = process.argv.indexOf('--shot');
const SHOT = shotIndex > -1 ? process.argv[shotIndex + 1] : null;

let failures = 0;

function check(name, condition, detail = '') {
    if (condition) {
        console.log('  ok   ' + name);
        return;
    }
    failures++;
    console.log('  FAIL ' + name + (detail ? '  — ' + detail : ''));
}

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
const page = await context.newPage();

/**
 * Every save in this file is answered here rather than reaching a server. The
 * request is what we are checking; the reply is a stub, and each test decides
 * what it says by setting `reply`.
 */
let lastRequest = null;
let reply = { status: 200, body: { saved: [{ id: 'entry-1', stamp: '1700009999' }] } };

await context.route('**/statamic-inline-edit/save', async (route) => {
    lastRequest = {
        headers: route.request().headers(),
        body: JSON.parse(route.request().postData() || '{}'),
    };

    await route.fulfill({
        status: reply.status,
        contentType: 'application/json',
        body: JSON.stringify(reply.body),
    });
});

await page.goto(PAGE);

const bar = page.locator('.sie-bar');
const toggle = page.locator('.sie-toggle');
const save = page.locator('.sie-save');
const discard = page.locator('.sie-discard');
const count = page.locator('.sie-count');
const status = page.locator('.sie-status');
const title = page.locator('[data-sie-field="hero_title"]');
const intro = page.locator('[data-sie-field="intro"]');
const second = page.locator('[data-sie-field="title"]');
const empty = page.locator('[data-sie-field="subtitle"]');

console.log('\nthe bar');

check('appears', await bar.isVisible());
check('starts with editing off', (await toggle.textContent()) === 'Edit page');
check('has nothing to save yet', await save.isDisabled());

const barBox = await bar.boundingBox();
check(
    'is not stretched by the host stylesheet',
    barBox.width < 600,
    'width ' + Math.round(barBox.width) + 'px, the page sets button { width: 100% }'
);
check(
    'keeps its own colours',
    (await toggle.evaluate((el) => getComputedStyle(el).backgroundColor)) !== 'rgb(255, 105, 180)',
    'hotpink leaked in from the host stylesheet'
);

console.log('\nediting off');

check(
    'no field is outlined',
    (await title.evaluate((el) => getComputedStyle(el).outlineStyle)) === 'none'
);
check('nothing is contenteditable', (await page.locator('[contenteditable]').count()) === 0);

console.log('\nediting on');

await toggle.click();

check('the button says so', (await toggle.textContent()) === 'Editing');
check(
    'editable fields are outlined',
    (await title.evaluate((el) => getComputedStyle(el).outlineStyle)) === 'dashed'
);
check(
    'the empty field says it is empty',
    (await empty.evaluate((el) => getComputedStyle(el, '::before').content)).includes('Empty')
);
check('the hint is shown', (await count.textContent()).includes('Double-click'));

await title.dblclick();

check('a double-click opens the field', await title.evaluate((el) => el.isContentEditable));

await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.type('Zuerst die Technik');
await page.locator('body').click();

check('the change is counted', (await count.textContent()) === '1 unsaved');
check('saving is now possible', await save.isEnabled());

console.log('\nescape reverts');

await intro.dblclick();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.type('Wrong');
await page.keyboard.press('Escape');

check('the old text is back', (await intro.innerText()).startsWith('Im Chor'));
check('and it is no longer counted', (await count.textContent()) === '1 unsaved');

console.log('\nenter behaves by fieldtype');

await intro.dblclick();
await page.keyboard.press('End');
await page.keyboard.press('Enter');
check('a textarea takes a line break', await intro.evaluate((el) => el.isContentEditable));
await page.keyboard.press('Escape');

await second.dblclick();
await page.keyboard.press('Enter');
check('a text field leaves instead', !(await second.evaluate((el) => el.isContentEditable)));

console.log('\nsaving');

// A second entry, so the request has to group by entry rather than send a flat
// list of fields. Getting this wrong only shows up on a page with two.
await second.dblclick();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.type('Zweiter Eintrag, geaendert');
await page.locator('body').click();

check('both changes are counted', (await count.textContent()) === '2 unsaved');

if (SHOT) {
    await page.screenshot({ path: SHOT, fullPage: true });
    console.log('  --   screenshot written to ' + SHOT);
}

reply = {
    status: 200,
    body: {
        saved: [
            { id: 'entry-1', stamp: '1700009999' },
            { id: 'entry-2', stamp: '1700009998' },
        ],
    },
};

await save.click();
await page.waitForFunction(() => document.querySelector('.sie-status').textContent !== '');

check('the csrf token is sent', lastRequest.headers['x-csrf-token'] === 'test-csrf-token');
check('two entries are sent', lastRequest.body.changes.length === 2);

const first = lastRequest.body.changes.find((c) => c.id === 'entry-1');

check('grouped by entry', Object.keys(first.fields).length === 1, JSON.stringify(first.fields));
check('the new text is sent', first.fields.hero_title === 'Zuerst die Technik');
check('the stamp the page was built with is sent', first.stamp === '1700000000');
check('untouched fields are not sent', first.fields.intro === undefined);

check('it says it saved', (await status.textContent()) === 'Saved');
check('nothing is pending any more', (await save.isDisabled()) && (await discard.isDisabled()));
check(
    'the marker carries the new stamp',
    (await title.getAttribute('data-sie-stamp')) === '1700009999',
    'otherwise the next save of this page conflicts with itself'
);

console.log('\na refused save');

await title.dblclick();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.type('Something else');
await page.locator('body').click();

reply = { status: 409, body: { message: 'Someone else changed this entry.' } };

await save.click();
await page.waitForFunction(() => document.querySelector('.sie-status').textContent.includes('Someone'));

check('the reason is shown', (await status.textContent()).includes('Someone else changed'));
check('the change is still pending', await save.isEnabled());
check('and the typing is not thrown away', (await title.innerText()) === 'Something else');

console.log('\ndiscard');

await discard.click();

check('the page is back to the saved text', (await title.innerText()) === 'Zuerst die Technik');
check('and nothing is pending', await save.isDisabled());

await browser.close();

console.log('');

if (failures) {
    console.log(failures + ' failed');
    process.exit(1);
}

console.log('all passed');
