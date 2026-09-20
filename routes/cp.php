<?php

use Goldnead\StatamicInlineEdit\Http\Controllers\Cp\FieldController;
use Illuminate\Support\Facades\Route;

/**
 * Discovered from routes/cp.php by the addon service provider and registered
 * inside the control panel's own route group, so these two carry the CP
 * session, its authentication and its CSRF check.
 *
 * They exist for one reason: the overlay on the public page used to load the
 * entire entry form, and a Bard field then arrived surrounded by twenty other
 * fields, a sidebar and a revision history. This renders the one field that
 * was double-clicked, as a real publish form, with the real fieldtype.
 */
Route::get('inline-edit/field/{collection}/{entry}/{handle}', [FieldController::class, 'edit'])
    ->name('inline-edit.field.edit');

Route::patch('inline-edit/field/{collection}/{entry}/{handle}', [FieldController::class, 'update'])
    ->name('inline-edit.field.update');
