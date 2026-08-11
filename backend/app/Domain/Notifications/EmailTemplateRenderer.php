<?php

namespace App\Domain\Notifications;

use App\Models\EmailTemplate;

/**
 * Renders a stored email template: substitutes {{variables}}, strips scripts,
 * and wraps the admin's rich-text body in a responsive layout (logo, accent
 * button colour, footer). Returns the final subject + HTML ready to mail.
 */
class EmailTemplateRenderer
{
    /**
     * @param  array<string, string>  $vars
     * @return array{subject: string, html: string}
     */
    public function render(string $key, array $vars, bool $inlineAssets = false): array
    {
        $template = EmailTemplate::find($key);

        return $template === null
            ? ['subject' => '', 'html' => '']
            : $this->renderTemplate($template, $vars, $inlineAssets);
    }

    /**
     * Render a template instance directly (used for previewing unsaved drafts).
     *
     * @param  array<string, string>  $vars
     * @return array{subject: string, html: string}
     */
    public function renderTemplate(EmailTemplate $template, array $vars, bool $inlineAssets = false): array
    {
        $subject = $this->substitute($template->subject, $vars);
        $body = $this->substitute($this->sanitize((string) $template->body_html), $vars);

        return ['subject' => $subject, 'html' => $this->wrap($template, $body, $inlineAssets)];
    }

    /** @param array<string, string> $vars */
    private function substitute(string $text, array $vars): string
    {
        foreach ($vars as $name => $value) {
            $text = str_replace('{{'.$name.'}}', e($value), $text);
        }

        return $text;
    }

    /** Remove script/style/on* — the author is trusted, this is just a safety net. */
    private function sanitize(string $html): string
    {
        $html = preg_replace('#<(script|style)\b[^>]*>.*?</\1>#is', '', $html);

        return preg_replace('#\son\w+\s*=\s*("[^"]*"|\'[^\']*\')#i', '', $html);
    }

    private function wrap(EmailTemplate $template, string $body, bool $inlineAssets = false): string
    {
        $accent = htmlspecialchars($template->accent_color ?: '#4f46e5', ENT_QUOTES);
        $header = $this->brandHeader($template, $inlineAssets);
        $footer = htmlspecialchars((string) $template->footer_text, ENT_QUOTES);

        return <<<HTML
<div style="background:#f1f5f9;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;color:#1e293b">
    {$header}
    <div style="font-size:15px;line-height:1.6">{$body}</div>
  </div>
  <p style="max-width:560px;margin:16px auto 0;text-align:center;color:#94a3b8;font-size:12px">{$footer}</p>
  <style>.btn{display:inline-block;background:{$accent};color:#fff!important;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;margin-top:8px}</style>
</div>
HTML;
    }

    /**
     * The email header logo. A custom uploaded image wins when present; otherwise
     * we render the platform's real Reidey mark (a hosted PNG — reliable across
     * every mail client, unlike SVG which Gmail strips) beside the wordmark, so it
     * always shows without any upload.
     */
    private function brandHeader(EmailTemplate $template, bool $inlineAssets = false): string
    {
        if (filled($template->logo_url)) {
            $src = htmlspecialchars($this->absoluteUrl($template->logo_url), ENT_QUOTES);

            return '<img src="'.$src.'" alt="Reidey" style="max-height:48px;margin-bottom:20px">';
        }

        // Preview embeds the logo (renders regardless of a reachable host); real
        // emails reference the hosted PNG (works in Gmail, which strips data URIs).
        $src = $inlineAssets
            ? $this->inlineLogo()
            : htmlspecialchars($this->absoluteUrl('email/reidey-logo.png'), ENT_QUOTES);

        return <<<HTML
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-collapse:collapse">
  <tr>
    <td style="vertical-align:middle"><img src="{$src}" width="40" height="40" alt="Reidey" style="display:block;border-radius:9px"></td>
    <td style="padding-left:10px;vertical-align:middle;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:18px;font-weight:700;color:#0f172a">Reidey</td>
  </tr>
</table>
HTML;
    }

    /** The platform logo as a base64 data URI (for previews / offline rendering). */
    private function inlineLogo(): string
    {
        $path = public_path('email/reidey-logo.png');
        if (! is_file($path)) {
            return htmlspecialchars($this->absoluteUrl('email/reidey-logo.png'), ENT_QUOTES);
        }

        return 'data:image/png;base64,'.base64_encode((string) file_get_contents($path));
    }

    /** Make an uploaded relative logo path absolute so remote mail clients load it. */
    private function absoluteUrl(string $url): string
    {
        if (str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) {
            return $url;
        }

        return rtrim((string) config('app.url'), '/').'/'.ltrim($url, '/');
    }
}
