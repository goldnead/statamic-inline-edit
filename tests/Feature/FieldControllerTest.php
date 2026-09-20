<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\Tests\TestCase;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\Test;
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
