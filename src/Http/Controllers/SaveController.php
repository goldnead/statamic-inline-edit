<?php

namespace Goldnead\StatamicInlineEdit\Http\Controllers;

use Goldnead\StatamicInlineEdit\Support\Editor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Validation\ValidationException;
use Statamic\Contracts\Entries\Entry as EntryContract;
use Statamic\Facades\Entry;

/**
 * The only way anything this addon renders can write to your content.
 *
 * Everything here is a trust boundary, so nothing here is clever. Each request
 * is a list of changes, each change names one entry and the fields on it that
 * moved, and each one is checked from scratch: the entry exists, this user may
 * update it, that handle is a real field on its blueprint, that fieldtype is
 * one we allow, the text is not absurdly long, the entry has not moved under
 * us, and the blueprint's own validation passes.
 *
 * Not core's control panel route, on purpose. That one validates the entire
 * blueprint, so a one-field save would fail on a `required` field somewhere
 * else on a screen the editor never opened — and it needs a control panel
 * session and its CSRF token rather than the site's.
 */
class SaveController extends Controller
{
    /**
     * Handles the frontend owns and this route must never write.
     *
     * The slug decides the URL, `published` decides whether the page exists
     * for the public, and the rest are core's own bookkeeping. All of them are
     * reachable through the control panel, where the consequence is visible.
     * None of them is a small text change.
     */
    protected const FORBIDDEN = ['id', 'slug', 'published', 'blueprint', 'date', 'author', 'parent'];

    public function __invoke(Request $request): JsonResponse
    {
        $editor = app(Editor::class);

        // Switched off means the route does not exist, not that it refuses.
        // A 403 would confirm the addon is installed to anyone who probes.
        abort_unless($editor->enabled(), 404);

        if (! $editor->user()) {
            return $this->error(__('statamic-inline-edit::messages.error_auth'), 403);
        }

        $data = $request->validate([
            'changes' => ['required', 'array', 'min:1', 'max:50'],
            'changes.*.id' => ['required', 'string', 'max:255'],
            'changes.*.stamp' => ['nullable', 'string', 'max:32'],
            'changes.*.fields' => ['required', 'array', 'min:1', 'max:50'],
        ]);

        $saved = [];

        foreach ($data['changes'] as $change) {
            $result = $this->applyChange($editor, $change);

            if ($result instanceof JsonResponse) {
                return $result;
            }

            $saved[] = $result;
        }

        return response()->json(['saved' => $saved]);
    }

    /**
     * One entry. Returns its new stamp, or the response that stops the lot.
     *
     * Stops the lot, rather than saving what it can and reporting the rest:
     * a half-applied batch leaves the page showing a mixture of saved and
     * unsaved text with no way to tell which is which.
     *
     * @param  array<string, mixed>  $change
     * @return array<string, string>|JsonResponse
     */
    protected function applyChange(Editor $editor, array $change): array|JsonResponse
    {
        $entry = Entry::find($change['id']);

        if (! $entry instanceof EntryContract) {
            return $this->error(__('statamic-inline-edit::messages.error_missing'), 404);
        }

        if (! $editor->canEdit($entry)) {
            return $this->error(__('statamic-inline-edit::messages.error_forbidden'), 403);
        }

        // Revisions are a workflow, and writing past one is not a small text
        // change — it would publish straight to the live site on a collection
        // whose whole point is that somebody approves first. Refused out loud
        // until this addon can create a working copy properly.
        if (method_exists($entry, 'revisionsEnabled') && $entry->revisionsEnabled()) {
            return $this->error(__('statamic-inline-edit::messages.error_revisions'), 422);
        }

        if ($conflict = $this->conflict($entry, $change['stamp'] ?? null)) {
            return $conflict;
        }

        $values = $this->readFields($editor, $entry, (array) $change['fields']);

        if ($values instanceof JsonResponse) {
            return $values;
        }

        $blueprint = $entry->blueprint();

        $fields = $blueprint->fields()->only(...array_keys($values))->addValues($values);

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

        // On a localized entry this writes into that localization, which means
        // the field stops inheriting from its origin — exactly what the control
        // panel does once you localize a field there. Editing the German page
        // changes the German text and leaves the English alone.
        $entry->merge($fields->process()->values());

        $entry->save();

        return [
            'id' => (string) $entry->id(),
            'stamp' => $this->stamp($entry),
        ];
    }

