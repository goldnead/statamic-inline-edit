# Changelog

## Unreleased

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

Tested with 18 PHP tests for the tag and the save route, and 34 browser checks against the
shipped script.

One bug worth naming because it was found before release and would have been hard to see
afterwards: switching edit mode on gives multiline fields `white-space: pre-wrap`, which makes
the stored line breaks visible and changes what the browser reports as the text. Every textarea
on the page therefore counted as changed before anyone touched anything, and a Save would have
posted fields nobody edited. The baseline is now taken after the mode is switched, not at page
load.
