<?php

namespace Goldnead\StatamicInlineEdit\Tags;

use Goldnead\StatamicInlineEdit\Support\Editor;
use Illuminate\Support\Facades\Route;
use Statamic\Fields\Value;
use Statamic\Tags\Tags;

/**
 * {{ editable:hero_title }} — the one tag a template author touches.
 *
 * Use it exactly where you would have written {{ hero_title }} and expected
 * text to come out. For a visitor, or for anyone who may not edit this entry,
 * it renders that and nothing else: same bytes, same markup, no wrapper, no
 * attributes. Nobody who is not editing pays for this addon being installed.
 *
 * For an editor it renders the same text inside a marker that carries the
 * three things the browser needs to send it back: which entry, which field,
 * and what the entry looked like when the page was built.
 *
 * ## Why the field has to be named here at all
 *
 * Because Antlers cannot tell us afterwards. By the time a rendered value is
 * appended to the output buffer, it is a string — the Value object that knew
 * its handle and its entry has already been reduced away, and the runtime
 * offers no hook in between. Marking the field in the template is what every
 * comparable tool does, for the same reason.
 */
class Editable extends Tags
{
    protected static $handle = 'editable';

    /**
     * {{ editable field="hero_title" }} — for when the field name is itself a
     * variable, which the colon form cannot express.
     */
    public function index(): string
    {
        return $this->renderField((string) $this->params->get('field', ''));
    }

    /**
     * {{ editable:hero_title }} — the normal form.
     *
     * A wildcard, and nothing but a wildcard: this tag declares no named
     * methods on purpose. A method called `head()` here would quietly shadow a
     * field called `head`, and the author would have no way to reach their own
     * content. The plumbing lives on a separate `inline_edit` tag for exactly
     * this reason.
     */
    public function wildcard(string $method): string
    {
        return $this->renderField($method);
    }

    protected function renderField(string $field): string
    {
        if ($field === '') {
            return '';
        }

        $value = $this->context->get($field);

        // The pair form hands the visible output to the template:
        //
        //     {{ editable field="promoted" }}{{ if promoted }}ja{{ /if }}{{ /editable }}
        //
        // Needed for everything whose value is not the text on the page. A
        // toggle renders as a word the template chose, an image as an <img>,
        // a Bard as a whole section, and none of those can be produced from
        // the value by a tag that does not know the design.
        $inner = $this->isPair ? (string) $this->parse() : null;

        $text = $inner ?? $this->stringify($value instanceof Value ? $value->value() : $value);

        [$attributes, $trailer] = $this->marker($field, $value, $text, $inner !== null);

        if ($attributes === null) {
            return $text;
        }

        $mode = $value instanceof Value ? (app(Editor::class)->modeFor($this->fieldtype($value)) ?? 'text') : 'text';
        $tag = $this->tagName($mode);

        return '<'.$tag.' '.$attributes.'>'.$text.'</'.$tag.'>'.$trailer;
    }

