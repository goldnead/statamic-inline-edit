/**
 * The rich editor: Tiptap, mounted into the page element itself.
 *
 * Loaded on demand and never on a page nobody is editing. Everything else
 * this addon ships is hand-written vanilla with no build step; this one file
 * is the exception, because a WYSIWYG that understands markdown shortcuts is
 * not something to hand-roll, and Statamic's own Bard is Tiptap too.
 *
 * ## What it gives up, and why that is the deal
 *
 * The value is markdown, and markdown has more than one spelling for the same
 * document. Round-tripping through a document model normalises it: `*a*` may
 * come back as `_a_`, a setext heading becomes an ATX one, a reference link
 * becomes inline. That is the price of editing the rendered text instead of
 * the source, and it is why the plain source editor is still one config line
 * away.
 *
 * What the price is NOT allowed to be: a page that rewrites itself because
 * somebody looked at it. The baseline is taken from the editor's own
 * serialisation the moment it mounts, not from the stored value, so opening
 * and closing a field without typing is never a change.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';

/**
 * Seven glyphs, drawn here rather than taken from anywhere.
 *
 * Statamic ships its own icons for exactly these, but they belong to a
 * commercial package and copying them into an addon is a licensing question
 * nobody needs. These are the generic shapes every editor uses, as plain
 * stroked paths, sized to the surrounding text.
 *
 * Bold, italic and the headings are letterforms rather than drawings, which
 * is what Statamic's own icons for them are too: a B with its counters is a
 * letter, and drawn as a filled path at 17px it is a blob. "H2" also says
 * which level it is, where no picture of a heading does.
 */
const ICONS = {
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/></svg>',
    quote: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6.5H5.5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v1.5a3 3 0 0 1-3 3M19.5 6.5h-4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v1.5a3 3 0 0 1-3 3"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13.5a4 4 0 0 0 6 .5l2.5-2.5a4 4 0 0 0-5.5-5.5L11.5 7.5M14 10.5a4 4 0 0 0-6-.5L5.5 12.5a4 4 0 0 0 5.5 5.5l1.5-1.5"/></svg>',
};

/**
 * The toolbar that appears over a selection.
 *
 * Rolled by hand rather than pulled from `@tiptap/extension-bubble-menu`:
 * that one brings a positioning library along, and what is needed here is one
 * rectangle from the selection and two clamps against the viewport.
 */
function makeBubble(editor, labels) {
    const bar = document.createElement('div');
    bar.className = 'sie-bubble';
    bar.hidden = true;

    const buttons = [
        { key: 'bold', label: labels.bold || 'Fett', text: 'B', is: 'bold', run: (c) => c.toggleBold() },
        { key: 'italic', label: labels.italic || 'Kursiv', text: 'I', is: 'italic', run: (c) => c.toggleItalic() },
        { key: 'h2', label: 'H2', text: 'H2', is: ['heading', { level: 2 }], run: (c) => c.toggleHeading({ level: 2 }) },
        { key: 'h3', label: 'H3', text: 'H3', is: ['heading', { level: 3 }], run: (c) => c.toggleHeading({ level: 3 }) },
        { key: 'list', label: labels.list || 'Liste', icon: ICONS.list, is: 'bulletList', run: (c) => c.toggleBulletList() },
        { key: 'quote', label: labels.quote || 'Zitat', icon: ICONS.quote, is: 'blockquote', run: (c) => c.toggleBlockquote() },
        { key: 'link', label: labels.link || 'Link', icon: ICONS.link, is: 'link', run: null },
    ];

    const nodes = buttons.map((spec) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sie-bubble-btn' + (spec.text ? ' sie-bubble-text sie-bubble-' + spec.key : '');

        // An icon needs its name somewhere a person or a screen reader can
        // reach. `title` for the pointer, `aria-label` for everything else.
        if (spec.text) {
            btn.textContent = spec.text;
        } else {
            btn.innerHTML = spec.icon;
        }

        btn.title = spec.label;
        btn.setAttribute('aria-label', spec.label);

        // mousedown, not click: a click would take the selection away first,
        // and every one of these commands acts on the selection.
        btn.addEventListener('mousedown', (event) => {
            event.preventDefault();

            if (spec.key === 'link') return toggleLink(editor, labels);

            spec.run(editor.chain().focus()).run();
        });

        bar.appendChild(btn);

        return { spec, btn };
    });

    function paint() {
        nodes.forEach(({ spec, btn }) => {
            const active = Array.isArray(spec.is) ? editor.isActive(...spec.is) : editor.isActive(spec.is);
            btn.classList.toggle('sie-bubble-on', active);
        });
    }

    function place() {
        const { from, to } = editor.state.selection;

        if (from === to || !editor.isFocused) {
            bar.hidden = true;

            return;
        }

        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);

        bar.hidden = false;
        bar.style.visibility = 'hidden';
        bar.style.left = '0px';
        bar.style.top = '0px';

        const own = bar.getBoundingClientRect();
        const field = editor.view.dom.getBoundingClientRect();
        const centre = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
        const middle = (Math.min(start.top, end.top) + Math.max(start.bottom, end.bottom)) / 2;

        // First choice: the margin beside the text, where it covers nothing
        // at all.
        //
        // A floating toolbar over a line of text always hides something. On
        // a page with a reading measure there is usually empty space to one
        // side of it, and a toolbar this small fits in it. Tried on the left
        // first because that is where the eye already is in a left-to-right
        // text, then the right.
        const gutterLeft = field.left - own.width - 14;
        const gutterRight = field.right + 14;
        const beside = Math.round(Math.min(Math.max(8, middle - own.height / 2), window.innerHeight - own.height - 8));

        if (gutterLeft > 8) {
            bar.style.left = Math.round(gutterLeft) + 'px';
            bar.style.top = beside + 'px';
            bar.style.visibility = '';
            paint();

            return;
        }

        if (gutterRight + own.width < window.innerWidth - 8) {
            bar.style.left = Math.round(gutterRight) + 'px';
            bar.style.top = beside + 'px';
            bar.style.visibility = '';
            paint();

            return;
        }

        // No margin, so it has to go over the text: above the selection,
        // which is what Bard, Notion and every other editor of this shape
        // does. Reading runs downwards, so covering the line above costs
        // less than covering the rest of the sentence being worked on. What
        // it must never cover is the selection itself, hence the 8px.
        const above = Math.min(start.top, end.top) - own.height - 8;
        const below = Math.max(start.bottom, end.bottom) + 8;
        const left = Math.min(Math.max(8, centre - own.width / 2), window.innerWidth - own.width - 8);

        bar.style.left = Math.round(left) + 'px';
        bar.style.top = Math.round(above > 8 ? above : below) + 'px';
        bar.style.visibility = '';

        paint();
    }

    document.body.appendChild(bar);

    return { element: bar, update: place, destroy: () => bar.remove() };
}

