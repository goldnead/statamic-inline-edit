<?php

namespace Goldnead\StatamicInlineEdit\Tags;

use Goldnead\StatamicInlineEdit\Support\Assets;
use Goldnead\StatamicInlineEdit\Support\Editor;
use Statamic\Tags\Tags;

/**
 * The plumbing, kept away from {{ editable }} so that no field name can ever
 * collide with a method name here.
 */
class InlineEdit extends Tags
{
    protected static $handle = 'inline_edit';

    /**
     * {{ inline_edit:assets }} — place the editor by hand.
     *
     * Only needed with `inject` switched off in the config, which is the
     * answer for sites whose Content Security Policy will not have a script
     * tag appear from a middleware. Put it immediately before </body>, after
     * the content, or the markers it looks for will not exist yet.
     *
     * Renders nothing when nobody is signed in, and nothing on a page with no
     * editable field on it.
     */
    public function assets(): string
    {
        $editor = app(Editor::class);

        if (! $editor->enabled() || ! $editor->user() || ! $editor->hasRendered()) {
            return '';
        }

        return app(Assets::class)->markup();
    }
}
