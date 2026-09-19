<?php

namespace Goldnead\StatamicInlineEdit\Http\Controllers;

use Goldnead\StatamicInlineEdit\Support\Editor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Statamic\Contracts\Entries\Entry as EntryContract;
use Statamic\Facades\Entry;
use Statamic\Fields\Value;

/**
 * What a markdown field will look like, before it is saved.
 *
 * Without this the editor types `**meistens vieles offen**` into a monospace
 * box, presses Done, sees the page exactly as it was, and presses Save. They
 * have not seen what they are saving; they have seen a number in a bar. The
 * one rule this addon exists to keep is that nobody saves something they have
 * not looked at.
 *
 * Rendered by the fieldtype itself rather than by a markdown library in the
 * browser. A second renderer would disagree with the real one sooner or
 * later, and a preview that lies is worse than none: this is the same
 * augmentation the page runs, so what comes back is what will be there.
 *
 * Writes nothing. The entry is never touched, and the value never leaves this
 * request.
 */
class PreviewController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $editor = app(Editor::class);

        abort_unless($editor->enabled(), 404);

        if (! $editor->user()) {
            return response()->json(['message' => __('statamic-inline-edit::messages.error_auth')], 403);
        }

        $data = $request->validate([
            'id' => ['required', 'string', 'max:255'],
            'field' => ['required', 'string', 'max:255'],
            'value' => ['present', 'string', 'max:'.$editor->maxLength()],
        ]);

        $entry = Entry::find($data['id']);

        if (! $entry instanceof EntryContract) {
            return response()->json(['message' => __('statamic-inline-edit::messages.error_missing')], 404);
        }

        // The same permission that governs writing. A preview of a field you
        // may not edit is a way to read a draft you may not read.
        if (! $editor->canEdit($entry)) {
            return response()->json(['message' => __('statamic-inline-edit::messages.error_forbidden')], 403);
        }

        $blueprint = $entry->blueprint();

        if (! $blueprint->hasField($data['field'])) {
            return response()->json(['message' => __('statamic-inline-edit::messages.error_field', ['field' => $data['field']])], 422);
        }

        $field = $blueprint->field($data['field']);

        // Only the fieldtypes that are edited as source have a preview worth
        // rendering, and only they are allowed one. Anything else would turn
        // this into a general-purpose render endpoint.
        if ($editor->modeFor($field->type()) !== 'source') {
            return response()->json(['message' => __('statamic-inline-edit::messages.error_field', ['field' => $data['field']])], 422);
        }

        // Built directly rather than through `Field::augment()`, which returns
        // a Field whose value is a Value, so the obvious `->augment()->value()`
        // hands back the wrapper instead of the HTML and the preview comes out
        // empty.
        $html = (new Value($data['value'], $data['field'], $field->fieldtype(), $entry))->value();

        return response()->json([
            'html' => is_string($html) ? $html : '',
        ]);
    }
}
