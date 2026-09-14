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
        // `key` is UNIQUE, so there is one row per incident forever. A prior
        // occurrence that already resolved leaves that row present with a
        // resolved_at — so re-opening the SAME key must UPDATE that row, not insert
        // a second one (which threw 1062 and crashed the whole alerts:check run,
        // swallowing the alert AND blinding every check after it).
        $incident = AlertIncident::firstOrNew(['key' => $key]);
        if ($incident->exists && $incident->resolved_at === null) {
            return; // still open; already alerted — don't re-notify
        }

        $incident->forceFill([
            'kind' => $kind,
            'title' => $title,
            'opened_at' => CarbonImmutable::now(),
            'resolved_at' => null, // reopen a previously-resolved incident
        ])->save();

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
