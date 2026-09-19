# Statamic Inline Edit

Edit content straight on the live page. Double-click, change it, save.

Not a page builder. You cannot move a block, add a section or change a layout with it, and that
is on purpose. It exists for the change a client actually asks for: one wrong word in a
headline, a phone number, a sentence in an intro. The kind of change that today means finding
the login, finding the entry, finding the field, and hoping nothing else got touched.

---

## Requirements

| | |
|---|---|
| Statamic | 6.0 or newer |
| PHP | 8.2 or newer |
| Laravel | 12.40 or newer, or 13 (whatever Statamic 6 pulls in) |
| Content | Entries. Globals, taxonomy terms and users are not supported yet |
| Control panel | Must be framable from the site's own origin for the overlay. Switch `control_panel` off if it is not |
| Fieldtypes | `text`, `textarea`, `integer` in place; `toggle`, `select`, `date` and `markdown` through a control; the rest through the control panel |
| Statamic Pro | not required. Collections with revisions enabled are refused, and revisions are Pro |
| JavaScript | required in the editor's browser. Visitors need none |

Installing needs no Node and no build. Two of the three shipped files are hand-written; the
third, the rich editor, is bundled here and committed, and CI fails if it drifts from its
source.

---

## What it looks like

A signed-in editor gets one small button in the corner. Press it, or `Ctrl/Cmd + Shift + E`,
and a bar docks at the bottom: every marked field picks up a dashed outline, and a double-click
opens whatever that field needs. A cursor in a headline. A switch on a toggle. A real editor in
the text itself for markdown, with a toolbar that appears over the selection. The control panel
over the page for everything else. Close the bar and the page is a page again.

Everyone else sees exactly what they saw before: same HTML, no wrapper elements, no script, no
attributes. There is nothing to leak because for a visitor nothing is rendered.

## Install

```bash
composer require goldnead/statamic-inline-edit
php artisan vendor:publish --tag=statamic-inline-edit-assets --force
```

The second line is not optional and `--force` is not optional either. The stylesheet and the
script are served from `public/vendor/statamic-inline-edit/`, and a stale copy there is an
editor talking to a newer save route, which fails in a way nobody can reproduce. Put both lines
in your deploy script.

## Use

Take any field you want editable and wrap the output:

```antlers
{{ hero_title }}          →    {{ editable:hero_title }}
```

That is the whole integration. Do it for the handful of fields clients actually ask you to
change; leave the rest alone.

```antlers
<h1>{{ editable:hero_title }}</h1>
<p>{{ editable:intro }}</p>

{{-- when the field name is itself a variable --}}
{{ editable field="{field_handle}" }}

{{-- the wrapper is a <span> unless you say otherwise --}}
{{ editable:intro tag="div" }}
```

### Why the tag, and not magic

Because Antlers cannot be asked afterwards. By the time a rendered value reaches the output
buffer it is a plain string; the object that knew its field handle and its entry has already
been reduced away, and the runtime offers no hook in between. On top of that, a value inside a
Bard or Replicator set has no link to its entry at all, by construction in core.

So the field gets named in the template. Every comparable tool in every CMS does this, for the
same reason.

## What can be edited

Four kinds of field, four different things happen. Which one a field gets is decided by its
fieldtype, in `config/statamic-inline-edit.php`.

| | Fieldtypes | Double-clicking it |
|---|---|---|
| **text** | `text`, `textarea`, `integer` | The text itself opens. What you type is what the page will show. |
| **control** | `toggle`, `select`, `date` | A small control opens. The value is not the text on the page, so there is nothing to put a cursor in. |
| **source** | `markdown` | The text becomes a real editor, in place. Markdown shortcuts as you type, a toolbar over the selection. |
| **cp** | everything else | That entry's control panel form opens in an overlay. |

Only **text** keeps what you typed on the page as you typed it. The other three reload the page
after saving, because only the server knows what the template will make of the new value.

### Why each one is the way it is

**text** is the original: what travels back to the server is the browser's `innerText`, never
`innerHTML`, so no markup a contenteditable produces can reach your content.

**control** needs the pair form, because the tag cannot produce the visible output itself:

```antlers
{{ editable field="promoted" }}{{ if promoted }}Läuft{{ else }}Pausiert{{ /if }}{{ /editable }}
{{ editable field="starts_on" }}{{ starts_on format="d.m.Y" }}{{ /editable }}
```

