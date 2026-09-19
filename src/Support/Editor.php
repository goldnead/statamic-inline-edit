<?php

namespace Goldnead\StatamicInlineEdit\Support;

use Statamic\Contracts\Entries\Entry as EntryContract;
use Statamic\Facades\User;

/**
 * The one place that answers "may this person edit this, and is this field the
 * kind of field we dare put a cursor in".
 *
 * Registered as `scoped`, so the tag that renders the first marker and the
 * middleware that decides whether to inject the script are looking at the same
 * object. Two instances would disagree, and the disagreement would show up as
 * an editor bar on a page with nothing to edit, or markers on a page with no
 * editor to act on them.
 */
class Editor
{
    /**
     * Whether any marker made it into this response.
     *
     * Set by the tag, read by the middleware. It is the difference between
     * "this page has editable fields on it" and "this person happens to be
     * signed in", and only the first one justifies shipping the editor.
     */
    protected bool $rendered = false;

    public function enabled(): bool
    {
        return (bool) config('statamic-inline-edit.enabled', true);
    }

    /**
     * The signed-in Statamic user, or null.
     *
     * Note that this is deliberately not "is an admin". Who may change a given
     * entry is a question core already answers through the entry policy, and
     * answering it a second time here is how an addon ends up more permissive
     * than the control panel it sits next to.
     */
    public function user(): ?object
    {
        return User::current();
    }

    /**
     * May the current user change this entry?
     *
     * Straight through core's `update` ability on the entry policy, which is
     * the same check the control panel's own save runs. If someone cannot edit
     * a page in the CP, no marker appears for them here either.
     *
     * Entries only in this version. Terms, globals and assets all reach the
     * template as augmented values too, and all three would need their own
     * way of being found again on save — an id alone is not enough for a term
     * without its taxonomy, or for a global set without its site. Rendering a
     * marker we cannot save is worse than rendering none.
     */
    public function canEdit(mixed $item): bool
    {
        if (! $item instanceof EntryContract) {
            return false;
        }

        $user = $this->user();

        if (! $user || ! method_exists($user, 'can')) {
            return false;
        }

        return (bool) $user->can('update', $item);
    }

    /**
     * @return array<int, string>
     */
    public function fieldtypes(): array
    {
        return array_values(array_filter((array) config('statamic-inline-edit.fieldtypes', []), 'is_string'));
    }

    public function isEditableFieldtype(?string $type): bool
    {
        return $type !== null && in_array($type, $this->fieldtypes(), true);
    }

    public function isMultiline(?string $type): bool
    {
        return $type !== null && in_array($type, (array) config('statamic-inline-edit.multiline', []), true);
    }

    public function maxLength(): int
    {
        return max(1, (int) config('statamic-inline-edit.max_length', 100000));
    }

    public function markRendered(): void
    {
        $this->rendered = true;
    }

    public function hasRendered(): bool
    {
        return $this->rendered;
    }
}
