<?php

namespace Goldnead\StatamicInlineEdit\Tests\Feature;

use Goldnead\StatamicInlineEdit\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;
use Statamic\Facades\Antlers;

class EditableTagTest extends TestCase
{
    /**
     * The third argument is not optional in practice. Without it Antlers marks
     * the string as user data and refuses to run tags in it, so every template
     * here would render as an empty string and every assertion would fail for
     * a reason that has nothing to do with this addon.
     *
     * @param  array<string, mixed>  $data
     */
    protected function render(string $template, array $data): string
    {
        return (string) Antlers::parse($template, $data, true);
    }

    #[Test]
    public function a_visitor_gets_the_plain_value_and_nothing_else(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello world']);

        $out = $this->render('{{ editable:title }}', $entry->toAugmentedArray());

        $this->assertSame('Hello world', $out);
        $this->assertStringNotContainsString('data-sie', $out);
    }

    #[Test]
    public function an_editor_gets_a_marker_around_the_same_value(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello world']);

        $this->actingAs($this->anEditor());

        $out = $this->render('{{ editable:title }}', $entry->toAugmentedArray());

        $this->assertStringContainsString('data-sie-id="entry-1"', $out);
        $this->assertStringContainsString('data-sie-field="title"', $out);
        $this->assertStringContainsString('data-sie-type="text"', $out);
        $this->assertStringContainsString('>Hello world</span>', $out);
    }

    #[Test]
    public function a_textarea_is_marked_multiline_and_a_text_field_is_not(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'One', 'intro' => "Two\nLines"]);

        $this->actingAs($this->anEditor());

        $data = $entry->toAugmentedArray();

        $this->assertStringContainsString('data-sie-multiline="true"', $this->render('{{ editable:intro }}', $data));
        $this->assertStringNotContainsString('data-sie-multiline', $this->render('{{ editable:title }}', $data));
    }

    #[Test]
    public function only_a_value_with_real_line_breaks_is_flagged_to_render_them(): void
    {
        $this->makeCollection();

        $this->actingAs($this->anEditor());

        $wraps = $this->makeEntry(['title' => 'a', 'intro' => "Two\nLines"], id: 'entry-wraps');
        $plain = $this->makeEntry(['title' => 'b', 'intro' => 'One paragraph.'], id: 'entry-plain');

        $this->assertStringContainsString(
            'data-sie-wraps="true"',
            $this->render('{{ editable:intro }}', $wraps->toAugmentedArray())
        );

        // No hidden breaks to reveal, so the editor's page must read exactly
        // as the visitor's does.
        $this->assertStringNotContainsString(
            'data-sie-wraps',
            $this->render('{{ editable:intro }}', $plain->toAugmentedArray())
        );
    }

    #[Test]
    public function a_fieldtype_that_is_not_allowed_renders_without_a_marker(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello', 'promoted' => true]);

        $this->actingAs($this->anEditor());

        $out = $this->render('{{ editable:promoted }}', $entry->toAugmentedArray());

        $this->assertStringNotContainsString('data-sie', $out);
    }

    #[Test]
    public function the_wrapper_element_can_be_chosen_and_a_bad_one_falls_back_to_span(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        $data = $entry->toAugmentedArray();

        $this->assertStringContainsString('<h1 data-sie-id', $this->render('{{ editable:title tag="h1" }}', $data));

        // A template author interpolating into the tag name must not be able
        // to write attributes of their own.
        $out = $this->render('{{ editable:title tag="span onload=x" }}', $data);
        $this->assertStringContainsString('<span data-sie-id', $out);
        $this->assertStringNotContainsString('onload', $out);
    }

    #[Test]
    public function the_marker_carries_the_blueprint_label_for_the_empty_placeholder(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        $this->assertStringContainsString(
            'data-sie-label="Überschrift"',
            $this->render('{{ editable:title }}', $entry->toAugmentedArray())
        );
    }

    #[Test]
    public function the_field_can_be_named_by_parameter(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        $out = $this->render('{{ editable field="title" }}', $entry->toAugmentedArray());

        $this->assertStringContainsString('data-sie-field="title"', $out);
    }

    #[Test]
    public function switching_the_addon_off_removes_every_marker(): void
    {
        config()->set('statamic-inline-edit.enabled', false);

        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        $this->assertSame('Hello', $this->render('{{ editable:title }}', $entry->toAugmentedArray()));
    }

    #[Test]
    public function an_unknown_field_renders_nothing_rather_than_throwing(): void
    {
        $this->makeCollection();
        $entry = $this->makeEntry(['title' => 'Hello']);

        $this->actingAs($this->anEditor());

        $this->assertSame('', $this->render('{{ editable:nope }}', $entry->toAugmentedArray()));
    }
}
