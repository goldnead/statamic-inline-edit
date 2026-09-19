<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;
use Statamic\Facades\Entry;

class PreviewControllerTest extends TestCase
{
    protected string $url = '/!/statamic-inline-edit/preview';

    #[Test]
    public function it_renders_markdown_through_its_own_fieldtype(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Hello', 'body' => '# Alt']);

        $response = $this->actingAs($this->anEditor())
            ->postJson($this->url, [
                'id' => 'entry-1',
                'field' => 'body',
                'value' => "## Neu\n\nEin **Absatz**.",
            ])
            ->assertOk();

        $html = $response->json('html');

        $this->assertStringContainsString('<h2', $html);
        $this->assertStringContainsString('<strong>Absatz</strong>', $html);
    }

    #[Test]
    public function it_writes_nothing(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Hello', 'body' => '# Alt']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, ['id' => 'entry-1', 'field' => 'body', 'value' => '# Neu'])
            ->assertOk();

        // The whole point: this shows what a save would do, it does not do it.
        $this->assertSame('# Alt', Entry::find('entry-1')->get('body'));
    }

    #[Test]
    public function a_guest_is_refused(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Hello', 'body' => '# Alt']);

        $this->postJson($this->url, ['id' => 'entry-1', 'field' => 'body', 'value' => '# Neu'])
            ->assertForbidden();
    }

    #[Test]
    public function a_field_that_is_not_edited_as_source_is_refused(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Hello']);

        // Otherwise this is a general-purpose "render anything" endpoint.
        $this->actingAs($this->anEditor())
            ->postJson($this->url, ['id' => 'entry-1', 'field' => 'title', 'value' => 'x'])
            ->assertStatus(422);
    }

    #[Test]
    public function the_route_is_gone_when_the_addon_is_switched_off(): void
    {
        config()->set('statamic-inline-edit.enabled', false);

        $this->makeCollection();
        $this->makeEntry(['title' => 'Hello', 'body' => '# Alt']);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, ['id' => 'entry-1', 'field' => 'body', 'value' => '# Neu'])
            ->assertNotFound();
    }
}
