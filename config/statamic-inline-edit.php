<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Enabled
    |--------------------------------------------------------------------------
    |
    | The master switch. Off means the {{ editable }} tag renders exactly what
    | {{ your_field }} would have rendered, the editor script is never injected
    | and the save route answers 404. Nothing about the public page changes
    | either way — the markers only ever exist for a signed-in user who is
    | allowed to edit the entry in question.
    |
    | Switch it off on production while you are still deciding, not by removing
    | the tags from your templates.
    |
    */

    'enabled' => env('STATAMIC_INLINE_EDIT_ENABLED', true),

    /*
    |--------------------------------------------------------------------------
    | Editable fieldtypes
    |--------------------------------------------------------------------------
    |
    | Which fieldtypes may be edited on the page. Deliberately short, and
    | deliberately all of them plain strings.
    |
    | The editor reads what the browser calls innerText and sends that, so no
    | markup can ever travel from the page into your content. That is the whole
    | safety model of version 1, and it only holds while every fieldtype here
    | stores a plain string. Adding `markdown` or `bard` to this list does not
    | give you a rich editor, it gives you a field whose formatting the next
    | save flattens.
    |
    | Anything not on this list renders normally and is simply not clickable.
    |
    | The slug is not here and cannot be put here: it decides the URL, so
    | changing it moves the page out from under the person editing it and
    | breaks every link to it. The save route refuses it outright.
    |
    */

    'fieldtypes' => [
        'text',
        'textarea',
        'integer',
    ],

    /*
    |--------------------------------------------------------------------------
    | Control fieldtypes
    |--------------------------------------------------------------------------
    |
    | Fields whose value is not the text on the page. A toggle renders as
    | "ja" or "in stock" or a coloured dot, depending on what the template
    | makes of it, so there is nothing to put a cursor in. These open a small
    | control instead, and the page reloads after saving so the template
    | renders the new value its own way.
    |
    | They need the pair form, because the tag has to wrap whatever the
    | template produced rather than produce it itself:
    |
    |     {{ editable field="promoted" }}{{ if promoted }}ja{{ else }}nein{{ /if }}{{ /editable }}
    |
    */

    'controls' => [
        'toggle',
        'select',
        'date',
    ],

    /*
    |--------------------------------------------------------------------------
    | Source fieldtypes
    |--------------------------------------------------------------------------
    |
    | Fields that render as HTML but are stored as text. How one of these
    | opens depends on `rich` below: as a real editor in place, or as its own
    | markdown source in a monospace box.
    |
    */

    'source' => [
        'markdown',
    ],

    /*
    |--------------------------------------------------------------------------
    | Rich editing for source fields
    |--------------------------------------------------------------------------
    |
    | With this on, a markdown field is edited where it sits: the text on the
    | page becomes the editor, markdown shortcuts work as you type them
    | (`## `, `- `, `**bold**`), and selecting text raises a small toolbar.
    | It is Tiptap, the same editor Statamic's own Bard is built on, fetched
    | the first time somebody opens such a field and never on a page nobody
    | is editing.
    |
    | Off gives you the plain source editor instead: the markdown itself in a
    | monospace box.
    |
    | The difference that matters is not the look. A rich editor reads the
    | markdown into a document and writes it back out, and markdown has more
    | than one spelling for the same document: `*a*` may return as `_a_`, a
    | reference link as an inline one. Editing one sentence therefore
    | rewrites the whole field in the editor's own dialect. If you have
    | markdown you need back byte for byte, hand-written tables, HTML blocks,
    | footnotes, switch this off.
    |
    | Either way, opening a field and closing it without typing never writes:
    | the comparison is against what the editor produced on mount, not
    | against what was stored.
    |
    */

    'rich' => true,

    /*
    |--------------------------------------------------------------------------
    | Multiline fieldtypes
    |--------------------------------------------------------------------------
    |
    | Of those, the ones where Enter inserts a line break instead of saving and
    | leaving the field. A subset of the list above; a handle here that is not
    | there does nothing.
    |
    */

    'multiline' => [
        'textarea',
    ],

    /*
    |--------------------------------------------------------------------------
    | Fieldtypes that open in place
    |--------------------------------------------------------------------------
    |
    | Fields too big for this addon's own editor and too central to the page to
    | be pulled out of it. A Bard is the article. Opening it as a card in the
    | middle of the screen means writing the page somewhere that is not the
    | page, and the layout you were looking at is gone while you type.
    |
    | These open the same real control panel field as the list below — same
    | fieldtype, same validation, same save — but the frame is put where the
    | content was, at the width the content had, with nothing painted behind
    | it. The page keeps its header, its margins and its type, and the text
    | you are editing sits in the column it will be read in.
    |
    | The typography is not guessed: the page measures the element that was
    | double-clicked and hands the editor its font, size, leading, colour and
    | spacing, for each kind of block it can contain.
    |
    | Needs the pair form, because what a Bard renders is the template's job:
    |
    |     {{ editable field="content" }}{{ content }}{{ /editable }}
    |
    | Entries under revisions keep the card: one field written past a working
    | copy would publish straight to the site, and the one-field route refuses
    | them for that reason.
    |
    */

    'inline' => [
        'bard',
    ],

    /*
    |--------------------------------------------------------------------------
    | Inject the editor automatically
    |--------------------------------------------------------------------------
    |
    | With this on, the stylesheet, the script and the configuration are placed
    | before </body> on any page that rendered at least one marker, and only for
    | the signed-in user who may edit it. That is one integration step fewer:
    | you add tags to the fields you want editable and nothing to your layout.
    |
    | Turn it off if you would rather place {{ inline_edit:assets }} yourself,
    | for instance because of a strict Content Security Policy.
    |
    */

    'inject' => true,

    /*
    |--------------------------------------------------------------------------
    | Which route groups the editor rides on
    |--------------------------------------------------------------------------
    |
    | `statamic.web` is the group Statamic serves its own pages in, and on an
    | Antlers site that is every page there is. Leave this alone.
    |
    | A site that draws its own pages — React through Inertia, Blade, a
    | controller of your own — serves them from `web` instead, and none of that
    | goes through `statamic.web`. Nothing would inject the editor there, and
    | nothing would mark those responses uncacheable either. Add your group:
    |
    |     'middleware_groups' => ['statamic.web', 'web'],
    |
    | Naming both is safe. Statamic's own frontend controller adds
    | `statamic.web` on top of `web`, so its pages pass through twice, and the
    | second pass sees the script is already there and leaves it alone.
    |
    */

    'middleware_groups' => [
        'statamic.web',
    ],

    /*
    |--------------------------------------------------------------------------
    | Place the editor on every page a signed-in editor opens
    |--------------------------------------------------------------------------
    |
    | Off, the editor is placed on pages that rendered a marker, which is the
    | right answer whenever a new page means a new request.
    |
    | It is the wrong answer for a site that draws itself. Going from a list to
    | an article inside a React or Vue application never reaches the server:
    | the response is JSON, nothing is injected into it, and the markers that
    | arrive with it have no script to act on them. The page looks editable and
    | double-clicking does nothing, silently — which is the worst way for this
    | to fail, because there is nothing to see and nothing to look up.
    |
    | On, the script is already there when those markers appear, and it takes
    | them in. It shows nothing on a page that has none.
    |
    | The price is stated rather than hidden: the script carries a CSRF token,
    | so every page a signed-in editor opens is marked uncacheable. On a site
    | whose pages Statamic does not serve that costs nothing, because Statamic
    | is not caching them either. Leave this off anywhere else.
    |
    */

    'inject_for_signed_in' => false,

    /*
    |--------------------------------------------------------------------------
    | Fall back to the control panel
    |--------------------------------------------------------------------------
    |
    | What to do with a marked field that none of the lists above covers: a
    | Bard, a Replicator, an image, a Grid. With this on, double-clicking it
    | opens a panel over the page holding that one field.
    |
    | Deliberately the real control panel field in an iframe, not a rebuilt
    | editor. Bard alone is a whole editor, an asset picker is a whole browser,
    | and a second-rate copy of either is worse than the real one. Saving goes
    | through the blueprint's own validation and permissions, and the page
    | reloads when the panel closes.
    |
    | On a collection with revisions the whole entry form opens instead: one
    | field written past a working copy would publish straight to the site.
    |
    | Switch it off if your control panel sits behind a proxy that refuses to
    | be framed, or on another domain. Those fields then simply render
    | normally and are not clickable.
    |
    */

    'control_panel' => true,

    /*
    |--------------------------------------------------------------------------
    | Maximum length
    |--------------------------------------------------------------------------
    |
    | A ceiling on any single field the save route accepts, independent of what
    | the blueprint says. This is not a content rule, it is a bound on what a
    | browser can post into your flat files in one request.
    |
    */

    'max_length' => 100000,

];
