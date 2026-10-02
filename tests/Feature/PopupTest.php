<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\InlineEdit;
use Goldnead\StatamicInlineEdit\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;
use Statamic\Facades\Entry;

/**
 * Text the page shows differently from how it is stored, edited in a small
 * window instead of in the line.
 *
 * A headline drawn from two cells, a sentence with a link in the middle, a
 * word the component turns into emphasis, a quote the page wraps in quotation
 * marks: typing into the element would save the drawing, not the value. The
 * popup shows the stored values as they are, one box per cell or field, and
 * saving writes those and nothing else. The page then reloads, so the
 * component draws the new value its own way.
 */
class PopupTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->makeCollection();
        $this->makeEntry(['title' => 'Hallo', 'intro' => "Zwei\nZeilen", 'zeilen' => [
            ['id' => 'h1', 'schluessel' => 'hero.line1', 'wert' => 'Zuerst die'],
            ['id' => 'h2', 'schluessel' => 'hero.line2', 'wert' => '*Stimme.*'],
            ['id' => 'p1', 'schluessel' => 'preis', 'wert' => '125 €', 'gesperrt' => 'x'],
            ['id' => 'b1', 'schluessel' => 'hero.image', 'wert' => '/assets/portrait.jpg'],
            ['id' => 'w1', 'schluessel' => 'weich', 'wert' => 'Chor&shy;leitung'],
        ]]);
    }

    protected function tearDown(): void
    {
        InlineEdit::imageCells(null);

        parent::tearDown();
    }

    protected function entry()
    {
        return Entry::find('entry-1');
    }

    /** @return list<array<string, mixed>> */
    protected function fields(array $marker): array
    {
        return json_decode($marker['data-sie-popup'], true, flags: JSON_THROW_ON_ERROR);
    }

    #[Test]
    public function the_site_can_ask_whether_the_addon_knows_popups(): void
    {
        $this->assertTrue(InlineEdit::supports('popup'));
    }

    #[Test]
    public function a_visitor_gets_nothing(): void
    {
        $this->assertSame([], InlineEdit::popup($this->entry(), ['zeilen.h1.wert', 'zeilen.h2.wert']));
        $this->assertSame([], InlineEdit::cell($this->entry(), 'zeilen', 'h1', 'wert', popup: true));
    }

    #[Test]
    public function two_cells_in_one_element_open_as_one_popup_with_the_stored_values(): void
    {
        $this->actingAs($this->anEditor());

        $marker = InlineEdit::popup($this->entry(), [
            'zeilen.h1.wert' => 'Zeile 1',
            'zeilen.h2.wert' => 'Zeile 2',
        ], 'Hero-Überschrift');

        $this->assertSame('entry-1', $marker['data-sie-id']);
        $this->assertSame('popup', $marker['data-sie-mode']);
        $this->assertSame('zeilen.h1.wert', $marker['data-sie-field']);
        $this->assertSame('true', $marker['data-sie-reload']);
        $this->assertSame('Hero-Überschrift', $marker['data-sie-label']);
        $this->assertNotSame('', $marker['data-sie-stamp']);

        $this->assertSame([
            ['field' => 'zeilen.h1.wert', 'label' => 'Zeile 1', 'value' => 'Zuerst die', 'multiline' => true],
            ['field' => 'zeilen.h2.wert', 'label' => 'Zeile 2', 'value' => '*Stimme.*', 'multiline' => true],
        ], $this->fields($marker));
    }

    #[Test]
    public function the_raw_value_is_offered_not_its_drawing(): void
    {
        $this->actingAs($this->anEditor());

        $marker = InlineEdit::cell($this->entry(), 'zeilen', 'w1', 'wert', 'Weich getrennt', popup: true);

        $this->assertSame('popup', $marker['data-sie-mode']);
        $this->assertSame('Chor&shy;leitung', $this->fields($marker)[0]['value']);
        $this->assertSame('Weich getrennt', $this->fields($marker)[0]['label']);
    }

    #[Test]
    public function whole_text_fields_of_an_entry_can_be_in_a_popup_too(): void
    {
        // A quote from another collection, wrapped in quotation marks by the
        // page, or a name and a role in one line.
        $this->actingAs($this->anEditor());

        $fields = $this->fields(InlineEdit::popup($this->entry(), ['title', 'intro']));

        $this->assertSame('title', $fields[0]['field']);
        $this->assertSame('Überschrift', $fields[0]['label']);
        $this->assertSame('Hallo', $fields[0]['value']);
        $this->assertFalse($fields[0]['multiline']);
        $this->assertSame("Zwei\nZeilen", $fields[1]['value']);
        $this->assertTrue($fields[1]['multiline']);
    }

    #[Test]
    public function one_field_that_cannot_be_written_as_text_refuses_the_whole_popup(): void
    {
        // The popup shows what the element shows. Leaving one part out would
        // hide it from the person who thinks they are editing the whole line.
        $this->actingAs($this->anEditor());

        InlineEdit::imageCells(fn (array $row, string $column) => $column === 'wert' && str_starts_with($row['wert'] ?? '', '/assets/'));

        foreach ([
            'markdown' => 'body',
            'toggle' => 'promoted',
            'forbidden' => 'slug',
            'unknown field' => 'gibtsnicht',
            'locked column' => 'zeilen.p1.gesperrt',
            'hidden column' => 'zeilen.p1.versteckt',
            'id column' => 'zeilen.h1.id',
            'unknown row' => 'zeilen.nix.wert',
            'picture row' => 'zeilen.b1.wert',
            'picture row, other column' => 'zeilen.b1.schluessel',
            'not a grid' => 'title.h1.wert',
            'nested deeper' => 'zeilen.h1.wert.x',
        ] as $why => $address) {
            $this->assertSame([], InlineEdit::popup($this->entry(), ['zeilen.h1.wert', $address]), $why);
        }

        $this->assertSame([], InlineEdit::popup($this->entry(), []), 'no fields');
    }

    #[Test]
    public function an_entry_under_revisions_gets_no_popup(): void
    {
        $this->actingAs($this->anEditor());

        $entry = \Mockery::mock($this->entry())->makePartial();
        $entry->shouldReceive('revisionsEnabled')->andReturn(true);

        $this->assertSame([], InlineEdit::popup($entry, ['title']));
    }

    #[Test]
    public function saving_the_popup_writes_only_its_cells(): void
    {
        $this->actingAs($this->anEditor());
        $before = $this->entry()->get('zeilen');
        $marker = InlineEdit::popup($this->entry(), ['zeilen.h1.wert', 'zeilen.h2.wert']);

        $this->postJson('/!/statamic-inline-edit/save', ['changes' => [[
            'id' => 'entry-1',
            'stamp' => $marker['data-sie-stamp'],
            'fields' => ['zeilen.h2.wert' => 'die *Stimme*.'],
        ]]])->assertOk();

        $before[1]['wert'] = 'die *Stimme*.';
        $this->assertSame($before, $this->entry()->get('zeilen'));
        $this->assertSame('Hallo', $this->entry()->get('title'));
    }

    #[Test]
    public function a_popup_over_a_field_and_a_cell_saves_both_in_one_request(): void
    {
        $this->actingAs($this->anEditor());

        $this->postJson('/!/statamic-inline-edit/save', ['changes' => [[
            'id' => 'entry-1',
            'fields' => ['title' => 'Neu', 'zeilen.h1.wert' => 'Zuerst immer die'],
        ]]])->assertOk();

        $this->assertSame('Neu', $this->entry()->get('title'));
        $this->assertSame('Zuerst immer die', $this->entry()->get('zeilen')[0]['wert']);
    }
}
