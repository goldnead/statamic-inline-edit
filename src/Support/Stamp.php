<?php

namespace Goldnead\StatamicInlineEdit\Support;

use Statamic\Facades\User;

/**
 * The conflict stamp of an entry, and the one place every save of this addon
 * moves it.
 *
 * Core's `lastModified()` answers with the stored `updated_at` when there is
 * one and with the file's mtime when there is not. An entry that was ever
 * saved in the control panel has one, so a save that only calls `save()`
 * leaves the stamp exactly where it was, and the editor who still has the
 * old page open is waved through. Every write the addon makes therefore goes
 * through `touch()` first, the way core's entries controller does it.
 */
class Stamp
{
    /**
     * When the entry was last written, as an opaque string. Empty when the
     * entry cannot say, which every caller treats as "do not check".
     */
    public static function of(mixed $entry): string
    {
        if (! is_object($entry) || ! method_exists($entry, 'lastModified')) {
            return '';
        }

        $modified = $entry->lastModified();

        return $modified ? (string) $modified->getTimestamp() : '';
    }

    /**
     * Record this write on the entry: `updated_at` and `updated_by`, as core
     * does on every control panel save. Call it before `save()`.
     *
     * A no-op where core does not track modification (the setting is off, or
     * the entry is not one that can), in which case the stamp keeps coming
     * from the file and moves with the save by itself.
     */
    public static function touch(mixed $entry): void
    {
        if (is_object($entry) && method_exists($entry, 'updateLastModified')) {
            $entry->updateLastModified(User::current());
        }
    }

    /**
     * Has the entry been written since the page that sent `$stamp` was drawn?
     *
     * An empty stamp on either side means "cannot tell", and cannot-tell is
     * treated as no conflict: refusing every save because a storage driver
     * does not report its modification time would make the addon unusable.
     */
    public static function isStale(mixed $entry, ?string $stamp): bool
    {
        $current = self::of($entry);

        if (! $stamp || $current === '') {
            return false;
        }

        return $stamp !== $current;
    }
}
