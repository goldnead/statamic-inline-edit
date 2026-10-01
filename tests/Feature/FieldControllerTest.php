<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\Http\Controllers\Cp\FieldController;
use Goldnead\StatamicInlineEdit\Tests\TestCase;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\Test;
use Statamic\Facades\Blueprint;
use Statamic\Facades\Entry;

/**
 * The control panel route that renders one field, and writes it back.
 *
 * What is being proved is narrow on purpose: the page carries exactly the
 * field that was asked for and nothing else, and the save touches that field
 * and nothing else. The publish form itself is core's, and testing that Bard
 * renders is testing Statamic.
 */
class FieldControllerTest extends TestCase
{
    protected function url(string $handle, string $entry = 'entry-1'): string
    {
        return "/cp/inline-edit/field/pages/{$entry}/{$handle}";
    }

    #[Test]
    public function it_renders_one_field_as_a_publish_form(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Hello', 'intro' => 'An intro']);

        $this->actingAs($this->anEditor())
            ->get($this->url('inhalt'))
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->component('statamic-inline-edit::Field')
                ->where('handle', 'inhalt')
                ->where('title', 'Inhalt')
                // One tab, one section, one field. The other six on the
                // blueprint are the whole point of not sending the form.
                ->has('blueprint.tabs.0.sections.0.fields', 1)
                ->where('blueprint.tabs.0.sections.0.fields.0.handle', 'inhalt')
            );
    }

    /**
     * Bard's "insert set" button asks core for the new set's defaults, and
     * proves it may by sending the blueprint token the publish form carries.
     * Core decrypts it, looks the blueprint up by its fully qualified handle
     * and refuses with a 403 when there is none. A blueprint made from one
     * field has no handle, so every set insert in the panel failed. Any addon
     * that resolves fields the same way (Bard Assist) failed with it.
     */
    #[Test]
    public function its_blueprint_token_lets_bard_insert_a_set(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Hello']);

        $real = Blueprint::in('collections/pages')->get('pages');
        Blueprint::shouldReceive('find')->with('collections.pages.pages')->andReturn($real);

        $editor = $this->anEditor();

        $blueprint = null;

        $this->actingAs($editor)
            ->get($this->url('inhalt').'?inplace=1')
            ->assertOk()
            ->assertInertia(function (AssertableInertia $page) use (&$blueprint) {
                $blueprint = $page->toArray()['props']['blueprint'];
            });

        $this->actingAs($editor)
            ->postJson('/cp/fieldtypes/replicator/set', [
                'token' => $blueprint['token'],
                'reference' => 'entry::entry-1',
                'field' => 'inhalt',
                'set' => 'zitat',
            ])
            ->assertOk()
            ->assertJsonPath('defaults.quote', 'Ein Zitat');

        $this->assertSame('collections.pages.pages', decrypt($blueprint['token'])['fqh']);
    }

    /**
     * The token points at the real blueprint; the form must not turn into it.
     * A one-field blueprint that shared the real one's handle would share its
     * cache keys too, and come back with every field on it: the panel would
     * render the whole entry and a save would trip over a `required` on a
     * field nobody can see.
     */
    #[Test]
    public function it_saves_one_field_even_when_another_one_is_required(): void
    {
        $this->makeCollection();
        $this->makeEntry(['intro' => 'An intro']);

        $real = Blueprint::in('collections/pages')->get('pages');
        $real->ensureFieldHasConfig('title', ['type' => 'text', 'validate' => ['required']]);

        $this->actingAs($this->anEditor())
            ->patchJson($this->url('intro'), ['intro' => 'A better intro'])
            ->assertOk();

        $this->assertSame('A better intro', Entry::find('entry-1')->get('intro'));

        $this->actingAs($this->anEditor())
            ->get($this->url('intro'))
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->has('blueprint.tabs.0.sections.0.fields', 1)
                ->where('blueprint.tabs.0.sections.0.fields.0.handle', 'intro')
            );
    }

    /**
     * The obvious fix for the token — give the one-field blueprint the real
     * one's handle — shares the real one's cache keys and writes the single
     * field into them. Everything that read the entry's blueprint afterwards
     * in that request saw one field.
     */
    #[Test]
    public function building_the_form_leaves_the_real_blueprint_whole(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $controller = app(FieldController::class);
        $fieldsFor = new \ReflectionMethod($controller, 'fieldsFor');
        $publishArray = new \ReflectionMethod($controller, 'publishArray');

        $before = $entry->blueprint()->toPublishArray()['tabs'];
        $this->assertGreaterThan(1, count($before[0]['sections'][0]['fields']));

        [, , $blueprint] = $fieldsFor->invoke($controller, $entry, 'inhalt');
        $form = $publishArray->invoke($controller, $entry, $blueprint);

        $this->assertCount(1, $form['tabs'][0]['sections'][0]['fields']);
        $this->assertSame($before, $entry->blueprint()->toPublishArray()['tabs']);
    }

    #[Test]
    public function it_saves_that_field_and_leaves_the_rest_alone(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Hello', 'intro' => 'An intro']);

        $this->actingAs($this->anEditor())
            ->patchJson($this->url('intro'), ['intro' => 'A better intro'])
            ->assertOk();

        $entry = Entry::find('entry-1');

        $this->assertSame('A better intro', $entry->get('intro'));
        $this->assertSame('Hello', $entry->get('title'));
    }

    #[Test]
    public function it_refuses_a_handle_the_frontend_may_never_write(): void
    {
        $this->makeCollection();
        $this->makeEntry();

        $this->actingAs($this->anEditor())
            ->get($this->url('slug'))
            ->assertNotFound();

        $this->actingAs($this->anEditor())
            ->patchJson($this->url('slug'), ['slug' => 'somewhere-else'])
            ->assertNotFound();

        $this->assertSame('a-page', Entry::find('entry-1')->slug());
    }

    #[Test]
    public function it_refuses_a_handle_that_is_not_on_the_blueprint(): void
    {
        $this->makeCollection();
        $this->makeEntry();

        $this->actingAs($this->anEditor())
            ->get($this->url('erfunden'))
            ->assertNotFound();
    }

    #[Test]
    public function it_refuses_everyone_who_is_not_signed_in(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Hello', 'intro' => 'An intro']);

        $this->patchJson($this->url('intro'), ['intro' => 'Sneaky'])
            ->assertStatus(401);

        $this->assertSame('An intro', Entry::find('entry-1')->get('intro'));
    }

    #[Test]
    public function it_does_not_exist_when_the_addon_is_switched_off(): void
    {
        config()->set('statamic-inline-edit.enabled', false);

        $this->makeCollection();
        $this->makeEntry();

        $this->actingAs($this->anEditor())
            ->get($this->url('inhalt'))
            ->assertNotFound();
    }
}
