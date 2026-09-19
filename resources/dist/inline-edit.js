/*!
 * Statamic Inline Edit
 *
 * Hand-written, on purpose. The whole editor is a bar, a contenteditable and a
 * fetch; a build step would add a toolchain to a file that a client site loads
 * on every page an editor opens, and buy nothing. Keep it that way.
 *
 * The safety rule this file exists to hold: what goes back to the server is
 * always innerText, never innerHTML. A browser's contenteditable will happily
 * produce <font>, style attributes and pasted markup, and none of it can reach
 * the content if we never read it. That is why version 1 only ever offers
 * plain-string fields.
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

    /** Which of the four kinds this field is, said out loud on the page. */
    var BADGES = {
        text: L.badge_text || 'Text',
        control: L.badge_control || 'Wert',
        source: L.badge_source || 'Markdown',
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

    var bar = document.createElement('div');
    bar.className = 'sie-bar';
    bar.setAttribute('role', 'toolbar');
    bar.innerHTML =
        '<button type="button" class="sie-btn sie-toggle"></button>' +
        '<span class="sie-count"></span>' +
        '<span class="sie-status"></span>' +
        '<button type="button" class="sie-btn sie-discard"></button>' +
        '<button type="button" class="sie-btn sie-primary sie-save"></button>';

    var toggleBtn = bar.querySelector('.sie-toggle');
    var countEl = bar.querySelector('.sie-count');
    var statusEl = bar.querySelector('.sie-status');
    var discardBtn = bar.querySelector('.sie-discard');
    var saveBtn = bar.querySelector('.sie-save');

    discardBtn.textContent = L.discard || 'Discard';
    saveBtn.textContent = L.save || 'Save';

    function paint() {
        var count = dirty().length;

        // One label in both states, on purpose. It used to say "Editing" while
        // on, which reads like an invitation to start rather than a statement
        // that it is running, and it made the button change width, so the
        // click that switches editing off landed somewhere other than the
        // click that switched it on. The dot and the colour carry the state,
        // and `aria-pressed` carries it for anyone not looking at colour.
        toggleBtn.textContent = L.edit || 'Edit page';
        toggleBtn.title = editing ? (L.editing || 'Editing') : '';
        toggleBtn.setAttribute('aria-pressed', editing ? 'true' : 'false');
        toggleBtn.classList.toggle('sie-on', editing);

        countEl.textContent = editing
            ? (count ? counted(count) : (L.hint || ''))
            : '';

        // Marked so a narrow screen can drop it. A hint truncated to "Tap o…"
        // is worse than no hint; a count never is.
        countEl.classList.toggle('sie-hint', editing && count === 0);

        bar.classList.toggle('sie-has-changes', count > 0);

        // With editing off there is nothing that could ever be saved, so Save
        // and Discard are not disabled, they are absent. A row of dead buttons
        // on somebody's live page reads as a broken widget.
        bar.classList.toggle('sie-idle', !editing);
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

        if (!on) closePop();

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
                node.dataset.sieBadge = BADGES[node.dataset.sieMode || 'text'] || '';
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
     * Four kinds of field, four different ways in.
     *
     * `text` is the one from version 1: the value is the text on the page, so
     * the text itself opens. The other three exist because their value is not
     * what the page shows, and pretending otherwise is how an editor saves
     * something they never saw.
     */
    function open(node) {
        if (!editing) return;

        var mode = node.dataset.sieMode || 'text';

        if (mode === 'control') return openControl(node);
        if (mode === 'source') return openSource(node);
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
        label.textContent = (node.dataset.sieLabel || node.dataset.sieField)
            + ' · ' + (node.dataset.sieBadge || '');
        pop.appendChild(label);

        var current = valueOf(node) === read(node) ? (node.dataset.sieRaw || '') : valueOf(node);
        var input;

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
            input.addEventListener('change', function () {
                setPending(node, input.value, input.options[input.selectedIndex].textContent);
            });
        } else {
            input = document.createElement('input');
            input.className = 'sie-input';
            input.type = 'date';
            // A stored date can carry a time; the input only takes the day.
            input.value = (current || '').slice(0, 10);
            input.addEventListener('change', function () { setPending(node, input.value, input.value); });
        }

        pop.appendChild(input);

        var done = document.createElement('button');
        done.type = 'button';
        done.className = 'sie-pop-done';
        done.textContent = L.done || 'Fertig';
        done.addEventListener('click', closePop);
        pop.appendChild(done);

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
    function openSource(node) {
        popFor = node;
        pop.innerHTML = '';
        pop.className = 'sie-pop sie-pop-wide';

        var source = pending.has(node) ? pending.get(node) : sourceOf(node);

        var head = document.createElement('span');
        head.className = 'sie-pop-label';
        head.textContent = (node.dataset.sieLabel || node.dataset.sieField)
            + ' · ' + (node.dataset.sieBadge || '');
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
        var url = node.dataset.sieCp;

        if (!url) return;

        if (dirty().length && !window.confirm(L.leave_panel || L.leave || '')) return;

        panelTitle.textContent = node.dataset.sieLabel || node.dataset.sieField;
        frame.title = panelTitle.textContent;
        frame.dataset.sieField = node.dataset.sieField || '';
        frame.src = url;
        panel.hidden = false;
        document.documentElement.classList.add('sie-panel-open');
        panelClose.focus();
    }

    function closePanel() {
        panel.hidden = true;
        frame.removeAttribute('src');
        document.documentElement.classList.remove('sie-panel-open');

        // Whatever happened in there happened to the entry, not to this page.
        // Reloading is the only honest way to show it, and it is also the only
        // way to find out that nothing happened.
        window.location.reload();
    }

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

    toggleBtn.addEventListener('click', function () {
        if (editing && dirty().length && !window.confirm(L.leave || 'You have unsaved changes on this page.')) return;
        if (editing) discard();
        setEditing(!editing);
    });

    saveBtn.addEventListener('click', save);
    discardBtn.addEventListener('click', discard);

    document.addEventListener('keydown', function (event) {
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

    document.body.appendChild(bar);
    document.body.appendChild(pop);
    document.body.appendChild(panel);

    // A click anywhere that is not the popover, the field it belongs to, or
    // the bar closes it. Whatever was picked is already pending, so closing
    // is never a way to lose a choice.
    document.addEventListener('mousedown', function (event) {
        if (pop.hidden) return;
        if (pop.contains(event.target) || bar.contains(event.target)) return;
        if (popFor && popFor.contains(event.target)) return;
        closePop();
    });

    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (!panel.hidden) { closePanel(); return; }
        if (!pop.hidden) closePop();
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
})();
