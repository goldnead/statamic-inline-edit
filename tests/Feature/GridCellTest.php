<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\InlineEdit;
use Goldnead\StatamicInlineEdit\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;
use Statamic\Facades\Collection;
use Statamic\Facades\Entry;
use Statamic\Facades\Site;

/**
 * One cell of a grid, addressed by the row's own id.
 *
 * A site whose copy lives in grid rows had no way in: a value inside a grid has
 * no path back to its entry once it is augmented. It does have an address,
 * though. Core gives every row a persisted id the moment the control panel
 * saves it, and that id survives reordering, which a position does not.
 *
 * The cell is named in the field handle as `grid.rowId.column`, so the script
 * in the browser needs nothing new: it sends whatever the marker said.
 */
class GridCellTest extends TestCase
{
    protected string $url = '/!/statamic-inline-edit/save';

    /**
     * @return array<int, array<string, mixed>>
     */
    protected function rows(): array
    {
        return [
            ['id' => 'r1', 'schluessel' => 'hero.title', 'wert' => 'Alte Überschrift', 'an' => true],
            // A row the control panel never saved: no id, so no address.
            ['schluessel' => 'hero.intro', 'wert' => 'Ohne Kennung'],
            ['id' => 'r3', 'schluessel' => 'hero.cta', 'wert' => "Zwei\nZeilen"],
        ];
    }

    protected function anEntryWithRows(): \Statamic\Contracts\Entries\Entry
    {
        $this->makeCollection();

        return $this->makeEntry(['title' => 'Hello', 'zeilen' => $this->rows()]);
    }

    /**
     * @param  array<string, mixed>  $fields
     * @return array<string, mixed>
     */
    protected function change(array $fields, ?string $stamp = null): array
    {
        return ['changes' => [array_filter([
            'id' => 'entry-1',
            'stamp' => $stamp,
            'fields' => $fields,
        ], fn ($v) => $v !== null)]];
    }

    /* ------------------------------------------------------------ marker */

    #[Test]
    public function a_cell_gets_a_marker_named_after_its_row(): void
    {
        $entry = $this->anEntryWithRows();
        $this->actingAs($this->anEditor());

        $marker = InlineEdit::cell($entry, 'zeilen', 'r1', 'wert');

        $this->assertSame('entry-1', $marker['data-sie-id']);
        $this->assertSame('zeilen.r1.wert', $marker['data-sie-field']);
        $this->assertSame('textarea', $marker['data-sie-type']);
        $this->assertSame('text', $marker['data-sie-mode']);
        $this->assertSame('true', $marker['data-sie-multiline']);
        $this->assertNotSame('', $marker['data-sie-stamp']);
        $this->assertSame('Zeilen › Wert', $marker['data-sie-label']);
        $this->assertArrayNotHasKey('data-sie-wraps', $marker);
    }

    #[Test]
    public function the_caller_may_name_the_cell_for_the_person_editing_it(): void
    {
        $entry = $this->anEntryWithRows();
        $this->actingAs($this->anEditor());

        $marker = InlineEdit::cell($entry, 'zeilen', 'r1', 'wert', 'Hero-Überschrift');

        $this->assertSame('Hero-Überschrift', $marker['data-sie-label']);
    }

    #[Test]
    public function a_cell_with_line_breaks_is_flagged_from_the_server(): void
    {
        $entry = $this->anEntryWithRows();
        $this->actingAs($this->anEditor());

        $this->assertSame('true', InlineEdit::cell($entry, 'zeilen', 'r3', 'wert')['data-sie-wraps']);
    }

