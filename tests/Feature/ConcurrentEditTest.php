<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\InlineEdit;
use Goldnead\StatamicInlineEdit\Support\Marker;
use Goldnead\StatamicInlineEdit\Tests\TestCase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia;
use PHPUnit\Framework\Attributes\Test;
use Statamic\Facades\AssetContainer;
use Statamic\Facades\Entry;

/**
 * Two people, one entry that was last saved in the control panel.
 *
 * That last detail is the whole point. Core's `lastModified()` prefers the
 * stored `updated_at` over the file's mtime, so an addon save that leaves
 * `updated_at` alone leaves the stamp alone, and the second editor's older
 * page still matches. Every test starts from such an entry and proves the
 * same thing three times over: the first save moves the stamp, the second,
 * from the older page, is refused, and the first change survives.
 *
 * The stamp is never part of an address. The page keeps one, `data-sie-stamp`
 * on the marker, refreshes it after every save, and the script appends it to
 * the overlay's address when it opens (`opened()` below does the same). An
 * address with a stamp baked in would go stale the moment its own page saved.
 */
class ConcurrentEditTest extends TestCase
{
    protected function cpSavedEntry(array $data = []): \Statamic\Contracts\Entries\Entry
    {
        $this->makeCollection();

        $entry = $this->makeEntry($data + ['title' => 'Hello', 'intro' => 'Original']);

        // As if saved in the control panel a day ago.
        $entry->set('updated_at', now()->subDay()->timestamp)->save();

        $this->actingAs($this->anEditor());

        return $entry;
    }

    /**
     * What the script does when it opens an overlay: the marker's address
     * plus the stamp the page holds right now.
     */
    protected function opened(string $url, string $stamp): string
    {
        return $url.(str_contains($url, '?') ? '&' : '?').'stamp='.$stamp;
    }

    protected function openedStamp(string $url): string
    {
        $stamp = null;

        $this->get($url)->assertOk()->assertInertia(function (AssertableInertia $page) use (&$stamp) {
            $stamp = $page->toArray()['props']['stamp'] ?? null;
        });

        return (string) $stamp;
    }

    protected function fieldUrl(\Statamic\Contracts\Entries\Entry $entry, string $handle): string
    {
        return app(Marker::class)->fieldUrl($entry, $handle);
    }

    protected function imageEntry(): \Statamic\Contracts\Entries\Entry
    {
        Storage::fake('bilder', ['url' => '/assets']);
        AssetContainer::make('assets')->disk('bilder')->title('Bilder')->save();

        foreach (['portrait.jpg', 'chor.jpg'] as $file) {
            Storage::disk('bilder')->put($file, UploadedFile::fake()->image($file, 40, 30)->getContent());
        }

        return $this->cpSavedEntry(['zeilen' => [
            ['id' => 'b1', 'schluessel' => 'hero.image', 'wert' => '/assets/portrait.jpg'],
        ]]);
    }

    /**
     * @return array<string, string>
     */
    protected function imageMarker(\Statamic\Contracts\Entries\Entry $entry): array
    {
        return InlineEdit::cell($entry, 'zeilen', 'b1', 'wert', 'Bild', true);
    }

    #[Test]
    public function a_direct_text_save_moves_the_stamp_and_refuses_the_older_page(): void
    {
        $entry = $this->cpSavedEntry();

        // Both sessions rendered the page before anyone saved.
        $stampA = InlineEdit::marker($entry, 'title')['data-sie-stamp'];
        $stampB = InlineEdit::marker($entry, 'title')['data-sie-stamp'];
        $this->assertNotSame('', $stampA);

        $first = $this->postJson('/!/statamic-inline-edit/save', ['changes' => [
            ['id' => 'entry-1', 'stamp' => $stampA, 'fields' => ['title' => 'From A']],
        ]])->assertOk();

        $this->assertNotSame($stampA, $first->json('saved.0.stamp'));
        $this->assertNotSame($stampA, (string) Entry::find('entry-1')->lastModified()->getTimestamp());

        $this->postJson('/!/statamic-inline-edit/save', ['changes' => [
            ['id' => 'entry-1', 'stamp' => $stampB, 'fields' => ['title' => 'From B']],
        ]])->assertStatus(409);

        $this->assertSame('From A', Entry::find('entry-1')->get('title'));

        // Page A, which carries the stamp the save answered with, may go on.
        $this->postJson('/!/statamic-inline-edit/save', ['changes' => [
            ['id' => 'entry-1', 'stamp' => $first->json('saved.0.stamp'), 'fields' => ['title' => 'A again']],
        ]])->assertOk();
    }

