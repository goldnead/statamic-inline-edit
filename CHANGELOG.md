# Changelog

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

35 PHP tests, 105 browser checks.

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
