<?php

namespace App\Console\Commands;

use App\Domain\Dispatch\Inbound\InboundMailHandler;
use Illuminate\Console\Command;
use Throwable;

/**
 * Postfix pipe entry point for the automatic Uber code (docs/27, variant B):
 *   in.reidey.de transport -> `php artisan inbound-mail:ingest --rcpt=${original_recipient}`
 * Reads ONE raw RFC 5322 message from STDIN, hands it to InboundMailHandler and exits.
 *
 * Exit 0 for everything that is not the MTA's problem - an unwanted or dropped message
 * must not bounce (no backscatter). Only an infrastructure failure exits 75 (EX_TEMPFAIL)
 * so Postfix retries. Nothing from the message is printed or logged.
 */
class IngestInboundMail extends Command
{
    protected $signature = 'inbound-mail:ingest {--rcpt= : the recipient the MTA accepted the message for}';

    protected $description = 'Ingest a forwarded Uber code email from STDIN (Postfix pipe)';

    /** Far above any real code email; a larger message is junk. */
    private const MAX_BYTES = 262144;

    private const EX_TEMPFAIL = 75;

    public function handle(InboundMailHandler $handler): int
    {
        // Ops requirement (Postfix): accept only recipients matching uber-[a-z0-9]{26}@in.reidey.de
        // (smtpd_recipient_restrictions) so junk never reaches this command at all.
        // Malformed content is dropped by the handler (it never throws on a bad message); only
        // a genuine infrastructure failure (cache / database down) may exit 75 and be retried.
        $raw = $this->readInput();
        if ($raw === '' || strlen($raw) > self::MAX_BYTES) {
            return self::SUCCESS;
        }
        $rcpt = trim((string) $this->option('rcpt'));

        try {
            $handler->handle($raw, $rcpt === '' ? null : $rcpt);
        } catch (Throwable $e) {
            // Class only: the message text could echo the email.
            report(new \RuntimeException('inbound-mail ingest failed: '.$e::class));

            return self::EX_TEMPFAIL;
        }

        return self::SUCCESS;
    }

    /** One message from STDIN, read no further than the size cap (+1 to detect an oversize one). */
    protected function readInput(): string
    {
        $raw = stream_get_contents(STDIN, self::MAX_BYTES + 1);

        return $raw === false ? '' : $raw;
    }
}
