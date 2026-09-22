<?php

namespace Goldnead\StatamicInlineEdit\Tags;

use Goldnead\StatamicInlineEdit\Support\Marker;
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
 *
 * ## Where the decisions actually live
 *
 * Not here. Every gate and every attribute is in Support\Marker, because a
 * Statamic site whose front end is React or Blade has no Antlers to put a tag
 * in and needs the same answers. This class is what is left once that is
 * taken out: read the value, render the text, wrap it.
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

        if (! $value instanceof Value) {
            return $text;
        }

        [$attributes, $trailer] = app(Marker::class)->build($value, $field, $text, $inner !== null);

        if ($attributes === []) {
            return $text;
        }

        $tag = $this->tagName($attributes['data-sie-mode'] ?? 'text');

        $rendered = collect($attributes)
            ->map(fn (string $v, string $k): string => $k.'="'.e($v).'"')
            ->implode(' ');

        return '<'.$tag.' '.$rendered.'>'.$text.'</'.$tag.'>'.$trailer;
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
        //
        // A Bard is the same, only more so: it opens in place, and the frame
        // that replaces it needs a box to take the width of.
        $default = in_array($mode, ['source', 'inline'], true) ? 'div' : 'span';

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
