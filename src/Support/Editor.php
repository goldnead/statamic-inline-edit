<?php

namespace Goldnead\StatamicInlineEdit\Support;

use Statamic\Contracts\Entries\Entry as EntryContract;
use Statamic\Facades\AssetContainer;
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

    /**
     * How this fieldtype is edited, or null when it is not edited at all.
     *
     * The four are genuinely different interactions, not variations on one:
     *
     *  - `text`    the value is the text on the page, so the text is editable
     *  - `control` the value is not on the page (a toggle renders as "ja"),
     *              so the element is a trigger for a small control
     *  - `source`  the value is text but the page shows it rendered, so the
     *              rendered output is swapped for its own source
     *  - `inline`  the real control panel field, but put where the content
     *              was instead of over it — for a Bard, which *is* the page
     *  - `image`   a picture: the control panel's own asset field, in the
     *              card, so the real asset browser chooses or uploads
     *  - `cp`      nothing we can do justice to here, so the control panel
     *              opens over the page
     *
     * Order matters only in that the lists must not overlap; if a handle is
     * on two of them, the first one here wins and the config is wrong.
     */
    public function modeFor(?string $type): ?string
    {
        if ($type === null) {
            return null;
        }

        if (in_array($type, $this->fieldtypes(), true)) {
            return 'text';
        }

        if (in_array($type, (array) config('statamic-inline-edit.controls', []), true)) {
            return 'control';
        }

        if (in_array($type, (array) config('statamic-inline-edit.source', []), true)) {
            return 'source';
        }

        if (! config('statamic-inline-edit.control_panel', true)) {
            return null;
        }

        // A picture is the control panel field too, in the same card as `cp`.
        // Its own mode because the page has to treat it differently: an image
        // has no text, so it is never "empty", and what it needs is the asset
        // browser rather than a form.
        if (in_array($type, (array) config('statamic-inline-edit.images', []), true)) {
            return 'image';
        }

        // Both of these open the same control panel field. The difference is
        // only where the frame is put, so `inline` degrades to `cp` the moment
        // the one-field route is unavailable — that decision needs the entry
        // and belongs to the tag, not here.
        if (in_array($type, (array) config('statamic-inline-edit.inline', []), true)) {
            return 'inline';
        }

        return 'cp';
    }

    /**
     * Which modes the save route will accept a value for.
     *
     * `cp` is absent on purpose: those fields are saved by the control panel
     * itself, and this route must never become a way around its validation.
     */
    public function isWritableMode(?string $mode): bool
    {
        return in_array($mode, ['text', 'control', 'source'], true);
    }

    /**
     * The asset containers a picture cell may point into.
     *
     * Only these, and only those whose assets have a public URL: the value
     * written is that URL, and a private container has none.
     *
     * @return array<int, string>
     */
    public function imageContainers(): array
    {
        // Only containers that exist and serve public URLs. A typo in the
        // config would otherwise open the picker on a container core cannot
        // find (a 500), and a private one on a browser whose every choice is
        // then refused.
        return array_values(array_filter(
            (array) config('statamic-inline-edit.image_containers', []),
            function ($handle): bool {
                if (! is_string($handle) || $handle === '') {
                    return false;
                }

                $container = AssetContainer::find($handle);

                return $container !== null && ! $container->private();
            }
        ));
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
