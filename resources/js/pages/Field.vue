<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import {
    Alert,
    Button,
    CommandPaletteItem,
    PublishContainer,
    PublishFieldsProvider,
    PublishFields,
} from '@statamic/cms/ui';

const props = defineProps([
    'handle',     // the one field this page is about
    'title',      // its display name, for the frame's own heading
    'blueprint',  // a one-field blueprint, as the publish form wants it
    'values',     // { [handle]: preprocessed value }
    'meta',       // { [handle]: fieldtype metadata }
    'saveUrl',    // PATCH endpoint
    'csrfToken',
    'readOnly',
    'inplace',    // the frame stands where the content stood, not on a card
    'labels',     // { save, saving, close, failed }
]);

/**
 * No control panel chrome.
 *
 * This page is the entire contents of a small panel over somebody's live
 * site. A navigation sidebar, a global search and a breadcrumb inside it
 * would be absurd, and they are the reason the old full-page overlay felt
 * like being thrown into the back office for a typo.
 *
 * Inertia's resolver does `page.layout = page.layout || Layout`, so a `null`
 * here would get the full one back. A layout that renders its slot and
 * nothing else is the way to have none.
 */
defineOptions({
    layout: {
        render() {
            return this.$slots.default?.();
        },
    },
});

// One tab, one section, one field — but read out of the blueprint rather than
// assumed, so a second field later is a change in one place.
const fields = computed(() => props.blueprint?.tabs?.[0]?.sections?.[0]?.fields ?? []);

const values = ref({ ...(props.values ?? {}) });
const errors = ref({});
const failed = ref(null);
const saving = ref(false);

/**
 * Talk to the page that framed us.
 *
 * `'*'` as the target: the frame knows its own origin, not the origin of the
 * site that put it there, and neither the height of a form nor the word
 * "saved" is a secret. The listener on the other side checks that the message
 * came from this frame, which is the half of the handshake that matters.
 */
function tell(type, payload = {}) {
    if (window.parent === window) return;

    window.parent.postMessage({ source: 'statamic-inline-edit', type, ...payload }, '*');
}

async function save() {
    if (saving.value || props.readOnly) return;

    saving.value = true;
    errors.value = {};
    failed.value = null;

    try {
        const response = await fetch(props.saveUrl, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-CSRF-TOKEN': props.csrfToken,
            },
            body: JSON.stringify({ [props.handle]: values.value[props.handle] ?? null }),
        });

        const body = await response.json().catch(() => ({}));

        if (response.status === 422) {
            errors.value = body.errors ?? {};
            failed.value = body.message ?? props.labels?.failed;

            return;
        }

        if (! response.ok) {
            failed.value = body.message ?? props.labels?.failed;

            return;
        }

        tell('saved');
    } catch (e) {
        // A save that fails silently is the one defect this panel cannot
        // afford: the person closes it believing their text is stored.
        failed.value = props.labels?.failed;
    } finally {
        saving.value = false;
    }
}

/**
 * Report how tall the form is, so the panel can be the size of the field
 * instead of the size of the screen.
 *
 * Observed rather than measured once: a Bard grows as it is typed into, and
 * an asset picker is a different height the moment it has a picture in it.
 */
let observer = null;
const root = ref(null);

function reportHeight() {
    // The form's own box, never `documentElement.scrollHeight`. The document
    // in a frame is at least as tall as the frame, so a panel sized from it
    // can grow and never shrink — it reports the height it was just given.
    if (! root.value) return;

    const box = root.value.getBoundingClientRect();
    const top = box.top + window.scrollY;
    const height = Math.ceil(top + root.value.offsetHeight);

    if (! props.inplace) {
        tell('height', { height });

        return;
    }

    // Standing in for content, the frame has to say more than how tall it is.
    // A toolbar above the text and a pair of buttons below it are part of this
    // document's height but must not be part of the article's: if the page
    // made room for them, opening the editor would shove everything below it
    // down the screen, starting with the paragraph that was double-clicked.
    //
    // So: where the text starts inside this document, and how tall the text
    // is. The page pulls the frame up by the first and lets the rest hang
    // over what is above and below, which is where floating chrome belongs.
    const editor = root.value.querySelector('.ProseMirror') ?? root.value;
    const editorBox = editor.getBoundingClientRect();

    tell('height', {
        height,
        lift: Math.max(0, Math.round(editorBox.top + window.scrollY)),
        content: Math.ceil(editorBox.height),
    });
}

function onKeydown(event) {
    if (event.key === 'Escape') {
        tell('close');

        return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        save();
    }
}

