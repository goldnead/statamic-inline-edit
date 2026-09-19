/**
 * Bundles the one file in this addon that needs bundling.
 *
 * Everything else under resources/dist is hand-written and shipped as it is.
 * This builds resources/js/rich.js, which pulls in Tiptap, into a single IIFE
 * that sets `window.SIERich`. It is committed, and CI rebuilds it and fails
 * on a diff, so the file in the repository is always the file the source
 * produces.
 *
 *   node scripts/build-rich.mjs [--watch]
 */
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const options = {
    entryPoints: [resolve(root, 'resources/js/rich.js')],
    outfile: resolve(root, 'resources/dist/inline-edit-rich.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    // The oldest engines Statamic 6 itself still speaks to. No polyfills: the
    // editor is for the person editing, and that person has a current browser.
    target: ['es2020', 'chrome100', 'firefox100', 'safari15'],
    legalComments: 'none',
    logLevel: 'info',
};

if (process.argv.includes('--watch')) {
    const ctx = await context(options);
    await ctx.watch();
    console.log('watching resources/js/rich.js');
} else {
    await build(options);
}
