<?php

namespace Goldnead\StatamicInlineEdit\Http\Middleware;

use Closure;
use Goldnead\StatamicInlineEdit\Support\Assets;
use Goldnead\StatamicInlineEdit\Support\Editor;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Two jobs on the way out, and the second one is the one that matters.
 *
 * 1. Put the editor on the page, so that marking a field editable is the only
 *    thing a template author has to do.
 *
 * 2. **Keep the editor's version of the page out of the static cache.**
 *
 * The second is not a nicety. A page rendered for a signed-in editor carries
 * markers and a CSRF token; if Statamic's static cache writes that page, every
 * visitor afterwards is served an editor's page, complete with a token that is
 * not theirs. `X-Statamic-Uncacheable` is core's own way of saying "do not
 * store this one", checked in StaticCaching\Middleware\Cache::shouldBeCached().
 *
 * Which is also why this middleware is pushed onto the `statamic.web` group
 * rather than being an event listener. Pushing appends, so this runs innermost:
 * its work on the way out happens *before* the cache middleware decides, which
 * is the only ordering in which the header is read at all.
 *
 * The read side of the cache is not solved and cannot be from here. On a site
 * with full-measure static caching, the cache middleware answers before this
 * one is ever reached, so an editor can be handed a stored visitor page with no
 * markers on it. The fix on such a site is core's {{ nocache }} or excluding
 * the URLs editors work on. Documented in the README rather than papered over,
 * because a marker that appears unreliably is worse than one that is absent.
 */
class InjectEditor
{
    public function handle(Request $request, Closure $next): mixed
    {
        $response = $next($request);

        $editor = app(Editor::class);

        // No marker was rendered, so there is nothing to edit and nothing that
        // distinguishes this response from the one a visitor gets. Leaving the
        // cache header off here is deliberate: marking every page of a signed-in
        // editor uncacheable would empty the cache of a busy site by browsing it.
        if (! $editor->enabled() || ! $editor->hasRendered()) {
            return $response;
        }

        if (! $response instanceof Response) {
            return $response;
        }

        $response->headers->set('X-Statamic-Uncacheable', 'true');

        if (! config('statamic-inline-edit.inject', true)) {
            return $response;
        }

        return $this->inject($response);
    }

    protected function inject(Response $response): Response
    {
        if (! str_contains((string) $response->headers->get('Content-Type'), 'text/html')) {
            return $response;
        }

        $content = $response->getContent();

        if (! is_string($content)) {
            return $response;
        }

        // Already there. A site that serves its own pages adds `web` to the
        // configured groups, and Statamic's own frontend controller puts
        // `statamic.web` on top of `web` — so a page rendered by Statamic
        // passes through this twice. Two copies of the script means two
        // editor bars, two sets of listeners, and every double-click opening
        // the field twice.
        if (str_contains($content, 'id="statamic-inline-edit-config"')) {
            return $response;
        }

        // The last one, not the first: a page may well contain the string
        // "</body>" inside an example, a code block or an escaped snippet, and
        // the document's own closing tag is the last of them.
        $position = strripos($content, '</body>');

        if ($position === false) {
            return $response;
        }

        $response->setContent(
            substr($content, 0, $position)
            .app(Assets::class)->markup()."\n"
            .substr($content, $position)
        );

        // Set earlier in the pipeline by something else, it is now a lie, and a
        // truncated page is a harder bug to see than a missing header.
        $response->headers->remove('Content-Length');

        return $response;
    }
}
