<?php

namespace Database\Seeders;

use App\Domain\Geo\PostalCodes;
use Illuminate\Database\Seeder;

/**
 * Imports the static German postal-code table from database/data/postal_codes.csv.
 * Idempotent (upsert on the plz primary key). Delegates to {@see PostalCodes::import}
 * so the seeder, the deploy-time data migration, and tests all share one importer.
 */
class PostalCodesSeeder extends Seeder
{
    public function run(): void
    {
        $count = PostalCodes::import();
        $this->command?->info("Imported {$count} postal codes.");
    }
}
