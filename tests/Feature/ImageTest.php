<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\InlineEdit;
use Goldnead\StatamicInlineEdit\Tests\TestCase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\Test;
use Statamic\Facades\AssetContainer;
use Statamic\Facades\Collection;
use Statamic\Facades\Entry;
use Statamic\Facades\Role;
use Statamic\Facades\User;

/**
 * Pictures on the page, swapped for another one from the asset browser.
 *
 * Two shapes of the same wish. A real `assets` field on the entry, whose value
 * is what core stores (an asset id), and a text cell in a grid that holds the
 * public path of a picture — the shape a site takes when its copy and its
 * pictures live as rows of tokens. The second one is a string column, so
 * anything could be typed into it; the marker says it is a picture, and the
 * server then accepts nothing but the URL of an asset that exists, in a
 * container it was told to allow.
 */
class ImageTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('bilder', ['url' => '/assets']);
        Storage::fake('geheim');

        AssetContainer::make('assets')->disk('bilder')->title('Bilder')->save();
        AssetContainer::make('privat')->disk('geheim')->title('Privat')->save();

        foreach (['portrait.jpg', 'chor.jpg'] as $file) {
            Storage::disk('bilder')->put($file, UploadedFile::fake()->image($file, 40, 30)->getContent());
        }

        Storage::disk('geheim')->put('vertrag.jpg', UploadedFile::fake()->image('vertrag.jpg', 10, 10)->getContent());
    }

    protected function tearDown(): void
    {
        // A static registration, like a service provider's; it must not leak
        // into the next test.
        InlineEdit::imageCells(null);

        parent::tearDown();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    protected function rows(): array
    {
        return [
            ['id' => 'b1', 'schluessel' => 'hero.image', 'wert' => '/assets/portrait.jpg'],
            ['id' => 'b2', 'schluessel' => 'hero.title', 'wert' => 'Bleibt, wie er ist'],
            ['id' => 'b3', 'schluessel' => 'cta.image', 'wert' => '/images/alt/liegt-ausserhalb.webp'],
        ];
    }

    protected function anEntryWithPictures(): \Statamic\Contracts\Entries\Entry
    {
        $this->makeCollection();

        return $this->makeEntry(['title' => 'Hello', 'zeilen' => $this->rows(), 'hero' => 'portrait.jpg']);
    }

    protected function imageUrl(string $address = 'zeilen.b1.wert'): string
    {
        return InlineEdit::cell(Entry::find('entry-1'), ...[...explode('.', $address), 'Bild', true])['data-sie-field-url'];
    }

    /* ----------------------------------------------------- an assets field */

    #[Test]
    public function an_assets_field_opens_as_a_picture(): void
    {
        $entry = $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        $marker = InlineEdit::marker($entry, 'hero');

        $this->assertSame('image', $marker['data-sie-mode']);
        $this->assertSame('hero', $marker['data-sie-field']);
        $this->assertSame('true', $marker['data-sie-reload']);
        $this->assertStringEndsWith('/cp/inline-edit/field/pages/entry-1/hero', $marker['data-sie-field-url']);
    }

    #[Test]
    public function a_visitor_gets_no_picture_marker(): void
    {
        $entry = $this->anEntryWithPictures();

        $this->assertSame([], InlineEdit::marker($entry, 'hero'));
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'b1', 'wert', null, true));
    }

    #[Test]
    public function an_assets_field_under_revisions_falls_back_to_the_whole_form(): void
    {
        $this->anEntryWithPictures();
        config(['statamic.revisions.enabled' => true, 'statamic.editions.pro' => true]);
        Collection::find('pages')->revisionsEnabled(true)->save();
        $this->actingAs($this->anEditor());

        $marker = InlineEdit::marker(Entry::find('entry-1'), 'hero');

        $this->assertSame('cp', $marker['data-sie-mode']);
        $this->assertArrayNotHasKey('data-sie-field-url', $marker);
    }

    #[Test]
    public function an_assets_field_is_saved_as_core_saves_it(): void
    {
        $this->anEntryWithPictures();

        $this->actingAs($this->anEditor())
            ->patchJson('/cp/inline-edit/field/pages/entry-1/hero', ['hero' => ['assets::chor.jpg']])
            ->assertOk();

        $this->assertSame('chor.jpg', Entry::find('entry-1')->get('hero'));
    }

    /* ------------------------------------------------- a cell that is a picture */

    #[Test]
    public function a_picture_cell_gets_its_own_marker(): void
    {
        $entry = $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        $marker = InlineEdit::cell($entry, 'zeilen', 'b1', 'wert', 'Hero-Bild', image: true);

        $this->assertSame('entry-1', $marker['data-sie-id']);
        $this->assertSame('zeilen.b1.wert', $marker['data-sie-field']);
        $this->assertSame('image', $marker['data-sie-mode']);
        $this->assertSame('Hero-Bild', $marker['data-sie-label']);
        $this->assertSame('true', $marker['data-sie-reload']);
        $this->assertStringStartsWith('/cp/inline-edit/image/pages/entry-1/zeilen.b1.wert?', $marker['data-sie-field-url']);
        $this->assertStringContainsString('signature=', $marker['data-sie-field-url']);
        $this->assertStringContainsString('label=Hero-Bild', $marker['data-sie-field-url']);
        // Not a text marker: nothing here may be typed into.
        $this->assertArrayNotHasKey('data-sie-multiline', $marker);
        $this->assertTrue(InlineEdit::active());
    }

    #[Test]
    public function a_picture_cell_needs_an_allowed_container(): void
    {
        $entry = $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        config(['statamic-inline-edit.image_containers' => []]);

        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'b1', 'wert', null, true));
    }

    #[Test]
    public function a_picture_cell_passes_the_same_gates_as_a_text_cell(): void
    {
        $entry = $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'gibtsnicht', 'wert', null, true));
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'b1', 'gesperrt', null, true));
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'b1', 'an', null, true));
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'b1', 'id', null, true));
    }

    #[Test]
    public function the_picker_shows_one_assets_field_with_the_current_picture(): void
    {
        $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        $this->get($this->imageUrl())
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->component('statamic-inline-edit::Field')
                ->where('title', 'Bild')
                ->has('blueprint.tabs.0.sections.0.fields', 1)
                ->where('blueprint.tabs.0.sections.0.fields.0.type', 'assets')
                ->where('blueprint.tabs.0.sections.0.fields.0.container', 'assets')
                ->where('blueprint.tabs.0.sections.0.fields.0.max_files', 1)
                ->where('values.asset', ['assets::portrait.jpg'])
                ->where('readOnly', false)
                ->where('saveUrl', fn ($url) => str_starts_with($url, '/cp/inline-edit/image/pages/entry-1/zeilen.b1.wert?signature='))
            );
    }

    #[Test]
    public function a_path_outside_every_container_opens_empty(): void
    {
        $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        $this->get($this->imageUrl('zeilen.b3.wert'))
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->where('values.asset', []));
    }

    #[Test]
    public function the_picker_refuses_an_address_the_server_never_signed(): void
    {
        $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        // The headline cell, never offered as a picture.
        $this->get('/cp/inline-edit/image/pages/entry-1/zeilen.b2.wert')->assertForbidden();

        // A real signature, moved onto another cell.
        $signed = $this->imageUrl();
        $this->get(str_replace('zeilen.b1.wert', 'zeilen.b2.wert', $signed))->assertForbidden();
        $this->patchJson(str_replace('zeilen.b1.wert', 'zeilen.b2.wert', $signed), ['asset' => ['assets::chor.jpg']])->assertForbidden();
    }

    #[Test]
    public function choosing_a_picture_writes_its_public_path_into_that_one_cell(): void
    {
        $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        $before = Entry::find('entry-1')->get('zeilen');

        $this->patchJson($this->imageUrl(), ['asset' => ['assets::chor.jpg']])
            ->assertOk()
            ->assertJsonPath('saved', true);

        $after = Entry::find('entry-1')->get('zeilen');

        $this->assertSame('/assets/chor.jpg', $after[0]['wert']);
        $before[0]['wert'] = '/assets/chor.jpg';
        $this->assertSame($before, $after);
        $this->assertSame('portrait.jpg', Entry::find('entry-1')->get('hero'));
    }

    #[Test]
    public function a_single_id_is_taken_as_well_as_a_list_of_one(): void
    {
        $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        $this->patchJson($this->imageUrl(), ['asset' => 'assets::chor.jpg'])->assertOk();

        $this->assertSame('/assets/chor.jpg', Entry::find('entry-1')->get('zeilen')[0]['wert']);
    }

    #[Test]
    public function anything_but_an_existing_asset_in_an_allowed_container_is_refused(): void
    {
        $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        $url = $this->imageUrl();

        foreach ([
            'https://fremd.example/bild.jpg',
            ['https://fremd.example/bild.jpg'],
            '/assets/chor.jpg',
            'assets::gibtsnicht.jpg',
            'privat::vertrag.jpg',
            ['assets::chor.jpg', 'assets::portrait.jpg'],
            '',
            [],
            null,
            ['nested' => ['assets::chor.jpg']],
        ] as $value) {
            $this->patchJson($url, ['asset' => $value])->assertStatus(422);
        }

        $this->assertSame('/assets/portrait.jpg', Entry::find('entry-1')->get('zeilen')[0]['wert']);
    }

    #[Test]
    public function a_container_without_public_urls_is_never_allowed(): void
    {
        $this->anEntryWithPictures();
        config(['statamic-inline-edit.image_containers' => ['assets', 'privat']]);
        // Its disk has no URL, so neither does any asset in it.
        $this->assertTrue(AssetContainer::find('privat')->private());
        $this->actingAs($this->anEditor());

        $this->patchJson($this->imageUrl(), ['asset' => ['privat::vertrag.jpg']])->assertStatus(422);
    }

    #[Test]
    public function someone_who_may_not_update_the_entry_may_look_but_not_save(): void
    {
        $this->anEntryWithPictures();

        $url = $this->signedAsEditor();

        config(['statamic.editions.pro' => true]);
        Role::make('leser')->permissions(['access cp', 'view pages entries'])->save();
        $reader = User::make()->id('reader-1')->email('reader@example.com')->assignRole('leser')->save();

        $this->actingAs($reader)->get($url)->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->where('readOnly', true));

        $this->actingAs($reader)->patchJson($url, ['asset' => ['assets::chor.jpg']])->assertForbidden();

        $this->assertSame('/assets/portrait.jpg', Entry::find('entry-1')->get('zeilen')[0]['wert']);
    }

    #[Test]
    public function the_row_must_still_be_one_row(): void
    {
        $this->anEntryWithPictures();
        $url = $this->signedAsEditor();

        $entry = Entry::find('entry-1');
        $rows = $entry->get('zeilen');
        $rows[] = ['id' => 'b1', 'schluessel' => 'kopie', 'wert' => '/assets/chor.jpg'];
        $entry->set('zeilen', $rows)->save();

        $this->patchJson($url, ['asset' => ['assets::chor.jpg']])->assertNotFound();
    }

    #[Test]
    public function entries_under_revisions_are_refused(): void
    {
        $this->anEntryWithPictures();
        $url = $this->signedAsEditor();

        config(['statamic.revisions.enabled' => true, 'statamic.editions.pro' => true]);
        Collection::find('pages')->revisionsEnabled(true)->save();

        $this->patchJson($url, ['asset' => ['assets::chor.jpg']])->assertForbidden();
        $this->get($url)->assertForbidden();
    }

    #[Test]
    public function the_text_route_still_writes_a_text_cell_next_to_it(): void
    {
        // A picture cell does not change what the frontend save route does
        // for the cell beside it.
        $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        $this->postJson('/!/statamic-inline-edit/save', ['changes' => [[
            'id' => 'entry-1',
            'fields' => ['zeilen.b2.wert' => 'Neu'],
        ]]])->assertOk();

        $this->assertSame('Neu', Entry::find('entry-1')->get('zeilen')[1]['wert']);
    }

    #[Test]
    public function a_cell_the_site_calls_a_picture_is_refused_on_the_text_route(): void
    {
        $this->anEntryWithPictures();
        $this->actingAs($this->anEditor());

        InlineEdit::imageCells(fn (array $row, string $column) => $column === 'wert' && str_ends_with($row['schluessel'] ?? '', '.image'));

        foreach (['https://fremd.example/bild.jpg', '/assets/chor.jpg', 'Tippfehler'] as $value) {
            $this->postJson('/!/statamic-inline-edit/save', ['changes' => [[
                'id' => 'entry-1',
                'fields' => ['zeilen.b1.wert' => $value],
            ]]])->assertStatus(422);
        }

        $this->assertSame('/assets/portrait.jpg', Entry::find('entry-1')->get('zeilen')[0]['wert']);

        // No text marker that could only lead to that refusal; the picture
        // marker still works, and the headline next to it is still text.
        $entry = Entry::find('entry-1');
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'b1', 'wert'));
        $this->assertSame('image', InlineEdit::cell($entry, 'zeilen', 'b1', 'wert', null, true)['data-sie-mode']);
        $this->assertSame('text', InlineEdit::cell($entry, 'zeilen', 'b2', 'wert')['data-sie-mode']);

        $this->patchJson($this->imageUrl(), ['asset' => ['assets::chor.jpg']])->assertOk();
        $this->assertSame('/assets/chor.jpg', Entry::find('entry-1')->get('zeilen')[0]['wert']);
    }

    #[Test]
    public function the_picker_does_not_exist_when_the_addon_is_switched_off(): void
    {
        $this->anEntryWithPictures();
        $url = $this->signedAsEditor();

        config(['statamic-inline-edit.enabled' => false]);

        $this->get($url)->assertNotFound();
        $this->patchJson($url, ['asset' => ['assets::chor.jpg']])->assertNotFound();
    }

    #[Test]
    public function a_signature_is_bound_to_the_entry(): void
    {
        $this->anEntryWithPictures();
        $this->makeEntry(['title' => 'Zwei', 'zeilen' => $this->rows()], 'pages', 'entry-2');

        $url = $this->signedAsEditor();

        $this->get(str_replace('/entry-1/', '/entry-2/', $url))->assertForbidden();
        $this->assertTrue(URL::hasValidSignature(request()->create($url), false));
    }

    protected function signedAsEditor(): string
    {
        $this->actingAs($this->anEditor());

        return $this->imageUrl();
    }
}