    #[Test]
    public function the_single_field_overlay_moves_the_stamp_and_refuses_the_older_page(): void
    {
        $entry = $this->cpSavedEntry();

        $stampA = InlineEdit::marker($entry, 'intro')['data-sie-stamp'];
        $stampB = InlineEdit::marker($entry, 'intro')['data-sie-stamp'];
        $url = $this->fieldUrl($entry, 'intro');

        $this->patchJson($this->opened($url, $stampA), ['intro' => 'From A', '_stamp' => $stampA])->assertOk();

        $this->assertNotSame($stampA, (string) Entry::find('entry-1')->lastModified()->getTimestamp());

        $this->patchJson($this->opened($url, $stampB), ['intro' => 'From B', '_stamp' => $stampB])->assertStatus(409);

        $this->assertSame('From A', Entry::find('entry-1')->get('intro'));
    }

    #[Test]
    public function the_overlay_form_is_handed_the_stamp_of_the_page_that_opened_it(): void
    {
        $entry = $this->cpSavedEntry();

        $stamp = InlineEdit::marker($entry, 'intro')['data-sie-stamp'];

        $this->assertSame($stamp, $this->openedStamp($this->opened($this->fieldUrl($entry, 'intro'), $stamp)));
    }

    #[Test]
    public function an_address_carries_no_stamp_because_the_page_refreshes_its_own(): void
    {
        $entry = $this->imageEntry();

        $this->assertStringNotContainsString('stamp=', $this->fieldUrl($entry, 'intro'));
        $this->assertStringNotContainsString('stamp=', $this->imageMarker($entry)['data-sie-field-url']);
        $this->assertNotSame('', $this->imageMarker($entry)['data-sie-stamp']);
    }

    #[Test]
    public function an_own_direct_save_does_not_make_the_same_pages_overlay_conflict(): void
    {
        $entry = $this->cpSavedEntry();

        $stamp = InlineEdit::marker($entry, 'title')['data-sie-stamp'];
        $url = $this->fieldUrl($entry, 'intro');

        $saved = $this->postJson('/!/statamic-inline-edit/save', ['changes' => [
            ['id' => 'entry-1', 'stamp' => $stamp, 'fields' => ['title' => 'Mine']],
        ]])->assertOk()->json('saved.0.stamp');

        // The script wrote the answer onto every marker; the overlay opens
        // with it, from the very same address as before the save.
        $this->assertSame($saved, $this->openedStamp($this->opened($url, $saved)));

        $this->patchJson($this->opened($url, $saved), ['intro' => 'Also mine', '_stamp' => $saved])->assertOk();

        $this->assertSame('Also mine', Entry::find('entry-1')->get('intro'));
    }

    #[Test]
    public function an_own_direct_save_does_not_make_the_same_pages_image_cell_conflict(): void
    {
        $entry = $this->imageEntry();

        $stamp = $this->imageMarker($entry)['data-sie-stamp'];
        $url = $this->imageMarker($entry)['data-sie-field-url'];

        $saved = $this->postJson('/!/statamic-inline-edit/save', ['changes' => [
            ['id' => 'entry-1', 'stamp' => $stamp, 'fields' => ['title' => 'Mine']],
        ]])->assertOk()->json('saved.0.stamp');

        // The signed address is the one the page was drawn with; only the
        // stamp beside it is new, and it sits outside the signature.
        $this->assertSame($saved, $this->openedStamp($this->opened($url, $saved)));

        $this->patchJson($this->opened($url, $saved), ['asset' => ['assets::chor.jpg'], '_stamp' => $saved])->assertOk();

        $this->assertSame('/assets/chor.jpg', Entry::find('entry-1')->get('zeilen')[0]['wert']);
    }

    #[Test]
    public function an_image_cell_save_moves_the_stamp_and_refuses_the_older_page(): void
    {
        $entry = $this->imageEntry();

        $url = $this->imageMarker($entry)['data-sie-field-url'];
        $stampA = $this->imageMarker($entry)['data-sie-stamp'];
        $stampB = $this->imageMarker($entry)['data-sie-stamp'];

        $this->assertSame($stampA, $this->openedStamp($this->opened($url, $stampA)));

        $this->patchJson($this->opened($url, $stampA), ['asset' => ['assets::chor.jpg'], '_stamp' => $stampA])->assertOk();

        $this->assertNotSame($stampA, (string) Entry::find('entry-1')->lastModified()->getTimestamp());

        $this->patchJson($this->opened($url, $stampB), ['asset' => ['assets::portrait.jpg'], '_stamp' => $stampB])->assertStatus(409);

        $this->assertSame('/assets/chor.jpg', Entry::find('entry-1')->get('zeilen')[0]['wert']);
    }
}
