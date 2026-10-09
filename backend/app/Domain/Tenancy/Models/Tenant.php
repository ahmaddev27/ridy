<?php

namespace App\Domain\Tenancy\Models;

use App\Casts\EncryptedWithPlaintextFallback;
use App\Domain\Billing\CompanyReferenceGenerator;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Laravel\Sanctum\PersonalAccessToken;

class Tenant extends Model
{
    protected $fillable = [
        'name', 'payment_reference', 'status', 'country', 'settings', 'uber_org_uuid', 'proxy_url', 'proxy_id',
        'activated_at', 'subscription_ends_at', 'banned_at',
    ];

    protected $casts = [
        // Carries residential-proxy credentials: encrypted at rest like proxies.url
        // (tolerates legacy plaintext rows until the encrypting migration ran).
        'proxy_url' => EncryptedWithPlaintextFallback::class,
        'settings' => 'array',
        'activated_at' => 'datetime',
        'subscription_ends_at' => 'datetime',
        'banned_at' => 'datetime',
        'activation_code_expires_at' => 'datetime',
        'activation_attempts' => 'integer',
        'activation_days' => 'integer',
        'activation_amount' => 'decimal:2',
        'activation_paid' => 'boolean',
    ];

    // Contains proxy credentials + the activation code — never expose in responses.
    protected $hidden = ['proxy_url', 'activation_code'];

    protected static function booted(): void
    {
        // Every company gets its stable payment reference at creation, so it is
        // present in the admin list/detail and ready to quote before first login.
        static::created(fn (Tenant $tenant) => $tenant->ensurePaymentReference());
    }

    public function proxy(): BelongsTo
    {
        return $this->belongsTo(Proxy::class);
    }

    /**
     * The company's stable, customer-facing payment reference (REIDEY-JAB-4821),
     * generated + persisted on first access. Quoted by the company on a bank
     * transfer and to support so a real transfer can be matched to the company.
     */
    public function ensurePaymentReference(): string
    {
        return app(CompanyReferenceGenerator::class)->assign($this);
    }

    /**
     * Auto-relink block: after an operator disconnects/wipes the fleet, the
     * browser extension must NOT silently re-capture the Uber session on the
     * next Uber page load — only an explicit reconnect may restore it. Stored in
     * settings so it needs no migration.
     */
    public function isAutolinkBlocked(): bool
    {
        return (bool) ($this->settings['autolink_blocked'] ?? false);
    }

    public function blockAutolink(): void
    {
        $this->forceFill(['settings' => array_merge($this->settings ?? [], ['autolink_blocked' => true])])->save();
    }

    public function unblockAutolink(): void
    {
        $settings = $this->settings ?? [];
        unset($settings['autolink_blocked']);
        $this->forceFill(['settings' => $settings])->save();
    }

    /**
     * The El-Professor link, as the dashboard card and the driver app both read it.
     * The single derivation: `connected` is true only while a token exists, is not
     * revoked, and El-Professor has actually pulled at least once.
     *
     * @return array{connected: bool, token_issued_at: ?string, first_used_at: ?string, last_used_at: ?string, revoked_at: ?string}
     */
    public function elprofessorConnection(): array
    {
        $state = $this->settings['elprofessor'] ?? [];
        $revokedAt = $state['revoked_at'] ?? null;
        $firstUsedAt = $state['first_used_at'] ?? null;

        return [
            'enabled' => $this->elprofessorEnabled(),
            'connected' => $this->elprofessorEnabled()
                && $revokedAt === null && $firstUsedAt !== null && $this->elprofessorTokens()->exists(),
            'token_issued_at' => $state['token_issued_at'] ?? null,
            'first_used_at' => $firstUsedAt,
            'last_used_at' => $state['last_used_at'] ?? null,
            'revoked_at' => $revokedAt,
        ];
    }

    public function isElprofessorConnected(): bool
    {
        return $this->elprofessorConnection()['connected'];
    }

