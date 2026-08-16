<?php

namespace Tests\Feature;

use App\Support\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AppVersionTest extends TestCase
{
    use RefreshDatabase;

    public function test_no_minimum_configured_never_forces_an_update(): void
    {
        $this->getJson('/api/v1/app/version?platform=android&version=0.1.0')
            ->assertOk()
            ->assertJsonPath('data.update_required', false)
            ->assertJsonPath('data.min_supported', null);
    }

    public function test_older_build_is_forced_to_update_with_store_url(): void
    {
        Settings::setMany([
            'app_min_android' => '1.2.0',
            'app_android_store_url' => 'https://play.google.com/store/apps/details?id=de.fleeteye.reidey.driver',
        ]);

        $this->getJson('/api/v1/app/version?platform=android&version=1.1.9')
            ->assertOk()
            ->assertJsonPath('data.update_required', true)
            ->assertJsonPath('data.store_url', 'https://play.google.com/store/apps/details?id=de.fleeteye.reidey.driver');
    }

    public function test_current_or_newer_build_is_allowed(): void
    {
        Settings::setMany(['app_min_ios' => '1.2.0']);

        $this->getJson('/api/v1/app/version?platform=ios&version=1.2.0')
            ->assertOk()
            ->assertJsonPath('data.update_required', false);

        $this->getJson('/api/v1/app/version?platform=ios&version=1.3.0')
            ->assertOk()
            ->assertJsonPath('data.update_required', false);
    }

    public function test_platform_and_version_are_required(): void
    {
        $this->getJson('/api/v1/app/version')->assertStatus(422);
    }
}
