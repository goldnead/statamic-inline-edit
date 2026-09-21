import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import statamic from '@statamic/cms/vite-plugin';

/**
 * The control panel bundle, and only that. The script that runs on the public
 * page is hand-written and built with esbuild (see scripts/build-rich.mjs);
 * it has no Vue in it and must not grow any.
 *
 * `@statamic/cms` resolves to `vendor/statamic/cms/resources/dist-package`, so
 * `composer install` has to have run before `npm install` — the UI kit is
 * pinned to the Statamic in vendor/ rather than to a version on npm, where it
 * does not exist.
 */
export default defineConfig({
    plugins: [
        laravel({
            // `public/build`, because that is where Statamic looks. The
            // provider's `$vite` property is a plain list of entry points —
            // the only shape core's own type allows — and a plain list leaves
            // the public directory at its default.
            input: ['resources/js/cp.js'],
            publicDirectory: 'public',
            refresh: false,
        }),
        // Externalises `vue` to the control panel's own runtime and leaves the
        // @statamic/cms/* imports to the host, so this bundle is a few
        // kilobytes rather than a second copy of the CP.
        statamic(),
    ],
});
