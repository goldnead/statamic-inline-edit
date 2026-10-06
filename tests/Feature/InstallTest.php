<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\ServiceProvider;
use Goldnead\StatamicInlineEdit\Tests\TestCase;
use Illuminate\Support\ServiceProvider as LaravelServiceProvider;
use PHPUnit\Framework\Attributes\Test;

/**
 * What `statamic:install` publishes on its own.
 *
 * Statamic runs `vendor:publish --tag=<addon slug> --force` after every
 * `composer install` and `composer update` on a standard site. Everything the
 * browser loads has to be in that tag, or the site runs the previous release's
 * script against this release's routes until somebody remembers a second
 * command.
 */
class InstallTest extends TestCase
{
    #[Test]
    public function the_install_tag_publishes_the_front_end_assets(): void
    {
        $paths = LaravelServiceProvider::pathsToPublish(ServiceProvider::class, 'statamic-inline-edit');

        $sources = array_map(fn ($path) => realpath($path) ?: $path, array_keys($paths));

        $this->assertContains(realpath(__DIR__.'/../../resources/dist'), $sources, json_encode($sources));
        $this->assertContains(public_path('vendor/statamic-inline-edit'), array_values($paths));
    }

    #[Test]
    public function the_old_assets_tag_still_works(): void
    {
        $paths = LaravelServiceProvider::pathsToPublish(ServiceProvider::class, 'statamic-inline-edit-assets');

        $this->assertContains(public_path('vendor/statamic-inline-edit'), array_values($paths));
    }

    #[Test]
    public function the_bar_hint_names_the_keyboard_too(): void
    {
        foreach (['en', 'de'] as $locale) {
            $hint = (require __DIR__.'/../../lang/'.$locale.'/messages.php')['hint'];

            $this->assertStringContainsString('Enter', $hint, $locale);
        }
    }
}
