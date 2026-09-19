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
check(
    'shows only the toggle while editing is off',
    !(await save.isVisible()) && !(await discard.isVisible()),
    'dead buttons on a live page read as something broken'
);

const barBox = await bar.boundingBox();
const viewport = page.viewportSize();

check(
    'is docked across the full width',
    Math.abs(barBox.width - viewport.width) < 2 && Math.abs(barBox.y + barBox.height - viewport.height) < 2,
    'box ' + JSON.stringify(barBox)
);
check(
    'keeps its own colours',
    (await toggle.evaluate((el) => getComputedStyle(el).backgroundColor)) !== 'rgb(255, 105, 180)',
    'hotpink leaked in from the host stylesheet'
);
check(
    'its buttons keep their own size',
    (await toggle.boundingBox()).width < 240,
    'the page sets a hostile global button rule'
);
check(
    'its buttons are big enough for a thumb',
    (await toggle.boundingBox()).height >= 44,
    Math.round((await toggle.boundingBox()).height) + 'px'
);

// The bar is fixed, so without a spacer it lies on top of whatever the page
// put at the bottom. The last paragraph must still be reachable.
check(
    'it reserves its own space at the end of the document',
    Math.abs((await page.locator('.sie-spacer').boundingBox()).height - barBox.height) < 2
);

console.log('\nediting off');

check(
    'no field is outlined',
    (await title.evaluate((el) => getComputedStyle(el).outlineStyle)) === 'none'
);
check('nothing is contenteditable', (await page.locator('[contenteditable]').count()) === 0);

check(
    'it publishes its height for other bottom-pinned overlays',
    (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sie-bar-height').trim())) ===
        Math.round(barBox.height) + 'px'
);

// The layout an editor reads must be the layout a visitor reads, and it must
// not jump when the toggle is pressed. Measured across the switch, because
// this used to break exactly there: pre-wrap arrived with edit mode and
// re-wrapped every multiline paragraph under the person who clicked.
const beforeToggle = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-sie-field]')).map((n) => Math.round(n.getBoundingClientRect().height))
);

console.log('\nediting on');

const toggleWidthBefore = (await toggle.boundingBox()).width;

await toggle.click();

// Measured now rather than before the click: with editing off the button is
// not on the page at all.
let savePosition = Math.round((await save.boundingBox()).x);

// One label in both states: it must not read like an invitation while it is
// already running, and the button must not change width under the pointer
// that is about to click it again.
const toggleWidthOff = Math.round(toggleWidthBefore);
const afterToggle = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-sie-field]')).map((n) => Math.round(n.getBoundingClientRect().height))
);
check(
    'nothing on the page re-wraps when edit mode comes on',
    JSON.stringify(beforeToggle) === JSON.stringify(afterToggle),
    JSON.stringify(beforeToggle) + ' became ' + JSON.stringify(afterToggle)
);
check(
    'a textarea with real line breaks shows them',
    (await intro.evaluate((el) => getComputedStyle(el).whiteSpace)) === 'pre-wrap'
);
check(
    'one without them reads exactly as a visitor sees it',
    (await page.locator('[data-sie-field="note"]').evaluate((el) => getComputedStyle(el).whiteSpace)) === 'normal',
    'no hidden breaks to reveal, so nothing should change'
);

check('the label does not change', (await toggle.textContent()) === 'Edit page');
check('nor does it say it is pressed only in colour', (await toggle.getAttribute('aria-pressed')) === 'true');
check(
    'and the button has not changed width',
    Math.abs(Math.round((await toggle.boundingBox()).width) - toggleWidthOff) < 2,
    'was ' + toggleWidthOff + ', now ' + Math.round((await toggle.boundingBox()).width)
);

