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
    | Fields that render as HTML but are stored as text. Double-clicking one
    | swaps the rendered output for its own source, which is then edited as
    | plain text with a small toolbar.
    |
    | Editing the source rather than the rendered HTML is the whole point.
    | A contenteditable over rendered markdown has to be converted back on
    | save, and every such conversion loses something: the exact list marker,
    | a reference link, a footnote, an HTML block someone put there on
    | purpose. The source round-trips byte for byte.
    |
    */

    'source' => [
        'markdown',
    ],

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
    | Fall back to the control panel
    |--------------------------------------------------------------------------
    |
    | What to do with a marked field that none of the lists above covers: a
    | Bard, a Replicator, an image, a Grid. With this on, double-clicking it
    | opens that entry's control panel form in an overlay on the same page.
    |
    | Deliberately the real control panel in an iframe, not a rebuilt editor.
    | Bard alone is a whole editor, an asset picker is a whole browser, and a
    | second-rate copy of either is worse than one click into the real one.
    | Saving there goes through the control panel's own validation, revisions
    | and permissions, and the page reloads when the overlay closes.
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
