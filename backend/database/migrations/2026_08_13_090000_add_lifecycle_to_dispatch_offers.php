<?php

use App\Domain\Fleet\DriverStatsService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Give each offer an explicit lifecycle status + a numeric fare and the
 * per-stage timestamps, so the offers page can show precise states and earnings
 * are summed from completed trips only. Backfills existing rows from the single
 * `accepted_at` signal we had before (documented best-effort mapping).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->string('status', 12)->default('pending')->index()->after('accepted_at');
            $table->decimal('fare_amount', 10, 2)->nullable()->after('fare_formatted');
            $table->timestamp('started_at')->nullable()->after('accepted_at');
            $table->timestamp('completed_at')->nullable()->after('started_at');
            $table->timestamp('rejected_at')->nullable()->after('completed_at');
            $table->timestamp('canceled_at')->nullable()->after('rejected_at');
        });

        // Backfill a numeric fare for every row from the formatted string.
        DB::table('dispatch_offers')->orderBy('id')->select('id', 'fare_formatted')
            ->chunk(500, function ($rows) {
                foreach ($rows as $row) {
                    DB::table('dispatch_offers')->where('id', $row->id)->update([
                        'fare_amount' => DriverStatsService::parseFare($row->fare_formatted) ?: null,
                    ]);
                }
            });

        // Accepted offers had no completion signal historically → treat them as
        // completed (keeps earnings continuous with the old behavior).
        DB::table('dispatch_offers')->whereNotNull('accepted_at')->update([
            'status' => 'completed',
            'completed_at' => DB::raw('accepted_at'),
        ]);

        // Un-accepted offers whose accept window has long passed → rejected.
        // Recent still-open ones stay pending.
        $cutoff = now()->subMinutes(15);
        DB::table('dispatch_offers')
            ->whereNull('accepted_at')
            ->where('received_at', '<', $cutoff)
            ->update(['status' => 'rejected', 'rejected_at' => DB::raw('received_at')]);
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropColumn(['status', 'fare_amount', 'started_at', 'completed_at', 'rejected_at', 'canceled_at']);
        });
    }
};
