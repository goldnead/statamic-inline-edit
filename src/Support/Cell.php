<?php

namespace Goldnead\StatamicInlineEdit\Support;

use Facades\Statamic\Fieldtypes\RowId;
use Goldnead\StatamicInlineEdit\Http\Controllers\SaveController;
use Illuminate\Validation\ValidationException;
use Statamic\Fields\Field;

/**
 * One cell of a grid, named by the row's own id.
 *
 * A value inside a grid has no way back to its entry once it is augmented, and
 * that is why grids were refused. But it has an address. Core gives every row a
 * persisted id when the control panel saves it (`RowId`, since 3.3), and the id
 * survives reordering where a position would not: a row moved in the control
 * panel between rendering and saving would otherwise have the edit land in the
 * neighbour.
 *
 * The address travels as an ordinary field handle, `grid.rowId.column`. The
 * browser sends whatever the marker said, so nothing there had to learn a new
 * shape, and a dot cannot occur in a real handle, so the two never collide.
 *
 * Every gate for a cell is in here, used by both the marker and the save
 * route. Two copies is how one of them ends up more permissive.
 */
class Cell
{
    /**
     * Split an address into its three parts, or null when it is not one.
     *
     * Strict on purpose: an empty id would match a row that never had one,
     * and a fourth segment would be a path into a nested structure this does
     * not support.
     *
     * @return array{0: string, 1: string, 2: string}|null
     */
    public static function parse(string $address): ?array
    {
        $parts = explode('.', $address);

        if (count($parts) !== 3) {
            return null;
        }

        [$grid, $row, $column] = $parts;

        if (! self::isHandle($grid) || ! self::isHandle($column) || ! self::isRowId($row)) {
            return null;
        }

        return [$grid, $row, $column];
    }

    /**
     * The site's own answer to "is this text cell really a picture".
     *
     * A marker made with `image: true` says so for the page it is on, but the
     * text save route never sees that marker: it is stateless, and a browser
     * console can post any address to it. Without this the picture cell would
     * be guarded on the one route that offers it and open on the other.
     *
     * @var (\Closure(array<string, mixed>, string, mixed, string): bool)|null
     */
    protected static ?\Closure $imageTest = null;

    /**
     * @param  (callable(array<string, mixed>, string, mixed, string): bool)|null  $test
     *                                                                                    the stored row, the column, the entry, the grid
     */
    public static function treatAsImage(?callable $test): void
    {
        self::$imageTest = $test === null ? null : \Closure::fromCallable($test);
    }

    /**
     * Whether the site says this row holds a picture, in any of its columns.
     * Never true without a test registered.
     *
     * The whole row, not just the cell: the test may decide on a neighbour
     * (a `key` column ending in `.image`). Were that neighbour writable as
     * text, one request could rename it and a second write any string into
     * the picture. So no cell of a picture row goes through the text route.
     */
    public static function isImage(mixed $entry, string $grid, int $index): bool
    {
        if (self::$imageTest === null) {
            return false;
        }

        $row = $entry->get($grid)[$index] ?? null;

        if (! is_array($row)) {
            return false;
        }

        foreach (array_keys($row) as $column) {
            if (is_string($column) && (self::$imageTest)($row, $column, $entry, $grid)) {
                return true;
            }
        }

        return false;
    }

    public static function address(string $grid, string $row, string $column): string
    {
        return $grid.'.'.$row.'.'.$column;
    }

