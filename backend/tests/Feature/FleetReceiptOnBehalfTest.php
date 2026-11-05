<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Jobs\RingElProfessor;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** A manager files a Beleg for one of THEIR drivers, through the shared recorder. */
class FleetReceiptOnBehalfTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Tenant $other;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = $this->makeTenant('YA Mobility');
        $this->other = $this->makeTenant('Other Fleet');
        app(TenantContext::class)->set($this->tenant->id);
    }

    private function makeTenant(string $name): Tenant
    {
        return Tenant::create([
            'name' => $name, 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
    }

    private function driver(Tenant $tenant, string $name): Driver
    {
        return Driver::create([
            'tenant_id' => $tenant->id, 'name' => $name, 'email' => strtolower($name).'@x.de',
            'phone' => '+49170', 'employment_type' => 'employee', 'pseudonym_id' => 'p-'.$name,
        ]);
    }

    private function manager(Tenant $tenant, string $email): User
    {
        $user = User::create([
            'name' => 'Owner', 'email' => $email,
            'password' => Hash::make('secret123'), 'tenant_id' => $tenant->id,
        ]);
        $user->assignRole('fleet_manager');

        return $user;
    }

    private function connect(Tenant $tenant, User $manager): void
    {
        $tenant->setElprofessorEnabled(true);
        Sanctum::actingAs($manager, ['*']);
        $token = $this->postJson('/api/v1/elprofessor/token')->assertOk()->json('data.token');
        $this->app['auth']->forgetGuards();
        $this->withHeaders(['Authorization' => 'Bearer '.$token])->getJson('/api/v1/elprofessor/fleet')->assertOk();
        $this->app['auth']->forgetGuards();
    }

    private function actingAsOwner(User $owner): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::findOrFail($owner->id), ['fleet:read']);
    }

    /** @return array<string, mixed> */
    private function receipt(int $driverId): array
    {
        return [
            'driver_id' => $driverId, 'receipt_date' => '2026-11-04', 'amount' => '41.47',
            'category' => 'Tanken', 'payment_method' => 'bar', 'merchant_name' => 'Aral',
        ];
    }

    public function test_a_manager_files_a_receipt_under_their_driver(): void
    {
        Queue::fake();
        $manager = $this->manager($this->tenant, 'm@ya.de');
        $this->connect($this->tenant, $manager);
        $omar = $this->driver($this->tenant, 'Omar');

        $this->actingAsOwner($manager);
        $this->postJson('/api/v1/driver/fleet/submissions', $this->receipt($omar->id))
            ->assertCreated()->assertJsonPath('data.subject', 'receipt');

        $row = ElProfessorSubmission::withoutGlobalScopes()->firstOrFail();
        $this->assertSame($omar->id, $row->driver_id);
        $this->assertSame($this->tenant->id, $row->tenant_id);
        $this->assertSame('41.47', $row->payload['amount']);
        $this->assertArrayNotHasKey('driver_id', $row->payload);
        Queue::assertPushed(RingElProfessor::class);
    }

    public function test_an_attached_photo_is_never_stored(): void
    {
        Queue::fake();
        Storage::fake('local');
        $manager = $this->manager($this->tenant, 'm@ya.de');
        $this->connect($this->tenant, $manager);
        $omar = $this->driver($this->tenant, 'Omar');

        $this->actingAsOwner($manager);
        $this->post('/api/v1/driver/fleet/submissions', $this->receipt($omar->id) + [
            'document' => UploadedFile::fake()->image('beleg.jpg'),
        ], ['Accept' => 'application/json'])->assertCreated();

        $row = ElProfessorSubmission::withoutGlobalScopes()->firstOrFail();
        $this->assertNull($row->document_path);
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_another_companys_driver_is_the_same_404_as_a_missing_one(): void
    {
        Queue::fake();
        $manager = $this->manager($this->tenant, 'm@ya.de');
        $this->connect($this->tenant, $manager);
        $foreign = $this->driver($this->other, 'Fred');

        $this->actingAsOwner($manager);
        $this->postJson('/api/v1/driver/fleet/submissions', $this->receipt($foreign->id))->assertNotFound();
        $this->postJson('/api/v1/driver/fleet/submissions', $this->receipt(999999))->assertNotFound();
        $this->assertSame(0, ElProfessorSubmission::withoutGlobalScopes()->count());
    }

    public function test_an_unconnected_company_is_refused_with_the_stable_reason(): void
    {
        Queue::fake();
        $manager = $this->manager($this->tenant, 'm@ya.de');
        $omar = $this->driver($this->tenant, 'Omar');

        $this->actingAsOwner($manager);
        $this->postJson('/api/v1/driver/fleet/submissions', $this->receipt($omar->id))
            ->assertForbidden()->assertJsonPath('reason', 'not_connected');
    }

    public function test_a_driver_token_cannot_use_the_manager_endpoint_and_notes_are_not_filed(): void
    {
        $omar = $this->driver($this->tenant, 'Omar');
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(Driver::withoutGlobalScopes()->findOrFail($omar->id), guard: 'driver');
        $this->postJson('/api/v1/driver/fleet/submissions', $this->receipt($omar->id))->assertUnauthorized();

        $manager = $this->manager($this->tenant, 'm@ya.de');
        $this->connect($this->tenant, $manager);
        $this->actingAsOwner($manager);
        $this->postJson('/api/v1/driver/fleet/submissions', [
            'driver_id' => $omar->id, 'subject' => 'note', 'note_type' => 'general', 'note_text' => 'x',
        ])->assertStatus(422);
    }

    public function test_the_same_validation_applies_and_a_driver_is_required(): void
    {
        $manager = $this->manager($this->tenant, 'm@ya.de');
        $this->connect($this->tenant, $manager);
        $omar = $this->driver($this->tenant, 'Omar');

        $this->actingAsOwner($manager);
        $this->postJson('/api/v1/driver/fleet/submissions', ['receipt_date' => '2026-11-04', 'amount' => '1', 'category' => 'Tanken'])
            ->assertStatus(422)->assertJsonValidationErrors('driver_id');
        $this->postJson('/api/v1/driver/fleet/submissions', ['driver_id' => $omar->id, 'receipt_date' => '2026-11-04', 'amount' => '1,5', 'category' => 'Tanken'])
            ->assertStatus(422)->assertJsonValidationErrors('amount');
    }

    public function test_the_postal_lookup_and_vision_poll_are_reachable_but_tenant_checked(): void
    {
        $manager = $this->manager($this->tenant, 'm@ya.de');
        $foreign = $this->driver($this->other, 'Fred');

        $this->actingAsOwner($manager);
        $this->getJson('/api/v1/driver/fleet/postal-codes/00000')->assertNotFound();
        $this->getJson('/api/v1/driver/fleet/receipt-vision/'.Str::uuid().'?driver_id='.$foreign->id)
            ->assertNotFound();
    }
}
