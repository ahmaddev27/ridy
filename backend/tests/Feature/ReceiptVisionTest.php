<?php

namespace Tests\Feature;

use App\Domain\Fleet\Models\Driver;
use App\Domain\Receipts\ReceiptVision;
use App\Domain\Receipts\ReceiptVisionJobs;
use App\Domain\Receipts\ReceiptVisionSanitizer;
use App\Domain\Tenancy\Models\Tenant;
use App\Domain\Tenancy\TenantContext;
use App\Jobs\ProcessReceiptVision;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ReceiptVisionTest extends TestCase
{
    use RefreshDatabase;

    private function jpeg(int $w = 2000, int $h = 3000): string
    {
        $im = imagecreatetruecolor($w, $h);
        ob_start();
        imagejpeg($im);

        return (string) ob_get_clean();
    }

    private function modelReply(array $fields): array
    {
        return ['choices' => [['message' => ['content' => json_encode($fields)]]]];
    }

    /** @return array<string, mixed> */
    private function shell(): array
    {
        return [
            'station_name' => 'Shell', 'street' => 'Hauptstr. 1', 'postal_code' => '40210', 'city' => 'Duesseldorf',
            'date' => now('Europe/Berlin')->toDateString(), 'time' => '16:47',
            'liters' => '21.94', 'price_per_liter' => '2.279 EUR/1', 'total_amount' => '50.00 BRUTTO',
            'receipt_number' => '123', 'station_number' => null,
        ];
    }

    private function driver(): Driver
    {
        $tenant = Tenant::create([
            'name' => 'T', 'country' => 'DE', 'status' => 'active',
            'activated_at' => now(), 'subscription_ends_at' => now()->addMonth(),
        ]);
        app(TenantContext::class)->set($tenant->id);
        $driver = Driver::create([
            'tenant_id' => $tenant->id, 'name' => 'Omar', 'email' => 'omar@x.de',
            'phone' => '+49170', 'employment_type' => 'employee', 'pseudonym_id' => 'p-omar',
        ]);
        $this->app['auth']->forgetGuards();
        $driver = Driver::withoutGlobalScopes()->findOrFail($driver->id);
        Sanctum::actingAs($driver, guard: 'driver');

        return $driver;
    }

    public function test_the_service_posts_a_downscaled_json_object_request_and_sanitises_the_reply(): void
    {
        DB::table('postal_codes')->updateOrInsert(['plz' => '40210'], ['city' => 'Düsseldorf', 'lat' => 51.2, 'lng' => 6.7]);
        config(['services.receipt_vision.url' => 'http://vision:8080', 'services.receipt_vision.max_edge' => 1000]);
        Http::fake(['vision:8080/*' => Http::response($this->modelReply($this->shell()))]);

        $fields = app(ReceiptVision::class)->read($this->jpeg());

        $this->assertSame(50.0, $fields['amount']);
        $this->assertSame(21.94, $fields['litres']);
        $this->assertSame(2.279, $fields['price_per_litre']);
        $this->assertSame('Düsseldorf', $fields['city']);
        $this->assertTrue($fields['city_from_plz']);
        $this->assertSame('Tanken', $fields['category']);

        Http::assertSent(function ($request) {
            $body = $request->data();
            $uri = $body['messages'][0]['content'][1]['image_url']['url'];
            $img = getimagesizefromstring(base64_decode(substr($uri, strlen('data:image/jpeg;base64,'))));

            return $body['response_format'] === ['type' => 'json_object']
                && $body['max_tokens'] === 512 && $body['temperature'] === 0
                && max($img[0], $img[1]) === 1000;
        });
    }

    public function test_inconsistent_fuel_math_drops_the_fuel_line_instead_of_guessing(): void
    {
        $raw = $this->shell();
        $raw['liters'] = '31.94';

        $fields = (new ReceiptVisionSanitizer)->sanitize($raw);

        $this->assertNull($fields['litres']);
        $this->assertNull($fields['price_per_litre']);
        $this->assertSame(50.0, $fields['amount']);
        $this->assertSame(['fuel_math'], $fields['warnings']);
    }

    public function test_numbers_dates_and_times_are_cleaned(): void
    {
        $s = new ReceiptVisionSanitizer;
        $this->assertSame(1234.56, $s->number('1.234,56 EUR', 0, 5000));
        $this->assertNull($s->number('abc', 0, 5000));
        $this->assertNull($s->number('9999', 0, 1000));

        $fields = $s->sanitize(['date' => '2020-01-01', 'time' => '25:99'], CarbonImmutable::parse('2026-10-31'));
        $this->assertNull($fields['date']);
        $this->assertNull($fields['time']);
        $this->assertSame('2026-10-30', $s->sanitize(['date' => '30.10.2026'], CarbonImmutable::parse('2026-10-31'))['date']);
    }

    public function test_upload_acks_then_the_job_parses_and_deletes_the_image(): void
    {
        Storage::fake('local');
        config(['services.receipt_vision.url' => 'http://vision:8080']);
        Http::fake(['vision:8080/*' => Http::response($this->modelReply($this->shell()))]);
        $driver = $this->driver();
        Bus::fake();

        $id = $this->postJson('/api/v1/driver/receipt-vision', ['image' => UploadedFile::fake()->createWithContent('b.jpg', $this->jpeg(400, 600))])
            ->assertStatus(202)->json('data.id');

        Bus::assertDispatched(ProcessReceiptVision::class);
        $this->getJson("/api/v1/driver/receipt-vision/{$id}")->assertOk()->assertJsonPath('data.status', 'pending');
        Storage::disk('local')->assertExists("receipt-vision-tmp/{$id}.bin");

        (new ProcessReceiptVision($driver->id, $id))->handle(app(ReceiptVision::class), app(ReceiptVisionJobs::class));

        $this->getJson("/api/v1/driver/receipt-vision/{$id}")
            ->assertOk()->assertJsonPath('data.status', 'done')->assertJsonPath('data.fields.amount', 50);
        Storage::disk('local')->assertMissing("receipt-vision-tmp/{$id}.bin");
    }

    public function test_a_model_failure_is_reported_failed_and_the_image_is_still_deleted(): void
    {
        Storage::fake('local');
        config(['services.receipt_vision.url' => 'http://vision:8080']);
        Http::fake(['vision:8080/*' => Http::response('boom', 500)]);
        $driver = $this->driver();
        $jobs = app(ReceiptVisionJobs::class);
        $id = $jobs->begin($driver->id, $this->jpeg(300, 300));

        (new ProcessReceiptVision($driver->id, $id))->handle(app(ReceiptVision::class), $jobs);

        $this->assertSame('failed', $jobs->status($driver->id, $id)['status']);
        Storage::disk('local')->assertMissing("receipt-vision-tmp/{$id}.bin");
    }

    public function test_it_is_503_when_not_configured_and_a_job_is_private_to_its_driver(): void
    {
        Storage::fake('local');
        config(['services.receipt_vision.url' => '']);
        $driver = $this->driver();

        $this->postJson('/api/v1/driver/receipt-vision', ['image' => UploadedFile::fake()->createWithContent('b.jpg', $this->jpeg(100, 100))])
            ->assertStatus(503);

        $id = app(ReceiptVisionJobs::class)->begin($driver->id + 999, $this->jpeg(100, 100));
        $this->getJson("/api/v1/driver/receipt-vision/{$id}")->assertNotFound();
    }
}
