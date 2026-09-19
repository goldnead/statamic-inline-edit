<?php

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
