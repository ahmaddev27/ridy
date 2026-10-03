<?php

namespace Tests\Feature;

use App\Support\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AppDownloadTest extends TestCase
{
    use RefreshDatabase;

    private const ANDROID = 'https://play.google.com/store/apps/details?id=de.reidey.app';

    private const IOS = 'https://apps.apple.com/de/app/reidey-driver/id6804695096';

    private const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

    private const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

    private const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

    private function hit(string $ua)
    {
        return $this->withHeader('User-Agent', $ua)->get('/get');
    }

    public function test_android_device_is_redirected_to_google_play(): void
    {
        Settings::setMany(['app_android_store_url' => self::ANDROID, 'app_ios_store_url' => self::IOS]);

        $this->hit(self::UA_ANDROID)->assertRedirect(self::ANDROID);
    }

    public function test_iphone_is_redirected_to_the_app_store(): void
    {
        Settings::setMany(['app_android_store_url' => self::ANDROID, 'app_ios_store_url' => self::IOS]);

        $this->hit(self::UA_IPHONE)->assertRedirect(self::IOS);
    }

    public function test_desktop_gets_the_chooser_page_with_both_links(): void
    {
        Settings::setMany(['app_android_store_url' => self::ANDROID, 'app_ios_store_url' => self::IOS]);

        $res = $this->hit(self::UA_DESKTOP)->assertOk();
        $res->assertSee(self::ANDROID, false);
        $res->assertSee(self::IOS, false);
    }

    public function test_android_without_a_configured_url_falls_back_to_the_chooser(): void
    {
        // iOS set, Android not: an Android device must not redirect to the iOS store.
        Settings::setMany(['app_ios_store_url' => self::IOS]);

        $this->hit(self::UA_ANDROID)
            ->assertOk()
            ->assertSee('bald verfügbar');
    }
}
