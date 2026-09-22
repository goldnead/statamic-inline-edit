/*!
 * Statamic Inline Edit
 *
 * Hand-written, on purpose, and it stays that way. This is the file every
 * page an editor opens has to load, 11 KB over the wire, and a toolchain
 * would buy it nothing. The one bundled file in this addon,
 * inline-edit-rich.js, is fetched on demand and only by somebody who has
 * actually opened a markdown field.
 *
 * The safety rule this file holds: what goes back to the server is never
 * innerHTML. A text field sends innerText, a control sends a scalar picked
 * from a real control, a markdown field sends markdown. A browser's
 * contenteditable will happily produce <font>, style attributes and pasted
 * markup, and none of it can reach the content if we never read it.
 */
(function () {
    'use strict';

    var configEl = document.getElementById('statamic-inline-edit-config');
    if (!configEl) return;

    var config;
    try {
        config = JSON.parse(configEl.textContent || '{}');
    } catch (e) {
        return;
    }

    /**
     * Wait for the markers if they are not in the HTML yet.
     *
     * On an Antlers site they always are: the page arrives rendered and this
     * script runs after it. A site drawn by React or Vue sends an empty root
     * and a blob of props, and the markers appear when the application mounts
     * — which is after a deferred script has run. Reading the document once
     * and giving up found nothing there, and the editor simply never appeared
     * on exactly the pages it had been installed for.
     *
     * ponytail: this waits for the first markers, not for every later set. A
     * client-side navigation to another page inside the same application
     * replaces them, and this does not notice. Reload, or call the boot again
     * from your router if that stops being good enough.
     */
    if (document.querySelector('[data-sie-field]')) {
        start();
    } else {
        var waiting = new MutationObserver(function () {
            if (!document.querySelector('[data-sie-field]')) return;

            stopWaiting();
            start();
        });

        var giveUp = setTimeout(stopWaiting, 15000);

        waiting.observe(document.documentElement, { childList: true, subtree: true });
    }

    function stopWaiting() {
        clearTimeout(giveUp);
        waiting.disconnect();
    }

    function start() {

    var L = config.labels || {};
    var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-sie-field]'));
    if (!nodes.length) return;

    // Chromium and WebKit strip formatting for us. Firefox only got this in
    // 136, so the paste handler below stays regardless.
    var PLAINTEXT = (function () {
        var probe = document.createElement('div');
        probe.setAttribute('contenteditable', 'plaintext-only');
        return probe.contentEditable === 'plaintext-only';
    })();

    var STORAGE_KEY = 'statamic-inline-edit:on';
    var original = new WeakMap();
    var editing = false;
    var busy = false;

    /* ---------------------------------------------------------------- read */

    function read(node) {
        // innerText, not textContent: it respects the line breaks the person
        // can actually see, which is what they think they are editing.
        return (node.innerText || '').replace(/ /g, ' ').replace(/\s+$/, '');
    }

    /**
     * Fields whose new value is not visible on the page.
     *
     * A text field carries its own pending state: the text in the element is
     * the change. A toggle, a select, a date and a markdown body do not, so
     * what the person picked lives here until it is saved or discarded.
     */
    var pending = new Map();

    function dirty() {
        return nodes.filter(function (node) {
            if (pending.has(node)) return true;
            if ((node.dataset.sieMode || 'text') !== 'text') return false;

            return read(node) !== original.get(node);
        });
    }

    /** What would be sent for this node right now. */
    function valueOf(node) {
        return pending.has(node) ? pending.get(node) : read(node);
    }

    function setPending(node, value, shown) {
        pending.set(node, value);
        node.classList.add('sie-changed');

        // What the page will say once this is saved, next to what it still
        // says. Without it a flipped toggle looks exactly like an untouched
        // one until the save and the reload, and the counter in the bar does
        // not answer "which one did I change?".
        if (shown) {
            node.dataset.sieGhost = shown;
        } else {
            delete node.dataset.sieGhost;
        }

        paint();
    }

    function clearPending(node) {
        pending.delete(node);
        node.classList.remove('sie-changed');
        delete node.dataset.sieGhost;
    }

    /** Which of the five kinds this field is, said out loud on the page. */
    var BADGES = {
        text: L.badge_text || 'Text',
        control: L.badge_control || 'Wert',
        source: L.badge_source || 'Markdown',
        inline: L.badge_inline || 'Editor',
        cp: L.badge_cp || 'Control Panel',
    };

    /**
     * What an empty field says before anyone has typed in it.
     *
     * The field's own label from the blueprint where the tag could supply one,
     * because "Add subtitle" tells the person which of three empty boxes on
     * the page they are looking at and a bare "Empty" does not.
     */
    function placeholder(node) {
        var label = node.dataset.sieLabel;

        if (label && L.empty_field) {
            return L.empty_field.replace(':field', label);
        }

        return label || L.empty || 'Empty';
    }

    /**
     * How many changes are waiting, in the space that is actually available.
     *
     * On a phone the middle of the bar is a few dozen pixels between the
     * toggle and the buttons, and ":count unsaved" does not fit in it. Clipped
     * to "1 uns…" it is noise; as a bare number next to an enabled Save button
     * it still says the one thing that matters, which is that something is
     * pending and how much.
     */
    function counted(count) {
        var narrow = window.matchMedia && window.matchMedia('(max-width: 30rem)').matches;

        // Empty when narrow: the number has moved onto the Save button, where
        // it has a word next to it saying what it counts.
        return narrow ? '' : (L.unsaved || ':count unsaved').replace(':count', count);
    }

    /* ----------------------------------------------------------------- bar */

    /**
     * The way in: one small button in the corner.
     *
     * The bar used to sit at the bottom of every page an editor opened,
     * whether they were editing or reading. It is a strip of somebody's site
     * spent on a tool that is idle most of the time. Now the strip only
     * exists while it is being used, and the rest of the time there is a
     * button the size of a favicon.
     */
    var launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'sie-launch';
    launcher.textContent = L.edit || 'Edit page';
    launcher.title = (L.edit || 'Edit page') + ' (' + (L.shortcut || 'Ctrl+Shift+E') + ')';

    var bar = document.createElement('div');
    bar.className = 'sie-bar';
    bar.setAttribute('role', 'toolbar');
    bar.hidden = true;
    bar.innerHTML =
        '<span class="sie-brand"></span>' +
        '<span class="sie-count"></span>' +
        '<span class="sie-status"></span>' +
        '<button type="button" class="sie-btn sie-discard"></button>' +
        '<button type="button" class="sie-btn sie-primary sie-save"></button>' +
        '<button type="button" class="sie-btn sie-close" aria-label=""></button>';

    var brandEl = bar.querySelector('.sie-brand');
    var closeBtn = bar.querySelector('.sie-close');
    var countEl = bar.querySelector('.sie-count');
    var statusEl = bar.querySelector('.sie-status');
    var discardBtn = bar.querySelector('.sie-discard');
    var saveBtn = bar.querySelector('.sie-save');

    discardBtn.textContent = L.discard || 'Discard';
    saveBtn.textContent = L.save || 'Save';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', L.close || 'Close');
    brandEl.textContent = L.editing || 'Editing';

    function paint() {
        var count = dirty().length;

        // While a field is open in place, the page's bar has nothing to say.
        // The one thing there is to save is in the frame, and it has its own
        // Save; a second one in the bar, greyed out, only asks which is which.
        bar.hidden = !editing || !!inplaceFor;
        launcher.hidden = editing;

        countEl.textContent = editing
            ? (count ? counted(count) : (L.hint || ''))
            : '';

        // Marked so a narrow screen can drop it. A hint truncated to "Tap o…"
        // is worse than no hint; a count never is.
        countEl.classList.toggle('sie-hint', editing && count === 0);

        bar.classList.toggle('sie-has-changes', count > 0);
        saveBtn.disabled = busy || count === 0;
        discardBtn.disabled = busy || count === 0;

        // On a narrow bar the count moves onto the button rather than sitting
        // beside it as a bare digit. "Speichern 2" is short and says what the
        // number means; a lone "2" between two buttons reads like a leftover.
        var onButton = count > 0 && window.matchMedia && window.matchMedia('(max-width: 30rem)').matches;

        saveBtn.textContent = busy
            ? (L.saving || 'Saving…')
            : (L.save || 'Save') + (onButton ? ' ' + count : '');
    }

    function status(message, kind) {
        statusEl.textContent = message || '';
        statusEl.className = 'sie-status' + (kind ? ' sie-' + kind : '');

        if (message && kind === 'ok') {
            setTimeout(function () {
                if (statusEl.textContent === message) status('');
            }, 2500);
        }
    }

    /* ------------------------------------------------------------- editing */

    function setEditing(on) {
        editing = on;

        if (!on) { closePop(); closeAllRich(); }

        try {
            on ? sessionStorage.setItem(STORAGE_KEY, '1') : sessionStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            // Private mode, blocked storage. The mode simply does not survive
            // the next page, which is a smaller problem than throwing here.
        }

        document.documentElement.classList.toggle('sie-editing', on);

        nodes.forEach(function (node) {
            if (on) {
                node.setAttribute('tabindex', '0');
                // No badge on a narrow field. It sits to the right, and in a
                // row of four facts the right of one field is the value of
                // the next: the label of "Belegung" landed on "Beginn". The
                // dashed outline still says editable, and the control that
                // opens names its own kind in its header.
                var wide = node.getBoundingClientRect().width >= 140;

                if (wide) {
                    node.dataset.sieBadge = BADGES[node.dataset.sieMode || 'text'] || '';
                } else {
                    delete node.dataset.sieBadge;
                }
                node.classList.toggle('sie-empty', read(node) === '');
                if (read(node) === '') node.setAttribute('data-sie-placeholder', placeholder(node));
            } else {
                stopEditing(node);
                node.removeAttribute('tabindex');
            }
        });

        // Re-read every field now that the class is on, and only now.
        //
        // This caught a real bug: `white-space: pre-wrap` used to arrive with
        // edit mode, which made the stored line breaks visible and changed
        // what innerText reported, so every textarea counted as changed before
        // anyone touched anything. That cause is gone, the style is now on the
        // element from the first paint.
        //
        // It stays because the rule it enforces is the one that matters: the
        // baseline must be read in the same state it will be compared in. Any
        // future rule under `.sie-editing` that touches text rendering would
        // otherwise reintroduce exactly that bug, silently.
        //
        // Safe to do here because there can be nothing to lose. Fields are only
        // writable while editing is on, and switching it off discards first.
        nodes.forEach(function (node) {
            original.set(node, read(node));
        });

        status('');
        paint();
    }

    /**
     * Five kinds of field, five different ways in.
     *
     * `text` is the one from version 1: the value is the text on the page, so
     * the text itself opens. The others exist because their value is not
     * what the page shows, and pretending otherwise is how an editor saves
     * something they never saw.
     *
     * `inline` and `cp` are the same form; only where it is put differs. A
     * Bard holding the article is not a field on a page, it *is* the page, and
     * pulling it onto a card in the middle of the screen takes away the column
     * width, the type and the rest of the layout that the writing depends on.
     */
    function open(node) {
        if (!editing) return;

        var mode = node.dataset.sieMode || 'text';

        if (mode === 'control') return openControl(node);
        if (mode === 'source') return openSource(node);
        if (mode === 'inline') return openInplace(node);
        if (mode === 'cp') return openPanel(node);

        return startEditing(node);
    }

    /* -------------------------------------------------- popover and panel */

    var pop = document.createElement('div');
    pop.className = 'sie-pop';
    pop.hidden = true;
    var popFor = null;

    function closePop() {
        var was = popFor;

        pop.hidden = true;
        pop.innerHTML = '';
        popFor = null;

        if (!was) return;

        was.focus();

        // Closing the source editor is the moment to show what was written.
        // Until this existed, a markdown edit was invisible on the page until
        // after the save and the reload: the person typed into a monospace
        // box, closed it, saw nothing change, and saved something they had
        // never looked at.
        if (was.dataset.sieMode === 'source' && pending.has(was)) preview(was);
    }

    /**
     * Replace the rendered block with what the server makes of the pending
     * source. The value on the page is now ahead of the value in the file,
     * which is exactly what the pending outline says.
     *
     * Rendered by the server's own fieldtype, never by a markdown library
     * here: a second renderer disagrees with the real one sooner or later,
     * and a preview that lies is worse than no preview.
     */
    function preview(node) {
        if (!config.previewUrl) return;

        node.classList.add('sie-previewing');

        fetch(config.previewUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRF-TOKEN': config.csrf,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                id: node.dataset.sieId,
                field: node.dataset.sieField,
                value: pending.get(node)
            })
        })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (body) {
                node.classList.remove('sie-previewing');

                if (!body || typeof body.html !== 'string') return;

                node.innerHTML = body.html;
            })
            .catch(function () {
                // No preview is a smaller problem than a broken page. The
                // rendered output simply stays as it was, and the pending
                // outline still says something is waiting.
                node.classList.remove('sie-previewing');
            });
    }

    /**
     * Put the popover where the field is, and keep it on screen.
     *
     * Fixed rather than absolute so no `overflow: hidden` on some wrapper of
     * the host site can clip it, which on a real client page is a matter of
     * when, not if.
     */
    function placePop(node) {
        var box = node.getBoundingClientRect();

        pop.hidden = false;
        pop.style.visibility = 'hidden';
        pop.style.left = '0px';
        pop.style.top = '0px';

        var own = pop.getBoundingClientRect();
        var gap = 8;
        var left = Math.min(Math.max(gap, box.left), window.innerWidth - own.width - gap);
        var below = box.bottom + gap;
        var top = below + own.height + gap < window.innerHeight ? below : Math.max(gap, box.top - own.height - gap);

        pop.style.left = Math.round(left) + 'px';
        pop.style.top = Math.round(top) + 'px';
        pop.style.visibility = '';
    }

    function openControl(node) {
        popFor = node;
        pop.innerHTML = '';
        pop.className = 'sie-pop';

        // Field name and kind. On a phone there is no hover, so the badge on
        // the page never appears and this header is where the person finds
        // out what they just opened.
        var label = document.createElement('span');
        label.className = 'sie-pop-label';
        // The separator only when there is something on the other side of it.
        // A field with no kind badge used to read "BELEGUNG ·", which looks
        // like the sentence was cut off.
        label.textContent = [node.dataset.sieLabel || node.dataset.sieField, node.dataset.sieBadge]
            .filter(Boolean)
            .join(' · ');
        pop.appendChild(label);

        var current = valueOf(node) === read(node) ? (node.dataset.sieRaw || '') : valueOf(node);
        var input;

        // One control, one decision, and the decision closes it. There used
        // to be a "Done" button here, and by the time anybody could press it
        // the answer was already pending and already showing on the page, so
        // it was a second click that did nothing but take the panel away.
        // Escape and a click outside still do that without changing anything.
        //
        // Deferred a tick: a `change` from a native select fires while the
        // browser is still closing its own dropdown, and tearing the panel
        // out from under it leaves the list painted on some platforms.
        function answered() {
            window.setTimeout(function () {
                if (popFor === node) closePop();
            }, 0);
        }

        // Which hand answered, because the two mean different things.
        //
        // A closed `<select>` fires `change` on every arrow key. That is
        // native behaviour and the value really does change, so it is right
        // to record it. Closing on it is not: somebody reading down the list
        // with the keyboard had the panel taken away after one keystroke,
        // with the neighbouring value committed. Measured, not guessed.
        //
        // So a pointer answer closes, and a keyboard one waits for Enter.
        var byKeyboard = false;

        function watchModality(el) {
            el.addEventListener('pointerdown', function () { byKeyboard = false; });
            el.addEventListener('keydown', function (event) {
                byKeyboard = true;

                if (event.key === 'Enter') {
                    event.preventDefault();
                    answered();
                }
            });
        }

        function committed() {
            if (!byKeyboard) answered();
        }

        if (node.dataset.sieType === 'toggle') {
            input = document.createElement('button');
            input.type = 'button';
            input.className = 'sie-switch';
            var on = current === 'true' || current === '1';
            input.setAttribute('aria-pressed', on ? 'true' : 'false');
            input.textContent = on ? (L.on || 'An') : (L.off || 'Aus');
            input.addEventListener('click', function () {
                on = !on;
                input.setAttribute('aria-pressed', on ? 'true' : 'false');
                input.textContent = on ? (L.on || 'An') : (L.off || 'Aus');
                setPending(node, on, on ? (L.on || 'An') : (L.off || 'Aus'));
                answered();
            });
        } else if (node.dataset.sieType === 'select') {
            input = document.createElement('select');
            input.className = 'sie-input';

            var choices = [];
            try {
                choices = JSON.parse(node.dataset.sieOptions || '[]');
            } catch (e) {
                choices = [];
            }

            // An empty first entry, because clearing a field is a legitimate
            // edit and a dropdown with no way back traps whoever picked wrong.
            var blank = document.createElement('option');
            blank.value = '';
            blank.textContent = '—';
            input.appendChild(blank);

            choices.forEach(function (choice) {
                var opt = document.createElement('option');
                opt.value = choice.value;
                opt.textContent = choice.label;
                input.appendChild(opt);
            });

            input.value = current;
            watchModality(input);
            input.addEventListener('change', function () {
                setPending(node, input.value, input.options[input.selectedIndex].textContent);
                committed();
            });
        } else {
            input = document.createElement('input');
            input.className = 'sie-input';
            input.type = 'date';
            // A stored date can carry a time; the input only takes the day.
            input.value = (current || '').slice(0, 10);
            watchModality(input);
            input.addEventListener('change', function () {
                setPending(node, input.value, input.value);
                committed();
            });
        }

        pop.appendChild(input);

        placePop(node);
        input.focus();
    }

    /**
     * Markdown, edited as its own source rather than as rendered HTML.
     *
     * The page shows the rendered output, so there is no honest way to put a
     * cursor in it: converting that HTML back to markdown on every save loses
     * the exact list marker, the reference link, the deliberate HTML block.
     * The source round-trips byte for byte, and the toolbar writes the same
     * syntax the person would type.
     */
    /* ------------------------------------------------- the rich editor ---- */

    var richHosts = new Map();
    var richHtml = new WeakMap();
    var richLoading = null;

    /**
     * Fetched the first time somebody opens a markdown field, and never on a
     * page nobody is editing.
     *
     * It is 180 KB over the wire, which is what a real editor costs and which
     * no visitor and no reading editor ever pays.
     */
    function loadRich() {
        if (window.SIERich) return Promise.resolve(true);
        if (richLoading) return richLoading;

        richLoading = new Promise(function (resolve) {
            var script = document.createElement('script');
            script.src = config.richUrl;
            script.onload = function () { resolve(!!window.SIERich); };
            script.onerror = function () { resolve(false); };
            document.head.appendChild(script);
        });

        return richLoading;
    }

    /**
     * Markdown, edited where it sits.
     *
     * The element on the page becomes the editor: same typography, same
     * width, same everything, so what is being typed is the page rather than
     * a picture of it. Markdown shortcuts work as they are typed, and
     * selecting text raises a small toolbar over it.
     */
    function openRich(node) {
        if (richHosts.has(node)) return;

        loadRich().then(function (ok) {
            if (!ok) return openSourcePopup(node);
            if (richHosts.has(node) || !editing) return;

            if (!richHtml.has(node)) richHtml.set(node, node.innerHTML);

            node.classList.add('sie-rich-host');
            node.innerHTML = '';

            richHosts.set(node, window.SIERich.mount(node, {
                markdown: pending.has(node) ? pending.get(node) : sourceOf(node),
                labels: L,
                onChange: function (markdown, changed) {
                    changed ? setPending(node, markdown) : clearPending(node);
                },
            }));
        });
    }

    /**
     * Close it and put the page back.
     *
     * Two endings, and the difference matters. Untouched: the original
     * rendering goes back, byte for byte, because nothing happened. Changed:
     * the server is asked what the new markdown renders to, and that goes on
     * the page. Leaving the editor's own HTML there would look right and be a
     * different renderer's opinion of the same text.
     */
    function closeRich(node) {
        var instance = richHosts.get(node);

        if (!instance) return;

        instance.destroy();
        richHosts.delete(node);
        node.classList.remove('sie-rich-host');

        if (pending.has(node)) {
            preview(node);
        } else if (richHtml.has(node)) {
            node.innerHTML = richHtml.get(node);
        }
    }

    function closeAllRich() {
        Array.from(richHosts.keys()).forEach(closeRich);
    }

    function openSource(node) {
        // The plain source editor is still one config line away, for anyone
        // who needs markdown to come back out exactly as it went in.
        if (config.rich !== false && config.richUrl) return openRich(node);

        return openSourcePopup(node);
    }

    function openSourcePopup(node) {
        popFor = node;
        pop.innerHTML = '';
        pop.className = 'sie-pop sie-pop-wide';

        var source = pending.has(node) ? pending.get(node) : sourceOf(node);

        var head = document.createElement('span');
        head.className = 'sie-pop-label';
        // Same as the small panel: the separator only when there is a second
        // half. A field with no kind badge read "Text · ", which looks like
        // the sentence was cut off.
        head.textContent = [node.dataset.sieLabel || node.dataset.sieField, node.dataset.sieBadge]
            .filter(Boolean)
            .join(' · ');
        pop.appendChild(head);

        var tools = document.createElement('div');
        tools.className = 'sie-tools';
        pop.appendChild(tools);

        var area = document.createElement('textarea');
        area.className = 'sie-area';
        area.value = source;
        area.spellcheck = true;

        // Words, not symbols. `B I # • ↗` needs five guesses, and a `title`
        // is invisible until the pointer has already stopped on one of them
        // and never appears at all on a phone.
        [
            { label: L.bold || 'Fett', wrap: ['**', '**'] },
            { label: L.italic || 'Kursiv', wrap: ['*', '*'] },
            { label: L.heading || 'Überschrift', line: '## ' },
            { label: L.list || 'Liste', line: '- ' },
            { label: L.link || 'Link', wrap: ['[', '](https://)'] },
        ].forEach(function (tool) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sie-tool';
            btn.textContent = tool.label;
            btn.addEventListener('click', function () {
                tool.line ? prefixLine(area, tool.line) : wrapSelection(area, tool.wrap[0], tool.wrap[1]);
                setPending(node, area.value);
            });
            tools.appendChild(btn);
        });

        area.addEventListener('input', function () { setPending(node, area.value); });
        area.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { event.preventDefault(); closePop(); }
        });

        pop.appendChild(area);

        var done = document.createElement('button');
        done.type = 'button';
        done.className = 'sie-pop-done';
        done.textContent = L.done || 'Fertig';
        done.addEventListener('click', closePop);
        pop.appendChild(done);

        placePop(node);
        area.focus();
    }

    /** The raw markdown the server put next to the element. */
    function sourceOf(node) {
        var holder = node.nextElementSibling;

        if (!holder || !holder.classList.contains('sie-source')) return '';

        try {
            return JSON.parse(holder.textContent || '""');
        } catch (e) {
            return '';
        }
    }

    function wrapSelection(area, before, after) {
        var a = area.selectionStart;
        var b = area.selectionEnd;
        var selected = area.value.slice(a, b);

        area.value = area.value.slice(0, a) + before + selected + after + area.value.slice(b);
        area.focus();
        area.setSelectionRange(a + before.length, a + before.length + selected.length);
    }

    function prefixLine(area, prefix) {
        var a = area.selectionStart;
        var start = area.value.lastIndexOf('\n', a - 1) + 1;

        area.value = area.value.slice(0, start) + prefix + area.value.slice(start);
        area.focus();
        area.setSelectionRange(a + prefix.length, a + prefix.length);
    }

    /* ------------------------------------------------- the field, in place */

    /**
     * The same one-field control panel form as the card below, put where the
     * content was instead of over it.
     *
     * For a Bard the card was the wrong shape from the start. A Bard is the
     * article: its line length, its type and its headings are the page's, and
     * a 760-pixel card in the middle of a dark overlay is a different document
     * with the same words in it. You cannot see what you are writing.
     *
     * So the element is taken out of the flow and the frame is put in its
     * place, at the width the content had, with nothing painted behind it.
     * What is inside is untouched: core's own Bard, core's validation, core's
     * save. Only the chrome is gone, and the page's own typography is handed
     * over so the text in the editor sets the way the text on the page sets.
     */
    var inplace = document.createElement('div');
    inplace.className = 'sie-inplace';
    inplace.hidden = true;
    inplace.innerHTML = '<iframe class="sie-inplace-frame" title=""></iframe>';

    var inplaceFrame = inplace.querySelector('.sie-inplace-frame');

    /** The node this frame is standing in for, and how it used to look. */
    var inplaceFor = null;
    var inplaceVisibility = '';

    /** Measured before the node is hidden, sent when the frame says it is up. */
    var inplaceCss = '';

    /** What the form last said about itself: total height, and where its text starts. */
    var inplaceGeom = null;

    /**
     * The room the controls need, made in the page rather than taken from it.
     *
     * The frame is taller than the block, because under the text there is a
     * toolbar and two buttons. Left to hang, they cover the next paragraph —
     * and a control that deletes what it covers is not chrome, it is damage.
     * So the page is asked to make exactly that much room, once, under the
     * block, and it grows as the text does.
     */
    var inplaceSpacer = document.createElement('div');
    inplaceSpacer.className = 'sie-inplace-spacer';
    inplaceSpacer.setAttribute('aria-hidden', 'true');

    /**
     * What putting anything there costs before it is even tall.
     *
     * An element between two paragraphs is not free: the margins that used to
     * collapse into one another now have something between them, and the gap
     * grows by the smaller of the two. Sixteen pixels on the test page.
     *
     * Measured with a height on it, not without. An empty block lets the
     * margins collapse straight through and costs exactly nothing — which is
     * the answer to a different question than the one being asked.
     */
    var inplaceSpacerCost = 0;

    var SPACER_PROBE = 100;

    function addSpacer() {
        var parent = inplaceFor.parentNode;
        var before = parent.getBoundingClientRect().height;

        inplaceSpacer.style.height = SPACER_PROBE + 'px';
        parent.insertBefore(inplaceSpacer, inplaceFor.nextSibling);

        var grew = parent.getBoundingClientRect().height - before;

        inplaceSpacerCost = Math.max(0, Math.round(grew - SPACER_PROBE));
    }

    function openInplace(node) {
        // Without the one-field route there is only the whole entry form, and
        // that cannot stand in an article's column. The card still can.
        if (!node.dataset.sieFieldUrl) return openPanel(node);

        if (inplaceFor) return;

        if (dirty().length && !window.confirm(L.leave_panel || L.leave || '')) return;

        // Measured first, while the element is still laid out. Once it is
        // hidden its computed style is still readable but its box is not, and
        // the box is what tells the frame how tall to start.
        inplaceCss = typography(node);

        inplaceFrame.title = node.dataset.sieLabel || node.dataset.sieField || '';

        var box = node.getBoundingClientRect();

        // Over the block, never in its place.
        //
        // Taking the block out of the flow and putting a frame there looks
        // like the obvious move and is wrong, because an iframe does not
        // inherit what the block did to the space around it. A heading's top
        // margin collapses out through its parent; a replaced element has no
        // children to collapse anything, so the gap above closes by exactly
        // that margin and the whole article slides up. Measured at eight
        // pixels on the test page, and it would be a different eight on every
        // site.
        //
        // So the block keeps its box and only stops being drawn, and the frame
        // is positioned over it in document coordinates. Nothing in the page
        // moves, because as far as the page is concerned nothing changed.
        //
        // ponytail: the block keeps the height it had, so the page does not
        // reflow while the text grows — the frame simply covers more of what
        // is under it, and the reload after saving puts it right. Giving the
        // block an explicit height would make it reflow and would also stop
        // its last child's margin collapsing out, which is the same class of
        // bug one end further down.
        inplace.classList.add('sie-inplace-measuring');
        inplace.style.width = Math.round(box.width) + 'px';
        inplace.style.setProperty('--sie-inplace-height', Math.max(240, Math.ceil(box.height)) + 'px');

        document.body.appendChild(inplace);

        inplaceFor = node;
        inplaceGeom = null;
        inplace.hidden = false;
        inplaceFrame.src = node.dataset.sieFieldUrl;

        window.addEventListener('resize', positionInplace);

        // The page's own bar is about the other fields, and while this is open
        // there is exactly one thing to save. Two buttons saying "Speichern",
        // one of them greyed out, is a question nobody should have to answer.
        paint();
    }

    /**
     * Put the frame where the content is, to the pixel.
     *
     * `lift` is how far into the form the text begins — the toolbar's height,
     * essentially. The frame's top goes that far above the block, so the first
     * line lands on the line it replaced and the toolbar hangs over whatever
     * is above. The buttons hang over whatever is below. The frame paints
     * nothing of its own, so the page shows through everywhere they are not.
     */
    function placeInplace(data) {
        inplaceGeom = {
            height: Math.max(40, data.height | 0),
            lift: Math.max(0, data.lift | 0),
        };

        if (inplace.classList.contains('sie-inplace-measuring')) {
            // First measurement: now the swap. `visibility`, not `display` —
            // the block has to keep its box, which is the whole trick.
            inplace.classList.remove('sie-inplace-measuring');

            inplaceVisibility = inplaceFor.style.visibility;
            inplaceFor.style.setProperty('visibility', 'hidden', 'important');

            addSpacer();

            positionInplace();
            inplaceFrame.focus();

            return;
        }

        positionInplace();
    }

    function positionInplace() {
        if (!inplaceFor || !inplaceGeom) return;

        // The room under the block first, then the position. In that order:
        // the spacer changes the layout, and a position measured before it
        // took effect describes a page that no longer exists.
        var height = inplaceGeom.height;

        inplaceSpacer.style.height = Math.max(0, height - inplaceFor.offsetHeight - inplaceSpacerCost) + 'px';

        var box = inplaceFor.getBoundingClientRect();

        inplace.style.left = Math.round(box.left + window.scrollX) + 'px';
        inplace.style.top = Math.round(box.top + window.scrollY - inplaceGeom.lift) + 'px';
        inplace.style.width = Math.round(box.width) + 'px';
        inplace.style.setProperty('--sie-inplace-height', height + 'px');
    }

    function closeInplace() {
        if (!inplaceFor) return;

        window.removeEventListener('resize', positionInplace);

        if (inplaceSpacer.parentNode) inplaceSpacer.parentNode.removeChild(inplaceSpacer);
        inplaceSpacer.style.height = '';

        inplaceFor.style.visibility = inplaceVisibility;
        inplace.hidden = true;
        inplace.classList.remove('sie-inplace-measuring');
        inplace.removeAttribute('style');
        inplaceFrame.removeAttribute('src');

        if (inplace.parentNode) inplace.parentNode.removeChild(inplace);

        inplaceFor = null;
        inplaceGeom = null;
        paint();

        // Whatever happened in there happened to the entry, not to this page.
        // Reloading is the only honest way to show it — the template decides
        // what a Bard looks like out here, and the editor never saw that.
        window.location.reload();
    }

    window.addEventListener('message', function (event) {
        if (!inplaceFrame.contentWindow || event.source !== inplaceFrame.contentWindow) return;

        var data = event.data;

        if (!data || data.source !== 'statamic-inline-edit') return;

        if (data.type === 'ready') {
            // Appearance only, and only to the frame we just opened.
            // `/` rather than the origin spelled out: it means "only if the
            // frame is still same-origin with this page", which is the check
            // that matters, and it is the one form that is also valid on a
            // page with an opaque origin.
            inplaceFrame.contentWindow.postMessage(
                { source: 'statamic-inline-edit-host', type: 'styles', css: inplaceCss },
                '/'
            );

            return;
        }

        if (data.type === 'height') {
            placeInplace(data);

            return;
        }

        if (data.type === 'saved' || data.type === 'close') closeInplace();
    });

    /**
     * The page's own typography, as rules the editor can wear.
     *
     * Not a copy of the site's stylesheet: loading that into the frame would
     * put the site's reset through the control panel's own interface, and a
     * Tailwind preflight is perfectly capable of flattening every button in
     * it. What travels is the *result* — the computed style of this element
     * and of one probe for each kind of block a Bard can make, read here,
     * where the cascade has already happened.
     *
     * The probes are real elements, inserted in the real place, because that
     * is the only way to find out what `.prose h2` or `article ul > li` add up
     * to. They are absolutely positioned and invisible, so nothing moves while
     * they are in, and they are gone before this function returns.
     *
     * Best-effort throughout. A page that throws here should lose its fonts in
     * the editor, not its editor.
     */
    var PROBES = [
        ['', ''],
        ['p', 'p'],
        ['h2', 'h2'],
        ['h3', 'h3'],
        ['h4', 'h4'],
        ['ul', 'ul'],
        ['ol', 'ol'],
        ['ul>li', 'li'],
        ['blockquote', 'blockquote'],
        ['a', 'a'],
        ['strong', 'strong'],
        ['em', 'em'],
        ['code', 'code'],
        ['hr', 'hr']
    ];

    /** What every probe reports. Anything a reader would notice as a change. */
    var TYPE_PROPS = [
        'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
        'line-height', 'letter-spacing', 'word-spacing', 'text-transform',
        'text-align', 'color', 'margin-top', 'margin-bottom',

        // Where a line breaks is not only a question of width. A page that
        // asks the browser to balance its paragraphs, or to hyphenate them,
        // breaks them somewhere else than one that does not — and a line that
        // breaks one word earlier in the editor than on the page is the whole
        // promise of this mode broken, in the most visible way there is.
        'text-wrap', 'hyphens', 'word-break', 'overflow-wrap',

        // And the metrics, which decide the same thing one word at a time.
        // Measured on the demo: the same sentence set five pixels narrower in
        // the editor than on the page, enough for the next word to climb into
        // the line above. Inter is a variable font and the control panel asks
        // it for different numbers than the site does — optical size, kerning
        // and the feature set are all live settings, not decoration.
        'font-variation-settings', 'font-feature-settings', 'font-optical-sizing',
        'font-kerning', 'font-stretch', 'font-synthesis', 'text-rendering',
        'font-variant-ligatures', 'font-size-adjust'
    ];

    /** And what only some of them do. */
    var EXTRA_PROPS = {
        ul: ['padding-inline-start', 'list-style-type', 'list-style-position'],
        ol: ['padding-inline-start', 'list-style-type', 'list-style-position'],
        li: ['padding-inline-start', 'margin-left'],
        blockquote: [
            'border-left-width', 'border-left-style', 'border-left-color',
            'padding-left', 'padding-top', 'padding-right', 'padding-bottom',
            'background-color', 'border-radius', 'quotes'
        ],
        a: ['text-decoration-line', 'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset'],
        code: ['background-color', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'border-radius'],
        hr: ['border-top-width', 'border-top-style', 'border-top-color']
    };

    function typography(node) {
        try {
            return snapshot(node);
        } catch (e) {
            return '';
        }
    }

    /**
     * The page's own font files, renamed so they cannot be confused with the
     * control panel's.
     *
     * Copying every property of a paragraph and still measuring it two and a
     * half pixels narrower in the frame is not a property that was missed. It
     * is a different font: the control panel ships its own Inter and so does
     * half the web, the family name is the same, and `font-family: Inter` in
     * the frame therefore asks for a different file than the same words ask
     * for out here. Two builds of a typeface do not have the same advances,
     * and over a line that is a word moving to the row above.
     *
     * So the `@font-face` rules the page really loaded travel with the
     * typography, under a name nothing else can claim, and the rules that
     * follow ask for that name.
     *
     * Best-effort by construction: a stylesheet from another origin — Google
     * Fonts, a CDN — will not let its rules be read, and those families keep
     * their own name and whatever the frame makes of it. Better one family
     * right than an exception on somebody's live page.
     *
     * @return array{0: string, 1: Object} the @font-face rules, and old name → new
     */
    /**
     * Hosts that serve nothing but font declarations.
     *
     * A stylesheet from another origin cannot be read, so its faces cannot be
     * copied and renamed — but it can be asked for again from inside the
     * frame, and then the page's own file is the last one declared for the
     * family and wins. That is only safe where the sheet is known to contain
     * font faces and nothing else. A CDN stylesheet of unknown content would
     * be a whole framework's reset going through the control panel's
     * interface, which is the failure this addon spends most of its CSS
     * avoiding.
     */
    var FONT_HOSTS = [
        'fonts.googleapis.com',
        'fonts.bunny.net',
        'use.typekit.net',
        'api.fontshare.com',
        'fonts.cdnfonts.com'
    ];

    function fontFaces(families) {
        var css = [];
        var imports = [];
        var renamed = {};
        var index = 0;

        function maybeImport(href) {
            if (!href) return;

            var host;

            try {
                host = new URL(href, document.baseURI).hostname;
            } catch (e) {
                return;
            }

            if (FONT_HOSTS.indexOf(host) === -1) return;
            if (imports.indexOf(href) === -1) imports.push(href);
        }

        Array.prototype.forEach.call(document.styleSheets, function (sheet) {
            var rules;

            try {
                rules = sheet.cssRules;
            } catch (e) {
                // Another origin, and not ours to read. If it is a font host,
                // the frame can ask for it itself.
                maybeImport(sheet.href);

                return;
            }

            if (!rules) return;

            Array.prototype.forEach.call(rules, function (rule) {
                // An @import in a sheet we can read, pointing at one we
                // cannot. This is how a site loads Google Fonts from inside
                // its own bundle, and the href is right there even though the
                // rules behind it are not.
                if (window.CSSImportRule && rule instanceof window.CSSImportRule) {
                    var readable = false;

                    try {
                        readable = !!(rule.styleSheet && rule.styleSheet.cssRules);
                    } catch (e) {
                        readable = false;
                    }

                    if (!readable) maybeImport(rule.href);

                    return;
                }

                if (!(window.CSSFontFaceRule && rule instanceof window.CSSFontFaceRule)) return;

                var family = unquote(rule.style.getPropertyValue('font-family'));

                var key = (family || '').toLowerCase();

                if (!key || families.indexOf(key) === -1) return;

                if (!renamed[key]) renamed[key] = 'sie-font-' + (index++);

                css.push(
                    rule.cssText
                        .replace(/font-family\s*:\s*[^;}]+/i, 'font-family: "' + renamed[key] + '"')
                        .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (all, quote, href) {
                            return 'url("' + absolute(href, sheet.href) + '")';
                        })
                );
            });
        });

        // Imports first, always: a browser ignores an @import that is not at
        // the top of its sheet, and then the font never arrives and nothing
        // says why.
        var head = imports.map(function (href) {
            return '@import url("' + href + '");';
        }).join('\n');

        return [head + (head && css.length ? '\n' : '') + css.join('\n'), renamed];
    }

    function unquote(value) {
        return (value || '').trim().replace(/^['"]|['"]$/g, '');
    }

    function absolute(href, base) {
        try {
            return new URL(href, base || document.baseURI).href;
        } catch (e) {
            return href;
        }
    }

    /** The families a value asks for, lower-cased, in order. */
    function familiesIn(value) {
        return (value || '').split(',').map(function (name) {
            return unquote(name).toLowerCase();
        }).filter(Boolean);
    }

    /**
     * What has to go, wherever this frame is.
     *
     * Sent with the typography rather than living in the control panel bundle,
     * because it belongs to the same job: this is the list of surfaces the
     * control panel draws *because it is a control panel*, and every one of
     * them is a seam where the frame stops looking like the page.
     *
     * Matched by structure, not by class name. Core's markup is core's to
     * change, and the only thing certain about it is that the element holding
     * the editor is ProseMirror's parent.
     */
    var CHROME_OFF = [
        // The field's own header — its label, its instructions, its handle
        // buttons. Read out of the markup rather than guessed at: the header
        // is the first child of the field group that has a label in it, and
        // that is true of every fieldtype rather than of Bard in particular.
        // On the page the heading above the text already says what this is.
        '.sie-cp-inplace .form-group > :first-child:has(label){display:none !important}',
        '.sie-cp-inplace :where(label){display:none !important}',

        // The box. A control panel draws one so that a Bard can be told apart
        // from the Grid under it; in an article there is nothing to tell it
        // apart from, and the border is simply a rectangle around a paragraph.
        '.sie-cp-inplace :is(.bard-fieldtype,.bard-editor){' +
            'background:transparent !important;border:0 !important;border-radius:0 !important;' +
            'box-shadow:none !important}',

        // And whatever holds the editor, for a fieldtype whose classes are
        // not these. Structure is the one thing core cannot change here: the
        // editor's parent is the editor's parent.
        '.sie-cp-inplace :where(div,section,fieldset):has(> .ProseMirror){' +
            'background:transparent !important;border:0 !important;border-radius:0 !important;' +
            'box-shadow:none !important;padding:0 !important}',

        '.sie-cp-inplace .ProseMirror{padding:0 !important;min-height:0 !important;' +
            'background:transparent !important;border-radius:0 !important;outline:none !important}',

        // The controls go under the text, in a strip of their own.
        //
        // They were floating over the page for one round, and that was worse
        // than the problem it solved: the toolbar sat on top of another field
        // and the buttons cut a line of the article in half. "Everything but
        // the controls looks the same" cannot mean the controls delete what
        // they cover.
        //
        // So: the text keeps its place to the pixel, and the page below makes
        // room for one strip — a toolbar on the left, Save and Close on the
        // right. That is what every editor on a page does, and the only thing
        // that moves is what was below the part being written.
        //
        // `order` rather than moving anything: the toolbar is core's markup,
        // inside core's wrapper, and a flex column can put it after its
        // sibling without either of them being touched.
        '.sie-cp-inplace{position:relative !important}',

        // The toolbar's own parent, found by the toolbar rather than by name:
        // in Statamic 6 it is the `.bard-fieldtype` wrapper and the editor is
        // its sibling, and naming the wrong one of the two puts the toolbar
        // back on top of the text it was supposed to move out from under.
        '.sie-cp-inplace :where(div):has(> .bard-fixed-toolbar){' +
            'display:flex !important;flex-direction:column !important}',

        '.sie-cp-inplace .bard-fixed-toolbar{' +
            'order:2 !important;width:fit-content !important;max-width:100% !important;' +
            'border:0 !important;border-radius:8px !important;margin:12px 0 0 !important;' +
            'box-shadow:0 4px 14px rgb(0 0 0 / 10%),0 0 0 1px rgb(0 0 0 / 8%) !important}',

        // Out of the flow and into the same strip, on the other side of it.
        // Its own row would be a second strip and twice the room to make.
        '.sie-cp-inplace .sie-cp-actions{' +
            'position:absolute !important;right:0 !important;bottom:0 !important;' +
            'margin:0 !important;padding:0 !important;gap:8px !important}',

        // And the primary in this addon's own blue rather than the control
        // panel's indigo — the same blue as the outline around every editable
        // field on the page, so the one button that writes is the one colour
        // the page has been using for editing all along.
        '.sie-cp-inplace .sie-cp-actions > :last-child{' +
            'background:#3b82f6 !important;border-color:#3b82f6 !important;color:#fff !important}'
    ].join('\n');

    function snapshot(node) {
        var made = [];
        var rules = [CHROME_OFF];

        PROBES.forEach(function (probe) {
            var path = probe[0];
            var selector = probe[1];

            var target = node;

            if (path !== '') {
                var host = node;
                var parts = path.split('>');
                var built = null;

                parts.forEach(function (name) {
                    var el = document.createElement(name);

                    // Content, because an empty inline element has no font
                    // size worth reading and a list item with nothing in it
                    // collapses. A single character is enough and never seen.
                    el.textContent = 'x';

                    if (name === 'a') el.setAttribute('href', '#');

                    host.appendChild(el);

                    if (!built) built = el;

                    host = el;
                });

                // Out of the flow, so a page in mid-scroll does not twitch
                // while this runs. Important, because a site that lays out
                // its own list items is entitled to !important of its own.
                built.style.setProperty('position', 'absolute', 'important');
                built.style.setProperty('visibility', 'hidden', 'important');
                built.style.setProperty('pointer-events', 'none', 'important');

                made.push(built);
                target = host;
            }

            var computed = window.getComputedStyle(target);
            var props = TYPE_PROPS.concat(EXTRA_PROPS[selector] || EXTRA_PROPS[path] || []);
            var body = [];

            props.forEach(function (prop) {
                var value = computed.getPropertyValue(prop);

                if (!value || value === 'none' && prop === 'quotes') return;

                body.push(prop + ':' + value + ' !important');
            });

            if (!body.length) return;

            // `!important` on every line, and the scope kept short on purpose.
            // This blob exists to beat the control panel's own type styles,
            // which are more specific than anything an addon can write without
            // knowing core's markup by heart.
            rules.push(
                '.sie-cp-inplace .ProseMirror' + (selector ? ' ' + selector : '') +
                '{' + body.join(';') + '}'
            );
        });

        made.forEach(function (el) {
            if (el.parentNode) el.parentNode.removeChild(el);
        });

        // The column, to the pixel, rather than "whatever the frame is".
        //
        // The frame is as wide as the block's border box; the text inside the
        // block sits in its content box, which is narrower by whatever padding
        // the block has. A few pixels either way is a line that breaks one
        // word earlier or later than it will on the page, which is the one
        // difference a writer sees immediately.
        var computed = window.getComputedStyle(node);
        var width = node.clientWidth
            - parseFloat(computed.paddingLeft || '0')
            - parseFloat(computed.paddingRight || '0');

        rules.push(
            '.sie-cp-inplace .ProseMirror{' +
            'box-sizing:content-box !important;' +
            'width:' + Math.max(0, Math.round(width)) + 'px !important;' +
            'max-width:none !important}'
        );

        var css = rules.join('\n');

        // Every family any of those rules asks for, then the ones this page
        // actually carries a file for, renamed, and the rules pointed at the
        // new names. Anything that could not be copied keeps its own name.
        var wanted = [];

        css.replace(/font-family\s*:\s*([^;}!]+)/gi, function (all, value) {
            familiesIn(value).forEach(function (name) {
                if (wanted.indexOf(name) === -1) wanted.push(name);
            });

            return all;
        });

        var faces = fontFaces(wanted);
        var renamed = faces[1];

        if (Object.keys(renamed).length) {
            css = css.replace(/font-family\s*:\s*([^;}!]+)/gi, function (all, value) {  // eslint-disable-line
                return 'font-family:' + value.split(',').map(function (name) {
                    var match = renamed[unquote(name).toLowerCase()];

                    // Both spellings, and the original kept behind it: if the
                    // copied file fails to load for any reason, the page falls
                    // back to what it would have had anyway.
                    return match ? '"' + match + '",' + name : name;
                }).join(',');
            });

        }

        // Whether or not anything was renamed: a font host asked for again
        // from inside the frame declares the page's own file last, and last
        // is what a browser picks when two faces fit the same request.
        return faces[0] ? faces[0] + '\n' + css : css;
    }

    /* ------------------------------------------------------ control panel */

    var panel = document.createElement('div');
    panel.className = 'sie-panel';
    panel.hidden = true;
    panel.innerHTML =
        '<div class="sie-panel-bar">' +
        '<span class="sie-panel-title"></span>' +
        '<button type="button" class="sie-panel-close"></button>' +
        '</div>' +
        '<iframe class="sie-frame" title=""></iframe>';

    var panelTitle = panel.querySelector('.sie-panel-title');
    var panelClose = panel.querySelector('.sie-panel-close');
    var frame = panel.querySelector('.sie-frame');

    panelClose.textContent = L.close || 'Schließen';

    /**
     * Bard, Replicator, a Grid, an image: the real control panel, in an
     * overlay, rather than a second-rate copy of it here.
     *
     * Bard alone is an entire editor and an asset picker is an entire
     * browser. Rebuilding either on the frontend means a worse one that also
     * has to be kept in step with core. Opening the real one costs a click,
     * and everything that happens in it goes through the control panel's own
     * validation, revisions and permissions.
     */
    function openPanel(node) {
        // The one field on its own where the control panel offers it, the
        // whole entry form otherwise. A Bard that arrives surrounded by
        // nineteen other fields, a sidebar and a revision history is not what
        // anybody double-clicked a paragraph for.
        var single = node.dataset.sieFieldUrl;
        var url = single || node.dataset.sieCp;

        if (!url) return;

        if (dirty().length && !window.confirm(L.leave_panel || L.leave || '')) return;

        panelTitle.textContent = node.dataset.sieLabel || node.dataset.sieField;
        frame.title = panelTitle.textContent;
        frame.dataset.sieField = node.dataset.sieField || '';
        frame.dataset.sieSingle = single ? 'true' : '';
        frame.src = url;

        // Starts at a readable size and is corrected the moment the form
        // reports its own height, so the panel never flashes at full screen
        // on the way to being small.
        panel.classList.toggle('sie-panel-card', !!single);
        panel.style.removeProperty('--sie-frame-height');

        panel.hidden = false;
        document.documentElement.classList.add('sie-panel-open');

        // The card has no title bar to put focus on, so focus goes into the
        // form itself. Without this the keyboard is left behind on the page
        // underneath, which is the page this thing is covering.
        if (single) frame.focus(); else panelClose.focus();
    }

    function closePanel() {
        panel.hidden = true;
        frame.removeAttribute('src');
        frame.dataset.sieSingle = '';
        document.documentElement.classList.remove('sie-panel-open');

        // Whatever happened in there happened to the entry, not to this page.
        // Reloading is the only honest way to show it, and it is also the only
        // way to find out that nothing happened.
        window.location.reload();
    }

    /**
     * What the one-field form has to say: how tall it is, and that it is done.
     *
     * The frame is same-origin, so its height could be read from here instead.
     * It is not, because `load` fires long before a Vue form has mounted and
     * long before a Bard has grown to fit its text: the frame tells us when
     * something changed, rather than us guessing when to look.
     *
     * The only check that matters is that the message came from this frame.
     * Anything else on the page may post to `window` all day.
     */
    window.addEventListener('message', function (event) {
        if (!frame.contentWindow || event.source !== frame.contentWindow) return;

        var data = event.data;

        if (!data || data.source !== 'statamic-inline-edit') return;

        if (data.type === 'height' && frame.dataset.sieSingle) {
            panel.style.setProperty('--sie-frame-height', Math.max(120, data.height | 0) + 'px');

            return;
        }

        if (data.type === 'saved' || data.type === 'close') closePanel();
    });

    panelClose.addEventListener('click', closePanel);

    /**
     * Scroll the control panel to the field that was double-clicked.
     *
     * Without it, a double-click on one chip opens the whole entry form at
     * the top and leaves the person to find their field among twenty. Same
     * origin, so we can reach in.
     *
     * Everything here is best-effort and silent. The control panel's own DOM
     * is not our contract: a future release may rename the attribute, and
     * when it does the overlay should still open at the top rather than throw
     * on somebody's live page.
     */
    frame.addEventListener('load', function () {
        var handle = frame.dataset.sieField;

        if (!handle) return;

        // Nothing to hunt for on the one-field page: it is the field.
        if (frame.dataset.sieSingle) return;

        // `load` is not the moment the form exists.
        //
        // The control panel is a Vue application: the document has finished
        // loading long before the publish form has been mounted into it. A
        // single lookup here finds nothing, returns quietly, and the overlay
        // opens at the top of the form with no sign that anything was meant
        // to happen. So: look again until it is there, or give up.
        //
        // What to look for took three tries. `data-handle` and `name` do not
        // exist in the Statamic 6 control panel at all. The id
        // `field_<handle>` is the right shape, but only fieldtypes that
        // render a single input actually carry it: a list, a Bard or a Grid
        // has no such element. What every field does have is its label,
        // pointing at that id. So: the input when there is one, the label
        // otherwise.
        var deadline = Date.now() + 8000;

        (function find() {
            if (frame.dataset.sieField !== handle) return; // another field was opened

            var target = null;

            try {
                var doc = frame.contentDocument;

                target = doc && (
                    doc.getElementById('field_' + handle)
                    || doc.querySelector('label[for="field_' + handle + '"]')
                );
            } catch (e) {
                return; // cross-origin: the overlay works, it just does not scroll
            }

            if (!target) {
                if (Date.now() < deadline) setTimeout(find, 150);

                return;
            }

            // Outline the whole field, not the label on top of it.
            var box = target.tagName === 'LABEL' && target.parentElement ? target.parentElement : target;

            box.scrollIntoView({ block: 'center' });

            // Once more a moment later. The heavy fieldtypes above this one,
            // a Bard or a markdown editor, mount after the first ones and
            // push everything below them down, so the field that was just
            // centred ends up at the bottom edge.
            setTimeout(function () {
                try { box.scrollIntoView({ block: 'center' }); } catch (e) { /* frame gone */ }
            }, 900);

            // Styled inline, not with a class: our stylesheet is not loaded
            // inside the control panel, so a class there would name a rule
            // that does not exist.
            var before = box.style.outline;
            box.style.outline = '2px solid #3b82f6';
            box.style.outlineOffset = '4px';

            // Four seconds, not two: the form has just scrolled, and the
            // person's eyes arrive after the animation does.
            setTimeout(function () {
                try { box.style.outline = before; } catch (e) { /* frame gone */ }
            }, 4000);
        })();
    });

    function startEditing(node) {
        if (!editing || node.isContentEditable) return;

        node.setAttribute('contenteditable', PLAINTEXT ? 'plaintext-only' : 'true');
        node.classList.add('sie-active');
        node.focus();

        var range = document.createRange();
        range.selectNodeContents(node);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function stopEditing(node) {
        if (!node.hasAttribute('contenteditable')) return;

        node.removeAttribute('contenteditable');
        node.classList.remove('sie-active');
        node.classList.toggle('sie-empty', read(node) === '');
    }

    function revert(node) {
        node.textContent = original.get(node);
        stopEditing(node);
        paint();
    }

    nodes.forEach(function (node) {
        original.set(node, read(node));

        // Marked at boot, not when edit mode comes on. An empty field has no
        // height of its own, and the box that makes it clickable is 23px
        // tall: added on the toggle, it pushes the whole page down at the
        // moment somebody starts working. Here the space is there from the
        // first paint and only the chip's ink arrives later.
        node.classList.toggle('sie-empty', read(node) === '');

        node.addEventListener('dblclick', function (event) {
            if (!editing) return;
            event.preventDefault();
            open(node);
        });

        // A double-click is a mouse gesture. On a touch screen a double-tap is
        // zoom, and two quick taps on text are as likely to be a selection as
        // anything else, so `dblclick` either never fires or fires after the
        // browser has already zoomed. Without this the bar appears on a phone
        // and nothing on the page can be opened — the feature is visible and
        // absent at the same time.
        //
        // A single tap is safe here because it only counts while edit mode is
        // on, which the person switched on deliberately one tap earlier.
        node.addEventListener('pointerup', function (event) {
            if (!editing || event.pointerType !== 'touch' || node.isContentEditable) return;
            event.preventDefault();
            open(node);
        });

        node.addEventListener('keydown', function (event) {
            // Hands off entirely once the rich editor owns this element.
            //
            // Tiptap mounts a contenteditable *child*, so the marker itself
            // reports `isContentEditable === false` and the branch below
            // would treat every Space as "open this field" and swallow it.
            // Typing "## " then produced "##", and the markdown shortcut that
            // is the whole point of the rich editor never fired.
            if (richHosts.has(node)) return;

            if (!node.isContentEditable) {
                // Keyboard equivalent of the double-click, so the editor is
                // reachable without a mouse.
                if (editing && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    open(node);
                }
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                revert(node);
                node.blur();
                return;
            }

            if (event.key === 'Enter' && node.dataset.sieMultiline !== 'true') {
                event.preventDefault();
                node.blur();
            }
        });

        // Firefox below 136 has no plaintext-only, and every browser lets a
        // paste carry markup in. Reading innerText later would survive it, but
        // the person would watch their page restyle itself under the cursor.
        node.addEventListener('paste', function (event) {
            if (!node.isContentEditable || PLAINTEXT) return;
            event.preventDefault();
            var text = (event.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, text);
        });

        node.addEventListener('drop', function (event) {
            if (node.isContentEditable) event.preventDefault();
        });

        node.addEventListener('blur', function () {
            stopEditing(node);
            paint();
        });

        node.addEventListener('input', paint);
    });

    /* ---------------------------------------------------------------- save */

    function save() {
        var changed = dirty();
        if (!changed.length || busy) return;

        var byEntry = {};

        changed.forEach(function (node) {
            var id = node.dataset.sieId;

            if (!byEntry[id]) {
                byEntry[id] = { id: id, stamp: node.dataset.sieStamp || null, fields: {} };
            }

            var value = valueOf(node);

            // A toggle's value is a real boolean all the way to the blueprint.
            // Cut to length only what has a length: slicing `false` gives "fal".
            byEntry[id].fields[node.dataset.sieField] =
                typeof value === 'string' ? value.slice(0, config.maxLength || 100000) : value;
        });

        // Anything whose rendered output differs from what was typed: a
        // toggle the template turns into a word, markdown the renderer turns
        // into HTML. The page has to come back from the server to be true.
        var needsReload = changed.some(function (node) {
            return node.dataset.sieReload === 'true';
        });

        busy = true;
        status('');
        paint();

        fetch(config.saveUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRF-TOKEN': config.csrf,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ changes: Object.keys(byEntry).map(function (k) { return byEntry[k]; }) })
        })
            .then(function (response) {
                return response.json().catch(function () { return {}; }).then(function (body) {
                    return { ok: response.ok, status: response.status, body: body };
                });
            })
            .then(function (result) {
                busy = false;

                if (!result.ok) {
                    status(result.body.message || (L.failed || 'Could not save.'), 'bad');
                    paint();
                    return;
                }

                // The entry is now newer than the page. Carry the new stamp on
                // every marker of that entry, or the next save of this same
                // page reports a conflict with itself.
                (result.body.saved || []).forEach(function (saved) {
                    nodes.forEach(function (node) {
                        if (node.dataset.sieId === saved.id) node.dataset.sieStamp = saved.stamp || '';
                    });
                });

                changed.forEach(function (node) {
                    clearPending(node);
                    original.set(node, read(node));
                    node.classList.toggle('sie-empty', read(node) === '');
                });

                status(L.saved || 'Saved', 'ok');
                paint();

                if (needsReload) {
                    closePop();
                    window.location.reload();
                }
            })
            .catch(function () {
                busy = false;
                status(L.failed || 'Could not save.', 'bad');
                paint();
            });
    }

    function discard() {
        closePop();

        dirty().forEach(function (node) {
            if (pending.has(node)) {
                // Nothing to put back on the page: what was picked never
                // showed there. Dropping it is the whole undo.
                clearPending(node);

                return;
            }

            revert(node);
        });

        status('');
        paint();
    }

    /* --------------------------------------------------------------- wiring */

    function toggleMode() {
        if (editing && dirty().length && !window.confirm(L.leave || 'You have unsaved changes on this page.')) return;
        if (editing) discard();
        setEditing(!editing);
    }

    launcher.addEventListener('click', toggleMode);
    closeBtn.addEventListener('click', toggleMode);

    saveBtn.addEventListener('click', save);
    discardBtn.addEventListener('click', discard);

    document.addEventListener('keydown', function (event) {
        // Ctrl/Cmd + Shift + E opens and closes the whole thing, so the bar
        // never has to sit on the page waiting to be needed.
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'E' || event.key === 'e')) {
            event.preventDefault();
            toggleMode();

            return;
        }

        if (!editing) return;
        if (!(event.metaKey || event.ctrlKey) || event.key !== 's') return;
        event.preventDefault();
        save();
    });

    window.addEventListener('beforeunload', function (event) {
        if (!dirty().length) return;
        event.preventDefault();
        event.returnValue = '';
    });

    document.body.appendChild(launcher);
    document.body.appendChild(bar);
    document.body.appendChild(pop);
    document.body.appendChild(panel);

    // A click anywhere that is not the popover, the field it belongs to, or
    // the bar closes it. Whatever was picked is already pending, so closing
    // is never a way to lose a choice.
    document.addEventListener('mousedown', function (event) {
        if (pop.hidden) return;
        if (pop.contains(event.target) || bar.contains(event.target) || launcher.contains(event.target)) return;
        if (popFor && popFor.contains(event.target)) return;
        closePop();
    });

    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (inplaceFor) { closeInplace(); return; }
        if (!panel.hidden) { closePanel(); return; }
        if (!pop.hidden) { closePop(); return; }
        closeAllRich();
    });

    // A click outside every open rich editor closes it, the same way the
    // popover closes. Inside one, the click is a cursor.
    document.addEventListener('mousedown', function (event) {
        if (!richHosts.size) return;
        if (bar.contains(event.target) || launcher.contains(event.target)) return;
        if (event.target.closest && event.target.closest('.sie-bubble')) return;

        Array.from(richHosts.keys()).forEach(function (node) {
            if (!node.contains(event.target)) closeRich(node);
        });
    });

    // Give the bar its own space at the end of the document instead of letting
    // it lie on top of whatever the page put down there. A spacer element
    // rather than padding on <body>, because the site may well set that itself
    // and a fight over one property is a fight this addon should not pick.
    //
    // This cannot help with another *fixed* overlay — a cookie dialog or a
    // chat bubble pinned to the bottom will still share the space, and no
    // bottom bar anywhere solves that. It is in the README.
    var spacer = document.createElement('div');
    spacer.className = 'sie-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(spacer);

    function reserveSpace() {
        var height = bar.offsetHeight;

        spacer.style.height = height + 'px';

        // Published so anything else pinned to the bottom of the window can
        // step aside. A fixed overlay is outside the document flow, so the
        // spacer above does nothing for it, and a sibling addon that puts a
        // consent dialog down there needs a number rather than a promise:
        //
        //   bottom: calc(1rem + var(--sie-bar-height, 0px));
        document.documentElement.style.setProperty('--sie-bar-height', height + 'px');
    }

    reserveSpace();
    window.addEventListener('resize', reserveSpace);

    // Repaint when the bar crosses into or out of the narrow layout, because
    // that is where the change count switches between "1 unsaved" and "1".
    // Bound to the query rather than to every resize event: it fires twice in
    // a session instead of a hundred times during a drag.
    if (window.matchMedia) {
        window.matchMedia('(max-width: 30rem)').addEventListener('change', paint);
    }
    if (window.ResizeObserver) new ResizeObserver(reserveSpace).observe(bar);

    var wasEditing = false;
    try {
        wasEditing = sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
        // See setEditing.
    }

    setEditing(wasEditing);

    }
})();
