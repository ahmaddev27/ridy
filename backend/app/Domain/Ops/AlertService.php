<?php

namespace App\Domain\Ops;

use App\Domain\Ops\Models\AlertIncident;
use App\Support\RidyLog;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * Raises and clears operational alerts with per-incident de-duplication: an
 * incident is emailed to ops exactly once when it opens and once when it
 * resolves, never on every check. Alerts go to services.alerts.email; with no
 * address configured it degrades to logging only.
 */
class AlertService
{
    /**
     * Ensure an incident is open for $key. If it wasn't already open, record it
     * and email ops. Idempotent — safe to call every check cycle.
     */
    public function open(string $key, string $kind, string $title, string $body = ''): void
    {
        $existing = AlertIncident::where('key', $key)->whereNull('resolved_at')->first();
        if ($existing !== null) {
            return; // already alerted; don't re-notify
        }

        AlertIncident::create([
            'key' => $key,
            'kind' => $kind,
            'title' => $title,
            'opened_at' => CarbonImmutable::now(),
        ]);

        $this->notify("🔴 ALERT: {$title}", $body ?: $title);
        RidyLog::event('alert.opened', ['key' => $key, 'kind' => $kind, 'title' => $title]);
    }

    /** Resolve an open incident for $key (if any) and send an all-clear. */
    public function resolve(string $key): void
    {
        $open = AlertIncident::where('key', $key)->whereNull('resolved_at')->first();
        if ($open === null) {
            return;
        }

        $open->forceFill(['resolved_at' => CarbonImmutable::now()])->save();
        $this->notify("✅ RESOLVED: {$open->title}", "Resolved: {$open->title}");
        RidyLog::event('alert.resolved', ['key' => $key, 'kind' => $open->kind]);
    }

    private function notify(string $subject, string $body): void
    {
        $to = config('services.alerts.email');
        if (empty($to)) {
            return; // no ops address — the RidyLog entry is the record
        }

        try {
            Mail::raw($body, function ($mail) use ($to, $subject) {
                $mail->to($to)->subject('[Reidey Ops] '.$subject);
            });
        } catch (Throwable $e) {
            RidyLog::event('alert.email_failed', ['error' => $e->getMessage()]);
        }
    }
}
