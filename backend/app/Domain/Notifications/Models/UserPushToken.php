<?php

namespace App\Domain\Notifications\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A dashboard user's browser FCM token — the target for web push notifications.
 */
class UserPushToken extends Model
{
    protected $fillable = ['user_id', 'token', 'platform', 'last_used_at'];

    protected $casts = ['last_used_at' => 'datetime'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
