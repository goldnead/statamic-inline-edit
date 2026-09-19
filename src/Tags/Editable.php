<?php

namespace Goldnead\StatamicInlineEdit\Tags;

use Goldnead\StatamicInlineEdit\Support\Editor;
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

        $text = $this->stringify($value instanceof Value ? $value->value() : $value);

        $marker = $this->marker($field, $value);

        if ($marker === null) {
            return $text;
        }

        $tag = $this->tagName();

        return '<'.$tag.' '.$marker.'>'.$text.'</'.$tag.'>';
    }

    /**
     * The attributes, or null when this field must render bare.
     *
     * Five gates, in the cheapest-first order. Each one is a separate reason
     * and they are not interchangeable: switched off, not signed in, the value
     * is not a real field, the field is nested somewhere we cannot address,
     * the fieldtype is not one we can safely put a cursor in.
     */
    protected function marker(string $field, mixed $value): ?string
    {
        $editor = app(Editor::class);

        if (! $editor->enabled() || ! $editor->user()) {
            return null;
        }

        if (! $value instanceof Value) {
            return null;
        }

        // Null inside a Bard or Replicator set, where core builds the value
        // without a parent. The text is genuinely unaddressable from here: it
        // has no entry of its own and no path back to the one it belongs to.
        $entry = $value->augmentable();

        if (! $editor->canEdit($entry)) {
            return null;
        }

        $type = $this->fieldtype($value);

        if (! $editor->isEditableFieldtype($type)) {
            return null;
        }

        $editor->markRendered();

        $attributes = [
            'data-sie-id' => (string) $entry->id(),
            'data-sie-field' => $value->handle() ?: $field,
            'data-sie-type' => $type,
            'data-sie-stamp' => $this->stamp($entry),
        ];

        if ($editor->isMultiline($type)) {
            $attributes['data-sie-multiline'] = 'true';
        }

        return collect($attributes)
            ->map(fn (string $v, string $k): string => $k.'="'.e($v).'"')
            ->implode(' ');
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
    protected function tagName(): string
    {
        $tag = (string) $this->params->get('tag', 'span');

        // Anything that is not a plain element name is a template author
        // typing into an attribute we interpolate into markup unescaped.
        return preg_match('/^[a-z][a-z0-9-]*$/', $tag) ? $tag : 'span';
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
