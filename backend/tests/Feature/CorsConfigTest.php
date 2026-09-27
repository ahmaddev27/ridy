<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * config/cors.php must never open credentialed CORS to every browser extension
 * in production, whether or not the published extension id is configured.
 */
class CorsConfigTest extends TestCase
{
    /** @var array<string, string|false> */
    private array $saved = [];

    protected function tearDown(): void
    {
        foreach ($this->saved as $key => $value) {
            $this->setEnv($key, $value === false ? null : $value);
        }
        parent::tearDown();
    }

    private function setEnv(string $key, ?string $value): void
    {
        if (! array_key_exists($key, $this->saved)) {
            $this->saved[$key] = getenv($key);
        }

        if ($value === null) {
            unset($_SERVER[$key], $_ENV[$key]);
            putenv($key);

            return;
        }

        $_SERVER[$key] = $_ENV[$key] = $value;
        putenv("{$key}={$value}");
    }

    /** @return array<string, mixed> */
    private function corsConfigFor(string $appEnv, ?string $extensionOrigin): array
    {
        $this->setEnv('APP_ENV', $appEnv);
        $this->setEnv('EXTENSION_ORIGIN', $extensionOrigin);

        return require config_path('cors.php');
    }

    public function test_production_without_extension_origin_fails_closed(): void
    {
        $config = $this->corsConfigFor('production', null);

        $this->assertSame([], $config['allowed_origins_patterns']);
    }

    public function test_production_with_extension_origin_allows_exactly_that_origin(): void
    {
        $origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
        $config = $this->corsConfigFor('production', $origin);

        $this->assertSame([], $config['allowed_origins_patterns']);
        $this->assertContains($origin, $config['allowed_origins']);
    }

    public function test_local_without_extension_origin_keeps_the_dev_patterns(): void
    {
        $config = $this->corsConfigFor('local', null);

        $this->assertNotEmpty($config['allowed_origins_patterns']);
    }
}
