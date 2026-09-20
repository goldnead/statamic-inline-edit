# Changelog

## Unreleased

### A Bard opens as a Bard, not as the whole entry form

Adrian, at the end of a session: "Ich fände es eleganter wenn man nur das bard Textfeld hat
und nicht das ganze Statamic Input Feld als popup."

He was right. Double-clicking a paragraph handed back the entire control panel page in a
full-screen frame: a sidebar, a revision history, a publish state and nineteen other fields,
for one edit to one text. The frame was the size of the screen because its contents were the
size of a back office.

There is now a control panel route that renders **one field** as a real publish form —
`/cp/inline-edit/field/{collection}/{entry}/{handle}` — and the overlay opens that instead.
The field is the real fieldtype with its real metadata, so a Bard arrives with its whole
toolbar, its sets and its link browser, and saving runs through the blueprint's own
validation. The panel is a card the size of the field, which the form measures and reports,
rather than a black rectangle over the page.

**Entries under revisions keep the old behaviour.** Writing one field past a working copy
would publish straight to the site on a collection whose whole point is that somebody
approves first. Those still open the full form, which knows how to make one. The tag does not
offer the new route for them, and the route refuses them a second time.

This adds a small control panel bundle to the addon, published with
`php artisan vendor:publish --tag=statamic-inline-edit`.

## 1.3.0

### The control panel for a toggle, a select or a date is a light panel now

Adrian pointed at a screenshot: a dark pill lying across the table row it was editing,
holding the words "Belegung ·", a native select and a button marked Done. Roughly 660 by 110
pixels to change one word.

It is 192 by 69 now, 18 percent of the area, and it wears the same skin as the selection
toolbar: white, 8px, the same three shadows. The rule this settles is that anything docked
stays dark and anything floating over the content is a light panel, which is also what the
control panel next door does. The field name moved above the control as a small caps line, so
the panel is no longer wide enough to cover the row it serves.

**The Done button is gone from a single control.** By the time anybody could press it the
answer was already recorded and already showing on the page, and Escape and a click outside
both already closed the panel without changing anything. One control, one decision, and the
decision closes it. The wide markdown editor keeps its button, because a text field has no
event that means "finished".

### Three bugs that came out of the review, one of them real

- **An arrow key committed the wrong value and took the panel away.** A closed `<select>`
  fires `change` on every arrow key, which is native and correct; closing on it was not.
  Somebody reading down the list with the keyboard got one keystroke and then a shut panel
  with the neighbouring value set. The panel now knows which hand answered: a pointer closes
  it, a keyboard waits for Enter. The old test used `selectOption()`, which goes straight past
  the keyboard path, so it stayed green through all of it.
- **The select and the date had no edge of their own.** `all: unset` takes the border with
  everything else, and `appearance: auto` hands back the chevron but not the box. At rest the
  control was a word floating in white on a white card, with the focus ring as its only
  outline. Nothing showed it, because the panel focuses the control the moment it opens.
- **`"Text · "`.** The separator was printed whether or not anything followed it. Fixed in the
  small panel first and left standing in the wide one, which is exactly the shape of mistake
  the small panel's comment describes.

Two checks were claiming more than they measured. "Still looks like a dropdown" only asked
about `appearance` and passed while the border was missing; "light, like the selection
toolbar" compared white to white. The first now asserts the inset edge, the second builds a
real `.sie-bubble` and compares background, radius and shadow against it.

The fixture grew a date field. Both control branches share the two lines that decide when the
panel closes, and only one of them was covered.

35 PHP tests, 127 browser checks.

## 1.2.0

### Markdown is edited in place now, not in a box

The popup with the monospace source is gone by default. The text on the page becomes the
editor: same heading, same measure, same font, now with a cursor in it. Type `## ` and it
becomes a heading, `- ` a list, `**bold**` bold as you close the asterisks. Select a few words
and a small toolbar appears over them.