    /**
     * The column's field, if this is a cell we are willing to write.
     *
     * Null for anything else: a handle that is not a grid, a column the grid
     * does not have, a column that is not plain text, a forbidden handle.
     * Plain text only, and that is narrower than for whole fields on purpose.
     * A toggle or select in a row would need the pair form and a control, and
     * a markdown cell a renderer; none of that has an address on the page yet.
     */
    public static function column(Editor $editor, mixed $entry, string $grid, string $column): ?Field
    {
        if (! self::isHandle($grid) || ! self::isHandle($column)) {
            return null;
        }

        if (in_array($grid, SaveController::FORBIDDEN, true)) {
            return null;
        }

        // The row's own id is the address. A column under that handle, or one
        // named like core's plumbing, would let an edit move or duplicate it.
        if (in_array($column, SaveController::FORBIDDEN, true) || $column === RowId::handle()) {
            return null;
        }

        if (! is_object($entry) || ! method_exists($entry, 'blueprint')) {
            return null;
        }

        $blueprint = $entry->blueprint();

        if (! $blueprint || ! $blueprint->hasField($grid)) {
            return null;
        }

        $gridField = $blueprint->field($grid);

        if (! $gridField || $gridField->type() !== 'grid') {
            return null;
        }

        $field = $gridField->fieldtype()->fields()->get($column);

        if (! $field instanceof Field) {
            return null;
        }

        if ($editor->modeFor($field->type()) !== 'text') {
            return null;
        }

        // What the blueprint locks or hides in the control panel stays locked
        // on the page too. Not the place to be more permissive than the CP.
        if (in_array($field->visibility(), ['read_only', 'hidden', 'computed'], true)) {
            return null;
        }

        return $field;
    }

    /**
     * The grid field itself, for its label. Only call after column() said yes.
     */
    public static function grid(mixed $entry, string $grid): ?Field
    {
        $field = $entry->blueprint()->field($grid);

        return $field instanceof Field ? $field : null;
    }

    /**
     * Where the row with this id sits in the stored value, or null.
     *
     * Read from the raw stored value, not the augmented one: augmentation can
     * drop or rename things, and the save writes back into the raw value, so
     * the index has to be an index into that.
     */
    public static function rowIndex(mixed $entry, string $grid, string $row): ?int
    {
        if (! self::isRowId($row) || ! is_object($entry) || ! method_exists($entry, 'get')) {
            return null;
        }

        // A localization that inherits this grid has no rows of its own.
        // Writing one cell there would copy the whole inherited grid into it,
        // and the localization would stop following its origin for good.
        if (method_exists($entry, 'hasOrigin') && $entry->hasOrigin() && ! $entry->has($grid)) {
            return null;
        }

        $rows = $entry->get($grid);

        if (! is_array($rows)) {
            return null;
        }

        $handle = RowId::handle();
        $found = [];

        foreach ($rows as $index => $stored) {
            if (is_array($stored) && isset($stored[$handle]) && (string) $stored[$handle] === $row) {
                $found[] = $index;
            }
        }

        // Two rows with one id (a copied row, hand-edited YAML) are not an
        // address. The first match would be a guess, and a guess here writes
        // into a row the page may never have shown.
        if (count($found) !== 1 || ! is_int($found[0])) {
            return null;
        }

        return $found[0];
    }

    /**
     * The value as the column stores it, after the column's own rules.
     *
     * Through the column's fieldtype, so an integer column stores an integer,
     * the same as a save in the control panel would; and through its
     * validation, so a required key cannot be emptied from the page. Shared
     * by every route that writes a cell.
     *
     * @param  array<string, mixed>  $replacements
     *
     * @throws ValidationException
     */
    public static function process(mixed $entry, string $grid, int $index, string $column, mixed $value, array $replacements): mixed
    {
        $fields = self::grid($entry, $grid)->fieldtype()->fields($index)
            ->only($column)
            ->addValues([$column => $value]);

        $fields->validator()->withReplacements($replacements)->validate();

        return $fields->process()->values()->get($column);
    }

    /**
     * Put one value into the stored rows, as it is.
     *
     * Not through the grid's own process(): that rebuilds every row, strips
     * nulls and re-processes every other cell, and a one-word correction
     * would rewrite the whole grid in the file. Does not save.
     */
    public static function put(mixed $entry, string $grid, int $index, string $column, mixed $value): void
    {
        $stored = $entry->get($grid);
        $stored[$index][$column] = $value;
        $entry->set($grid, $stored);
    }

    protected static function isHandle(string $value): bool
    {
        return (bool) preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $value);
    }

    /**
     * Core's ids are eight random letters and digits. Anything with a dot or
     * a slash in it is not one, whatever it claims.
     */
    protected static function isRowId(string $value): bool
    {
        return (bool) preg_match('/^[A-Za-z0-9_-]{1,64}$/', $value);
    }
}
