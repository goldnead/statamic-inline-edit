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
const PAGE_RICH = 'file://' + resolve(here, 'fixture-rich.html');
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
const launcher = page.locator('.sie-launch');
const save = page.locator('.sie-save');
const discard = page.locator('.sie-discard');
const count = page.locator('.sie-count');
const status = page.locator('.sie-status');
const title = page.locator('[data-sie-field="hero_title"]');
const intro = page.locator('[data-sie-field="intro"]');
const second = page.locator('[data-sie-field="title"]');
const empty = page.locator('[data-sie-field="subtitle"]');

console.log('\nthe way in')

check('is one small button in the corner, not a bar', (await launcher.isVisible()) && (await bar.isHidden()));
check('and it says what it does', (await launcher.textContent()) === 'Edit page');
check('with the shortcut in its tooltip', (await launcher.getAttribute('title')).includes('Ctrl+Shift+E'));
check('its target is big enough for a thumb', (await launcher.boundingBox()).height >= 44);
check(
    'and the host stylesheet has not got at it',
    (await launcher.evaluate((el) => getComputedStyle(el).backgroundColor)) !== 'rgb(255, 105, 180)',
    'the fixture sets button { background: hotpink }'
);

console.log('\nediting off');

check('no field is outlined', (await title.evaluate((el) => getComputedStyle(el).outlineStyle)) === 'none');
check('nothing is contenteditable', (await page.locator('[contenteditable]').count()) === 0);

// The layout an editor reads must be the layout a visitor reads, and it must
// not jump when edit mode comes on. Measured across the switch, because this
// used to break exactly there: pre-wrap arrived with edit mode and re-wrapped
// every multiline paragraph under the person who clicked.
const beforeToggle = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-sie-field]')).map((n) => Math.round(n.getBoundingClientRect().height))
);

console.log('\nediting on');

await launcher.click();

const barBox = await bar.boundingBox();
const viewport = page.viewportSize();

check('the bar takes the buttons place', (await bar.isVisible()) && (await launcher.isHidden()));
check(
    'docked across the full width',
    Math.abs(barBox.width - viewport.width) < 2 && Math.abs(barBox.y + barBox.height - viewport.height) < 2,
    'box ' + JSON.stringify(barBox)
);
check('its buttons keep their own size', (await save.boundingBox()).width < 240, 'the page sets a hostile global button rule');
check('and are big enough for a thumb', (await save.boundingBox()).height >= 44);
check('there is a way back out', await page.locator('.sie-close').isVisible());

// The bar is fixed, so without a spacer it lies on top of whatever the page
// put at the bottom. The last paragraph must still be reachable.
check(
    'it reserves its own space at the end of the document',
    Math.abs((await page.locator('.sie-spacer').boundingBox()).height - barBox.height) < 2
);
check(
    'and publishes its height for other bottom-pinned overlays',
    (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sie-bar-height').trim())) ===
        Math.round(barBox.height) + 'px'
);

let savePosition = Math.round((await save.boundingBox()).x);

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

const saveBox = await save.boundingBox();
check(
    'the buttons still fit side by side',
    saveBox.x + saveBox.width <= 390,
    'Save ends at ' + Math.round(saveBox.x + saveBox.width) + ', label "' + (await save.textContent()) + '"'
);
check(
    'and the close button is still reachable',
    (await page.locator('.sie-close').boundingBox()).height >= 44
);

// The middle is a few dozen pixels wide here, so the count moves onto the
// Save button. A bare "1" between two buttons reads like a leftover; next to
// the word it says what it counts.
await page
    .waitForFunction(() => document.querySelector('.sie-save').textContent.trim() === 'Save 1', { timeout: 3000 })
    .catch(() => {});
check('the count rides on the Save button', (await save.textContent()).trim() === 'Save 1', JSON.stringify(await save.textContent()));
check('and the middle is left empty rather than clipped', (await count.textContent()) === '');
check(
    'nothing overflows its box',
    await save.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
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

console.log('\ntelling the four kinds apart');

// Until this existed the only difference between a text field and a whole
// control panel was the mouse cursor: invisible in a screenshot, absent on a
// phone, and arriving only once the pointer is already there.
const badges = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-sie-field]')).map((n) => [n.dataset.sieMode, n.dataset.sieBadge].join(':'))
);
check(
    'a field with room says which kind it is',
    badges.filter((b) => b.split(':')[1]).length >= 4,
    JSON.stringify(badges)
);
// Every badge that is shown has to name its own mode. Not "four distinct
// words": on this page the control and cp fields are single words in a row
// of facts, too narrow for a badge, and they correctly have none.
const WORDS = { text: 'Text', control: 'Value', source: 'Markdown', cp: 'Control panel' };
check(
    'and each one names its own kind',
    badges.every((b) => { const [mode, word] = b.split(':'); return word === '' || word === WORDS[mode]; }),
    JSON.stringify(badges)
);

