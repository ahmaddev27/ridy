<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two columns the dispatch-side decline needs on the offer itself.
 *
 * `status = rejected` now carries TWO meanings: the ordinary "not taken" (an
 * offer superseded by a newer one, or expired once the driver went idle), and a
 * decline we deliberately sent to Uber from the dispatch panel. Adding an enum
 * value instead would ripple through OfferStatus::allowedNext(), isTaken(),
 * expirePending(), the dashboard filters, the app's TERMINAL_STATUSES and i18n in
 * four places — so the distinction lives in a timestamp column instead.
 *
 * `dispatch_rejected_at` is set ONLY when Uber confirmed the decline
 * (isSuccess: true). That matters beyond reporting: OfferLifecycle::takeableGuard()
 * keeps a rejected offer takeable for three minutes so a late real accept can
 * overturn a premature rejection, which would otherwise let an offer we declined
 * silently re-accept itself on the driver's next engagement edge.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->timestamp('dispatch_rejected_at')->nullable()->after('rejected_at');

            // Uber's offer type, needed by the RejectOffers mutation. Absent from
            // every one of 1003 real production payloads (and no alternative field
            // carries it), while Uber's own panel sends "JOB" — so it is a client
            // constant, not a per-offer value. Stored as its own column anyway: it
            // survives raw_payload anonymization, keeps JSON decoding off the hot
            // path, and makes "did we ever see a non-JOB offer?" a one-line query.
            $table->string('offer_type', 32)->nullable()->after('real_offer_uuid');

            $table->index('dispatch_rejected_at');
        });
    }

    public function down(): void
    {
        Schema::table('dispatch_offers', function (Blueprint $table) {
            $table->dropIndex(['dispatch_rejected_at']);
            $table->dropColumn(['dispatch_rejected_at', 'offer_type']);
        });
    }
};
