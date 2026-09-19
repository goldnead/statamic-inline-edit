# Statamic Inline Edit — Marketplace

## Price

**$49, one edition.** Decided by Adrian on 2026-09-19.

One product, no free/pro split, so `extra.statamic.editions` stays absent from `composer.json`.
A free tier was considered and rejected: the natural cut is "plain text free, markdown and the
control panel overlay paid", and plain text alone does not do the job anybody buys this for.
Half a feature is not a funnel, it is a bad first impression.

### Why $49 when every neighbour is free

That is the question this page exists to answer, because the field really is free:

| Addon | Price | What it does |
|---|---|---|
| Visual Editor (mariohamann) | free | Click in the CP's preview pane, jump to the field. Editing still happens in the form on the left. |
| Workshop (Statamic) | free | An entry form in the front end. The control panel with different chrome. |
| Admin Bar (el-schneider) | free | A bar that links into the control panel. |
| Editor API (ppcharlier) | MIT | A write API. No interface of its own. |
| **Statamic Inline Edit** | **$49** | **The cursor goes in the text the visitor is reading.** |

None of the four does the thing. They all end at the same place: the client still lands in a
form. This one does not, and that is the entire product.

### What the $49 actually buys

The free ones are one mechanism each. This is four, because a page is not all text:

- **text in place** for a headline or an intro
- **a real control** for a toggle, a select or a date, whose value is not the text on the page
- **a rich editor** for markdown, built on Tiptap, the same engine as Statamic's own Bard
- **the real control panel in an overlay** for Bard, Replicator and assets, scrolled to the field

Plus the parts nobody sees until they are missing: a visitor gets byte-for-byte the same HTML,
the editor's page is marked uncacheable so it never reaches a visitor with somebody's CSRF
token in it, `innerHTML` never travels back to the server, a stale save is refused with a 409
instead of overwriting a colleague, and a collection with revisions is refused rather than
written straight past.

### The honest comparison

A developer can put a `contenteditable` and a `fetch` on a page in an afternoon. What is bought
is the afternoon plus the things that only show up on somebody's live site: the static cache
serving an editor's page to the public, a paste that drops a `<span style>` into the content,
two people on the same entry, a markdown round-trip that quietly rewrites a field nobody
touched.

## Editions

One. See above.

## Support

Latest version only. <https://github.com/goldnead/statamic-inline-edit/issues>
