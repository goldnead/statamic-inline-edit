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
    /**
     * Filled in register() from the config, because which groups these are is
     * a property of the site and not of the addon. A Statamic site drawn by
     * React or Blade serves its pages from its own routes, which are in `web`
     * and never in `statamic.web` — on such a site the default here would
     * mean the editor is installed, the markers are in the HTML, and nothing
     * ever loads the script that acts on them.
     *
     * @var array<string, list<class-string>>
     */
    protected $middlewareGroups = [];

    /**
     * The control panel bundle: one Inertia page, which renders a single field
     * as a publish form for the panel on the public page. Loaded on every CP
     * page, because that is how Statamic registers addon assets; it stays a
     * few kilobytes, since Vue and the CP's component library are the host's.
     *
     * A plain list of entry points, which is the shape core declares and the
     * only shape its own type allows. That fixes the build directory at
     * `public/build`, so vite.config.js writes there.
     *
     * Publish it, or the control panel cannot find the manifest and every CP
     * page dies on it: `php artisan vendor:publish --tag=statamic-inline-edit`.
     * That is the addon slug, which core registers for this bundle, and a
     * different tag from `statamic-inline-edit-assets` below.
     *
     * @var list<string>
     */
    protected $vite = [
        'resources/js/cp.js',
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

        // Read here rather than in boot: the parent walks this property in
        // bootMiddleware(), and register() is the last moment at which it is
        // still ours. Deduplicated, because a group named twice would push the
        // middleware twice and inject the editor twice into one page.
        $groups = collect(config('statamic-inline-edit.middleware_groups', ['statamic.web']))
            ->filter(fn ($group): bool => is_string($group) && $group !== '')
            ->unique();

        $this->middlewareGroups = $groups
            ->mapWithKeys(fn (string $group): array => [$group => [InjectEditor::class]])
            ->all();

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
