# Changelog

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
