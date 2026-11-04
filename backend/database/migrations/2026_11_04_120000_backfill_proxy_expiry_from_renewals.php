<?php

use App\Domain\Tenancy\Models\Proxy;
use Illuminate\Database\Migrations\Migration;

/** One-off: renewals used to leave proxies.expires_at at the first period's end. */
return new class extends Migration
{
    public function up(): void
    {
        Proxy::whereHas('renewals')->each(fn (Proxy $p) => $p->syncExpiryFromRenewals());
    }

    public function down(): void {}
};
