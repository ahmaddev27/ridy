<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PruneSubmissionPhotosTest extends TestCase
{
    use RefreshDatabase;

    private Driver $driver;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $tenant = Tenant::create([
            'name' => 'YA', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($tenant->id);
        $this->driver = Driver::create([
            'tenant_id' => $tenant->id, 'name' => 'Omar', 'email' => 'o@x.de', 'pseudonym_id' => 'p',
        ]);
    }

    private function row(string $path, $fetchedAt, bool $putFile = true): ElProfessorSubmission
    {
        if ($putFile) {
            Storage::disk('local')->put($path, 'bytes');
        }

        return ElProfessorSubmission::create([
            'tenant_id' => $this->driver->tenant_id, 'driver_id' => $this->driver->id, 'subject' => 'receipt',
            'status' => $fetchedAt ? 'taken' : 'pending', 'payload' => ['amount' => '1.00'],
            'document_path' => $path, 'document_mime' => 'image/jpeg', 'document_bytes' => 5,
            'fetched_at' => $fetchedAt,
        ]);
    }

    public function test_a_photo_past_the_window_goes_but_the_row_and_numbers_stay(): void
    {
        $old = $this->row('e/old.jpg', now()->subMinutes(121));

        $this->artisan('elprofessor:prune-photos')->assertSuccessful();

        Storage::disk('local')->assertMissing('e/old.jpg');
        $old->refresh();
        $this->assertNull($old->document_path);
        $this->assertSame(5, (int) $old->document_bytes);
        $this->assertSame(['amount' => '1.00'], $old->payload);
    }

    public function test_inside_the_window_and_never_fetched_are_untouched(): void
    {
        $fresh = $this->row('e/fresh.jpg', now()->subMinutes(100));
        $never = $this->row('e/never.jpg', null);

        $this->artisan('elprofessor:prune-photos')->assertSuccessful();

        Storage::disk('local')->assertExists(['e/fresh.jpg', 'e/never.jpg']);
        $this->assertSame('e/fresh.jpg', $fresh->refresh()->document_path);
        $this->assertSame('e/never.jpg', $never->refresh()->document_path);
    }

    public function test_a_file_already_gone_does_not_fail_the_run_and_the_window_is_configurable(): void
    {
        $gone = $this->row('e/gone.jpg', now()->subMinutes(121), putFile: false);
        $other = $this->row('e/other.jpg', now()->subMinutes(150));

        $this->artisan('elprofessor:prune-photos')->assertSuccessful();
        $this->assertNull($gone->refresh()->document_path);
        $this->assertNull($other->refresh()->document_path);

        config(['elprofessor.photo_retention_minutes' => 240]);
        $late = $this->row('e/late.jpg', now()->subMinutes(150));
        $this->artisan('elprofessor:prune-photos')->assertSuccessful();
        $this->assertSame('e/late.jpg', $late->refresh()->document_path);
    }
}
