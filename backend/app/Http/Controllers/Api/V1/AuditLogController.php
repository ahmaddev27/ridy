<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Audit\Models\AuditLog;
use App\Domain\Tenancy\TenantContext;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class AuditLogController extends Controller
{
    public function index(TenantContext $context): JsonResponse
    {
        $logs = AuditLog::where('tenant_id', $context->get())
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(50);

        return response()->json([
            'data' => collect($logs->items())->map(fn (AuditLog $l) => [
                'id' => $l->id,
                'action' => $l->action,
                'actor_id' => $l->actor_id,
                'subject' => $l->subject_type ? class_basename($l->subject_type).'#'.$l->subject_id : null,
                'context' => $l->context,
                'ip' => $l->ip,
                'created_at' => $l->created_at?->toIso8601String(),
            ]),
            'meta' => [
                'total' => $logs->total(),
                'per_page' => $logs->perPage(),
                'current_page' => $logs->currentPage(),
            ],
        ]);
    }
}
