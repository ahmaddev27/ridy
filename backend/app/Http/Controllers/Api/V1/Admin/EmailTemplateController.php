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
        $samples = [
            'company_registration' => ['company_name' => 'YA Mobility', 'manager_name' => 'Basel', 'login_url' => config('app.frontend_url', 'https://r.fleeteye.de').'/login'],
            'driver_invite' => ['company_name' => 'YA Mobility', 'driver_name' => 'Ayman', 'invite_link' => config('app.frontend_url', 'https://r.fleeteye.de').'/invite?token=demo'],
        ];

        $vars = $samples[$key] ?? [];

        // Preview the unsaved draft in-memory when provided, else the stored one.
        if ($request->filled('subject') || $request->filled('body_html')) {
            $draft = new EmailTemplate($request->only(['subject', 'body_html', 'logo_url', 'accent_color', 'footer_text']));
            $draft->key = $key;
            $rendered = $renderer->renderTemplate($draft, $vars);
        } else {
            $rendered = $renderer->render($key, $vars);
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
