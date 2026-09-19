# Statamic Inline Edit

Edit text straight on the live page. Double-click, type, save.

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
| Fieldtypes | `text`, `textarea`, `integer` |
| Statamic Pro | not required. Collections with revisions enabled are refused, and revisions are Pro |
| JavaScript | required in the editor's browser. Visitors need none |

No build step, no Node, no Vite. The addon ships its stylesheet and script as plain files.

---

## What it looks like

A signed-in editor gets one button docked at the bottom of the window. They switch editing on,
the editable text picks up a dashed outline, they double-click a headline, type, and press
Save. Everyone else sees the page exactly as before: same HTML, no wrapper elements, no script,
no attributes. There is nothing to leak because for a visitor nothing is rendered.

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

| | |
|---|---|
| `text`, `textarea`, `integer` | yes |
| everything else | renders normally, is not clickable |

The list lives in `config/statamic-inline-edit.php` and is deliberately short. What travels back
to the server is always the browser's `innerText`, never `innerHTML`, so no markup a
contenteditable produces can reach your content. That safety model only holds while every
fieldtype on the list stores a plain string. **Adding `markdown` or `bard` does not give you a
rich editor, it gives you a field whose formatting the next save flattens.**

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
| `fieldtypes` | `text`, `textarea`, `integer` | See above before extending it. |
| `multiline` | `textarea` | Of those, the ones where Enter inserts a line break instead of leaving the field. |
| `inject` | `true` | Places the editor before `</body>` automatically. Switch off and use `{{ inline_edit:assets }}` if a Content Security Policy needs the script somewhere specific. |
| `max_length` | `100000` | A ceiling on any one field, independent of the blueprint. |

## Not in this version

Named, not hidden:

- **Bard, Replicator and Grid.** No inline editing. Core builds those values without a link
  back to their entry, so the text is genuinely unaddressable from the page.
- **Markdown** with a formatting toolbar.
- **Images.** Swapping an asset from the page.
- **Revisions.** A collection with revisions enabled refuses the save and says so, rather than
  writing straight past a workflow whose whole point is that somebody approves first.
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
vendor/bin/phpunit          # 18 tests: the tag and the save route
vendor/bin/pint --test
vendor/bin/phpstan analyse

npm install
node tests/browser/run.mjs  # 55 checks: everything that only exists in a browser
```

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
