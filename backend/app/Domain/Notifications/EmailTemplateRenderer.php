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
    public function render(string $key, array $vars): array
    {
        $template = EmailTemplate::find($key);

        return $template === null
            ? ['subject' => '', 'html' => '']
            : $this->renderTemplate($template, $vars);
    }

    /**
     * Render a template instance directly (used for previewing unsaved drafts).
     *
     * @param  array<string, string>  $vars
     * @return array{subject: string, html: string}
     */
    public function renderTemplate(EmailTemplate $template, array $vars): array
    {
        $subject = $this->substitute($template->subject, $vars);
        $body = $this->substitute($this->sanitize((string) $template->body_html), $vars);

        return ['subject' => $subject, 'html' => $this->wrap($template, $body)];
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

    private function wrap(EmailTemplate $template, string $body): string
    {
        $accent = htmlspecialchars($template->accent_color ?: '#4f46e5', ENT_QUOTES);
        $logo = $template->logo_url
            ? '<img src="'.htmlspecialchars($template->logo_url, ENT_QUOTES).'" alt="" style="max-height:48px;margin-bottom:16px">'
            : '';
        $footer = htmlspecialchars((string) $template->footer_text, ENT_QUOTES);

        return <<<HTML
<div style="background:#f1f5f9;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;color:#1e293b">
    {$logo}
    <div style="font-size:15px;line-height:1.6">{$body}</div>
  </div>
  <p style="max-width:560px;margin:16px auto 0;text-align:center;color:#94a3b8;font-size:12px">{$footer}</p>
  <style>.btn{display:inline-block;background:{$accent};color:#fff!important;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;margin-top:8px}</style>
</div>
HTML;
    }
}
