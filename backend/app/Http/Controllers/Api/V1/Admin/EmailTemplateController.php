<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Domain\Notifications\EmailTemplateRenderer;
use App\Http\Controllers\Controller;
use App\Models\EmailTemplate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Super-admin management of the platform email templates (registration + driver
 * invite): edit subject/body/logo/accent/footer, upload images, and preview
 * with sample variables.
 */
class EmailTemplateController extends Controller
{
    public function index(): JsonResponse
    {
        $templates = EmailTemplate::all()->map(fn (EmailTemplate $t) => $this->present($t));

        return response()->json(['data' => $templates]);
    }

    public function show(string $key): JsonResponse
    {
        $template = EmailTemplate::findOrFail($key);

        return response()->json(['data' => $this->present($template)]);
    }

    public function update(Request $request, string $key): JsonResponse
    {
        $template = EmailTemplate::findOrFail($key);

        $data = $request->validate([
            'subject' => ['required', 'string', 'max:255'],
            'body_html' => ['required', 'string', 'max:50000'],
            'logo_url' => ['nullable', 'string', 'max:1000'],
            'accent_color' => ['nullable', 'string', 'max:9'],
            'footer_text' => ['nullable', 'string', 'max:255'],
        ]);

        $template->update($data);

        return response()->json(['data' => $this->present($template->fresh())]);
    }

    /** Upload a logo/hero image; returns an absolute URL usable in the template. */
    public function uploadImage(Request $request): JsonResponse
    {
        $request->validate([
            'image' => ['required', 'image', 'max:2048'], // 2 MB
        ]);

        $path = $request->file('image')->store('email-images', 'public');

        return response()->json(['data' => ['url' => Storage::disk('public')->url($path)]]);
    }

    /** Render with sample values so the admin can preview the final email. */
    public function preview(Request $request, string $key, EmailTemplateRenderer $renderer): JsonResponse
    {
        $base = config('app.frontend_url', 'https://reidey.de');

        $samples = [
            'company_registration' => ['company_name' => 'YA Mobility', 'manager_name' => 'Basel', 'login_url' => $base.'/login'],
            'company_otp' => ['name' => 'Basel', 'otp' => '123456'],
            'password_otp' => ['name' => 'Basel', 'otp' => '123456'],
            'driver_invite' => ['company_name' => 'YA Mobility', 'driver_name' => 'Ayman', 'invite_link' => $base.'/invite?token=demo'],
            'subscription_expiring' => ['title' => 'Dein Abo läuft bald ab', 'body' => 'Dein Abo läuft in 3 Tagen ab. Verlängere jetzt, um ohne Unterbrechung weiterzuarbeiten.', 'action_label' => 'Abo verlängern', 'action_url' => $base.'/settings/subscription'],
            'subscription_expired' => ['title' => 'Dein Abo ist abgelaufen', 'body' => 'Dein Abo ist abgelaufen. Reaktiviere es, um wieder vollen Zugriff zu erhalten.', 'action_label' => 'Abo reaktivieren', 'action_url' => $base.'/settings/subscription'],
            'subscription_activated' => ['title' => 'Dein Abo ist aktiv', 'body' => 'Dein Abo wurde aktiviert. Du hast jetzt vollen Zugriff auf alle Funktionen.', 'action_label' => 'Zum Dashboard', 'action_url' => $base.'/dashboard'],
            'subscription_free' => ['title' => 'Kostenloses Abo freigeschaltet', 'body' => 'Dir wurde ein kostenloses Abo gewährt. Viel Erfolg mit Reidey!', 'action_label' => 'Zum Dashboard', 'action_url' => $base.'/dashboard'],
            'session_needs_relink' => ['title' => 'Uber-Verbindung erneuern', 'body' => 'Deine Uber-Sitzung muss neu verbunden werden, damit wir Fahrten weiter erfassen können.', 'action_label' => 'Jetzt verbinden', 'action_url' => $base.'/settings/connections'],
            'company_banned' => ['title' => 'Konto gesperrt', 'body' => 'Das Konto von YA Mobility wurde gesperrt. Bitte kontaktiere den Support für Details.', 'action_label' => 'Support kontaktieren', 'action_url' => $base.'/support'],
            'company_registered' => ['title' => 'Neue Firma registriert', 'body' => 'YA Mobility hat sich soeben auf der Plattform registriert.', 'action_label' => 'Firma ansehen', 'action_url' => $base.'/admin/companies'],
            'proxy_expiring' => ['title' => 'Proxy läuft bald ab', 'body' => 'Ein Proxy läuft in Kürze ab. Erneuere ihn, um Verbindungsabbrüche zu vermeiden.', 'action_label' => 'Proxys verwalten', 'action_url' => $base.'/admin/proxies'],
            'code_activated' => ['title' => 'Aktivierungscode eingelöst', 'body' => 'Einer deiner Aktivierungscodes wurde soeben eingelöst.', 'action_label' => 'Codes ansehen', 'action_url' => $base.'/admin/codes'],
        ];

        $vars = $samples[$key] ?? [];

        // Preview the unsaved draft in-memory when provided, else the stored one.
        if ($request->filled('subject') || $request->filled('body_html')) {
            $draft = new EmailTemplate($request->only(['subject', 'body_html', 'logo_url', 'accent_color', 'footer_text']));
            $draft->key = $key;
            $rendered = $renderer->renderTemplate($draft, $vars, inlineAssets: true);
        } else {
            $rendered = $renderer->render($key, $vars, inlineAssets: true);
        }

        return response()->json(['data' => $rendered]);
    }

    /** @return array<string, mixed> */
    private function present(EmailTemplate $t): array
    {
        return [
            'key' => $t->key,
            'subject' => $t->subject,
            'body_html' => $t->body_html,
            'logo_url' => $t->logo_url,
            'accent_color' => $t->accent_color,
            'footer_text' => $t->footer_text,
            'variables' => EmailTemplate::VARIABLES[$t->key] ?? [],
        ];
    }
}
