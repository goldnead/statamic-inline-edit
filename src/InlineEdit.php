<?php

namespace Goldnead\StatamicInlineEdit;

use Goldnead\StatamicInlineEdit\Support\Assets;
use Goldnead\StatamicInlineEdit\Support\Editor;
use Goldnead\StatamicInlineEdit\Support\Marker;

/**
 * The addon, for a front end that is not Antlers.
 *
 * A Statamic site is not always Antlers any more. The control panel stays, the
 * content stays, and the pages are drawn by React through Inertia, or by
 * Blade, or by a separate front end entirely. Those sites could not use this
 * addon at all: the only way to mark a field was a template tag in an engine
 * they do not run.
 *
 * So the same marker, as an array:
 *
 *     // in your controller, or wherever you build the props
 *     'contentMarker' => InlineEdit::marker($entry, 'content'),
 *
 *     // in React
 *     <div {...contentMarker} dangerouslySetInnerHTML={{ __html: content }} />
 *
 *     // or in Blade
 *     <div {!! InlineEdit::attributes($entry, 'content') !!}>…</div>
 *
 * Everything else is unchanged, and deliberately so: the same permissions, the
 * same refusals, the same save route. An empty array is the normal answer —
 * it is what a visitor gets — and an element that spreads an empty array is
 * byte for byte the element it was.
 *
 * Two things a site like this has to do that an Antlers site does not:
 *
 *  1. Add its own route group to `middleware_groups` in the config. Pages
 *     drawn by your own controllers do not run in `statamic.web`, so neither
 *     the script nor the `do not cache this` header would reach them.
 *  2. Nothing else. The script is injected before `</body>` as usual, and it
 *     finds the markers in the DOM whatever drew them.
 */
class InlineEdit
{
    /**
     * The marker attributes for one field of one entry.
     *
     * @return array<string, string>
     */
    public static function marker(mixed $entry, string $handle): array
    {
        return app(Marker::class)->forEntry($entry, $handle);
    }

    /**
     * The same thing as a string of HTML attributes, already escaped.
     */
    public static function attributes(mixed $entry, string $handle): string
    {
        return app(Marker::class)->attributeString($entry, $handle);
    }

    /**
     * Whether this request has a marker on it at all.
     *
     * The answer to "should my layout bother", for a site that places the
     * assets by hand. False for every visitor.
     */
    public static function active(): bool
    {
        $editor = app(Editor::class);

        return $editor->enabled() && $editor->user() !== null && $editor->hasRendered();
    }

    /**
     * The stylesheet, the configuration and the script, for a layout that
     * places them itself.
     *
     * Only needed with `inject` off. Empty when there is nothing to edit.
     */
    public static function assets(): string
    {
        return static::active() ? app(Assets::class)->markup() : '';
    }
}