// A badge sits to the right of its field. In a row of four facts, the right
// of one field is the value of the next, so a narrow field gets none.
const narrowBadges = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-sie-field]'))
        .filter((n) => n.getBoundingClientRect().width < 140)
        .map((n) => n.dataset.sieBadge || '')
);
check('a narrow one keeps quiet', narrowBadges.every((b) => b === ''), JSON.stringify(narrowBadges));

// Quiet until asked. Always-on was tried and reverted: on a row of four
// fields the badge of one sits on the value of the next.
const resting = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-sie-field]')).map((n) => getComputedStyle(n, '::after').opacity)
);
check('no badge shouts at rest', resting.every((o) => parseFloat(o) === 0), JSON.stringify(resting));

await page.locator('[data-sie-field="belegung"]').hover();
await page.waitForTimeout(250);
check(
    'but hovering one names its kind',
    parseFloat(await page.locator('[data-sie-field="belegung"]').evaluate((el) => getComputedStyle(el, '::after').opacity)) > 0.5
);

check(
    'and nothing makes a phone scroll sideways',
    !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1))
);

// A span wrapping a heading, a paragraph and a list has no box of its own, so
// the outline that says "editable" was never drawn on the one field version 2
// was built for.
const mdBox = await page.locator('[data-sie-field="body"]').boundingBox();
check(
    'a markdown block is a block, so its outline is drawn',
    (await page.locator('[data-sie-field="body"]').evaluate((el) => getComputedStyle(el).display)) === 'block' && mdBox.height > 40,
    JSON.stringify(mdBox)
);

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
check(
    'but the field shows what it will become',
    (await toggle2.getAttribute('data-sie-ghost')) === 'Off',
    'otherwise a flipped toggle looks exactly like an untouched one'
);

await page.locator('.sie-pop-done').click();
check('the control closes', await popover.isHidden());
check('and the change survives closing it', (await count.textContent()) === '1 unsaved');

console.log('\na select');

await select2.dblclick();
const choices = await page.locator('.sie-pop select option').allTextContents();
check('offers the blueprint choices plus a way to clear', JSON.stringify(choices) === '["—","Offen","Ausgebucht"]', JSON.stringify(choices));
check('with the stored one selected', (await page.locator('.sie-pop select').inputValue()) === 'offen');

check(
    'and it still looks like a dropdown',
    (await page.locator('.sie-pop select').evaluate((el) => getComputedStyle(el).appearance)) !== 'none',
    'the reset strips the chevron, and what is left reads as a text field'
);

await page.locator('.sie-pop select').selectOption('voll');
check('picking another counts', (await count.textContent()) === '2 unsaved');
check('and names the choice on the page', (await select2.getAttribute('data-sie-ghost')) === 'Ausgebucht');
await page.keyboard.press('Escape');

console.log('\nmarkdown');

await body2.dblclick();
const source = await page.locator('.sie-area').inputValue();
check(
    'opens its own source, not the rendered HTML',
    source === '## Ein Kapitel\n\nMit einem **Absatz**.',
    JSON.stringify(source)
);

const toolLabels = await page.locator('.sie-tool').allTextContents();
check(
    'the toolbar buttons are words, not symbols',
    JSON.stringify(toolLabels) === '["Bold","Italic","Heading","List","Link"]',
    JSON.stringify(toolLabels)
);

await page.locator('.sie-area').evaluate((el) => el.setSelectionRange(3, 14));
await page.locator('.sie-tool', { hasText: 'Bold' }).click();
check(
    'the toolbar writes markdown around the selection',
    (await page.locator('.sie-area').inputValue()).startsWith('## **Ein Kapitel**'),
    JSON.stringify(await page.locator('.sie-area').inputValue())
);

// Nobody may save something they have not looked at. Closing the source
// editor asks the server what it will render and puts that on the page.
await context.route('**/statamic-inline-edit/preview', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ html: '<h2>Gerendert</h2>' }) })
);

await page.keyboard.press('Escape');
await page.waitForFunction(() => document.querySelector('[data-sie-field="body"]').innerText.includes('Gerendert'), { timeout: 5000 }).catch(() => {});

check(
    'closing the source editor shows what it will look like',
    (await body2.innerText()).includes('Gerendert'),
    'otherwise the page keeps the old rendering until after the save'
);

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
// Edit mode survives a reload through sessionStorage; the launcher is only
// there when it did not.
if (await page.locator('.sie-launch').isVisible()) {
    await page.locator('.sie-launch').click();
}