/**
 * The page's own typography, handed over by the page.
 *
 * This frame carries the control panel's stylesheet, so a Bard in it is set in
 * the control panel's font at the control panel's size — which is the right
 * answer on a card over the site and the wrong one when the frame is standing
 * in the article's column. What the editor shows has to be what the article
 * shows, or every line break lands somewhere else than it will on the page.
 *
 * Measured over there, not guessed here: the page reads the computed style of
 * the element that was double-clicked and of a probe for each kind of block a
 * Bard can produce, and sends back rules already scoped to `.ProseMirror`.
 * Nothing about the site's stylesheet is loaded into this document — that
 * would put Tailwind's preflight through the control panel's own UI.
 */
const pageStyles = ref('');

function onMessage(event) {
    // Only the window that framed us, and only from the same origin. The
    // control panel and the site share one in every setup where this frame
    // works at all; where they do not, this quietly does nothing, which is
    // the right failure for a message that carries nothing but appearance.
    if (event.source !== window.parent) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data;

    if (! data || data.source !== 'statamic-inline-edit-host') return;

    if (data.type === 'styles' && typeof data.css === 'string') {
        pageStyles.value = data.css;

        // And measure again once they have taken effect. The rules change the
        // toolbar's padding and the editor's, so the numbers reported before
        // they arrived describe a layout that no longer exists — and the page
        // would put the text a few pixels off the line it belongs on.
        requestAnimationFrame(() => requestAnimationFrame(reportHeight));
    }
}

onMounted(() => {
    reportHeight();

    observer = new ResizeObserver(reportHeight);
    observer.observe(root.value);

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('message', onMessage);

    // The card paints its own white behind this document; in place there must
    // be nothing behind it at all, or the page's own background, image or
    // border stops at the edge of the frame. The control panel's layout sets
    // this on the elements themselves, so it is taken off the same way.
    if (props.inplace) {
        document.documentElement.style.background = 'transparent';
        document.body.style.background = 'transparent';

        // No scrollbar, ever. This document is exactly as tall as the page
        // made it, so a bar down the right edge would only be a few pixels of
        // width taken off the text — and a line that breaks one word earlier
        // than it will on the page is the whole promise broken.
        document.documentElement.style.overflow = 'hidden';
    }

    tell('ready');
});

onBeforeUnmount(() => {
    observer?.disconnect();
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('message', onMessage);
});
</script>

<template>
    <div ref="root" class="sie-cp-field" :class="{ 'sie-cp-inplace': inplace }">
        <component :is="'style'" v-if="inplace && pageStyles" v-text="pageStyles" />
        <PublishContainer
            name="inline-edit-field"
            :blueprint="blueprint"
            :meta="meta"
            :model-value="values"
            :errors="errors"
            :read-only="readOnly"
            @update:model-value="values = $event"
        >
            <!-- Provider then renderer: `PublishFields` draws whatever the
                 surrounding provider put in context, and has no props. -->
            <PublishFieldsProvider :fields="fields">
                <PublishFields />
            </PublishFieldsProvider>
        </PublishContainer>

        <!-- Core's own alert rather than a paragraph of ours: it is the shape
             a control panel uses to say something went wrong, and it carries
             the theme's colours instead of a red this addon picked. -->
        <Alert v-if="failed" variant="error" class="mt-3">
            <p v-text="failed"></p>
        </Alert>

        <div class="sie-cp-actions">
            <Button variant="ghost" :text="labels?.close" @click="tell('close')" />
            <CommandPaletteItem
                v-if="! readOnly"
                :category="__('Actions')"
                :text="labels?.save"
                icon="save"
                :action="save"
            >
                <Button
                    variant="primary"
                    :disabled="saving"
                    :text="saving ? labels?.saving : labels?.save"
                    @click="save"
                />
            </CommandPaletteItem>
        </div>
    </div>
</template>

<style>
/* Not scoped, and deliberately short. The control panel's own stylesheet is
   loaded by the layout this page sits in, so every field inside looks exactly
   as it does in the entry form. All that is left is the padding the missing
   chrome used to provide. */
.sie-cp-field {
    padding: 16px;
}

.sie-cp-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
}

/* ------------------------------------------------------------- in place */

/* Standing in the article's column rather than on a card over it.

   Only what depends on this component's own markup lives here. The rules that
   take the control panel's surfaces away — the box around the field, the
   label, the editor's padding — arrive from the page together with its
   typography, because they are the same job: one payload decides how this
   frame stops looking like a form and starts looking like the article. */

.sie-cp-field.sie-cp-inplace {
    padding: 0;
    background: transparent;
}
</style>
