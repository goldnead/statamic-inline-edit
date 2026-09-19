<?php

use Goldnead\StatamicInlineEdit\Http\Controllers\PreviewController;
use Goldnead\StatamicInlineEdit\Http\Controllers\SaveController;
use Illuminate\Support\Facades\Route;

/**
 * Registered by core under the action prefix and the addon's slug, so the full
 * path is /!/statamic-inline-edit/save, inside the `statamic.web` middleware
 * group. That group is what gives the route the site's session and its CSRF
 * check, which is the whole reason the editor can talk to it from a normal
 * page without a second login.
 *
 * Throttled because it writes to content. Fifty entries per request times
 * sixty requests is the ceiling on how fast one signed-in account can rewrite
 * a site by holding down a key.
 */
Route::post('save', SaveController::class)
    ->middleware('throttle:60,1')
    ->name('inline-edit.save');

/**
 * Renders a markdown field through its own fieldtype so the editor can see
 * what they are about to save. Writes nothing.
 *
 * Throttled more loosely than the save: it is called on every close of the
 * source editor, and a person tidying up a long text closes it often.
 */
Route::post('preview', PreviewController::class)
    ->middleware('throttle:180,1')
    ->name('inline-edit.preview');