    /**
     * The attributes, or null when this field must render bare.
     *
     * Gates in cheapest-first order, each one a separate reason and none of
     * them interchangeable: switched off, not signed in, the value is not a
     * real field, the field is nested somewhere we cannot address, the
     * fieldtype has no way of being edited at all.
     *
     * @return array{0: ?string, 1: string} the attributes, and any markup that
     *                                      has to sit next to the element
     */
    protected function marker(string $field, mixed $value, string $text, bool $isPair): array
    {
        $editor = app(Editor::class);

        if (! $editor->enabled() || ! $editor->user()) {
            return [null, ''];
        }

        if (! $value instanceof Value) {
            return [null, ''];
        }

        // Null inside a Bard or Replicator set, where core builds the value
        // without a parent. The text is genuinely unaddressable from here: it
        // has no entry of its own and no path back to the one it belongs to.
        $entry = $value->augmentable();

        if (! $editor->canEdit($entry)) {
            return [null, ''];
        }

        $type = $this->fieldtype($value);
        $mode = $editor->modeFor($type);

        if ($mode === null) {
            return [null, ''];
        }

        // A text field's value IS the text on the page, and that is the only
        // reason it can be edited in place. Wrapped in a pair, the template
        // may have put markup, a second field or a separator inside, and the
        // browser's innerText would then be saved over the value. Refused
        // rather than guessed at.
        if ($mode === 'text' && $isPair) {
            return [null, ''];
        }

        $editor->markRendered();

        $attributes = [
            'data-sie-id' => (string) $entry->id(),
            'data-sie-field' => $value->handle() ?: $field,
            'data-sie-type' => $type,
            'data-sie-mode' => $mode,
            'data-sie-stamp' => $this->stamp($entry),
        ];

        // Modes where what gets typed is not what the page will show. A
        // toggle renders through the template's own `if`, markdown through a
        // renderer, a Bard through the whole section partial. Only a reload
        // shows the truth, and pretending otherwise leaves the editor looking
        // at their input instead of their page.
        if ($mode !== 'text') {
            $attributes['data-sie-reload'] = 'true';
        }

        $trailer = '';

        if ($mode === 'control') {
            $attributes['data-sie-raw'] = $this->scalar($value->raw());

            if ($type === 'select' && ($options = $this->options($value)) !== null) {
                $attributes['data-sie-options'] = $options;
            }
        }

        if ($mode === 'source') {
            // In a script block rather than an attribute: this is the whole
            // body of a markdown field, and an attribute carrying a few
            // kilobytes of escaped newlines is unreadable in the source and
            // easy to break with one stray quote.
            $trailer = '<script type="application/json" class="sie-source">'
                .$this->json($this->scalar($value->raw()))
                .'</script>';
        }

        // The whole URL, built here rather than assembled in the browser. The
        // control panel lives wherever `statamic.cp.route` says, which a
        // script on the frontend has no way of knowing, and a guessed `/cp`
        // would send half the installations to a 404.
        if ($mode === 'cp' && ($url = $this->panelUrl($entry))) {
            $attributes['data-sie-cp'] = $url;

            // And, where it is possible, the one field on its own. The full
            // form stays on the element as the fallback: it is what an entry
            // under revisions still gets, and what the browser falls back to
            // if this route is missing from an older published copy.
            if ($fieldUrl = $this->fieldUrl($entry, $value->handle() ?: $field)) {
                $attributes['data-sie-field-url'] = $fieldUrl;
            }
        }

        // The field's own label from the blueprint, for the placeholder an
        // empty field shows. "Add subtitle" tells the person which of three
        // empty boxes on the page they are looking at; "Empty" does not.
        if ($label = $this->label($value)) {
            $attributes['data-sie-label'] = $label;
        }

        if ($mode === 'text' && $editor->isMultiline($type)) {
            $attributes['data-sie-multiline'] = 'true';

            // Only when the stored value really has line breaks in it.
            //
            // A multiline field needs `white-space: pre-wrap` to be editable
            // without losing those breaks, because ordinary HTML collapses
            // them into spaces and a save would then write the collapsed text
            // back. But applying it to every textarea would re-wrap
            // paragraphs that have no breaks to show, for nothing.
            //
            // Flagged from the server rather than measured in the browser, so
            // the style is on the element from the first paint and the page
            // never reflows underneath the person reading it.
            if (str_contains($text, "\n")) {
                $attributes['data-sie-wraps'] = 'true';
            }
        }

        $rendered = collect($attributes)
            ->map(fn (string $v, string $k): string => $k.'="'.e($v).'"')
            ->implode(' ');

        return [$rendered, $trailer];
    }

    /**
     * Where this entry is edited in the control panel.
     *
     * Null rather than fatal when the route is not registered, which is the
     * case in a package test that boots the provider without core's own
     * control panel routes. A missing overlay costs a click; an exception
     * costs the page.
     */
    protected function panelUrl(mixed $entry): ?string
    {
        if (! is_object($entry) || ! method_exists($entry, 'collectionHandle')) {
            return null;
        }

        if (! Route::has('statamic.cp.collections.entries.edit')) {
            return null;
        }

        return route('statamic.cp.collections.entries.edit', [
            'collection' => $entry->collectionHandle(),
            'entry' => $entry->id(),
        ]);
    }

    /**
     * Where this one field is edited on its own.
     *
     * Null when the entry uses revisions: saving one field there would write
     * straight past the person who is meant to approve it, and making a
     * working copy properly is the control panel's own job. Those entries
     * keep opening the whole form, which knows how.
     */
    protected function fieldUrl(mixed $entry, string $handle): ?string
    {
        if (! is_object($entry) || ! method_exists($entry, 'collectionHandle')) {
            return null;
        }

        if (! Route::has('statamic.cp.inline-edit.field.edit')) {
            return null;
        }

        if (method_exists($entry, 'revisionsEnabled') && $entry->revisionsEnabled()) {
            return null;
        }

        return route('statamic.cp.inline-edit.field.edit', [
            'collection' => $entry->collectionHandle(),
            'entry' => $entry->id(),
            'handle' => $handle,
        ]);
    }

