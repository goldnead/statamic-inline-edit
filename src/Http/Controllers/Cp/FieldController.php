<?php

namespace Goldnead\StatamicInlineEdit\Http\Controllers\Cp;

use Goldnead\StatamicInlineEdit\Http\Controllers\SaveController;
use Goldnead\StatamicInlineEdit\Support\Editor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Statamic\Facades\Blueprint;
use Statamic\Fields\Field;
use Statamic\Fields\Fields;
use Statamic\Http\Controllers\CP\CpController;

use function Statamic\trans as __;

/**
 * One field of one entry, as a real control panel publish form.
 *
 * A Bard, a Replicator, an asset picker: things this addon cannot do justice
 * to on the public page, and things nobody should rebuild. Until now the
 * answer was to open the whole entry form in a full-screen frame, which meant
 * double-clicking a paragraph and being handed a sidebar, a revision history
 * and nineteen fields nobody asked about.
 *
 * So: the same fieldtype, the same Vue component, the same metadata core would
 * send — for exactly the field that was double-clicked, and nothing else. The
 * frame around it is then the size of the field rather than the size of the
 * screen.
 *
 * Conditions are stripped from the field's config on the way out. `if: {other
 * field}` cannot be answered on a form that contains one field, and a field
 * that hides itself because its condition has nothing to read is worse than a
 * field whose condition is ignored for the minute it is open.
 */
class FieldController extends CpController
{
    public function edit(Request $request, $collection, $entry, string $handle)
    {
        $this->authorize('view', $entry);

        [$fields, $field, $blueprint] = $this->fieldsFor($entry, $handle);

        return Inertia::render('statamic-inline-edit::Field', [
            'handle' => $handle,
            'title' => $field->display(),
            'blueprint' => $blueprint->toPublishArray(),
            'values' => $fields->values()->all(),
            'meta' => $fields->meta()->all(),
            'saveUrl' => cp_route('inline-edit.field.update', [
                'collection' => $collection->handle(),
                'entry' => $entry->id(),
                'handle' => $handle,
            ]),
            // The control panel talks to itself with axios and the XSRF cookie.
            // This page posts with fetch, which does not, so the token comes
            // along as a prop rather than being dug back out of the cookie jar.
            'csrfToken' => csrf_token(),
            'readOnly' => $request->user()->cant('update', $entry),
            // Whether this frame stands where the content stood, rather than
            // on a card over it. It changes nothing about what is saved and
            // nothing about who may save it — only the chrome around the
            // field, which is why it may come from the query string.
            'inplace' => $request->boolean('inplace'),
            'labels' => [
                'save' => __('statamic-inline-edit::messages.save'),
                'saving' => __('statamic-inline-edit::messages.saving'),
                'close' => __('statamic-inline-edit::messages.close'),
                'failed' => __('statamic-inline-edit::messages.failed'),
            ],
        ]);
    }

    public function update(Request $request, $collection, $entry, string $handle): JsonResponse
    {
        $this->authorize('update', $entry);

        [$fields] = $this->fieldsFor($entry, $handle, preProcess: false);

        $fields = $fields->addValues([$handle => $request->input($handle)]);

        try {
            $fields->validator()
                ->withReplacements([
                    'id' => $entry->id(),
                    'collection' => $entry->collectionHandle(),
                    'site' => $entry->locale(),
                ])
                ->validate();
        } catch (ValidationException $e) {
            return response()->json([
                'message' => __('statamic-inline-edit::messages.error_invalid'),
                'errors' => $e->errors(),
            ], 422);
        }

        // Writes into this localization, which is what the control panel's own
        // save does once a field has been localized there. The English page is
        // left alone when the German one is edited.
        $entry->merge($fields->process()->values());

        $entry->save();

        return response()->json(['saved' => true]);
    }

    /**
     * The one field, with its value read in, plus the field itself.
     *
     * Everything that decides whether this request is allowed at all happens
     * here, because both endpoints need the same answer and an endpoint that
     * checks a subset of what its sibling checks is how a hole is made.
     *
     * @return array{0: Fields, 1: Field, 2: \Statamic\Fields\Blueprint}
     */
    protected function fieldsFor($entry, string $handle, bool $preProcess = true): array
    {
        $editor = app(Editor::class);

        // Switched off means the route does not exist, not that it refuses.
        abort_unless($editor->enabled(), 404);

        // Revisions are a workflow: saving here would write straight past the
        // person who is meant to approve. Those entries keep opening the whole
        // control panel form, which knows how to make a working copy — the tag
        // does not offer this route for them, and this is the second lock.
        abort_if(
            method_exists($entry, 'revisionsEnabled') && $entry->revisionsEnabled(),
            403,
            __('statamic-inline-edit::messages.error_revisions')
        );

        // The slug decides the URL, `published` decides whether the page
        // exists for the public. Same list the frontend save route refuses.
        abort_if(in_array($handle, SaveController::FORBIDDEN, true), 404);

        $blueprint = $entry->blueprint();

        abort_unless($blueprint && $blueprint->hasField($handle), 404);

        $blueprint->setParent($entry);

        $field = $blueprint->field($handle);

        $blueprint = $this->blueprintFor($entry, $handle, $field);

        $fields = $blueprint->fields();

        if (! $preProcess) {
            return [$fields, $field, $blueprint];
        }

        return [$fields->addValues([$handle => $entry->value($handle)])->preProcess(), $field, $blueprint];
    }

    protected function blueprintFor($entry, string $handle, Field $field): \Statamic\Fields\Blueprint
    {
        $config = collect($field->config())->except([
            'if', 'if_any', 'show_when', 'show_when_any',
            'unless', 'unless_any', 'hide_when', 'hide_when_any',
        ])->all();

        return Blueprint::makeFromFields([$handle => $config])->setParent($entry);
    }
}
