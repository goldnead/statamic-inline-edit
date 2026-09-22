<?php

namespace Goldnead\StatamicInlineEdit\Tests;

use Goldnead\StatamicInlineEdit\ServiceProvider;
use Statamic\Facades\Blueprint;
use Statamic\Facades\Collection;
use Statamic\Facades\Entry;
use Statamic\Facades\User;
use Statamic\Testing\AddonTestCase;
use Statamic\Testing\Concerns\PreventsSavingStacheItemsToDisk;

abstract class TestCase extends AddonTestCase
{
    use PreventsSavingStacheItemsToDisk;

    protected string $addonServiceProvider = ServiceProvider::class;

    /**
     * The suite runs on the configuration that ships. Switching options on for
     * every test hides the failure that only a default installation sees,
     * which for an addon installed once per client site is every installation.
     */
    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);

        $app['config']->set('statamic.system.multisite', false);
    }

    /**
     * A page with nothing editable on it, in the group the editor rides on.
     *
     * Testbench collects these before the application boots; a route declared
     * inside a test body arrives after the router has made up its mind and
     * answers 404.
     */
    protected function defineRoutes($router): void
    {
        $router->middleware('statamic.web')->get('/nichts-zu-bearbeiten', fn () => '<html><body>Liste</body></html>');
    }

    /**
     * A collection with a blueprint that covers the cases every test needs: a
     * field we allow, a multiline one, and two we must refuse.
     *
     * Two refusals rather than one, because they fail differently. A toggle is
     * simply not on the list. An assets field is not on the list either, and
     * augmenting it throws without a configured container — which is what
     * plain {{ hero }} does too, so the tag must not be the thing that makes
     * it happen.
     *
     * The blueprint is faked onto the repository rather than saved, because
     * saving it writes a file the next run would inherit.
     */
    protected function makeCollection(string $handle = 'pages'): void
    {
        $blueprint = Blueprint::makeFromFields([
            // An explicit display name, different from anything Statamic would
            // derive from the handle, so a test asserting on it proves the
            // blueprint was read rather than the handle prettified.
            'title' => ['type' => 'text', 'display' => 'Überschrift'],
            'intro' => ['type' => 'textarea'],
            'promoted' => ['type' => 'toggle'],
            // Not called `status`: an entry already has a computed `status`
            // of its own, and it wins in the cascade. A blueprint field with
            // that handle is simply never reachable from a template.
            'belegung' => ['type' => 'select', 'options' => ['offen' => 'Offen', 'voll' => 'Ausgebucht']],
            'starts_on' => ['type' => 'date'],
            'body' => ['type' => 'markdown'],
            // The reason the one-field control panel panel exists: a whole
            // editor, which this addon does not rebuild and does not want to
            // hand over a whole entry form for.
            'inhalt' => ['type' => 'bard', 'display' => 'Inhalt'],
            'hero' => ['type' => 'assets', 'max_files' => 1],
        ])->setHandle($handle)->setNamespace('collections.'.$handle);

        Blueprint::shouldReceive('in')
            ->with('collections/'.$handle)
            ->andReturn(collect([$handle => $blueprint]));

        Blueprint::makePartial();

        Collection::make($handle)->save();
    }

    /**
     * @param  array<string, mixed>  $data
     */
    protected function makeEntry(array $data = ['title' => 'Hello'], string $collection = 'pages', string $id = 'entry-1'): \Statamic\Contracts\Entries\Entry
    {
        $entry = Entry::make()
            ->collection($collection)
            ->id($id)
            ->slug('a-page')
            ->data($data);

        $entry->save();

        return $entry;
    }

    protected function anEditor(): \Statamic\Contracts\Auth\User
    {
        return User::make()->id('editor-1')->email('editor@example.com')->makeSuper()->save();
    }
}
