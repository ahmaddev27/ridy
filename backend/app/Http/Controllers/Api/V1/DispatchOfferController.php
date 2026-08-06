<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Http\Controllers\Controller;
use App\Http\Resources\DispatchOfferResource;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DispatchOfferController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        $offers = DispatchOffer::query()
            ->with('driver:id,name')
            ->orderByDesc('received_at')
            ->paginate(30);

        return DispatchOfferResource::collection($offers);
    }
}
