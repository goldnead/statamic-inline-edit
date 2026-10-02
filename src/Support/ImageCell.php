<?php

namespace Goldnead\StatamicInlineEdit\Support;

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\URL as LaravelUrl;
// The concrete class, not the contract: the contract has neither id() nor
// containerHandle(), and both are what this checks.
use Statamic\Assets\Asset as AssetContract;
use Statamic\Facades\Asset;
use Statamic\Facades\AssetContainer;
use Statamic\Facades\URL;

/**
 * A text cell that holds the path of a picture, and the one value it accepts.
 *
 * The column is a string. Left to the text route, it would take whatever a
 * browser sent: a typo, a path to nothing, a picture on somebody else's
 * server. So the cell is written only from an asset the control panel knows,
 * in a container this addon was told to allow, and what is written is that
 * asset's own public URL, never anything from the request.
 */
class ImageCell
{
    /**
     * Where this cell's picker lives, signed for this entry and this address.
     *
     * Relative, so the signature survives a proxy that turns https into http
     * on the way in. Without an expiry: an editor may leave a page open for
     * an afternoon, and the signature is a statement about the page, not a
     * session.
     */
    public static function url(mixed $entry, string $address, ?string $label = null): ?string
    {
        if (! is_object($entry) || ! method_exists($entry, 'collectionHandle')) {
            return null;
        }

        if (! Route::has('statamic.cp.inline-edit.image.edit')) {
            return null;
        }

        // The label rides along, signed with the rest, so the card can say
        // which picture this is ("Hero picture") rather than "Value".
        return LaravelUrl::signedRoute('statamic.cp.inline-edit.image.edit', array_filter([
            'collection' => $entry->collectionHandle(),
            'entry' => $entry->id(),
            'address' => $address,
            'label' => $label,
        ], fn ($v) => $v !== null && $v !== ''), absolute: false);
    }

    /**
     * The asset a submitted value names, if it is one we accept.
     *
     * Exactly one asset id, as the asset field sends it (a list of one, or
     * the id on its own). It must exist, sit in an allowed container, and
     * have a public URL. Null for anything else, which the caller refuses.
     */
    public static function chosen(Editor $editor, mixed $value, ?object $user = null): ?AssetContract
    {
        if (is_array($value)) {
            if (count($value) !== 1 || ! array_is_list($value)) {
                return null;
            }

            $value = $value[0];
        }

        if (! is_string($value) || ! str_contains($value, '::')) {
            return null;
        }

        $asset = Asset::find($value);

        if (! $asset instanceof AssetContract) {
            return null;
        }

        if (! in_array($asset->containerHandle(), $editor->imageContainers(), true)) {
            return null;
        }

        // The person must be allowed to see it in the browser. Otherwise a
        // direct request could set a picture they were never shown, and the
        // difference between 200 and 422 would tell them which files exist.
        if ($user !== null && method_exists($user, 'cant') && $user->cant('view', $asset)) {
            return null;
        }

        return self::publicUrl($asset) === null ? null : $asset;
    }

    /**
     * What goes into the cell: the asset's URL, relative where it is on this
     * site (the shape such cells hold, `/assets/hero.jpg`), absolute where the
     * container serves from another host, such as a CDN.
     */
    public static function publicUrl(AssetContract $asset): ?string
    {
        // Null for a private container, whatever the docblock promises.
        $url = $asset->url();

        if (blank($url)) {
            return null;
        }

        return URL::isExternalToApplication($url) ? $url : URL::makeRelative($url);
    }

    /**
     * The asset a stored path points at, for showing it as chosen. Null for a
     * path outside every allowed container: the picker then opens empty, and
     * the page keeps showing the old picture until another one is chosen.
     */
    public static function current(Editor $editor, mixed $stored): ?AssetContract
    {
        if (! is_string($stored) || $stored === '') {
            return null;
        }

        // Only the allowed containers are asked, by their own URL. Core's
        // findByUrl() asks every container for its URL first, and one whose
        // disk is not configured on this machine (an S3 bucket without
        // credentials locally) throws for all of them.
        foreach ($editor->imageContainers() as $handle) {
            $container = AssetContainer::find($handle);

            if (! $container || $container->private() || blank($base = $container->url())) {
                continue;
            }

            $base = rtrim(URL::isExternalToApplication($base) ? $base : URL::makeRelative($base), '/').'/';

            if (! str_starts_with($stored, $base)) {
                continue;
            }

            // Null for a file that is not there, whatever the docblock says.
            /** @var AssetContract|null $asset */
            $asset = $container->asset(rawurldecode(substr($stored, strlen($base))));

            if ($asset !== null) {
                return $asset;
            }
        }

        return null;
    }
}
