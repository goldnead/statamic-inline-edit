<?php

namespace Goldnead\StatamicInlineEdit;

use Goldnead\StatamicInlineEdit\Http\Middleware\InjectEditor;
use Goldnead\StatamicInlineEdit\Support\Editor;
use Statamic\Providers\AddonServiceProvider;

class ServiceProvider extends AddonServiceProvider
{
    /**
     * Tags are discovered from src/Tags, so they are not listed here.
     *
     * The action routes are discovered from routes/actions.php the same way,
     * and land under /!/statamic-inline-edit/.
     */
    protected $middlewareGroups = [
        'statamic.web' => [
            InjectEditor::class,
        ],
    ];

    /**
     * The parent boots config off the addon directory, which is resolved
     * through the manifest and comes up empty in package test suites. Merged
     * explicitly in register() with an absolute path instead.
     */
    protected $config = false;

    public function register()
    {
        parent::register();

        $this->mergeConfigFrom(__DIR__.'/../config/statamic-inline-edit.php', 'statamic-inline-edit');

        // One per request. The tag sets the "a marker was rendered" flag and
        // the middleware reads it on the way out; separate instances would mean
        // the middleware never hears about the markers the tag just wrote, and
        // the editor would simply not appear on exactly the pages it belongs on.
        $this->app->scoped(Editor::class);
    }

    public function bootAddon()
    {
        $this->loadTranslationsFrom(__DIR__.'/../lang', 'statamic-inline-edit');

        $this->publishes([
            __DIR__.'/../config/statamic-inline-edit.php' => config_path('statamic-inline-edit.php'),
        ], 'statamic-inline-edit-config');

        // The stylesheet and the script the browser actually loads. Marked as
        // a force target in the install instructions: a stale copy here is an
        // editor that talks to the previous release of the save route, which
        // fails in a way nobody can reproduce from the repository.
        $this->publishes([
            __DIR__.'/../resources/dist' => public_path('vendor/statamic-inline-edit'),
        ], 'statamic-inline-edit-assets');

        $this->publishes([
            __DIR__.'/../lang' => lang_path('vendor/statamic-inline-edit'),
        ], 'statamic-inline-edit-translations');
    }
}
