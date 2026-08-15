<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Http\Controllers\Controller;
use App\Http\Resources\DispatchOfferResource;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The driver app's own offer history — scoped to the authenticated driver only,
 * regardless of tenant context.
 */
class DriverOfferController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $offers = DispatchOffer::withoutGlobalScopes()
            ->where('driver_id', $request->user()->id)
            ->orderByDesc('received_at')
            ->paginate(min(100, max(5, (int) $request->integer('per_page', 25))));

        return DispatchOfferResource::collection($offers);
    }
}
