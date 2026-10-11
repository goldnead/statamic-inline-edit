/**
 * Bundles the one file in this addon that needs bundling.
 *
 * Everything else under resources/dist is hand-written and shipped as it is.
 * This builds resources/js/rich.js, which pulls in Tiptap, into a single IIFE
 * that sets `window.SIERich`. It is committed, and CI rebuilds it and fails
 * on a diff, so the file in the repository is always the file the source
 * produces.
 *
 * Every package that ends up inside the bundle is listed, with its licence
 * text, in resources/dist/THIRD-PARTY-NOTICES.txt, which ships with the addon.
 * The notice is generated from esbuild's metafile, so it names what was
 * actually bundled and cannot drift from the code. The bundle itself points
 * at it in a banner comment.
 *
 *   node scripts/build-rich.mjs [--watch]
 */
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, sep } from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

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
    // Licence comments stay where the packages put them, and the banner says
    // where the full texts are: MIT and friends require the notice to travel
    // with the code, and a minified file with neither is the failure.
    legalComments: 'inline',
    banner: { js: '/*! Third-party licences: see THIRD-PARTY-NOTICES.txt */' },
    metafile: true,
    logLevel: 'info',
};

/**
 * The package directory a bundled file belongs to: the last node_modules/<pkg>
 * (or node_modules/@scope/pkg) segment of its path.
 */
function packageRoot(file) {
    const parts = resolve(root, file).split(sep);
    const at = parts.lastIndexOf('node_modules');

    if (at === -1 || !parts[at + 1]) return null;

    const length = parts[at + 1].startsWith('@') ? 2 : 1;

    return parts.slice(0, at + 1 + length).join(sep);
}

function notices(metafile) {
    const roots = new Set();

    for (const file of Object.keys(metafile.inputs)) {
        const dir = packageRoot(file);
        if (dir) roots.add(dir);
    }

    const entries = [...roots].map((dir) => {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        const licence = readdirSync(dir).find((name) => /^(licen[cs]e|copying|notice)/i.test(name));

        return {
            name: pkg.name,
            version: pkg.version,
            licence: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see licence text'),
            text: licence ? readFileSync(join(dir, licence), 'utf8').trim() : '(the package ships no licence file; it declares the licence above)',
        };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const rule = '='.repeat(72);

    return [
        'Third-party software bundled into resources/dist/inline-edit-rich.js',
        '',
        'This addon is distributed under the licence in LICENSE.md. The rich text',
        'editor bundle contains the open source packages below, each under its own',
        'licence, reproduced here as those licences require.',
        '',
        ...entries.flatMap((e) => [rule, `${e.name} ${e.version}  (${e.licence})`, rule, '', e.text, '']),
    ].join('\n');
}

async function writeNotices(result) {
    writeFileSync(resolve(root, 'resources/dist/THIRD-PARTY-NOTICES.txt'), notices(result.metafile));
}

if (process.argv.includes('--watch')) {
    const ctx = await context(options);
    await ctx.watch();
    console.log('watching resources/js/rich.js');
} else {
    await writeNotices(await build(options));
}