/**
 * Turn the selection into a link, or take one off.
 *
 * `window.prompt` rather than a dialog of our own: this is one string, the
 * browser's own box is reachable by keyboard and screen reader for free, and
 * a hand-built modal inside a client's page is a second thing to keep working.
 */
function toggleLink(editor, labels) {
    if (editor.isActive('link')) {
        editor.chain().focus().unsetLink().run();

        return;
    }

    const href = window.prompt(labels.link_prompt || 'Adresse', 'https://');

    if (!href) return;

    editor.chain().focus().setLink({ href }).run();
}

/**
 * @param {HTMLElement} element the page element that becomes the editor
 * @param {{markdown: string, labels: object, onChange: function}} options
 */
function mount(element, options) {
    const labels = options.labels || {};

    const editor = new Editor({
        element,
        content: options.markdown || '',
        extensions: [
            // The markdown shortcuts everybody expects come from here:
            // `## ` for a heading, `- ` for a list, `> ` for a quote,
            // `**bold**` as you type, `---` for a rule.
            StarterKit.configure({
                link: false,

                // Off, and this one is not cosmetic.
                //
                // The trailing node is an empty paragraph ProseMirror appends
                // when a document ends with a list or a quote, so there is
                // somewhere to type after it. It is also content that is not
                // in the document: on a field whose markdown ends with a
                // list, mounting the editor made the block 36px taller and
                // pushed everything below it down the page, then pulled it
                // back up on close. Measured on the demo page, where the
                // last child went from UL to P at the moment of mount.
                //
                // The cost is small and recoverable: to write after a list,
                // press Enter twice at the end of the last item, which is
                // what every editor does anyway.
                trailingNode: false,
            }),
            Link.configure({ openOnClick: false, autolink: true }),
            Markdown.configure({
                // `-` for bullets and `*` for emphasis, which is what
                // Statamic's own markdown field writes.
                bulletListMarker: '-',
                linkify: false,
                breaks: false,
                transformPastedText: true,
            }),
        ],
        editorProps: {
            attributes: { class: 'sie-rich' },
        },
    });

    // Taken from the editor, not from the stored value. The two differ the
    // moment markdown has more than one spelling for the same document, and
    // comparing against the stored one would report a change nobody made.
    const baseline = editor.storage.markdown.getMarkdown();

    const bubble = makeBubble(editor, labels);

    const report = () => {
        const now = editor.storage.markdown.getMarkdown();
        options.onChange(now, now !== baseline);
    };

    editor.on('update', () => { report(); bubble.update(); });
    editor.on('selectionUpdate', bubble.update);
    editor.on('blur', () => { bubble.element.hidden = true; });
    editor.on('focus', bubble.update);

    editor.commands.focus('end');

    return {
        getMarkdown: () => editor.storage.markdown.getMarkdown(),
        baseline,
        destroy() {
            bubble.destroy();
            editor.destroy();
        },
    };
}

window.SIERich = { mount };