    /**
     * The configured choices of a select, as JSON for the browser.
     *
     * Null when the field does not offer a fixed set, which is the case for
     * a select with `taggable` on: there is nothing to put in a dropdown, and
     * offering an empty one would be worse than leaving the field alone.
     */
    protected function options(Value $value): ?string
    {
        $field = $value->field();

        if (! $field || ! method_exists($field, 'get')) {
            return null;
        }

        $options = $field->get('options');

        if (! is_array($options) || $options === []) {
            return null;
        }

        // Statamic accepts both shapes: a map of value to label, and a plain
        // list where the value is its own label.
        $normalised = [];

        foreach ($options as $key => $label) {
            $normalised[] = [
                'value' => (string) (is_int($key) ? $label : $key),
                'label' => (string) ($label === null ? $key : $label),
            ];
        }

        return $this->json($normalised);
    }

    /**
     * A stored value flattened to the string the browser will send back.
     *
     * A toggle arrives as a real boolean and must not become "1" or "" by
     * accident, because the control has to show the right state before
     * anybody touches it.
     */
    protected function scalar(mixed $raw): string
    {
        if (is_bool($raw)) {
            return $raw ? 'true' : 'false';
        }

        if (is_string($raw) || is_int($raw) || is_float($raw)) {
            return (string) $raw;
        }

        return '';
    }

    /**
     * Strict flags, always. This lands inside an attribute or a script block
     * on a page, and a value a client typed into the control panel must not
     * be able to close either of them.
     */
    protected function json(mixed $data): string
    {
        return (string) json_encode(
            $data,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
        );
    }

    /**
     * When the entry was last written, as the page believed it at render time.
     *
     * Sent back with every save and compared there. Two people on the same
     * page otherwise overwrite each other in silence, and the one who saved
     * first never finds out. An empty string when the entry cannot say —
     * the save route treats that as "do not check" rather than as a conflict,
     * because refusing every save is the worse failure.
     */
    protected function stamp(mixed $entry): string
    {
        if (! is_object($entry) || ! method_exists($entry, 'lastModified')) {
            return '';
        }

        $modified = $entry->lastModified();

        return $modified ? (string) $modified->getTimestamp() : '';
    }

    /**
     * The blueprint's display name for the field, if it has one.
     *
     * Never fatal: a field can be built without one, and a missing label costs
     * a nicer placeholder, nothing else.
     */
    protected function label(Value $value): ?string
    {
        $field = $value->field();

        if (! $field || ! method_exists($field, 'display')) {
            return null;
        }

        $display = $field->display();

        return is_string($display) && $display !== '' ? $display : null;
    }

    protected function fieldtype(Value $value): ?string
    {
        $fieldtype = $value->fieldtype();

        return $fieldtype ? $fieldtype->handle() : null;
    }

    /**
     * The wrapper element.
     *
     * A span by default, because the overwhelming case is a heading or a
     * sentence already sitting inside its own block element. Pass tag="div"
     * where a span would be wrong.
     */
    protected function tagName(string $mode = 'text'): string
    {
        // A markdown field is block content by nature: a heading, paragraphs,
        // a list. Wrapped in a span it has no box of its own, so the outline
        // that says "this is editable" is simply not drawn, and neither is
        // the one that says "this has unsaved changes". The demo page walked
        // straight into that, which is how it was found.
        $default = $mode === 'source' ? 'div' : 'span';

        $tag = (string) $this->params->get('tag', $default);

        // Anything that is not a plain element name is a template author
        // typing into an attribute we interpolate into markup unescaped.
        return preg_match('/^[a-z][a-z0-9-]*$/', $tag) ? $tag : $default;
    }

    /**
     * What Antlers itself would have printed.
     *
     * Arrays and objects come out empty, which is what {{ a_list_field }}
     * does too. This tag is for text; anything else is a template mistake that
     * shows up immediately as a blank space rather than as an exception on a
     * live page.
     */
    protected function stringify(mixed $value): string
    {
        if (is_string($value)) {
            return $value;
        }

        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }

        if (is_object($value) && method_exists($value, '__toString')) {
            return (string) $value;
        }

        return '';
    }
}