    /**
     * Whether the PLATFORM has opened the El-Professor integration for this
     * company. The operator decides it per company from the admin companies
     * list; nothing a company does switches it on for itself.
     *
     * **Absent means off.** Every company that existed before this switch
     * therefore starts closed, which is the owner's intent (he opens it one
     * company at a time) and the safe direction: a flag read as "on" by
     * default would quietly expose the integration to every fleet.
     */
    public function elprofessorEnabled(): bool
    {
        return ($this->settings['elprofessor']['enabled'] ?? false) === true;
    }

    /**
     * Open or close the integration for this company.
     *
     * **Closing ENDS the connection, it does not suspend it** (owner's
     * decision, 09.10.2026): the company's `elprofessor` tokens are deleted and
     * the state is stamped revoked, so El-Professor's very next read is a 401
     * and its own card shows the connection as failed. Re-opening gives back
     * the switch and nothing else — the operator must issue a new token and
     * paste it again.
     *
     * The alternative, leaving the token in place so a re-open restores the
     * link untouched, was rejected: a company that was closed deliberately
     * must stop sending its drivers' data the moment it is closed, and a
     * credential that survives a revocation is a credential nobody can account
     * for.
     *
     * @return bool the value now in force
     */
    public function setElprofessorEnabled(bool $enabled): bool
    {
        if ($enabled) {
            $this->mergeElprofessorState(['enabled' => true]);

            return true;
        }

        // Order matters: the tokens go first, so a pull racing this change
        // finds nothing rather than a flag that has not reached it yet.
        $this->elprofessorTokens()->delete();
        $this->mergeElprofessorState([
            'enabled' => false,
            'revoked_at' => now()->toIso8601String(),
        ]);

        return false;
    }

    /** Every `elprofessor` token held by a user of this company. */
    public function elprofessorTokens(): Builder
    {
        return PersonalAccessToken::query()
            ->where('name', 'elprofessor')
            ->where('tokenable_type', (new User)->getMorphClass())
            ->whereIn('tokenable_id', User::query()->where('tenant_id', $this->id)->select('id'));
    }

    /** Merge keys into settings['elprofessor'] without touching other settings. */
    public function mergeElprofessorState(array $changes): void
    {
        $settings = $this->settings ?? [];
        $settings['elprofessor'] = array_merge($settings['elprofessor'] ?? [], $changes);
        $this->forceFill(['settings' => $settings])->save();
    }

    /** Whether the company can log in and operate right now. */
    public function isUsable(): bool
    {
        return $this->stateReason() === null;
    }

    /** SQL mirror of {@see stateReason()} === null (usable companies). */
    public function scopeUsable(Builder $query): Builder
    {
        return $query
            ->where('status', 'active')
            ->whereNull('banned_at')
            // not "inactive" (a fresh signup that was never activated)
            ->where(fn (Builder $q) => $q->whereNotNull('activated_at')->orWhereNotNull('subscription_ends_at'))
            // not expired
            ->where(fn (Builder $q) => $q->whereNull('subscription_ends_at')->orWhere('subscription_ends_at', '>', now()));
    }

    /**
     * Why the company is blocked, or null when usable. Precedence: a manual
     * disable and a ban are terminal; a never-activated company (fresh signup)
     * and an expired subscription are both recoverable by entering an activation
     * code.
     *
     * @return 'disabled'|'banned'|'inactive'|'expired'|null
     */
    public function stateReason(): ?string
    {
        if ($this->status !== 'active') {
            return 'disabled';
        }
        if ($this->banned_at !== null) {
            return 'banned';
        }
        // Never activated (a fresh signup) — must enter an admin code to start.
        if ($this->activated_at === null && $this->subscription_ends_at === null) {
            return 'inactive';
        }
        if ($this->subscription_ends_at !== null && $this->subscription_ends_at->isPast()) {
            return 'expired';
        }

        return null;
    }

    /** Whole days left on the subscription (0 when expired; null when open-ended). */
    public function daysLeft(): ?int
    {
        if ($this->subscription_ends_at === null) {
            return null;
        }

        return max(0, (int) now()->startOfDay()->diffInDays($this->subscription_ends_at->startOfDay(), false));
    }
}