It is [Tiptap](https://tiptap.dev), which is what Statamic's own Bard is built on, so the
shortcuts are the ones clients already meet in the control panel. Fetched the first time
somebody opens such a field, 180 KB over the wire, and never on a page nobody is editing. The
file every editor's page does load stays at 11 KB.

**The trade, stated plainly.** A rich editor reads markdown into a document and writes it back
out, and markdown has more than one spelling for the same document. Editing one sentence
rewrites the whole field in the editor's dialect. Opening a field and closing it without typing
never writes anything, because the comparison is against what the editor produced on mount
rather than against what was stored. `rich => false` gives the old source editor back, for
markdown that has to survive byte for byte.

This is the addon's first build step. One file, esbuild, committed, and a CI job that rebuilds
it and fails on a diff.

### The bar waits to be asked

It used to sit at the bottom of every page an editor opened, whether they were editing or
reading. Now there is one small button in the corner, and `Ctrl/Cmd + Shift + E` does the same
thing from the keyboard. Pressing it brings up the bar and switches editing on; the bar has a
close button that puts both away again.

One bug found while wiring it: the handler that lets Space open a focused field was swallowing
every space typed into the rich editor, because Tiptap mounts its contenteditable as a *child*
of the marker. Typing `## ` produced `##`, so the markdown shortcut that is the whole point
never fired.

### The toolbar, after Adrian saw it

Light with icons, the way Bard's is, because this is a text-formatting toolbar in a Statamic
site and it should look like the one the same person meets in the control panel. Bold, italic
and the heading levels are letterforms, which is what Statamic's own icons for them are too;
the rest are drawn here rather than copied out of a commercial package.

And it goes in the margin beside the text where the page has one, covering nothing at all.
Over the text only when there is no room, and then above the selection, because reading runs
downwards. Two rounds of review had it covering first the heading above it and then the line
below it; a smaller toolbar and the margin solve what moving it up and down could not.

One bug worth naming: the icons were invisible while every computed style read correctly.
`all: unset`, which is what keeps a host site's CSS out of this addon's chrome, also resets
`d`, and `d` is a real CSS property on an SVG path. Right size, right colour, no shape. It
took a screenshot of the toolbar on its own to see, and there is a check for it now.

35 PHP tests, 113 browser checks.

## 1.1.0

### Three more kinds of field

Version 1 could edit text. Everything else on a page rendered normally and was not clickable,
which on a real client site is most of it.

- **`toggle`, `select` and `date` open a small control.** Their value is not the text on the
  page: a toggle renders as whatever word the template chose, a date in whatever format it
  wanted. So the element becomes a trigger rather than a text box, and it needs the pair form:
  `{{ editable field="promoted" }}{{ if promoted }}ja{{ /if }}{{ /editable }}`. A select's
  choices come from the blueprint, and the save route checks the arriving value against them
  again rather than trusting the dropdown.
- **`markdown` opens its own source, not the rendered HTML.** With a toolbar that writes the
  same syntax a person would type. Editing rendered output means converting it back on every
  save, and every such conversion loses something: the exact list marker, a reference link, a
  deliberate HTML block. The source round-trips byte for byte.
- **Everything else opens the control panel in an overlay.** Bard, Replicator, images, grids.
  Bard alone is an entire editor and an asset picker is an entire browser; a second-rate copy
  of either is worse than one click into the real one, and the real one brings its own
  validation, revisions and permissions. Switch `control_panel` off if your control panel
  cannot be framed.

The three new kinds reload the page after saving, because only the server knows what the
template will make of the new value. Text does not: what you typed is what is there.

A toggle travels to the server as a real boolean rather than a string, so `false` and "" stay
different things to the blueprint.

### What the review changed, again

Same loop as version 1: built, photographed on a real page, handed to a reviewer who saw only
the pictures.

- **The one field version 2 was built for had no outline at all.** A markdown block is a
  heading, paragraphs and a list; wrapped in a `span` it has no box, so nothing was drawn
  around it, and neither was the outline that says "unsaved". A markdown field now defaults to
  a `div`, and any marker that contains block content becomes one.
- **Nobody could see what they were saving in markdown.** Type into a monospace box, close it,
  the page looks exactly as before, press Save. Closing the source editor now asks the server
  to render the value through its own fieldtype and puts that on the page. The one rule this
  addon exists to keep is that nobody saves something they have not looked at.
- **A select looked like a text field.** The reset that protects the bar from the host site's
  CSS also strips a dropdown of its chevron and a date input of its calendar button. Handed
  back explicitly.
- **A flipped toggle looked exactly like an untouched one** until the save and the reload. The
  field now shows what it will become, next to what it still says.
- **The toolbar was five unlabelled symbols.** It is five words.
- **On a phone the only state was a bare digit.** The count moved onto the Save button, where
  it has a word next to it saying what it counts.
- The control panel overlay scrolls to the field that was double-clicked and outlines it,
  instead of opening the whole form at the top.

Tried and reverted in the same round: an always-visible badge naming each field's kind. On a
row of four fields it lands on the neighbour's value, whichever side it is placed. It shows on
hover, and the control that opens names its own kind in its header, which is what a phone
gets.

35 PHP tests, 86 browser checks.

## 1.0.0

### The first version

Edit `text`, `textarea` and `integer` fields on the live page. Mark a field with
`{{ editable:handle }}`, double-click it as a signed-in editor, type, save.

- `{{ editable:handle }}` and `{{ editable field="handle" }}`, with `tag=` for the wrapper
  element. Renders the plain value and nothing else for anyone who is not editing.
- A save route at `/!/statamic-inline-edit/save`, behind the site's session and CSRF, checking
  the entry policy, the blueprint, the fieldtype list, a length ceiling and the blueprint's own
  validation on every request.
- Conflict detection: a save from a page older than the entry is refused with a 409 rather than
  overwriting whoever saved first.
- The editor is injected automatically on pages that rendered a marker, and those pages are
  marked `X-Statamic-Uncacheable` so an editor's version is never stored in the static cache.
- `{{ inline_edit:assets }}` to place it by hand instead, for sites with a Content Security
  Policy.
- English and German.

Refused on purpose, with a message rather than silently: the slug, collections with revisions
enabled, any fieldtype not on the list, and any handle the page never offered.

Tested with 20 PHP tests for the tag and the save route, and 55 browser checks against the
shipped script.

### What a round of review changed

The editor was built, photographed on a real Statamic page, and handed to a reviewer who saw
only the pictures. Three passes:

- **The bar was a floating pill.** It covered whatever the site had at the bottom, and it grew
  with its own contents, so the Save button moved between one click and the next. It is now a
  band docked across the width that reserves matching space at the end of the document and
  publishes its height as `--sie-bar-height` for anything else pinned down there.
- **There was no way into a field on a phone.** `dblclick` is a mouse gesture; on a touch
  screen a double tap is zoom. A single tap now opens a field while edit mode is on, targets
  are 44px, and the change count shortens to fit the narrow bar.
- **The primary action was green.** In Statamic green means "that worked". It is blue now, and
  green is left to the saved message.
- **The empty placeholder inherited the page's typography** and said only "Empty". It is its
  own chip now, with its own font, carrying the field's name from the blueprint.
- **The on state was unreadable**, because the generic hover rule outranked it and the pointer
  is on the button the instant it is switched on. The label also changed, which read like an
  invitation and moved the button under the cursor. One label now, state on a dot, the colour
  and `aria-pressed`.
- **Save and Discard sat there disabled** with editing off. They are absent instead.
- **The page re-wrapped when edit mode came on.** Multiline fields got `white-space: pre-wrap`
  with the toggle, so paragraphs moved under the person who had just clicked. The server now
  flags only the fields whose stored value really contains a line break, and the style is on
  the element from the first paint. A textarea holding one paragraph renders exactly as a
  visitor sees it; nothing moves when the toggle is pressed.

One bug worth naming because it was found before release and would have been hard to see
afterwards: switching edit mode on gives multiline fields `white-space: pre-wrap`, which makes
the stored line breaks visible and changes what the browser reports as the text. Every textarea
on the page therefore counted as changed before anyone touched anything, and a Save would have
posted fields nobody edited. The baseline is now taken after the mode is switched, not at page
load.
