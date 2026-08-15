<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Jobs\SendAdminBroadcast;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super-admin broadcast: send a free-form title/body (+ optional link) to a set
 * of users, delivered as both a bell notification and an FCM push. The actual
 * fan-out runs on the queue ({@see SendAdminBroadcast}); this controller only
 * validates, resolves the audience and hands off — so a large send never blocks
 * the request.
 */
class AdminNotificationController extends Controller
{
    /** Roles a broadcast may target (mirrors the platform role set). */
    private const TARGETABLE_ROLES = ['super_admin', 'owner', 'fleet_manager', 'driver', 'viewer', 'reseller'];

    public function broadcast(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:120'],
            'body' => ['required', 'string', 'max:2000'],
            'href' => ['nullable', 'string', 'max:2048'],
            'all' => ['boolean'],
            'role' => ['nullable', 'string', 'in:'.implode(',', self::TARGETABLE_ROLES)],
            'user_ids' => ['array'],
            'user_ids.*' => ['integer'],
        ]);

        $userIds = $this->resolveTargetIds($data);

        if ($userIds === []) {
            return response()->json(['message' => 'no_recipients'], 422);
        }

        SendAdminBroadcast::dispatch(
            $userIds,
            $data['title'],
            $data['body'],
            $data['href'] ?? null,
        );

        return response()->json(['queued' => count($userIds)]);
    }

    /**
     * Resolve the target audience to a list of user ids. Precedence: an explicit
     * `all` flag wins, then a `role` filter, then an explicit id list.
     *
     * @param  array<string, mixed>  $data
     * @return array<int, int>
     */
    private function resolveTargetIds(array $data): array
    {
        if (! empty($data['all'])) {
            return User::query()->pluck('id')->all();
        }

        if (! empty($data['role'])) {
            return User::role($data['role'])->pluck('id')->all();
        }

        $ids = array_values(array_unique($data['user_ids'] ?? []));

        return User::whereIn('id', $ids)->pluck('id')->all();
    }
}
