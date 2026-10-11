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

        $urlA = app(Marker::class)->fieldUrl($entry, 'intro');
        $urlB = app(Marker::class)->fieldUrl($entry, 'intro');

        $stampA = $this->stampOf($urlA);
        $stampB = $this->stampOf($urlB);

        $this->patchJson($urlA, ['intro' => 'From A', '_stamp' => $stampA])->assertOk();

        $this->assertNotSame($stampA, (string) Entry::find('entry-1')->lastModified()->getTimestamp());

        $this->patchJson($urlB, ['intro' => 'From B', '_stamp' => $stampB])->assertStatus(409);

        $this->assertSame('From A', Entry::find('entry-1')->get('intro'));
    }

    #[Test]
    public function the_overlay_form_is_handed_the_stamp_of_the_page_that_opened_it(): void
    {
        $entry = $this->cpSavedEntry();

        $url = app(Marker::class)->fieldUrl($entry, 'intro');
        $stamp = $this->stampOf($url);

        $this->get($url)->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('stamp', $stamp));
    }

    #[Test]
    public function an_image_cell_save_moves_the_stamp_and_refuses_the_older_page(): void
    {
        Storage::fake('bilder', ['url' => '/assets']);
        AssetContainer::make('assets')->disk('bilder')->title('Bilder')->save();

        foreach (['portrait.jpg', 'chor.jpg'] as $file) {
            Storage::disk('bilder')->put($file, UploadedFile::fake()->image($file, 40, 30)->getContent());
        }

        $entry = $this->cpSavedEntry(['zeilen' => [
            ['id' => 'b1', 'schluessel' => 'hero.image', 'wert' => '/assets/portrait.jpg'],
        ]]);

        $urlA = InlineEdit::cell($entry, 'zeilen', 'b1', 'wert', 'Bild', true)['data-sie-field-url'];
        $urlB = InlineEdit::cell($entry, 'zeilen', 'b1', 'wert', 'Bild', true)['data-sie-field-url'];

        $stampA = $this->openedStamp($urlA);
        $stampB = $this->openedStamp($urlB);
        $this->assertNotEmpty($stampA);

        $this->patchJson($urlA, ['asset' => ['assets::chor.jpg'], '_stamp' => $stampA])->assertOk();

        $this->assertNotSame($stampA, (string) Entry::find('entry-1')->lastModified()->getTimestamp());

        $this->patchJson($urlB, ['asset' => ['assets::portrait.jpg'], '_stamp' => $stampB])->assertStatus(409);

        $this->assertSame('/assets/chor.jpg', Entry::find('entry-1')->get('zeilen')[0]['wert']);
    }

    protected function openedStamp(string $url): string
    {
        $stamp = null;

        $this->get($url)->assertOk()->assertInertia(function (AssertableInertia $page) use (&$stamp) {
            $stamp = $page->toArray()['props']['stamp'] ?? null;
        });

        return (string) $stamp;
    }

    protected function stampOf(string $url): string
    {
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

        return (string) ($query['stamp'] ?? '');
    }
}