    /**
     * Filter the submitted handles down to ones we are willing to write.
     *
     * The fieldtype gate is repeated here rather than trusted from the page.
     * The markers in the HTML say what the server offered; this request says
     * what a browser sent, and the two are only the same thing until somebody
     * opens the console.
     *
     * @param  array<array-key, mixed>  $fields
     * @return array<string, string|bool>|JsonResponse
     */
    protected function readFields(Editor $editor, EntryContract $entry, array $fields): array|JsonResponse
    {
        $blueprint = $entry->blueprint();
        $values = [];

        foreach ($fields as $handle => $value) {
            $handle = (string) $handle;

            if (in_array($handle, self::FORBIDDEN, true)) {
                return $this->error(__('statamic-inline-edit::messages.error_field', ['field' => $handle]), 422);
            }

            $field = $blueprint->hasField($handle) ? $blueprint->field($handle) : null;

            if (! $field || ! $editor->isWritableMode($editor->modeFor($field->type()))) {
                return $this->error(__('statamic-inline-edit::messages.error_field', ['field' => $handle]), 422);
            }

            // A toggle posts a real boolean and keeps it: cast to a string it
            // would arrive as "1" or "", and `false` and "" are the same
            // thing to a string cast but not to a blueprint.
            if (is_bool($value)) {
                $values[$handle] = $value;

                continue;
            }

            if (! is_string($value) && ! is_int($value) && ! is_float($value)) {
                return $this->error(__('statamic-inline-edit::messages.error_field', ['field' => $handle]), 422);
            }

            $value = (string) $value;

            // A select's choices are a fixed set, and the page said which.
            // Checked here anyway: the dropdown in the browser is a
            // suggestion, the request is what arrived.
            if ($field->type() === 'select' && ! $this->isOffered($field, $value)) {
                return $this->error(__('statamic-inline-edit::messages.error_field', ['field' => $handle]), 422);
            }

            if (mb_strlen($value) > $editor->maxLength()) {
                return $this->error(__('statamic-inline-edit::messages.error_long', ['field' => $handle]), 422);
            }

            // Browsers put U+00A0 where the editor pressed space at the end of
            // a line. It looks identical, survives a save, and then breaks the
            // next search for that phrase. Normalised here, once.
            $values[$handle] = str_replace("\u{00A0}", ' ', $value);
        }

        return $values;
    }

    /**
     * Is this one of the choices the blueprint actually offers?
     *
     * A select with no fixed options is `taggable`, where any string is a
     * legitimate value and the blueprint's own validation is the only gate.
     * An empty value is always allowed: that is how a field is cleared.
     */
    protected function isOffered(mixed $field, string $value): bool
    {
        if ($value === '') {
            return true;
        }

        $options = method_exists($field, 'get') ? $field->get('options') : null;

        if (! is_array($options) || $options === []) {
            return true;
        }

        foreach ($options as $key => $label) {
            if ((string) (is_int($key) ? $label : $key) === $value) {
                return true;
            }
        }

        return false;
    }

    /**
     * Has anyone else written this entry since the page was rendered?
     *
     * An empty stamp on either side means "cannot tell", and cannot-tell is
     * treated as no conflict. Refusing a save because an entry could not
     * report its own modification time would make the addon unusable on
     * whichever storage driver happens not to track it.
     */
    protected function conflict(EntryContract $entry, ?string $stamp): ?JsonResponse
    {
        $current = $this->stamp($entry);

        if (! $stamp || $current === '') {
            return null;
        }

        if ($stamp === $current) {
            return null;
        }

        return $this->error(__('statamic-inline-edit::messages.error_conflict'), 409);
    }

    protected function stamp(EntryContract $entry): string
    {
        if (! method_exists($entry, 'lastModified')) {
            return '';
        }

        $modified = $entry->lastModified();

        return $modified ? (string) $modified->getTimestamp() : '';
    }

    protected function error(string $message, int $status): JsonResponse
    {
        return response()->json(['message' => $message], $status);
    }
}
