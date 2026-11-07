<?php

namespace App\Domain\Fleet\Models;

use App\Domain\Tenancy\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A driver's own star rating of the Reidey app (1-5) plus optional typed feedback.
 * Captured by us; never read from, or sent to, the app stores.
 */
class AppRating extends Model
{
    use BelongsToTenant;

    protected $fillable = ['tenant_id', 'driver_id', 'stars', 'feedback', 'platform', 'app_version'];

    protected $casts = ['stars' => 'integer'];

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }
}
