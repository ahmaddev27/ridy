<?php

namespace Tests\Unit;

use Tests\TestCase;

/**
 * `config/webauthn.php` is read from the environment at boot, so it is
 * re-evaluated here against a controlled $_SERVER (the repository env()
 * reads first) instead of the booted app's values.
 */
class WebauthnConfigTest extends TestCase
{
    /** @var array<string, string|null> */
    private array $savedServer = [];

    protected function setUp(): void
    {
        parent::setUp();

        foreach (['APP_URL', 'WEBAUTHN_ORIGINS', 'WEBAUTHN_RP_ID'] as $key) {
            $this->savedServer[$key] = $_SERVER[$key] ?? null;
        }
    }

    protected function tearDown(): void
    {
        foreach ($this->savedServer as $key => $value) {
            if ($value === null) {
                unset($_SERVER[$key]);
            } else {
                $_SERVER[$key] = $value;
            }
        }

        parent::tearDown();
    }

    /** @return array<string, mixed> */
    private function configWith(array $env): array
    {
        foreach ($env as $key => $value) {
            if ($value === null) {
                unset($_SERVER[$key]);
            } else {
                $_SERVER[$key] = $value;
            }
        }

        return require config_path('webauthn.php');
    }

    public function test_app_url_is_the_only_origin_by_default(): void
    {
        $config = $this->configWith(['APP_URL' => 'https://reidey.de', 'WEBAUTHN_ORIGINS' => null]);

        $this->assertSame(['https://reidey.de'], $config['origins']);
        $this->assertSame('reidey.de', $config['rp_id']);
    }

    public function test_extra_origins_add_to_app_url_and_never_replace_it(): void
    {
        // B1: a dev frontend port or the Android signing-cert origins must not
        // silently drop the dashboard's (and iOS's) own origin.
        $config = $this->configWith([
            'APP_URL' => 'https://reidey.de',
            'WEBAUTHN_ORIGINS' => ' http://localhost:3000 , android:apk-key-hash:AbCd_-12 ,, https://reidey.de ',
        ]);

        $this->assertSame(
            ['http://localhost:3000', 'android:apk-key-hash:AbCd_-12', 'https://reidey.de'],
            $config['origins'],
        );
    }

    public function test_an_explicit_rp_id_wins_over_the_app_url_host(): void
    {
        $config = $this->configWith(['APP_URL' => 'https://api.reidey.de', 'WEBAUTHN_RP_ID' => 'reidey.de']);

        $this->assertSame('reidey.de', $config['rp_id']);
    }
}
