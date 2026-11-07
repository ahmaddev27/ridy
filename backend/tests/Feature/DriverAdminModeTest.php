<?php

namespace Tests\Feature;

use App\Domain\Dispatch\Models\DispatchOffer;
use App\Domain\Dispatch\OfferStatus;
use App\Domain\Fleet\Models\Driver;
use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Domain\Notifications\Contracts\PushSender;
use App\Domain\Notifications\DispatchNotifier;
use App\Domain\Notifications\Models\DeviceToken;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Jobs\RingElProfessor;
use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** Phase B: an owner who also drives reads the whole company and files Belege via driver/admin/*. */
class DriverAdminModeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Tenant $other;

    private User $owner;

    private Driver $me;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RolePermissionSeeder::class);
        $this->tenant = $this->makeTenant('Acme');
        $this->other = $this->makeTenant('Other');
        app(TenantContext::class)->set($this->tenant->id);
        $this->owner = $this->user($this->tenant, 'owner', 'boss@acme.de');
        $this->me = $this->driver($this->tenant, 'Zed Boss');
        $this->link($this->owner, $this->me);
    }

    private function makeTenant(string $name): Tenant
    {
        return Tenant::create([
            'name' => $name, 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
    }

    private function user(Tenant $tenant, string $role, string $email): User
    {
        $user = User::create(['name' => 'U', 'email' => $email, 'password' => Hash::make('x'), 'tenant_id' => $tenant->id]);
        $user->assignRole($role);

        return $user;
    }

    private function driver(Tenant $tenant, string $name): Driver
    {
        return Driver::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'name' => $name, 'uber_driver_uuid' => 'u-'.uniqid(),
        ]);
    }

    private function link(User $owner, Driver $driver): void
    {
        Sanctum::actingAs($owner);
        $this->patchJson("/api/v1/drivers/{$driver->id}/owner-link", ['linked' => true])->assertOk();
        $this->app['auth']->forgetGuards();
    }

    private function asDriver(Driver $driver): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(Driver::withoutGlobalScopes()->findOrFail($driver->id), [], 'driver');
    }

    private function offer(Tenant $tenant, ?Driver $driver): DispatchOffer
    {
        return DispatchOffer::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'driver_id' => $driver?->id, 'driver_uuid' => 'u1',
            'offer_uuid' => 'o'.uniqid(), 'fare_amount' => 10, 'received_at' => now(),
            'raw_payload' => [], 'status' => OfferStatus::Pending,
        ]);
    }

    private function connectElProfessor(): void
    {
        $manager = $this->user($this->tenant, 'fleet_manager', 'm@acme.de');
        $this->tenant->setElprofessorEnabled(true);
        Sanctum::actingAs($manager, ['*']);
        $token = $this->postJson('/api/v1/elprofessor/token')->assertOk()->json('data.token');
        $this->app['auth']->forgetGuards();
        $this->withHeaders(['Authorization' => 'Bearer '.$token])->getJson('/api/v1/elprofessor/fleet')->assertOk();
        $this->app['auth']->forgetGuards();
    }

    /** @return array<string, mixed> */
    private function receipt(int $driverId): array
    {
        return [
            'driver_id' => $driverId, 'receipt_date' => '2026-11-04', 'amount' => '41.47',
            'category' => 'Tanken', 'payment_method' => 'bar', 'merchant_name' => 'Aral',
        ];
    }

    public function test_admin_sees_every_drivers_offers_and_stats_but_not_another_companys(): void
    {
        $colleague = $this->driver($this->tenant, 'Omar');
        $mine = $this->offer($this->tenant, $colleague);
        $foreign = $this->offer($this->other, $this->driver($this->other, 'Fred'));
        $this->asDriver($this->me);

        $ids = collect($this->getJson('/api/v1/driver/admin/offers')->assertOk()->json('data'))->pluck('id');
        $this->assertTrue($ids->contains($mine->id));
        $this->assertFalse($ids->contains($foreign->id));
        $this->getJson("/api/v1/driver/admin/offers/{$mine->id}")->assertOk();
        $this->getJson("/api/v1/driver/admin/offers/{$foreign->id}")->assertNotFound();
        $this->getJson('/api/v1/driver/admin/stats')->assertOk();
        $this->getJson('/api/v1/driver/admin/home')->assertOk();
    }

    public function test_drivers_picker_flags_and_sorts_the_callers_own_row_first(): void
    {
        $this->driver($this->tenant, 'Aaron');
        $this->driver($this->other, 'Fred');
        $this->asDriver($this->me);

        $rows = $this->getJson('/api/v1/driver/admin/drivers')->assertOk()->json('data');

        $this->assertCount(2, $rows);
        $this->assertSame($this->me->id, $rows[0]['id']);
        $this->assertTrue($rows[0]['is_me']);
        $this->assertFalse($rows[1]['is_me']);
    }

    public function test_admin_reads_every_drivers_submissions(): void
    {
        $colleague = $this->driver($this->tenant, 'Omar');
        $row = ElProfessorSubmission::create([
            'tenant_id' => $this->tenant->id, 'driver_id' => $colleague->id, 'subject' => 'receipt',
            'status' => ElProfessorSubmission::STATUS_PENDING, 'payload' => ['amount' => '1.00'],
        ]);
        $this->asDriver($this->me);

        $this->getJson('/api/v1/driver/admin/submissions')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson("/api/v1/driver/admin/submissions/{$row->uuid}")->assertOk();
    }

    public function test_admin_files_a_receipt_for_a_colleague_and_for_himself(): void
    {
        Queue::fake();
        $this->connectElProfessor();
        $omar = $this->driver($this->tenant, 'Omar');
        $this->asDriver($this->me);

        $this->postJson('/api/v1/driver/admin/submissions', $this->receipt($omar->id))->assertCreated();
        $this->postJson('/api/v1/driver/admin/submissions', $this->receipt($this->me->id))->assertCreated();

        $this->assertEqualsCanonicalizing(
            [$omar->id, $this->me->id],
            ElProfessorSubmission::withoutGlobalScopes()->pluck('driver_id')->all(),
        );
        Queue::assertPushed(RingElProfessor::class, 2);
    }

    public function test_a_cross_tenant_driver_id_is_404(): void
    {
        Queue::fake();
        $this->connectElProfessor();
        $foreign = $this->driver($this->other, 'Fred');
        $this->asDriver($this->me);

        $this->postJson('/api/v1/driver/admin/submissions', $this->receipt($foreign->id))->assertNotFound();
        $this->assertSame(0, ElProfessorSubmission::withoutGlobalScopes()->count());
    }

    public function test_an_unlinked_manager_driver_gets_admin_revoked(): void
    {
        $manager = $this->driver($this->tenant, 'Mia');
        $manager->forceFill(['is_manager' => true])->save();
        $this->asDriver($manager);

        $this->getJson('/api/v1/driver/admin/offers')->assertForbidden()->assertJsonPath('message', 'admin_revoked');
        $this->getJson('/api/v1/driver/admin/drivers')->assertForbidden();
    }

    public function test_a_plain_driver_is_forbidden(): void
    {
        $this->asDriver($this->driver($this->tenant, 'Omar'));

        $this->getJson('/api/v1/driver/admin/offers')->assertForbidden();
        $this->postJson('/api/v1/driver/admin/submissions', $this->receipt($this->me->id))->assertForbidden();
    }

    public function test_a_demoted_owner_is_forbidden_on_the_next_request(): void
    {
        $this->asDriver($this->me);
        $this->getJson('/api/v1/driver/admin/offers')->assertOk();

        $this->owner->syncRoles([]);
        $this->asDriver($this->me);

        $this->getJson('/api/v1/driver/admin/offers')->assertForbidden()->assertJsonPath('message', 'admin_revoked');
    }

    public function test_a_suspended_company_is_blocked(): void
    {
        $this->tenant->forceFill(['status' => 'disabled'])->save();
        $this->asDriver($this->me);

        $this->getJson('/api/v1/driver/admin/offers')->assertForbidden()->assertJsonPath('message', 'account_suspended');
    }

    public function test_the_owner_user_token_cannot_call_admin_but_still_uses_fleet(): void
    {
        $this->app['auth']->forgetGuards();
        $auth = ['Authorization' => 'Bearer '.$this->owner->createToken('t', ['fleet:read'])->plainTextToken];

        $this->getJson('/api/v1/driver/fleet/offers', $auth)->assertOk();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/driver/admin/offers', $auth)->assertUnauthorized();
    }

    public function test_the_linked_drivers_device_is_skipped_by_the_owner_fanout(): void
    {
        $this->asDriver($this->me);
        $this->postJson('/api/v1/driver/devices', ['token' => 'dev-me', 'platform' => 'android'])->assertSuccessful();
        $device = DeviceToken::withoutGlobalScopes()->where('token', 'dev-me')->sole();
        $this->assertNull($device->user_id);
        $this->assertSame($this->me->id, $device->driver_id);

        $offer = $this->offer($this->tenant, $this->me);
        $spy = new class implements PushSender
        {
            public array $calls = [];

            public function send(string $deviceToken, string $title, string $body, array $data = []): bool
            {
                $this->calls[] = $deviceToken;

                return true;
            }
        };
        $notifier = new DispatchNotifier($spy);

        $this->assertSame(0, $notifier->notifyOwners($offer));
        $this->assertSame(1, $notifier->notify($offer));
        $this->assertSame(['dev-me'], $spy->calls);
    }
}