// The on state has to be readable at a glance and instantly, not after a
// fade. Green is deliberately not used here: in Statamic green means "that
// worked", and it is kept for the saved message.
const toggleBg = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
// Read with the pointer still on the button, because that is where it is
// the moment after someone clicks it.
check(
    'the on state is unmistakable, hover or not',
    toggleBg === 'rgb(59, 130, 246)' || toggleBg === 'rgb(43, 111, 224)',
    'got ' + toggleBg
);
check(
    'and it does not fade into it',
    (await toggle.evaluate((el) => getComputedStyle(el).transitionProperty)) === 'none',
    'a fade means there is a moment where the bar says neither on nor off'
);
const saveBg = await save.evaluate((el) => getComputedStyle(el).backgroundColor);
check('the primary action is not green', !saveBg.startsWith('rgb(62, 207'), 'got ' + saveBg);
check(
    'editable fields are outlined',
    (await title.evaluate((el) => getComputedStyle(el).outlineStyle)) === 'dashed'
);
check(
    'the empty field names itself',
    (await empty.evaluate((el) => getComputedStyle(el, '::before').content)).includes('Add Dachzeile'),
    'should use the blueprint label, not a bare "Empty"'
);
check(
    'and the placeholder does not inherit the page typography',
    (await empty.evaluate((el) => getComputedStyle(el, '::before').textTransform)) === 'none' &&
        (await empty.evaluate((el) => getComputedStyle(el, '::before').fontStyle)) === 'normal',
    'the host paragraph is uppercase italic with wide tracking'
);
check('the hint is shown', (await count.textContent()).includes('double-click'));

// Narrow screens drop the hint rather than clip it to "Tap o…". Checked here,
// with nothing pending, because that is the only state in which it is on
// screen at all.
await page.setViewportSize({ width: 390, height: 844 });
check(
    'and dropped rather than clipped on a phone',
    (await count.evaluate((el) => getComputedStyle(el).visibility)) === 'hidden'
);
await page.setViewportSize({ width: 1100, height: 800 });
check('but back on a wide screen', (await count.evaluate((el) => getComputedStyle(el).visibility)) === 'visible');

await title.dblclick();

check('a double-click opens the field', await title.evaluate((el) => el.isContentEditable));

await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.type('Zuerst die Technik');
await page.locator('body').click();

check('the change is counted', (await count.textContent()) === '1 unsaved');
check('saving is now possible', await save.isEnabled());

// The bar grows as it gains a count and a status. If it were centred and
// shrink-wrapped, the buttons would slide sideways between one click and the
// next, and a second Save would land on empty space.
const saveAtRest = savePosition;
savePosition = Math.round((await save.boundingBox()).x);
check(
    'the Save button has not moved',
    Math.abs(savePosition - saveAtRest) < 2,
    'was ' + saveAtRest + ', now ' + savePosition
);

console.log('\ntouch');

// A phone has no double-click. Without a single-tap path the bar appears and
// nothing on the page can be opened.
await page.locator('body').click();
await second.dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
check('a single tap opens a field', await second.evaluate((el) => el.isContentEditable));
await page.keyboard.press('Escape');

console.log('\non a phone');

await page.setViewportSize({ width: 390, height: 844 });

check(
    'the buttons still fit side by side',
    (await save.boundingBox()).x + (await save.boundingBox()).width <= 390,
    'Save runs off the edge'
);
check(
    'and the toggle is still reachable',
    (await toggle.boundingBox()).x >= 0 && (await toggle.boundingBox()).height >= 44
);

// The middle is a few dozen pixels wide here. The long form would be clipped
// to "1 uns…", so the count drops to the number and stays readable.
await page
    .waitForFunction(() => document.querySelector('.sie-count').textContent === '1', { timeout: 3000 })
    .catch(() => {});
check(
    'the count fits instead of being clipped',
    (await count.textContent()) === '1',
    'got "' + (await count.textContent()) + '"'
);
check(
    'and it is not overflowing its box',
    await count.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    'scroll ' + (await count.evaluate((el) => el.scrollWidth)) + ' vs client ' + (await count.evaluate((el) => el.clientWidth))
);

await page.setViewportSize({ width: 1100, height: 800 });
await page
    .waitForFunction(() => document.querySelector('.sie-count').textContent === '1 unsaved', { timeout: 3000 })
    .catch(() => {});

check('and the long form is back on a wide screen', (await count.textContent()) === '1 unsaved');

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

