<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\Http\Middleware\InjectEditor;
use Goldnead\StatamicInlineEdit\InlineEdit;
use Goldnead\StatamicInlineEdit\Tests\TestCase;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\Test;
use Statamic\Facades\Antlers;
use Statamic\Facades\Collection;

/**
 * A Bard that opens where it stands, and the marker for a front end that has
 * no Antlers to put a tag in.
 *
 * Two features, one file, because they are the same release and the second one
 * exists for the first: the site this was built for draws its articles with
 * React, and a Bard there had no way of being marked at all.
 */
class InPlaceTest extends TestCase
{
    /**
     * @param  array<string, mixed>  $data
     */
    protected function render(string $template, array $data): string
    {
        return (string) Antlers::parse($template, $data, true);
    }

    #[Test]
    public function a_bard_opens_in_place_rather_than_on_a_card(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        $out = $this->render(
            '{{ editable field="inhalt" }}<p>Ein Absatz</p>{{ /editable }}',
            $entry->toAugmentedArray()
        );

        $this->assertStringContainsString('data-sie-mode="inline"', $out);
        $this->assertStringContainsString('inline-edit/field/pages/entry-1/inhalt', $out);

        // The frame has to know it is standing in for content before it paints
        // anything, so it is told in the URL rather than a message afterwards.
        $this->assertStringContainsString('inplace=1', $out);

        // Block content needs a box, or the outline that says "editable" is
        // never drawn. A span around a Bard has none.
        $this->assertStringContainsString('<div data-sie-id=', $out);
    }

    #[Test]
    public function without_the_one_field_route_it_falls_back_to_the_card(): void
    {
        // Both, because core's getter answers false without either — and a
        // test that forgets the edition would pass for the wrong reason: the
        // fallback it asserts is also what an unconfigured route produces.
        config()->set('statamic.revisions.enabled', true);
        config()->set('statamic.editions.pro', true);

        $this->makeCollection();
        Collection::find('pages')->revisionsEnabled(true)->save();

        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        $out = $this->render(
            '{{ editable field="inhalt" }}<p>Ein Absatz</p>{{ /editable }}',
            $entry->toAugmentedArray()
        );

        // Saving one field past a working copy would publish straight to the
        // site. The whole entry form knows how to make one; a frame in the
        // article's column does not.
        $this->assertStringContainsString('data-sie-mode="cp"', $out);
        $this->assertStringNotContainsString('data-sie-field-url', $out);
        $this->assertStringNotContainsString('inplace=1', $out);
    }

    #[Test]
    public function taking_bard_off_the_list_puts_it_back_on_a_card(): void
    {
        config()->set('statamic-inline-edit.inline', []);

        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        $out = $this->render(
            '{{ editable field="inhalt" }}<p>Ein Absatz</p>{{ /editable }}',
            $entry->toAugmentedArray()
        );

        $this->assertStringContainsString('data-sie-mode="cp"', $out);
    }

    #[Test]
    public function the_form_is_told_it_is_standing_in_for_content(): void
    {
        $this->makeCollection();
        $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        $this->get('/cp/inline-edit/field/pages/entry-1/inhalt?inplace=1')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->where('inplace', true));

        // And not told so when nobody said so: the card paints its own white,
        // and a form that thinks it is in a page would leave it transparent.
        $this->get('/cp/inline-edit/field/pages/entry-1/inhalt')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->where('inplace', false));
    }

    /* ------------------------------------------------ a front end that is not Antlers */

    #[Test]
    public function a_marker_can_be_had_without_a_template_tag(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello world']);

        $this->actingAs($this->anEditor());

        $marker = InlineEdit::marker($entry, 'title');

        $this->assertSame('entry-1', $marker['data-sie-id']);
        $this->assertSame('title', $marker['data-sie-field']);
        $this->assertSame('text', $marker['data-sie-type']);
        $this->assertSame('text', $marker['data-sie-mode']);
        $this->assertSame('Überschrift', $marker['data-sie-label']);
    }

    #[Test]
    public function the_headless_marker_is_the_same_bard_decision(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        $marker = InlineEdit::marker($entry, 'inhalt');

        $this->assertSame('inline', $marker['data-sie-mode']);
        $this->assertStringContainsString('inplace=1', $marker['data-sie-field-url']);
    }

    #[Test]
    public function a_visitor_gets_no_marker_that_way_either(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello world']);

        $this->assertSame([], InlineEdit::marker($entry, 'title'));
        $this->assertSame('', InlineEdit::attributes($entry, 'title'));
        $this->assertFalse(InlineEdit::active());
    }

    #[Test]
    public function a_field_that_cannot_be_edited_gets_no_marker_that_way_either(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        // The slug decides the URL. Not on any list, and the save route
        // refuses it outright — the headless path must not be the way round.
        $this->assertSame([], InlineEdit::marker($entry, 'slug'));
    }

    #[Test]
    public function the_attribute_string_escapes_what_the_blueprint_says(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        $string = InlineEdit::attributes($entry, 'title');

        $this->assertStringContainsString('data-sie-field="title"', $string);
        $this->assertStringNotContainsString('<', $string);
    }

    #[Test]
    public function a_marker_makes_the_page_uncacheable_and_gets_the_editor(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        // The tag is not the only thing that may turn the editor on any more.
        // Building a marker in a controller has to arm the middleware too, or
        // a React site ships markers with nothing to act on them.
        $this->assertFalse(InlineEdit::active());

        InlineEdit::marker($entry, 'title');

        $this->assertTrue(InlineEdit::active());
        $this->assertStringContainsString('statamic-inline-edit-config', InlineEdit::assets());
    }

    #[Test]
    public function a_site_that_draws_itself_can_have_the_editor_on_every_page(): void
    {
        // The page a router navigates *from* has no marker on it, and the page
        // it navigates *to* never reaches this middleware — the response there
        // is JSON. Without the script already in the document, the markers
        // that arrive with that navigation have nothing to act on them, and
        // double-clicking does nothing at all, silently.
        config()->set('statamic-inline-edit.inject_for_signed_in', true);

        $this->actingAs($this->anEditor());

        $this->get('/nichts-zu-bearbeiten')
            ->assertOk()
            ->assertHeader('X-Statamic-Uncacheable', 'true')
            ->assertSee('statamic-inline-edit-config', false);
    }

    #[Test]
    public function and_a_visitor_still_gets_nothing_on_that_page(): void
    {
        config()->set('statamic-inline-edit.inject_for_signed_in', true);

        $response = $this->get('/nichts-zu-bearbeiten')->assertOk();

        $response->assertDontSee('statamic-inline-edit-config', false);
        $this->assertNull($response->headers->get('X-Statamic-Uncacheable'));
    }

    #[Test]
    public function off_by_default_a_page_without_markers_stays_untouched(): void
    {
        $this->actingAs($this->anEditor());

        $this->get('/nichts-zu-bearbeiten')
            ->assertOk()
            ->assertDontSee('statamic-inline-edit-config', false);
    }

    #[Test]
    public function the_route_groups_the_editor_rides_on_come_from_the_config(): void
    {
        $groups = app('router')->getMiddlewareGroups();

        $this->assertContains(
            InjectEditor::class,
            $groups['statamic.web'] ?? []
        );
    }
}
