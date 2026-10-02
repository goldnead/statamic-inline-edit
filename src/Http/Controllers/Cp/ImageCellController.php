<?php

namespace Goldnead\StatamicInlineEdit\Http\Controllers\Cp;

use Goldnead\StatamicInlineEdit\Support\Cell;
use Goldnead\StatamicInlineEdit\Support\Editor;
use Goldnead\StatamicInlineEdit\Support\ImageCell;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\URL;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Statamic\Facades\Blueprint;
use Statamic\Fields\Field;

use function Statamic\trans as __;

/**
 * The asset browser for a text cell that holds the path of a picture.
 *
 * The card is the same one-field publish form as for any other field, so the
 * person gets core's own asset field: the picture that is there now, Browse,
 * drop to upload. The field is made up here, because the column it writes is
 * a string and not an asset field; what comes back is an asset id, and the
 * cell gets that asset's public URL.
 *
 * Nothing about which cell this is comes from the page unsigned. The marker
 * signed the address for this entry; a request for any other cell, entry or
 * picture has no valid signature and is turned away before anything is read.
 */
class ImageCellController extends FieldController
{
    /**
     * The handle of the made-up field, and the key the form posts its value
     * under. Not the column's handle: a grid column can be called anything,
     * including something the publish form treats specially.
     */
    public const HANDLE = 'asset';

    public function show(Request $request, $collection, $entry, string $address)
    {
        $this->authorize('view', $entry);

        [$grid, $index, $column, $field] = $this->cell($request, $entry, $address);

        $editor = app(Editor::class);
        $current = ImageCell::current($editor, $entry->get($grid)[$index][$column] ?? null);

        $blueprint = Blueprint::makeFromFields([self::HANDLE => [
            'type' => 'assets',
            'display' => $request->query('label') ?: $field->display(),
            'container' => $editor->imageContainers()[0],
            'max_files' => 1,
            'mode' => 'grid',
            'allow_uploads' => true,
        ]])->setParent($entry);

        $fields = $blueprint->fields()
            ->addValues([self::HANDLE => $current ? [$current->id()] : []])
            ->preProcess();

        return Inertia::render('statamic-inline-edit::Field', [
            'handle' => self::HANDLE,
            'title' => $blueprint->field(self::HANDLE)->display(),
            'blueprint' => $this->publishArray($entry, $blueprint),
            'values' => $fields->values()->all(),
            'meta' => $fields->meta()->all(),
            'saveUrl' => URL::signedRoute('statamic.cp.inline-edit.image.update', [
                'collection' => $collection->handle(),
                'entry' => $entry->id(),
                'address' => $address,
            ], absolute: false),
            'csrfToken' => csrf_token(),
            'readOnly' => $request->user()->cant('update', $entry),
            'inplace' => false,
            'picker' => true,
            'labels' => [
                'save' => __('statamic-inline-edit::messages.save'),
                'saving' => __('statamic-inline-edit::messages.saving'),
                'close' => __('statamic-inline-edit::messages.close'),
                'failed' => __('statamic-inline-edit::messages.failed'),
            ],
        ]);
    }

    public function store(Request $request, $collection, $entry, string $address): JsonResponse
    {
        $this->authorize('update', $entry);

        [$grid, $index, $column] = $this->cell($request, $entry, $address);

        $asset = ImageCell::chosen(app(Editor::class), $request->input(self::HANDLE));

        if ($asset === null) {
            return response()->json([
                'message' => __('statamic-inline-edit::messages.error_image'),
                'errors' => [self::HANDLE => [__('statamic-inline-edit::messages.error_image')]],
            ], 422);
        }

        try {
            $value = Cell::process($entry, $grid, $index, $column, ImageCell::publicUrl($asset), [
                'id' => $entry->id(),
                'collection' => $entry->collectionHandle(),
                'site' => $entry->locale(),
            ]);
        } catch (ValidationException $e) {
            return response()->json([
                'message' => __('statamic-inline-edit::messages.error_invalid'),
                'errors' => $e->errors(),
            ], 422);
        }

        Cell::put($entry, $grid, $index, $column, $value);

        $entry->save();

        return response()->json(['saved' => true]);
    }

    /**
     * Every gate, in the order that gives nothing away: switched off is 404,
     * an address the server never signed is 403 before the entry is looked
     * at, revisions are 403, and a cell that is not (or no longer) a single
     * writable text cell is 404.
     *
     * @return array{0: string, 1: int, 2: string, 3: Field}
     */
    protected function cell(Request $request, $entry, string $address): array
    {
        $editor = app(Editor::class);

        abort_unless($editor->enabled(), 404);

        abort_unless(URL::hasValidSignature($request, absolute: false), 403);

        abort_if($editor->imageContainers() === [], 404);

        abort_if(
            method_exists($entry, 'revisionsEnabled') && $entry->revisionsEnabled(),
            403,
            __('statamic-inline-edit::messages.error_revisions')
        );

        $parts = Cell::parse($address);

        abort_if($parts === null, 404);

        [$grid, $row, $column] = $parts;

        $field = Cell::column($editor, $entry, $grid, $column);
        $index = $field ? Cell::rowIndex($entry, $grid, $row) : null;

        abort_if($field === null || $index === null, 404);

        return [$grid, $index, $column, $field];
    }
}
