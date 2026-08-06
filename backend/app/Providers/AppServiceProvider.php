<?php

namespace App\Providers;

use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\Push\FcmPushSender;
use App\Domain\Notifications\Push\LogPushSender;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Real FCM when a server key is configured, otherwise log the push so the
        // full flow works without a Firebase project.
        $this->app->bind(PushSender::class, function () {
            $key = (string) config('services.fcm.server_key');

            return $key !== ''
                ? new FcmPushSender((string) config('services.fcm.endpoint'), $key)
                : new LogPushSender;
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