    #[Test]
    public function a_visitor_gets_no_cell_marker(): void
    {
        $entry = $this->anEntryWithRows();

        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'r1', 'wert'));
    }

    #[Test]
    public function a_cell_marker_arms_the_editor_like_any_other(): void
    {
        $entry = $this->anEntryWithRows();
        $this->actingAs($this->anEditor());

        $this->assertFalse(InlineEdit::active());

        InlineEdit::cell($entry, 'zeilen', 'r1', 'wert');

        $this->assertTrue(InlineEdit::active());
    }

    #[Test]
    public function a_cell_that_cannot_be_addressed_or_written_gets_no_marker(): void
    {
        $entry = $this->anEntryWithRows();
        $this->actingAs($this->anEditor());

        // No such row: an id the page invented, or one that was deleted.
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'gibtsnicht', 'wert'));
        // No such column.
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'r1', 'nope'));
        // A column that is not plain text: a toggle has no text to put a
        // cursor in, an asset field is a whole picker.
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'r1', 'an'));
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'r1', 'bild'));
        // Not a grid at all.
        $this->assertSame([], InlineEdit::cell($entry, 'title', 'r1', 'wert'));
        $this->assertSame([], InlineEdit::cell($entry, 'nope', 'r1', 'wert'));
        // An id that could break out of the dotted address.
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'r1.wert', 'wert'));
    }

    #[Test]
    public function a_cell_under_revisions_gets_no_marker(): void
    {
        config()->set('statamic.revisions.enabled', true);
        config()->set('statamic.editions.pro', true);

        $this->makeCollection();
        Collection::find('pages')->revisionsEnabled(true)->save();
        $entry = $this->makeEntry(['title' => 'Hello', 'zeilen' => $this->rows()]);

        $this->actingAs($this->anEditor());

        // The save route refuses it. A marker that can only lead to a
        // refusal is a promise the page cannot keep.
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'r1', 'wert'));
    }

    /* -------------------------------------------------------------- save */

    #[Test]
    public function saving_a_cell_writes_that_cell_and_nothing_else(): void
    {
        $this->anEntryWithRows();

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['zeilen.r1.wert' => 'Neue Überschrift']))
            ->assertOk();

        $expected = $this->rows();
        $expected[0]['wert'] = 'Neue Überschrift';

        // Same order, same keys, the row without an id still without one, and
        // the toggle in the same row still a real boolean.
        $this->assertSame($expected, Entry::find('entry-1')->get('zeilen'));
        $this->assertSame('Hello', Entry::find('entry-1')->get('title'));
    }

    #[Test]
    public function a_cell_and_a_field_of_the_same_entry_save_together(): void
    {
        $this->anEntryWithRows();

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change([
                'title' => 'Neu',
                'zeilen.r3.wert' => 'Eine Zeile',
            ]))
            ->assertOk();

        $entry = Entry::find('entry-1');

        $this->assertSame('Neu', $entry->get('title'));
        $this->assertSame('Eine Zeile', $entry->get('zeilen')[2]['wert']);
        $this->assertSame('Alte Überschrift', $entry->get('zeilen')[0]['wert']);
    }

    #[Test]
    public function a_non_breaking_space_in_a_cell_is_normalised(): void
    {
        $this->anEntryWithRows();

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['zeilen.r1.wert' => "Zwei\u{00A0}Wörter"]))
            ->assertOk();

        $this->assertSame('Zwei Wörter', Entry::find('entry-1')->get('zeilen')[0]['wert']);
    }

    #[Test]
    public function cells_that_are_not_text_or_do_not_exist_are_refused(): void
    {
        $this->anEntryWithRows();
        $editor = $this->anEditor();

        foreach ([
            'zeilen.gibtsnicht.wert',   // no such row
            'zeilen.r1.nope',           // no such column
            'zeilen.r1.an',             // a toggle
            'zeilen.r1.bild',           // an asset picker
            'title.r1.wert',            // not a grid
            'slug.r1.wert',             // never, whatever it is
            'zeilen.r1',                // not a cell
            'zeilen.r1.wert.extra',     // not a cell either
            'zeilen..wert',             // an empty id matches the row without one
            'zeilen.r1.id',             // the row's own address
        ] as $key) {
            $this->actingAs($editor)
                ->postJson($this->url, $this->change([$key => 'x']))
                ->assertStatus(422);
        }

        // Only a scalar is text. An array or an object would land in the file
        // as a structure the column was never meant to hold.
        foreach ([['x'], ['a' => 'b'], true, null] as $value) {
            $this->actingAs($editor)
                ->postJson($this->url, $this->change(['zeilen.r1.wert' => $value]))
                ->assertStatus(422);
        }

        $this->assertSame($this->rows(), Entry::find('entry-1')->get('zeilen'));
    }

    #[Test]
    public function a_row_id_that_occurs_twice_is_not_an_address(): void
    {
        $this->makeCollection();
        $rows = $this->rows();
        $rows[2]['id'] = 'r1';
        $entry = $this->makeEntry(['title' => 'Hello', 'zeilen' => $rows]);

        $this->actingAs($this->anEditor());

        // Hand-edited YAML or a copied row: two rows, one id. Picking the
        // first would put the edit in a row the page may not have shown.
        $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'r1', 'wert'));

        $this->postJson($this->url, $this->change(['zeilen.r1.wert' => 'Neu']))
            ->assertStatus(422);

        $this->assertSame($rows, Entry::find('entry-1')->get('zeilen'));
    }

    #[Test]
    public function a_read_only_or_hidden_column_is_neither_marked_nor_written(): void
    {
        $entry = $this->anEntryWithRows();
        $this->actingAs($this->anEditor());

        foreach (['gesperrt', 'versteckt'] as $column) {
            $this->assertSame([], InlineEdit::cell($entry, 'zeilen', 'r1', $column), $column);

            $this->postJson($this->url, $this->change(["zeilen.r1.{$column}" => 'x']))
                ->assertStatus(422);
        }

        $this->assertSame($this->rows(), Entry::find('entry-1')->get('zeilen'));
    }

    #[Test]
    public function a_localization_that_inherits_the_grid_is_not_written(): void
    {
        config()->set('statamic.system.multisite', true);
        config()->set('statamic.editions.pro', true);
        Site::setSites([
            'de' => ['name' => 'Deutsch', 'url' => '/', 'locale' => 'de_DE'],
            'en' => ['name' => 'English', 'url' => '/en/', 'locale' => 'en_US'],
        ]);

        $this->makeCollection();
        Collection::find('pages')->sites(['de', 'en'])->save();

        $origin = Entry::make()->collection('pages')->locale('de')->id('entry-1')->slug('a-page')
            ->data(['title' => 'Hallo', 'zeilen' => $this->rows()]);
        $origin->save();

        $localized = Entry::make()->collection('pages')->locale('en')->id('entry-en')->slug('a-page')
            ->origin($origin)->data(['title' => 'Hello']);
        $localized->save();

        $this->actingAs($this->anEditor());

        // Writing one cell would copy the whole inherited grid into the
        // localization, and it would stop following the origin for good.
        $this->assertSame([], InlineEdit::cell($localized, 'zeilen', 'r1', 'wert'));

        $this->postJson($this->url, ['changes' => [['id' => 'entry-en', 'fields' => ['zeilen.r1.wert' => 'New']]]])
            ->assertStatus(422);

        $this->assertFalse(Entry::find('entry-en')->has('zeilen'));
        $this->assertSame($this->rows(), Entry::find('entry-1')->get('zeilen'));
    }

    #[Test]
    public function an_integer_cell_is_stored_as_the_column_would_store_it(): void
    {
        $this->anEntryWithRows();

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['zeilen.r1.anzahl' => '12']))
            ->assertOk();

        $this->assertSame(12, Entry::find('entry-1')->get('zeilen')[0]['anzahl']);
    }

    #[Test]
    public function a_cell_under_revisions_is_refused_on_save(): void
    {
        config()->set('statamic.revisions.enabled', true);
        config()->set('statamic.editions.pro', true);

        $this->makeCollection();
        Collection::find('pages')->revisionsEnabled(true)->save();
        $this->makeEntry(['title' => 'Hello', 'zeilen' => $this->rows()]);

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['zeilen.r1.wert' => 'Neu']))
            ->assertStatus(422);

        $this->assertSame($this->rows(), Entry::find('entry-1')->get('zeilen'));
    }

    #[Test]
    public function a_cell_is_checked_against_its_own_column_rules(): void
    {
        $this->anEntryWithRows();

        // The key column is required. Emptying it through the page would leave
        // a row the control panel then refuses to save.
        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['zeilen.r1.schluessel' => '']))
            ->assertStatus(422);

        $this->assertSame('hero.title', Entry::find('entry-1')->get('zeilen')[0]['schluessel']);
    }

    #[Test]
    public function a_guest_cannot_write_a_cell(): void
    {
        $this->anEntryWithRows();

        $this->postJson($this->url, $this->change(['zeilen.r1.wert' => 'Neu']))->assertForbidden();

        $this->assertSame($this->rows(), Entry::find('entry-1')->get('zeilen'));
    }

    #[Test]
    public function a_stale_page_cannot_overwrite_a_cell(): void
    {
        $this->anEntryWithRows();

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['zeilen.r1.wert' => 'Neu'], stamp: '1'))
            ->assertStatus(409);

        $this->assertSame($this->rows(), Entry::find('entry-1')->get('zeilen'));
    }

    #[Test]
    public function a_cell_longer_than_the_ceiling_is_refused(): void
    {
        config()->set('statamic-inline-edit.max_length', 5);

        $this->anEntryWithRows();

        $this->actingAs($this->anEditor())
            ->postJson($this->url, $this->change(['zeilen.r1.wert' => 'sechsz']))
            ->assertStatus(422);
    }
}
