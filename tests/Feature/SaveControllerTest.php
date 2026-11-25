<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\Tests\TestCase;
use Illuminate\Support\Facades\Event;
use PHPUnit\Framework\Attributes\Test;
use Statamic\Events\EntrySaving;
use Statamic\Facades\Entry;

class SaveControllerTest extends TestCase
{
    protected string $url = '/!/statamic-inline-edit/save';

    /**
     * @param  array<string, mixed>  $fields
     * @return array<string, mixed>
     */
    protected function change(array $fields, string $id = 'entry-1', ?string $stamp = null): array
    {
        return ['changes' => [array_filter([
            'id' => $id,
            'stamp' => $stamp,
            'fields' => $fields,
        ], fn ($v) => $v !== null)]];
    }

    #[Test]
    public function it_saves_a_text_field(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['title' => 'New']))
            ->assertOk();

        $this->assertSame('New', Entry::find('entry-1')->get('title'));
    }

    #[Test]
    public function it_saves_several_fields_of_one_entry_at_once(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old', 'intro' => 'Old intro']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['title' => 'New', 'intro' => "Line\nLine"]))
            ->assertOk();

        $entry = Entry::find('entry-1');

        $this->assertSame('New', $entry->get('title'));
        $this->assertSame("Line\nLine", $entry->get('intro'));
    }

    #[Test]
    public function it_saves_a_toggle_as_a_real_boolean(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old', 'promoted' => false]);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['promoted' => true]))
            ->assertOk();

        $this->assertTrue(Entry::find('entry-1')->get('promoted'));
    }

    #[Test]
    public function it_saves_a_choice_the_blueprint_offers(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old', 'belegung' => 'offen']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['belegung' => 'voll']))
            ->assertOk();

        $this->assertSame('voll', Entry::find('entry-1')->get('belegung'));
    }

    #[Test]
    public function a_choice_the_blueprint_does_not_offer_is_refused(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old', 'belegung' => 'offen']);

        // The dropdown in the browser is a suggestion. This is what arrived.
        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['belegung' => 'erfunden']))
            ->assertStatus(422);

        $this->assertSame('offen', Entry::find('entry-1')->get('belegung'));
    }

    #[Test]
    public function it_saves_markdown_source_byte_for_byte(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old', 'body' => '# Alt']);

        $source = "# Neu\n\n- eins\n- zwei\n\nEin [Link](https://example.com) und `code`.";

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['body' => $source]))
            ->assertOk();

        $this->assertSame($source, Entry::find('entry-1')->get('body'));
    }

    #[Test]
    public function a_field_that_only_the_control_panel_can_edit_is_refused(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        // Those fields open the control panel, which does its own saving.
        // This route must never become a way around that.
        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['hero' => 'anything']))
            ->assertStatus(422);
    }

    #[Test]
    public function a_guest_is_refused(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        $this->postJson($this->url, $this->change(['title' => 'New']))->assertForbidden();

        $this->assertSame('Old', Entry::find('entry-1')->get('title'));
    }

    #[Test]
    public function a_field_the_blueprint_does_not_have_is_refused(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['nope' => 'New']))
            ->assertStatus(422);
    }

    #[Test]
    public function a_fieldtype_that_is_not_allowed_is_refused_even_though_the_page_never_offered_it(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['hero' => 'anything']))
            ->assertStatus(422);
    }

    #[Test]
    public function the_slug_is_refused(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['slug' => 'somewhere-else']))
            ->assertStatus(422);

        $this->assertSame('a-page', Entry::find('entry-1')->slug());
    }

    #[Test]
    public function a_stale_page_is_refused_instead_of_overwriting_someone_else(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['title' => 'New'], stamp: '1'))
            ->assertStatus(409);

        $this->assertSame('Old', Entry::find('entry-1')->get('title'));
    }

    #[Test]
    public function a_value_longer_than_the_ceiling_is_refused(): void
    {
        config()->set('statamic-inline-edit.max_length', 10);

        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['title' => str_repeat('a', 11)]))
            ->assertStatus(422);
    }

    #[Test]
    public function the_route_is_gone_when_the_addon_is_switched_off(): void
    {
        config()->set('statamic-inline-edit.enabled', false);

        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['title' => 'New']))
            ->assertNotFound();
    }

    #[Test]
    public function a_non_breaking_space_from_the_browser_is_normalised(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['title' => "Two\u{00A0}words"]))
            ->assertOk();

        $this->assertSame('Two words', Entry::find('entry-1')->get('title'));
    }

    /**
     * @return array<string, mixed>
     */
    protected function batch(array ...$changes): array
    {
        return ['changes' => $changes];
    }

    #[Test]
    public function a_batch_with_one_missing_entry_saves_nothing(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        // The page shows one mixture of saved and unsaved text if the first
        // entry is written and the second refused. Nothing is written.
        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->batch(
                ['id' => 'entry-1', 'fields' => ['title' => 'New']],
                ['id' => 'gone', 'fields' => ['title' => 'Whatever']],
            ))
            ->assertNotFound();

        $this->assertSame('Old', Entry::find('entry-1')->get('title'));
    }

    #[Test]
    public function a_batch_with_one_invalid_field_saves_nothing(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old', 'belegung' => 'offen']);
        $this->makeEntry(['title' => 'Two', 'belegung' => 'offen'], 'pages', 'entry-2');

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->batch(
                ['id' => 'entry-1', 'fields' => ['title' => 'New']],
                ['id' => 'entry-2', 'fields' => ['belegung' => 'erfunden']],
            ))
            ->assertStatus(422);

        $this->assertSame('Old', Entry::find('entry-1')->get('title'));
        $this->assertSame('offen', Entry::find('entry-2')->get('belegung'));
    }

    #[Test]
    public function a_batch_saves_every_entry_when_all_pass(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'One']);
        $this->makeEntry(['title' => 'Two'], 'pages', 'entry-2');

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->batch(
                ['id' => 'entry-1', 'fields' => ['title' => 'First']],
                ['id' => 'entry-2', 'fields' => ['title' => 'Second']],
            ))
            ->assertOk()
            ->assertJsonCount(2, 'saved');

        $this->assertSame('First', Entry::find('entry-1')->get('title'));
        $this->assertSame('Second', Entry::find('entry-2')->get('title'));
    }

    #[Test]
    public function the_same_entry_twice_in_one_batch_is_refused(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->batch(
                ['id' => 'entry-1', 'fields' => ['title' => 'A']],
                ['id' => 'entry-1', 'fields' => ['intro' => 'B']],
            ))
            ->assertStatus(422);

        $this->assertSame('Old', Entry::find('entry-1')->get('title'));
    }

    #[Test]
    public function a_save_blocked_by_a_site_listener_is_not_reported_as_saved(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old']);

        // A site's own EntrySaving listener may veto the write. Core then
        // returns false from save(); the page must not say "Saved".
        Event::listen(EntrySaving::class, fn () => false);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['title' => 'New']))
            ->assertStatus(422)
            ->assertJsonMissing(['saved']);
    }

    #[Test]
    public function a_read_only_field_is_refused_even_when_posted_directly(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Old', 'berechnet' => 'computed by the site']);

        // The marker never offers it; the request must not be a way around that.
        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['berechnet' => 'overwritten']))
            ->assertStatus(422);

        $this->assertSame('computed by the site', Entry::find('entry-1')->get('berechnet'));
    }
}
