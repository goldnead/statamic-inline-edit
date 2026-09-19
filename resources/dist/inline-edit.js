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

    function dirty() {
        return nodes.filter(function (node) {
            return read(node) !== original.get(node);
        });
    }

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

        return narrow ? String(count) : (L.unsaved || ':count unsaved').replace(':count', count);
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
        saveBtn.textContent = busy ? (L.saving || 'Saving…') : (L.save || 'Save');
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
            startEditing(node);
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
            startEditing(node);
        });

        node.addEventListener('keydown', function (event) {
            if (!node.isContentEditable) {
                // Keyboard equivalent of the double-click, so the editor is
                // reachable without a mouse.
                if (editing && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    startEditing(node);
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

            byEntry[id].fields[node.dataset.sieField] = read(node).slice(0, config.maxLength || 100000);
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
                    original.set(node, read(node));
                    node.classList.toggle('sie-empty', read(node) === '');
                });

                status(L.saved || 'Saved', 'ok');
                paint();
            })
            .catch(function () {
                busy = false;
                status(L.failed || 'Could not save.', 'bad');
                paint();
            });
    }

    function discard() {
        dirty().forEach(revert);
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
