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

/**
 * Two rules about who may READ submissions:
 *
 *  - a driver keeps his archive when the company disconnects (only sending stops);
 *  - the fleet owner reads every driver's submissions of HIS tenant, read-only.
 */
class SubmissionArchiveAndFleetReportTest extends TestCase
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

    private function owner(Tenant $tenant, string $email): User
    {
        $user = User::create([
            'name' => 'Owner', 'email' => $email,
            'password' => Hash::make('secret123'), 'tenant_id' => $tenant->id,
        ]);
        $user->assignRole('fleet_manager');

        return $user;
    }

    /** Connect for real: mint a token and let El-Professor use it once. */
    private function connect(Tenant $tenant, User $manager): void
    {
        $tenant->setElprofessorEnabled(true);
        Sanctum::actingAs($manager, ['*']);
        $token = $this->postJson('/api/v1/elprofessor/token')->assertOk()->json('data.token');
        $this->app['auth']->forgetGuards();
        $this->withHeaders(['Authorization' => 'Bearer '.$token])->getJson('/api/v1/elprofessor/fleet')->assertOk();
        $this->app['auth']->forgetGuards();
    }

    private function disconnect(User $manager): void
    {
        Sanctum::actingAs($manager, ['*']);
        $this->deleteJson('/api/v1/elprofessor/token')->assertOk();
        $this->app['auth']->forgetGuards();
    }

    private function actingAsDriver(Driver $driver): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(Driver::withoutGlobalScopes()->findOrFail($driver->id), guard: 'driver');
    }

    private function actingAsOwner(User $owner): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::findOrFail($owner->id), ['fleet:read']);
    }

    private function submission(Tenant $tenant, Driver $driver, array $attributes = []): ElProfessorSubmission
    {
        return ElProfessorSubmission::create(array_merge([
            'tenant_id' => $tenant->id, 'driver_id' => $driver->id, 'subject' => 'receipt',
            'status' => ElProfessorSubmission::STATUS_PENDING,
            'payload' => ['amount' => '41.47', 'category' => 'Tanken', 'merchant_name' => 'Aral'],
        ], $attributes));
    }

    // ── Part A: the archive outlives the connection ──────────────────────────

    public function test_a_disconnected_company_still_serves_the_drivers_archive_but_refuses_to_receive(): void
    {
        Storage::fake('local');
        Queue::fake();
        $manager = $this->owner($this->tenant, 'm@ya.de');
        $this->connect($this->tenant, $manager);
        $driver = $this->driver($this->tenant, 'Omar');
        Storage::disk('local')->put('elprofessor/beleg.jpg', 'bytes');
        $row = $this->submission($this->tenant, $driver, [
            'document_path' => 'elprofessor/beleg.jpg', 'document_mime' => 'image/jpeg', 'document_bytes' => 5,
        ]);

        $this->disconnect($manager);
        $this->actingAsDriver($driver);

        $this->getJson('/api/v1/driver/submissions')->assertOk()->assertJsonPath('data.0.id', $row->uuid);
        $this->getJson('/api/v1/driver/submissions/'.$row->uuid)->assertOk()->assertJsonPath('data.id', $row->uuid);

        $this->postJson('/api/v1/driver/submissions', [
            'subject' => 'receipt', 'receipt_date' => '2026-10-07', 'amount' => '41.47',
            'category' => 'Tanken', 'document' => UploadedFile::fake()->image('b.jpg'),
        ])->assertStatus(403)->assertJsonPath('reason', 'not_connected');
        $this->getJson('/api/v1/driver/vehicles')->assertStatus(403)->assertJsonPath('reason', 'not_connected');

        $this->assertSame(1, ElProfessorSubmission::withoutGlobalScopes()->count());
        Queue::assertNotPushed(RingElProfessor::class);
    }

    public function test_the_profile_separates_may_send_from_may_view(): void
    {
        $manager = $this->owner($this->tenant, 'm@ya.de');
        $sender = $this->driver($this->tenant, 'Omar');
        $never = $this->driver($this->tenant, 'Nora');

        // Never connected: nobody may send, and only the one with history may view.
        $this->submission($this->tenant, $sender);
        $this->actingAsDriver($never);
        $this->getJson('/api/v1/driver/me')
            ->assertJsonPath('data.documents_enabled', false)
            ->assertJsonPath('data.documents_readable', false);
        $this->actingAsDriver($sender);
        $this->getJson('/api/v1/driver/me')
            ->assertJsonPath('data.documents_enabled', false)
            ->assertJsonPath('data.documents_readable', true);

        // Connected: both may view, both may send.
        $this->connect($this->tenant, $manager);
        $this->actingAsDriver($never);
        $this->getJson('/api/v1/driver/me')
            ->assertJsonPath('data.documents_enabled', true)
            ->assertJsonPath('data.documents_readable', true);
    }

    public function test_both_owner_payloads_say_an_owner_neither_sends_nor_reads_as_a_driver(): void
    {
        $manager = $this->owner($this->tenant, 'm@ya.de');
        $this->connect($this->tenant, $manager);

        $this->actingAsOwner($manager);
        $this->getJson('/api/v1/driver/fleet/me')
            ->assertOk()
            ->assertJsonPath('data.documents_enabled', false)
            ->assertJsonPath('data.documents_readable', false);
    }

    // ── Part B: the owner reads the tenant's submissions ─────────────────────

    public function test_an_owner_lists_every_drivers_submissions_with_who_sent_them_and_nothing_foreign(): void
    {
        $owner = $this->owner($this->tenant, 'o@ya.de');
        $mine = $this->submission($this->tenant, $this->driver($this->tenant, 'Omar'));
        $mine2 = $this->submission($this->tenant, $this->driver($this->tenant, 'Lena'), ['subject' => 'note', 'payload' => ['note_text' => 'x']]);
        $this->submission($this->other, $this->driver($this->other, 'Theirs'));

        $this->actingAsOwner($owner);
        $res = $this->getJson('/api/v1/driver/fleet/submissions')->assertOk();

        $this->assertEqualsCanonicalizing([$mine->uuid, $mine2->uuid], array_column($res->json('data'), 'id'));
        $byId = collect($res->json('data'))->keyBy('id');
        $this->assertSame('Omar', $byId[$mine->uuid]['driver']['name']);
        $this->assertSame('Lena', $byId[$mine2->uuid]['driver']['name']);
        $res->assertJsonPath('meta.has_more', false);
    }

    public function test_the_owner_list_is_paged(): void
    {
        $owner = $this->owner($this->tenant, 'o@ya.de');
        $driver = $this->driver($this->tenant, 'Omar');
        for ($i = 0; $i < 51; $i++) {
            $this->submission($this->tenant, $driver);
        }

        $this->actingAsOwner($owner);
        $first = $this->getJson('/api/v1/driver/fleet/submissions')->assertOk();
        $this->assertCount(50, $first->json('data'));
        $first->assertJsonPath('meta.has_more', true);
        $this->assertCount(1, $this->getJson('/api/v1/driver/fleet/submissions?page=2')->json('data'));
    }

    public function test_an_owner_opens_one_in_full_with_the_photo_metadata_only(): void
    {
        Storage::fake('local');
        $owner = $this->owner($this->tenant, 'o@ya.de');
        Storage::disk('local')->put('elprofessor/b.jpg', 'bytes');
        $row = $this->submission($this->tenant, $this->driver($this->tenant, 'Omar'), [
            'document_path' => 'elprofessor/b.jpg', 'document_mime' => 'image/jpeg', 'document_bytes' => 5,
        ]);

        $this->actingAsOwner($owner);
        $this->getJson('/api/v1/driver/fleet/submissions/'.$row->uuid)
            ->assertOk()
            ->assertJsonPath('data.id', $row->uuid)
            ->assertJsonPath('data.driver.name', 'Omar')
            ->assertJsonPath('data.document.available', true);
    }

    public function test_another_tenants_submission_is_the_same_404_as_an_unknown_uuid(): void
    {
        Storage::fake('local');
        $owner = $this->owner($this->tenant, 'o@ya.de');
        Storage::disk('local')->put('elprofessor/t.jpg', 'bytes');
        $theirs = $this->submission($this->other, $this->driver($this->other, 'Theirs'), [
            'document_path' => 'elprofessor/t.jpg', 'document_mime' => 'image/jpeg', 'document_bytes' => 5,
        ]);

        $this->actingAsOwner($owner);
        $foreign = $this->getJson('/api/v1/driver/fleet/submissions/'.$theirs->uuid);
        $unknown = $this->getJson('/api/v1/driver/fleet/submissions/'.Str::uuid());
        $foreign->assertNotFound();
        $this->assertSame($unknown->getContent(), $foreign->getContent());
    }

    public function test_there_is_no_owner_write_path(): void
    {
        $owner = $this->owner($this->tenant, 'o@ya.de');
        $this->actingAsOwner($owner);

        $this->postJson('/api/v1/driver/fleet/submissions', ['subject' => 'note'])->assertStatus(405);
        $this->assertSame(0, ElProfessorSubmission::withoutGlobalScopes()->count());
    }

    public function test_a_driver_token_cannot_reach_the_fleet_routes_and_an_owner_token_cannot_reach_the_driver_ones(): void
    {
        $owner = $this->owner($this->tenant, 'o@ya.de');
        $driver = $this->driver($this->tenant, 'Omar');
        $row = $this->submission($this->tenant, $driver);

        $this->actingAsDriver($driver);
        $this->assertContains($this->getJson('/api/v1/driver/fleet/submissions')->status(), [401, 403]);
        $this->assertContains($this->getJson('/api/v1/driver/fleet/submissions/'.$row->uuid)->status(), [401, 403]);

        $this->actingAsOwner($owner);
        $this->assertContains($this->getJson('/api/v1/driver/submissions')->status(), [401, 403]);
        $this->assertContains($this->getJson('/api/v1/driver/submissions/'.$row->uuid)->status(), [401, 403]);
    }
}