A select's choices come from your blueprint, and the save route checks the arriving value
against them again. The dropdown in the browser is a suggestion; the request is what happened.

**source** turns the text on the page into the editor. Not a box over it, not a copy of it: the
same heading, the same measure, the same font, now with a cursor in it. Type `## ` and it
becomes a heading, `- ` a list, `**bold**` bold as you close the asterisks. Select a few words
and a small toolbar appears over them.

It is [Tiptap](https://tiptap.dev), which is also what Statamic's own Bard is built on, so the
shortcuts and the behaviour are the ones your clients already meet in the control panel. It is
fetched the first time somebody opens such a field, 180 KB, and never on a page nobody is
editing.

**What it costs.** A rich editor reads markdown into a document and writes it back out, and
markdown has more than one spelling for the same document: `*a*` may return as `_a_`, a
reference link as an inline one. Editing one sentence rewrites the whole field in the editor's
dialect. Opening a field and closing it without typing never writes anything, because the
comparison is against what the editor produced on mount rather than against what was stored.
But if you have markdown that has to come back byte for byte, hand-written tables, HTML blocks,
footnotes, set `rich` to `false` and you get the plain source editor instead.

**cp** is the real control panel in an iframe, not a rebuilt editor. Bard alone is an entire
editor and an asset picker is an entire browser; a second-rate copy of either is worse than one
click into the real one. Saving there goes through the control panel's own validation,
revisions and permissions. The overlay scrolls to the field you double-clicked and outlines it,
and the page reloads when you close it.

### Seeing it before you save it

The three non-text kinds cannot show the result in place: only your template knows what a
toggle reads as, and only the server knows what markdown renders to. So:

- A **control** shows what the field will become next to what it still says, and the page
  reloads after saving so the template has the last word.
- A **markdown** field is rendered by the server the moment you close the editor, through the
  same fieldtype the page uses. What you see there is what will be there. Nothing is written
  until you press Save.

The slug is refused outright and cannot be enabled. Changing it moves the page out from under
the person editing it and breaks every link to it.

### Don't chain modifiers onto it

```antlers
{{ editable:title | upper }}    {{-- wrong --}}
```

The modifier runs on the tag's whole output, wrapper and all, and the editor would then save
the uppercased text back as the stored value. Put modifiers on a plain `{{ title }}` somewhere
that is not editable.

## Who may edit what

Core's own entry policy, unchanged. If someone cannot edit a page in the control panel, no
marker is rendered for them here and the save route refuses them. There is no separate
permission to forget to grant, and no way for this addon to be more permissive than the CP it
sits next to.

Every request is checked again server-side: the entry exists, this user may update it, the
handle is a real field on its blueprint, its fieldtype is on the list, the text is within the
length ceiling, the entry has not changed since the page loaded, and the blueprint's own
validation passes. The markers in the HTML say what the server offered, but a request says what
a browser sent, and those are only the same thing until somebody opens the console.

## Two people at once

Every marker carries the entry's modification time as the page saw it. A save that arrives with
a stale one is refused with a 409 and the message says to reload. Nobody's work disappears
quietly.

## Static caching

Read this if you have static caching switched on. There are two halves and only one is solved.

**Writing is safe.** A page that rendered markers is marked `X-Statamic-Uncacheable`, so an
editor's version of a page, complete with their CSRF token, is never stored and never served to
a visitor.

**Reading is not.** With full-measure caching, the cache answers before this addon is reached,
so an editor can be handed a stored visitor page with no markers on it. Use core's
`{{ nocache }}` around the editable regions, or exclude the URLs your clients edit. This is
written down rather than papered over, because a marker that appears unreliably is worse than
one that is reliably absent.

## Configuration

```bash
php artisan vendor:publish --tag=statamic-inline-edit-config
```

| Key | Default | |
|---|---|---|
| `enabled` | `true` | Off means the tag renders the plain value, no script is injected, and the save route answers 404. |
| `fieldtypes` | `text`, `textarea`, `integer` | Edited in place. Every one of them has to store a plain string; see above. |
| `controls` | `toggle`, `select`, `date` | Edited through a small control. |
| `source` | `markdown` | Edited in place with a real editor. |
| `rich` | `true` | The editor for those. `false` gives the plain markdown source in a monospace box instead. |
| `control_panel` | `true` | Everything else opens the control panel in an overlay. Off means those fields are simply not clickable. |
| `multiline` | `textarea` | Of the text ones, where Enter inserts a line break instead of leaving the field. |
| `inject` | `true` | Places the editor before `</body>` automatically. Switch off and use `{{ inline_edit:assets }}` if a Content Security Policy needs the script somewhere specific. |
| `max_length` | `100000` | A ceiling on any one field, independent of the blueprint. |

Two routes are registered under the action prefix: `save`, which writes, and `preview`, which
renders a markdown value through its own fieldtype and writes nothing. Both check the same
permission as the control panel, and both answer 404 when `enabled` is off.

## Not in this version

Named, not hidden:

- **Bard and Replicator, inline.** Core builds the values inside a set without a link back to
  their entry, so a paragraph in a Bard is genuinely unaddressable from the page. Marking the
  whole field opens the control panel instead, which is the honest answer.
- **Revisions.** A collection with revisions enabled refuses the save on the page and says so,
  rather than writing straight past a workflow whose whole point is that somebody approves
  first. Its fields are still reachable through the control panel overlay, where revisions work
  as they should.
- **Globals, taxonomy terms and users.** Entries only. All three reach a template as augmented
  values too, but each needs its own way of being found again on save, and rendering a marker
  we cannot save is worse than rendering none.
- **Multisite** works, with one thing to know: editing a field on a localized entry writes into
  that localization, so the field stops inheriting from its origin. That is what the control
  panel does once you localize a field there.

## Line breaks in a textarea

A `textarea` can hold line breaks that your template does not render, because normal HTML
collapses them into spaces. An editor who cannot see them deletes them on the first save
without ever knowing they were there, so a field whose stored value really has breaks in it is
rendered with `pre-wrap` and shows them.

Two things follow, both deliberate:

- **Only fields that actually contain a break.** A textarea holding one paragraph renders
  exactly as a visitor sees it, because there is nothing hidden to reveal.
- **From the first paint, not when you switch editing on.** Nothing re-wraps under you when
  you press the toggle. The page an editor reads is the page they edit.

Where the two do differ, it is because the content has breaks that plain HTML swallows. If you
would rather they showed for visitors too, that is a `| nl2br` on your template, not a setting
here.

## The bar

It docks across the bottom of the window and reserves matching space at the end of the
document, so it covers none of your page. It cannot get out of the way of another *fixed*
overlay, though: a cookie dialog or a chat bubble pinned to the bottom corner will share that
strip with it. No bottom bar anywhere solves that. Switch editing off and the bar is just the
one toggle again.

## Keyboard and touch

| | |
|---|---|
| Ctrl/Cmd + Shift + E | show and hide the bar |
| Double-click, or a single tap on a touch screen | start editing |
| Enter / Space on a focused field | start editing, without a mouse |
| Escape | discard this field |
| Enter | leave the field (single-line fields) |
| Cmd/Ctrl + S | save everything |

A single tap only opens a field while edit mode is on, which the person switched on one tap
earlier. Reading the page is never interrupted.

## Development

```bash
composer install
vendor/bin/phpunit          # 35 tests: the tag, the save route and the preview route
vendor/bin/pint --test
vendor/bin/phpstan analyse

npm install
npm run build               # resources/js/rich.js -> resources/dist/inline-edit-rich.js
node tests/browser/run.mjs  # 102 checks: everything that only exists in a browser
```

`resources/dist/inline-edit-rich.js` is committed, because a site that installs this addon gets
no build step. The `bundle` job in CI rebuilds it and fails on a diff, so the file in the
repository is always the file the source produces. `npm run watch` rebuilds while you work.

The two suites answer different questions and neither covers the other. PHP proves the
server: who may write, to which field, with what validation, and what happens when two people
collide. The browser run drives the shipped script against `tests/browser/fixture.html` — no
Statamic, no PHP — for double-click to edit, the dirty count, Escape reverting, the exact shape
of the save request, and the bar surviving a host stylesheet that styles every button on the
page.

`node tests/browser/run.mjs --shot out.png` writes a screenshot of the editor mid-edit.

`resources/dist/` is hand-written vanilla JavaScript and CSS with no build step. The whole
editor is a bar, a contenteditable and a `fetch`; a toolchain would buy nothing and would ship
a bundle to every client page an editor opens. Keep it that way.
