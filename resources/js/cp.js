/**
 * Statamic Inline Edit — control panel entry point.
 *
 * One page, and it is never navigated to by hand: the overlay on the public
 * page loads it in a frame. The name must read exactly as the PHP side's
 * `Inertia::render()` writes it.
 */

import Field from './pages/Field.vue';

Statamic.booting(() => {
    Statamic.$inertia.register('statamic-inline-edit::Field', Field);
});
