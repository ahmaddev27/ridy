<?php

use App\Http\Controllers\AppDownloadController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// Smart app-install link (the invite email's single "install" button). Reads the
// device from the User-Agent and redirects to the matching store. Served by the
// backend (via Caddy's @laravel matcher) so it reads the store URLs from settings
// directly — no cross-container fetch, a true pre-page 302.
Route::get('/get', [AppDownloadController::class, 'redirect']);