await page.locator('[data-sie-field="hero"]').dblclick();
check('a field only the control panel can edit opens it over the page', await page.locator('.sie-panel').isVisible());
check('in an iframe pointed at the entry', (await frame.getAttribute('src')) === 'about:blank');
check('with a way out', await page.locator('.sie-panel-close').isVisible());

/* --------------------------------------------------- the rich editor ---- */

console.log('\nthe rich editor');

let previewAsked = null;
await context.route('**/statamic-inline-edit/preview', async (route) => {
    previewAsked = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ html: '<h2>Vom Server</h2>' }) });
});

await page.goto(PAGE_RICH);
await page.waitForSelector('.sie-launch', { state: 'attached' });

// Edit mode survives the navigation through sessionStorage, so the launcher
// may already be out of the way.
if (await page.locator('.sie-launch').isVisible()) {
    await page.locator('.sie-launch').click();
}

const body = page.locator('[data-sie-field="body"]');

// The whole promise of editing in place is that the page does not become a
// form when you click into it. Measured, not eyeballed.
const before = await page.evaluate(() => {
    const el = document.querySelector('[data-sie-field="body"]');
    const h2 = el.querySelector('h2');

    return {
        page: document.body.scrollHeight,
        block: Math.round(el.getBoundingClientRect().height),
        heading: getComputedStyle(h2).fontSize + '/' + getComputedStyle(h2).fontFamily,
    };
});

await body.dblclick();
await page.waitForSelector('.sie-rich', { timeout: 15000 });
await page.waitForTimeout(300);

const after = await page.evaluate(() => {
    const el = document.querySelector('[data-sie-field="body"]');
    const h2 = el.querySelector('h2');

    return {
        page: document.body.scrollHeight,
        block: Math.round(el.getBoundingClientRect().height),
        heading: getComputedStyle(h2).fontSize + '/' + getComputedStyle(h2).fontFamily,
    };
});

check(
    'opening it does not move the page',
    Math.abs(after.page - before.page) <= 2,
    before.page + 'px became ' + after.page + 'px'
);
check(
    'and the block keeps its height',
    Math.abs(after.block - before.block) <= 2,
    before.block + 'px became ' + after.block + 'px'
);
check(
    'the heading is still the page heading',
    after.heading === before.heading,
    before.heading + ' became ' + after.heading
);

check('the page element itself becomes the editor', await body.evaluate((el) => el.classList.contains('sie-rich-host')));
check('not a box over it', (await page.locator('.sie-pop').count()) === 0 || (await page.locator('.sie-pop').isHidden()));
check(
    'and it keeps the page typography',
    (await page.locator('.sie-rich h2').evaluate((el) => getComputedStyle(el).fontFamily)).toLowerCase().includes('georgia'),
    'the whole point of editing in place is that it looks like the page'
);

// Nothing was typed, so nothing may be pending. Round-tripping markdown
// normalises it, and a normalisation nobody asked for is not a change.
check('opening it is not a change', (await save.isDisabled()), 'a mount must never mark the page dirty');

console.log('\nmarkdown shortcuts');

await page.locator('.sie-rich').click();
await page.keyboard.press('ControlOrMeta+End');

// The document ends with a list, and the trailing paragraph ProseMirror
// would otherwise append is switched off because it moved the page. Enter
// twice leaves the list, which is the way out every editor has and the one
// the comment in rich.js promises.
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
check('Enter twice gets you out of a list', (await page.locator('.sie-rich > p').count()) >= 2);

await page.keyboard.type('### Neue Ueberschrift');
check('typing ### makes a heading', (await page.locator('.sie-rich h3').count()) === 1);

await page.keyboard.press('Enter');
await page.keyboard.type('- eins');
check('typing - makes a list', (await page.locator('.sie-rich ul li').count()) >= 1);

await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.keyboard.type('Das ist **fett** getippt.');
check('typing ** makes it bold as you go', (await page.locator('.sie-rich strong').count()) >= 2);

check('and all of that counts as one change', (await count.textContent()) === '1 unsaved');

// ProseMirror wraps every list item in a paragraph, and the site's own
// paragraph margin then pushes the items apart: the list grows the moment it
// is opened and shrinks again on close.
check(
    'a list does not grow just because it is being edited',
    (await page.locator('.sie-rich li > p').first().evaluate((el) => getComputedStyle(el).marginBlockStart)) === '0px'
);

console.log('\nthe bubble toolbar');

