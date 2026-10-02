<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\InlineEdit;
use Goldnead\StatamicInlineEdit\Tests\TestCase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\Test;
use Statamic\Facades\AssetContainer;
use Statamic\Facades\Entry;

/**
 * The words that stand in for a picture, edited where the picture is.
 *
 * An alt text is never on the page, so there is nothing to double-click. It
 * belongs to the picture, and the place the person already is when they deal
 * with the picture is the card that opens on it. So the card carries a second
 * field, and it writes a second cell: the row the site keeps the alt text in.
 *
 * Which row that is comes from the server, signed into the card's address with
 * the picture's own. Nothing the page sends can point the text somewhere else.
 */
class AltTextTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('bilder', ['url' => '/assets']);
        AssetContainer::make('assets')->disk('bilder')->title('Bilder')->save();

        foreach (['portrait.jpg', 'chor.jpg'] as $file) {
            Storage::disk('bilder')->put($file, UploadedFile::fake()->image($file, 40, 30)->getContent());
        }

        $this->makeCollection();
        $this->makeEntry(['title' => 'Hello', 'zeilen' => [
            ['id' => 'b1', 'schluessel' => 'hero.image', 'wert' => '/assets/portrait.jpg'],
            ['id' => 'a1', 'schluessel' => 'hero.imageAlt', 'wert' => 'Adrian am Klavier'],
            ['id' => 't1', 'schluessel' => 'hero.title', 'wert' => 'Bleibt, wie er ist'],
            ['id' => 'b2', 'schluessel' => 'cta.image', 'wert' => '/assets/chor.jpg'],
        ]]);
    }

    protected function tearDown(): void
    {
        InlineEdit::imageCells(null);

        parent::tearDown();
    }

    protected function url(?string $alt = 'a1', string $row = 'b1'): string
    {
        return InlineEdit::cell(Entry::find('entry-1'), 'zeilen', $row, 'wert', 'Hero-Bild', image: true, alt: $alt)['data-sie-field-url'];
    }

    protected function stored(): array
    {
        return Entry::find('entry-1')->get('zeilen');
    }

    #[Test]
    public function the_site_can_ask_whether_the_addon_knows_alt_texts(): void
    {
        $this->assertTrue(InlineEdit::supports('alt'));
        $this->assertTrue(InlineEdit::supports('source'));
        $this->assertFalse(InlineEdit::supports('teleport'));
    }

    #[Test]
    public function the_alt_row_travels_signed_with_the_picture(): void
    {
        $this->actingAs($this->anEditor());

        $url = $this->url();

        $this->assertStringContainsString('alt=a1', $url);
        $this->assertStringContainsString('signature=', $url);

        // Moved onto another row, the signature no longer fits.
        $this->get(str_replace('alt=a1', 'alt=t1', $url))->assertForbidden();
        $this->patchJson(str_replace('alt=a1', 'alt=t1', $url), ['alt_text' => 'Gekapert'])->assertForbidden();

        $this->assertSame('Bleibt, wie er ist', $this->stored()[2]['wert']);
    }

    #[Test]
    public function a_visitor_gets_nothing(): void
    {
        $this->assertSame([], InlineEdit::cell(Entry::find('entry-1'), 'zeilen', 'b1', 'wert', null, image: true, alt: 'a1'));
    }

    #[Test]
    public function the_card_shows_the_alt_text_under_the_picture(): void
    {
        $this->actingAs($this->anEditor());

        $this->get($this->url())
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->has('blueprint.tabs.0.sections.0.fields', 2)
                ->where('blueprint.tabs.0.sections.0.fields.0.handle', 'asset')
                ->where('blueprint.tabs.0.sections.0.fields.1.handle', 'alt_text')
                ->where('blueprint.tabs.0.sections.0.fields.1.type', 'text')
                ->where('blueprint.tabs.0.sections.0.fields.1.display', 'Alt text')
                ->where('values.asset', ['assets::portrait.jpg'])
                ->where('values.alt_text', 'Adrian am Klavier')
            );
    }

    #[Test]
    public function without_an_alt_row_the_card_is_the_picture_alone(): void
    {
        $this->actingAs($this->anEditor());

        $url = $this->url(null);

        $this->assertStringNotContainsString('alt=', $url);
        $this->get($url)->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->has('blueprint.tabs.0.sections.0.fields', 1));
    }

    #[Test]
    public function saving_the_alt_text_writes_only_the_alt_row(): void
    {
        $this->actingAs($this->anEditor());
        $before = $this->stored();

        // The card sends both fields; the picture is the one already there.
        $this->patchJson($this->url(), ['asset' => ['assets::portrait.jpg'], 'alt_text' => 'Adrian singt'])
            ->assertOk()
            ->assertJsonPath('saved', true);

        $before[1]['wert'] = 'Adrian singt';
        $this->assertSame($before, $this->stored());
    }

    #[Test]
    public function an_empty_picture_with_an_alt_text_changes_only_the_alt_text(): void
    {
        // A stored path outside every container opens the picker empty. The
        // alt text must still be savable, and the picture left alone.
        $this->actingAs($this->anEditor());
        $before = $this->stored();

        foreach ([[], null, ''] as $empty) {
            $this->patchJson($this->url(), ['asset' => $empty, 'alt_text' => 'Neu'])->assertOk();
        }

        $before[1]['wert'] = 'Neu';
        $this->assertSame($before, $this->stored());
    }

    #[Test]
    public function picture_and_alt_text_are_saved_together(): void
    {
        $this->actingAs($this->anEditor());

        $this->patchJson($this->url(), ['asset' => ['assets::chor.jpg'], 'alt_text' => 'Chor im blauen Licht'])->assertOk();

        $this->assertSame('/assets/chor.jpg', $this->stored()[0]['wert']);
        $this->assertSame('Chor im blauen Licht', $this->stored()[1]['wert']);
    }

    #[Test]
    public function a_bad_picture_writes_neither(): void
    {
        $this->actingAs($this->anEditor());
        $before = $this->stored();

        $this->patchJson($this->url(), ['asset' => 'https://fremd.example/x.jpg', 'alt_text' => 'Neu'])->assertStatus(422);

        $this->assertSame($before, $this->stored());
    }

    #[Test]
    public function only_text_is_taken_for_the_alt_text(): void
    {
        $this->actingAs($this->anEditor());
        $before = $this->stored();

        foreach ([['x' => 'y'], ['a', 'b'], 12, true] as $value) {
            $this->patchJson($this->url(), ['asset' => ['assets::portrait.jpg'], 'alt_text' => $value])->assertStatus(422);
        }

        $this->assertSame($before, $this->stored());
    }

    #[Test]
    public function no_alt_field_in_the_request_leaves_the_alt_row_alone(): void
    {
        $this->actingAs($this->anEditor());

        $this->patchJson($this->url(), ['asset' => ['assets::chor.jpg']])->assertOk();

        $this->assertSame('/assets/chor.jpg', $this->stored()[0]['wert']);
        $this->assertSame('Adrian am Klavier', $this->stored()[1]['wert']);
    }

    #[Test]
    public function the_alt_row_must_be_text_and_not_the_picture_itself(): void
    {
        $this->actingAs($this->anEditor());
        $entry = Entry::find('entry-1');

        // The picture's own row, a row that does not exist, and another
        // picture: none is an alt text, so the marker leaves the alt out.
        foreach (['b1', 'gibtsnicht', 'b2'] as $alt) {
            InlineEdit::imageCells(fn (array $row, string $column) => $column === 'wert' && str_ends_with($row['schluessel'] ?? '', '.image'));
            $url = InlineEdit::cell($entry, 'zeilen', 'b1', 'wert', null, image: true, alt: $alt)['data-sie-field-url'];
            $this->assertStringNotContainsString('alt=', $url, $alt);
        }
    }

    #[Test]
    public function an_alt_row_that_became_a_picture_since_is_refused(): void
    {
        $this->actingAs($this->anEditor());
        $url = $this->url();

        $entry = Entry::find('entry-1');
        $rows = $entry->get('zeilen');
        $rows[1]['wert'] = '/assets/chor.jpg';
        $entry->set('zeilen', $rows)->save();

        InlineEdit::imageCells(fn (array $row, string $column) => $column === 'wert' && str_starts_with($row['wert'] ?? '', '/assets/'));

        $this->patchJson($url, ['asset' => ['assets::portrait.jpg'], 'alt_text' => 'Text'])->assertNotFound();
        $this->assertSame('/assets/chor.jpg', $this->stored()[1]['wert']);
    }

    #[Test]
    public function an_alt_row_that_is_gone_is_refused(): void
    {
        $this->actingAs($this->anEditor());
        $url = $this->url();

        $entry = Entry::find('entry-1');
        $rows = $entry->get('zeilen');
        unset($rows[1]);
        $entry->set('zeilen', array_values($rows))->save();

        $this->patchJson($url, ['asset' => ['assets::chor.jpg'], 'alt_text' => 'Text'])->assertNotFound();
        $this->assertSame('/assets/portrait.jpg', $this->stored()[0]['wert']);
    }

    #[Test]
    public function an_alt_text_may_be_emptied(): void
    {
        // An empty alt is a statement too: the picture is decoration.
        $this->actingAs($this->anEditor());

        $this->patchJson($this->url(), ['asset' => ['assets::portrait.jpg'], 'alt_text' => ''])->assertOk();
        $this->assertSame('', (string) $this->stored()[1]['wert']);
    }

    #[Test]
    public function a_text_cell_can_carry_its_stored_source(): void
    {
        $this->actingAs($this->anEditor());
        $entry = Entry::find('entry-1');

        $entry->set('zeilen', [...$entry->get('zeilen'), ['id' => 's1', 'schluessel' => 'h1', 'wert' => 'Zuerst die *Stimme.*']])->save();

        $marker = InlineEdit::cell(Entry::find('entry-1'), 'zeilen', 's1', 'wert', source: true);

        $this->assertSame('text', $marker['data-sie-mode']);
        $this->assertSame('Zuerst die *Stimme.*', $marker['data-sie-source']);

        $this->assertArrayNotHasKey('data-sie-source', InlineEdit::cell(Entry::find('entry-1'), 'zeilen', 's1', 'wert'));
        $this->assertSame([], InlineEdit::cell(Entry::find('entry-1'), 'zeilen', 'gibtsnicht', 'wert', source: true));
    }
}
