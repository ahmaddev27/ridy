<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EmailTemplateTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $this->seed(RolePermissionSeeder::class);
        $this->artisan('migrate'); // ensure email_templates + defaults are present
        $admin = User::create(['name' => 'A', 'email' => 'a@r.app', 'password' => Hash::make('password'), 'tenant_id' => null]);
        $admin->assignRole('super_admin');

        return $admin;
    }

    public function test_admin_lists_and_updates_templates_and_preview_substitutes_variables(): void
    {
        Sanctum::actingAs($this->admin());

        $this->getJson('/api/v1/admin/email-templates')
            ->assertOk()
            ->assertJsonPath('data.0.variables', fn ($v) => is_array($v));

        $this->putJson('/api/v1/admin/email-templates/driver_invite', [
            'subject' => 'Join {{company_name}}',
            'body_html' => '<p>Hi {{driver_name}}, <a href="{{invite_link}}" class="btn">accept</a></p>',
            'accent_color' => '#ff0000',
            'footer_text' => 'Reidey',
        ])->assertOk()->assertJsonPath('data.subject', 'Join {{company_name}}');

        // Preview fills sample variables and applies the accent colour.
        $res = $this->postJson('/api/v1/admin/email-templates/driver_invite/preview', [])->assertOk();
        $html = $res->json('data.html');
        $this->assertStringContainsString('YA Mobility', $res->json('data.subject'));
        $this->assertStringContainsString('#ff0000', $html);
        $this->assertStringNotContainsString('{{driver_name}}', $html);
    }

    public function test_manager_cannot_reach_templates(): void
    {
        $this->seed(RolePermissionSeeder::class);
        $m = User::create(['name' => 'M', 'email' => 'm@a.de', 'password' => Hash::make('password'), 'tenant_id' => 1]);
        $m->assignRole('fleet_manager');
        Sanctum::actingAs($m);
        $this->getJson('/api/v1/admin/email-templates')->assertForbidden();
    }
}