// Near the left edge, on the word. A locator's default click lands in the
// middle of the element, and a heading is full width, so the middle is empty
// space past the end of the text: the selection then sits on a node boundary
// and nothing is selected at all.
await page.locator('.sie-rich h3').first().dblclick({ position: { x: 14, y: 12 } });
await page.waitForTimeout(250);
const bubble = page.locator('.sie-bubble');
check('selecting text raises it', await bubble.isVisible());
// Next to the selection, above or below it. Below when there is text of the
// field's own above, so the toolbar never covers the line somebody just
// wrote to edit the one under it.
const selBox = await page.locator('.sie-rich h3').first().boundingBox();
const bubBox = await bubble.boundingBox();
check(
    'right next to the selection',
    Math.abs(bubBox.y - selBox.y) < 90,
    'bubble at ' + Math.round(bubBox.y) + ', selection at ' + Math.round(selBox.y)
);
// The one thing a floating toolbar must not do is cover the text being
// worked on. Where the page has a margin beside its measure, it goes there
// and covers nothing at all; where it does not, above the selection, which
// is what Bard and every editor of this shape does.
async function bubbleOverField() {
    const b = await bubble.boundingBox();
    const f = await page.locator('.sie-rich').boundingBox();

    return {
        over: b.x < f.x + f.width && b.x + b.width > f.x && b.y < f.y + f.height && b.y + b.height > f.y,
        b,
        f,
    };
}

// Wide enough that the page has a margin beside its measure. There the
// toolbar belongs in the margin, where it covers nothing at all.
await page.setViewportSize({ width: 1500, height: 800 });
await page.waitForTimeout(250);
await page.locator('.sie-rich h3').first().dblclick({ position: { x: 14, y: 12 } });
await page.waitForTimeout(250);

let seen = await bubbleOverField();
check('with a margin beside the text, it covers nothing', !seen.over, JSON.stringify(seen.b) + ' over ' + JSON.stringify(seen.f));
check(
    'and stays level with the line',
    Math.abs(seen.b.y + seen.b.height / 2 - (seen.f.y + 30)) < 260,
    'bubble at ' + Math.round(seen.b.y)
);

// Narrow enough that there is no margin left. Then it has to go over the
// text, and above is the least bad place: reading runs downwards.
await page.setViewportSize({ width: 700, height: 800 });
await page.waitForTimeout(250);
await page.locator('.sie-rich h3').first().dblclick({ position: { x: 14, y: 12 } });
await page.waitForTimeout(250);

const narrowSel = await page.locator('.sie-rich h3').first().boundingBox();
const narrowBub = await bubble.boundingBox();
check(
    'without one, above the selection and never on it',
    narrowBub.y + narrowBub.height <= narrowSel.y + 2,
    'bubble ends at ' + Math.round(narrowBub.y + narrowBub.height) + ', selection starts at ' + Math.round(narrowSel.y)
);

await page.setViewportSize({ width: 1100, height: 800 });
await page.waitForTimeout(200);
// Icons now, in Bard's style, so the names live where a pointer and a
// screen reader can reach them rather than in the button's text.
const tools = await page.locator('.sie-bubble-btn').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
check('with the usual suspects', JSON.stringify(tools) === '["Bold","Italic","H2","H3","List","Quote","Link"]', JSON.stringify(tools));
check(
    'every one of them named for a screen reader',
    await page.locator('.sie-bubble-btn').evaluateAll((els) => els.every((e) => e.getAttribute('aria-label') && e.title)),
);
// A button with the right size and the right colour and no shape in it.
// `all: unset` resets `d`, which is a real CSS property on an SVG path, and
// every computed style still reads correctly while the icon is invisible.
check(
    'and the icons actually have a shape',
    await page.locator('.sie-bubble-btn svg path').first().evaluate((el) => getComputedStyle(el).d !== 'none'),
    'all: unset reaches the path data unless svg is excluded from it'
);
check(
    'and it is light, not another dark panel',
    (await page.locator('.sie-bubble').evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgb(255, 255, 255)'
);
check('and it says what the selection already is', (await page.locator('.sie-bubble-on').count()) >= 1);

await page.locator('.sie-bubble-btn[aria-label="Bold"]').click();
await page.waitForTimeout(150);
check('pressing one changes the text', (await page.locator('.sie-rich h3 strong').count()) === 1);

console.log('\nclosing it');

await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.waitForFunction(() => document.querySelector('[data-sie-field="body"]').innerText.includes('Vom Server'), { timeout: 5000 }).catch(() => {});

check('the editor goes away', (await page.locator('.sie-rich').count()) === 0);
check('the server is asked what it will look like', previewAsked !== null);
check(
    'and it sends markdown, not HTML',
    previewAsked && previewAsked.value.includes('### **Neue** Ueberschrift') && !previewAsked.value.includes('<h3'),
    previewAsked ? JSON.stringify(previewAsked.value.slice(0, 80)) : 'nothing sent'
);
check('which is what lands on the page', (await body.innerText()).includes('Vom Server'));

await browser.close();

console.log('');

if (failures) {
    console.log(failures + ' failed');
    process.exit(1);
}

console.log('all passed');