/* ------------------------------------------------ the version 2 modes ---- */

const toggle2 = page.locator('[data-sie-field="promoted"]');
const select2 = page.locator('[data-sie-field="belegung"]');
const body2 = page.locator('[data-sie-field="body"]');
const hero = page.locator('[data-sie-field="hero"]');
const popover = page.locator('.sie-pop');

console.log('\na toggle');

await toggle2.dblclick();
check('opens a control rather than a cursor', await popover.isVisible());
check('and the field itself never becomes editable', !(await toggle2.evaluate((el) => el.isContentEditable)));
check('the switch shows the stored state', (await page.locator('.sie-switch').getAttribute('aria-pressed')) === 'true');

await page.locator('.sie-switch').click();
check('flipping it counts as a change', (await count.textContent()) === '1 unsaved');
check(
    'and the page text is left alone',
    (await toggle2.innerText()) === 'ja',
    'the template decides what a toggle reads as, so only a reload can show it'
);

await page.locator('.sie-pop-done').click();
check('the control closes', await popover.isHidden());
check('and the change survives closing it', (await count.textContent()) === '1 unsaved');

console.log('\na select');

await select2.dblclick();
const choices = await page.locator('.sie-pop select option').allTextContents();
check('offers the blueprint choices plus a way to clear', JSON.stringify(choices) === '["—","Offen","Ausgebucht"]', JSON.stringify(choices));
check('with the stored one selected', (await page.locator('.sie-pop select').inputValue()) === 'offen');

await page.locator('.sie-pop select').selectOption('voll');
check('picking another counts', (await count.textContent()) === '2 unsaved');
await page.keyboard.press('Escape');

console.log('\nmarkdown');

await body2.dblclick();
const source = await page.locator('.sie-area').inputValue();
check(
    'opens its own source, not the rendered HTML',
    source === '## Ein Kapitel\n\nMit einem **Absatz**.',
    JSON.stringify(source)
);

await page.locator('.sie-area').evaluate((el) => el.setSelectionRange(3, 14));
await page.locator('.sie-tool[title="Bold"]').click();
check(
    'the toolbar writes markdown around the selection',
    (await page.locator('.sie-area').inputValue()).startsWith('## **Ein Kapitel**'),
    JSON.stringify(await page.locator('.sie-area').inputValue())
);

await page.keyboard.press('Escape');
check('three changes are now pending', (await count.textContent()) === '3 unsaved');

console.log('\nsaving the three of them');

reply = { status: 200, body: { saved: [{ id: 'entry-1', stamp: '1700010000' }] } };
lastRequest = null;

// No status to wait for here: these three fields all reload the page on a
// successful save, so the bar is gone by the time the request has landed.
// The request itself is what this section is about.
await save.click();
await page.waitForFunction(() => true);
await page.waitForTimeout(600);

const sent = lastRequest.body.changes.find((c) => c.id === 'entry-1').fields;

check('a toggle travels as a real boolean', sent.promoted === false, JSON.stringify(sent.promoted));
check('a select travels as the chosen key', sent.belegung === 'voll', JSON.stringify(sent.belegung));
check('markdown travels as its source', sent.body.startsWith('## **Ein Kapitel**'), JSON.stringify(sent.body));

console.log('\nthe control panel overlay');

// Last, because closing it reloads the page on purpose.
const frame = page.locator('.sie-frame');
await page.waitForTimeout(600);
await page.goto(PAGE);
await page.waitForSelector('.sie-bar');
if (!(await page.locator('.sie-toggle').evaluate((el) => el.classList.contains('sie-on')))) {
    await page.locator('.sie-toggle').click();
}

await page.locator('[data-sie-field="hero"]').dblclick();
check('a field only the control panel can edit opens it over the page', await page.locator('.sie-panel').isVisible());
check('in an iframe pointed at the entry', (await frame.getAttribute('src')) === 'about:blank');
check('with a way out', await page.locator('.sie-panel-close').isVisible());

await browser.close();

console.log('');

if (failures) {
    console.log(failures + ' failed');
    process.exit(1);
}

console.log('all passed');
