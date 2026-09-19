<?php

namespace Goldnead\StatamicInlineEdit\Support;

use Illuminate\Support\Facades\Route;

/**
 * The stylesheet, the configuration and the script, as one block of markup.
 *
 * One class rather than two copies, because the middleware that injects them
 * automatically and the {{ inline_edit:assets }} tag that places them by hand
 * must produce the same thing. A second copy is how the manual escape hatch
 * ends up a release behind the automatic path.
 */
class Assets
{
    public const HANDLE = 'statamic-inline-edit';

    public function markup(): string
    {
        return implode("\n", [
            '<link rel="stylesheet" href="'.e($this->url('inline-edit.css')).'">',
            '<script id="statamic-inline-edit-config" type="application/json">'.$this->payload().'</script>',
            '<script src="'.e($this->url('inline-edit.js')).'" defer></script>',
        ]);
    }

    /**
     * The JSON the script reads on boot.
     *
     * The CSRF token travels with it rather than being fetched, and that is
     * safe here for one specific reason: a page carrying this payload is a
     * page the middleware has already marked uncacheable, so the token belongs
     * to the person reading it and not to whoever warmed a cache.
     *
     * Flags are the strict set: a token in a page must not be able to close
     * the script tag it sits in, whatever a content editor put in a label.
     */
    protected function payload(): string
    {
        $data = [
            'saveUrl' => $this->saveUrl(),
            'csrf' => csrf_token(),
            'maxLength' => app(Editor::class)->maxLength(),
            'labels' => [
                'edit' => __('statamic-inline-edit::messages.edit'),
                'editing' => __('statamic-inline-edit::messages.editing'),
                'save' => __('statamic-inline-edit::messages.save'),
                'saving' => __('statamic-inline-edit::messages.saving'),
                'saved' => __('statamic-inline-edit::messages.saved'),
                'discard' => __('statamic-inline-edit::messages.discard'),
                'unsaved' => __('statamic-inline-edit::messages.unsaved'),
                'hint' => __('statamic-inline-edit::messages.hint'),
                'empty' => __('statamic-inline-edit::messages.empty'),
                'conflict' => __('statamic-inline-edit::messages.conflict'),
                'failed' => __('statamic-inline-edit::messages.failed'),
                'leave' => __('statamic-inline-edit::messages.leave'),
            ],
        ];

        return (string) json_encode(
            $data,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
        );
    }

    /**
     * Built from the named route when it is registered, and from the configured
     * action prefix when it is not — which is the case in a package test that
     * boots the provider without core's own route file.
     */
    protected function saveUrl(): string
    {
        if (Route::has('statamic.inline-edit.save')) {
            return route('statamic.inline-edit.save');
        }

        return url(trim((string) config('statamic.routes.action', '!'), '/').'/'.self::HANDLE.'/save');
    }

    /**
     * Cache-busted by file contents, not by a version number.
     *
     * A client's browser holding last month's editor against this month's save
     * route fails in a way nobody can reproduce. The hash changes exactly when
     * the file does.
     */
    protected function url(string $file): string
    {
        $path = public_path('vendor/'.self::HANDLE.'/'.$file);
        $url = url('/vendor/'.self::HANDLE.'/'.$file);

        return is_file($path) ? $url.'?v='.substr(md5_file($path) ?: '', 0, 8) : $url;
    }
}
