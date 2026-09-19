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

        toggleBtn.textContent = editing ? (L.editing || 'Editing') : (L.edit || 'Edit page');
        toggleBtn.classList.toggle('sie-on', editing);

        countEl.textContent = editing
            ? (count ? (L.unsaved || ':count unsaved').replace(':count', count) : (L.hint || ''))
            : '';

        bar.classList.toggle('sie-has-changes', count > 0);
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
                if (read(node) === '') node.setAttribute('data-sie-placeholder', L.empty || 'Empty');
            } else {
                stopEditing(node);
                node.removeAttribute('tabindex');
            }
        });

        // Re-read every field now that the class is on, and only now.
        //
        // Switching edit mode gives multiline fields `white-space: pre-wrap`,
        // so the newlines the stored value has, and the rendered page collapses
        // into spaces, suddenly become visible. innerText changes with them.
        // Without this, turning editing on marks every textarea on the page as
        // changed before anyone has touched anything: the counter lies, and a
        // Save posts fields nobody edited.
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

    var wasEditing = false;
    try {
        wasEditing = sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
        // See setEditing.
    }

    setEditing(wasEditing);
})();
