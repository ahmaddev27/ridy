<?php

namespace App\Domain\Audit;

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Throwable;

/**
 * Records audit entries for sensitive actions (impersonation, purges, admin
 * mutations, config changes).
 *
 * The actor is the REAL person: during a super-admin "act as company" session the
 * authenticated user is the impersonated manager, so the impersonator is recorded
 * as actor and the impersonated user goes into the context as `as_user_id`.
 * Auditing is best-effort: a failed write is reported but never breaks the action.
 */
class AuditLogger
{
    /** Request attribute set once an explicit entry was written (the middleware skips then). */
    public const REQUEST_FLAG = 'audit.logged';

    /** Session key the impersonation flow stores the original super-admin id under. */
    private const IMPERSONATOR_KEY = 'impersonator_id';

    public function __construct(private TenantContext $context) {}

    /**
     * @param  array<string, mixed>  $context
     * @param  int|null  $tenantId  explicit tenant; defaults to the request's resolved tenant
     */
    public function log(string $action, ?Model $subject = null, array $context = [], ?int $tenantId = null): ?AuditLog
    {
        return $this->write($action, $subject, $context, $tenantId ?? $this->context->get());
    }

    /**
     * A platform-level entry (tenant_id NULL): survives the deletion of any company
     * and is not shown in a tenant's own audit screen.
     *
     * @param  array<string, mixed>  $context
     */
    public function logPlatform(string $action, ?Model $subject = null, array $context = []): ?AuditLog
    {
        return $this->write($action, $subject, $context, null);
    }

    /** @param array<string, mixed> $context */
    private function write(string $action, ?Model $subject, array $context, ?int $tenantId): ?AuditLog
    {
        try {
            $actorId = Auth::id();
            $impersonatorId = $this->impersonatorId();
            if ($impersonatorId !== null && $impersonatorId !== $actorId) {
                $context['as_user_id'] = $actorId;
                $actorId = $impersonatorId;
            }

            $request = app()->bound('request') ? request() : null;
            $request?->attributes->set(self::REQUEST_FLAG, true);

            // subject_id is numeric; a string-keyed subject (e.g. an email template) keeps its key in context.
            $key = $subject?->getKey();
            if ($key !== null && ! is_int($key) && ! ctype_digit((string) $key)) {
                $context['subject_key'] = (string) $key;
                $key = null;
            }

            return AuditLog::create([
                'tenant_id' => $tenantId,
                'actor_id' => $actorId,
                'action' => mb_substr($action, 0, 255),
                'subject_type' => $subject ? $subject::class : null,
                'subject_id' => $key,
                'context' => $context ?: null,
                'ip' => $request?->ip(),
                'created_at' => now(),
            ]);
        } catch (Throwable $e) {
            report($e);

            return null;
        }
    }

    private function impersonatorId(): ?int
    {
        if (! app()->bound('request')) {
            return null;
        }
        $request = request();
        if (! $request->hasSession()) {
            return null;
        }
        $id = $request->session()->get(self::IMPERSONATOR_KEY);

        return $id !== null ? (int) $id : null;
    }
}
