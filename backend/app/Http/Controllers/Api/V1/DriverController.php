<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Fleet\Models\Driver;
use App\Http\Controllers\Controller;
use App\Http\Resources\DriverResource;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DriverController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        $drivers = Driver::query()->orderBy('name')->paginate(20);

        return DriverResource::collection($drivers);
    }
}
