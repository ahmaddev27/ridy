<?php

namespace App\Console\Commands;

use App\Domain\Audit\AuditLogger;
use App\Domain\Privacy\DataRetentionService;
use App\Domain\Privacy\RetentionPolicy;
use Illuminate\Console\Command;

/**
 * Applies the platform's data-retention periods (DSGVO storage limitation).
 *
 * Every period is a platform setting that is EMPTY by default — with nothing
 * configured this command changes nothing. Offers are anonymized (personal data
 * stripped, trip figures kept), not deleted. Use --dry-run to see what a period
 * would affect before enabling it.
 */
class ApplyDataRetention extends Command
{
    protected $signature = 'data:retention {--dry-run : Only count what would be anonymized/deleted}';

    protected $description = 'Anonymize/delete personal data past the configured retention periods (off by default).';

    public function handle(DataRetentionService $retention, RetentionPolicy $policy, AuditLogger $audit): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $result = $retention->run($dryRun);

        $rows = [];
        foreach ($result as $what => $count) {
            $rows[] = [$what, $count === null ? 'disabled' : (string) $count];
        }
        $this->table(['policy', $dryRun ? 'would affect' : 'affected'], $rows);

        $enabled = array_filter($result, fn ($v) => $v !== null);
        if (! $dryRun && $enabled !== []) {
            $audit->logPlatform('data.retention_applied', null, [
                'results' => $enabled,
                'periods' => array_filter(array_combine(RetentionPolicy::KEYS, array_map($policy->period(...), RetentionPolicy::KEYS))),
            ]);
        }

        return self::SUCCESS;
    }
}
