<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import {
    Button,
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
    if (root.value) tell('height', { height: Math.ceil(root.value.offsetHeight) });
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

onMounted(() => {
    reportHeight();

    observer = new ResizeObserver(reportHeight);
    observer.observe(root.value);

    document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
    observer?.disconnect();
    document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
    <div ref="root" class="sie-cp-field">
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

        <p v-if="failed" class="sie-cp-failed" v-text="failed"></p>

        <div class="sie-cp-actions">
            <Button variant="ghost" :text="labels?.close" @click="tell('close')" />
            <Button
                v-if="! readOnly"
                variant="primary"
                :disabled="saving"
                :text="saving ? labels?.saving : labels?.save"
                @click="save"
            />
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

.sie-cp-failed {
    margin-top: 12px;
    font-size: 13px;
    color: #b42318;
}
</style>
