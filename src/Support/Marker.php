<?php

namespace Goldnead\StatamicInlineEdit\Support;

use Goldnead\StatamicInlineEdit\Http\Controllers\SaveController;
use Illuminate\Support\Facades\Route;
use Statamic\Fields\Value;

/**
 * The attributes that turn a piece of a page into an editable field.
 *
 * Extracted out of {{ editable }} rather than living in it, because the tag is
 * not the only caller any more. A Statamic site whose front end is React,
 * Blade or anything else has no Antlers to put a tag in, and had no way to use
 * this addon at all — the marker was locked inside a template engine it does
 * not run. Same decisions, same refusals, one place.
 *
 * Every gate that decides "may this be edited" is here. A second copy made for
 * the headless path is exactly how one of the two ends up more permissive than
 * the other, and the permissive one is always the one that gets found.
 */
class Marker
{
    /**
     * The marker for one field of one entry, for a front end that is not
     * Antlers.
     *
     * Hand the array to your template and spread it onto the element that
     * shows the field — in React `<div {...marker}>`, in Blade
     * `@foreach`, or through `attributeString()` below.
     *
     * Empty when this person may not edit this, when the addon is off, or when
     * the fieldtype has no way of being edited. Empty is the normal case: it
     * is what every visitor gets, and it means the element renders bare.
     *
     * @return array<string, string>
     */
    public function forEntry(mixed $entry, string $handle): array
    {
        if (! is_object($entry) || ! method_exists($entry, 'augmentedValue')) {
            return [];
        }

        $value = $entry->augmentedValue($handle);

        if (! $value instanceof Value) {
            return [];
        }

        // Not a pair: the caller named one field for one element, which is
        // the thing the pair form cannot promise. And the rendered text is
        // unknown, because whatever draws this element has not drawn it yet
        // and it is not this addon's markup — that costs only the line-break
        // flag on a textarea, which is an optimisation and not a gate.
        [$attributes] = $this->build($value, $handle, null, false);

        return $attributes;
    }

    /**
     * The same thing as a string of HTML attributes, for a template engine
     * that has no way of spreading an array.
     */
    public function attributeString(mixed $entry, string $handle): string
    {
        return collect($this->forEntry($entry, $handle))
            ->map(fn (string $v, string $k): string => $k.'="'.e($v).'"')
            ->implode(' ');
    }

    /**
     * The attributes, or an empty array when this field must render bare.
     *
     * Gates in cheapest-first order, each one a separate reason and none of
     * them interchangeable: switched off, not signed in, the value is not a
     * real field, the field is nested somewhere we cannot address, the
     * fieldtype has no way of being edited at all.
     *
     * @param  string|null  $text  what the page will show, where the caller knows
     * @param  bool  $isPair  whether the visible output came from the template
     * @return array{0: array<string, string>, 1: string} the attributes, and any
     *                                                    markup that has to sit
     *                                                    next to the element
     */
    public function build(Value $value, string $field, ?string $text, bool $isPair): array
    {
        $editor = app(Editor::class);

        if (! $editor->enabled() || ! $editor->user()) {
            return [[], ''];
        }

        // Null inside a Bard or Replicator set, where core builds the value
        // without a parent. The text is genuinely unaddressable from here: it
        // has no entry of its own and no path back to the one it belongs to.
        $entry = $value->augmentable();

        if (! $editor->canEdit($entry)) {
            return [[], ''];
        }

        $handle = $value->handle() ?: $field;

        // The handles every way in refuses: the slug decides the URL,
        // `published` decides whether the page exists at all, and the rest are
        // the entry's own plumbing. Both the save route and the one-field form
        // already turn these away — but until this was here, a `cp` marker was
        // still drawn on them, and double-clicking it opened a panel that
        // answered 404. A marker that cannot lead anywhere is a broken promise,
        // not a safe default.
        if (in_array($handle, SaveController::FORBIDDEN, true)) {
            return [[], ''];
        }

        $type = $this->fieldtype($value);
        $mode = $editor->modeFor($type);

        if ($mode === null) {
            return [[], ''];
        }
        $fieldUrl = in_array($mode, ['cp', 'inline'], true) ? $this->fieldUrl($entry, $handle) : null;

        // Editing in place needs the one-field route. Where it is missing — an
        // entry under revisions, an older published copy without the route —
        // the only thing left is the whole entry form, and that cannot stand
        // in the column the article is read in. So: the card, as before.
        if ($mode === 'inline' && $fieldUrl === null) {
            $mode = 'cp';
        }

        // A text field's value IS the text on the page, and that is the only
        // reason it can be edited in place. Wrapped in a pair, the template
        // may have put markup, a second field or a separator inside, and the
        // browser's innerText would then be saved over the value. Refused
        // rather than guessed at.
        if ($mode === 'text' && $isPair) {
            return [[], ''];
        }

        $editor->markRendered();

        $attributes = [
            'data-sie-id' => (string) $entry->id(),
            'data-sie-field' => $handle,
            'data-sie-type' => (string) $type,
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
        if (in_array($mode, ['cp', 'inline'], true)) {
            if ($url = $this->panelUrl($entry)) {
                $attributes['data-sie-cp'] = $url;
            }

            // And, where it is possible, the one field on its own. The full
            // form stays on the element as the fallback: it is what an entry
            // under revisions still gets, and what the browser falls back to
            // if this route is missing from an older published copy.
            if ($fieldUrl !== null) {
                // `inplace` is a property of how this field was marked, not of
                // the person opening it, so it belongs in the URL the server
                // built and not in a flag the browser appends. A frame that
                // decides its own chrome from a query string it was handed is
                // one less round of postMessage before the first paint.
                $attributes['data-sie-field-url'] = $mode === 'inline'
                    ? $fieldUrl.(str_contains($fieldUrl, '?') ? '&' : '?').'inplace=1'
                    : $fieldUrl;
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
            if ($text !== null && str_contains($text, "\n")) {
                $attributes['data-sie-wraps'] = 'true';
            }
        }

        return [$attributes, $trailer];
    }

    /**
     * Where this entry is edited in the control panel.
     *
     * Null rather than fatal when the route is not registered, which is the
     * case in a package test that boots the provider without core's own
     * control panel routes. A missing overlay costs a click; an exception
     * costs the page.
     */
    public function panelUrl(mixed $entry): ?string
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
    public function fieldUrl(mixed $entry, string $handle): ?string
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
}
