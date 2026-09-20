import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import statamic from '@statamic/cms/vite-plugin';

/**
 * The control panel bundle, and only that. The script that runs on the public
 * page is hand-written and built with esbuild (see scripts/build-rich.mjs);
 * it has no Vue in it and must not grow any.
 */
export default defineConfig({
    plugins: [
        laravel({
            // Statamic's AddonServiceProvider publishes the compiled assets
            // from <publicDirectory>/build, which is where laravel-vite-plugin
            // writes its manifest.
            input: ['resources/js/cp.js'],
            publicDirectory: 'resources/dist',
            refresh: false,
        }),
        // Externalises `vue` to the control panel's own runtime and leaves the
        // @statamic/cms/* imports to the host, so this bundle is a few
        // kilobytes rather than a second copy of the CP.
        statamic(),
    ],
});
