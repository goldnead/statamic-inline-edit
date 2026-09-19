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
        { key: 'bold', label: labels.bold || 'Fett', is: 'bold', run: (c) => c.toggleBold() },
        { key: 'italic', label: labels.italic || 'Kursiv', is: 'italic', run: (c) => c.toggleItalic() },
        { key: 'h2', label: 'H2', is: ['heading', { level: 2 }], run: (c) => c.toggleHeading({ level: 2 }) },
        { key: 'h3', label: 'H3', is: ['heading', { level: 3 }], run: (c) => c.toggleHeading({ level: 3 }) },
        { key: 'list', label: labels.list || 'Liste', is: 'bulletList', run: (c) => c.toggleBulletList() },
        { key: 'quote', label: labels.quote || 'Zitat', is: 'blockquote', run: (c) => c.toggleBlockquote() },
        { key: 'link', label: labels.link || 'Link', is: 'link', run: null },
    ];

    const nodes = buttons.map((spec) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sie-bubble-btn';
        btn.textContent = spec.label;

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
        const centre = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
        const left = Math.min(Math.max(8, centre - own.width / 2), window.innerWidth - own.width - 8);
        const above = Math.min(start.top, end.top) - own.height - 8;

        bar.style.left = Math.round(left) + 'px';
        bar.style.top = Math.round(above > 8 ? above : Math.max(start.bottom, end.bottom) + 8) + 'px';
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
            StarterKit.configure({ link: false }),
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
