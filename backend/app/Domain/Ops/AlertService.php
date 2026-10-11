<?php

namespace App\Domain\Ops;

use App\Domain\Notifications\Jobs\SendRenderedMail;
use App\Domain\Ops\Models\AlertIncident;
use App\Support\RidyLog;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Log;
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

    /**
     * Always leaves a production log line (the record when no ops address is set)
     * and QUEUES the email: SMTP latency must never stall the scheduler tick, and a
     * transient mailer failure is retried by the job instead of being lost.
     */
    private function notify(string $subject, string $body): void
    {
        Log::warning('ops.alert', ['subject' => $subject, 'body' => $body]);

        $to = self::recipients();
        if ($to === []) {
            return;
        }

        try {
            SendRenderedMail::dispatch($to, '[Reidey Ops] '.$subject, $body, false);
        } catch (Throwable $e) {
            RidyLog::failure('alert.email_failed', ['subject' => $subject], $e);
        }
    }

    /**
     * Who gets ops alerts, as a list.
     *
     * ALERT_EMAIL takes one address or several separated by a comma, semicolon or
     * whitespace — an operator who wants a second pair of eyes on broken sessions
     * should not need a code change or a second secret for it.
     *
     * It used to be passed through as a single `(string)`, which Symfony Mailer
     * reads as ONE address: adding a second one silently broke the alert for BOTH
     * recipients, so the very thing meant to add coverage removed it. Hence the
     * split, the validation (a typo drops that one address rather than failing the
     * whole send) and the log line naming what was dropped.
     *
     * @return array<int, string>
     */
    public static function recipients(): array
    {
        $raw = (string) config('services.alerts.email');
        if (trim($raw) === '') {
            return [];
        }

        $parts = preg_split('/[,;\s]+/', trim($raw), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        $valid = [];
        $invalid = [];
        foreach ($parts as $address) {
            if (filter_var($address, FILTER_VALIDATE_EMAIL)) {
                $valid[] = $address;
            } else {
                $invalid[] = $address;
            }
        }

        if ($invalid !== []) {
            // Not silent: a mistyped ops address means alerts quietly stop reaching
            // someone, which is the same failure mode as having no alerting at all.
            Log::warning('ops.alert_recipient_invalid', ['dropped' => $invalid]);
        }

        return array_values(array_unique($valid));
    }
}
