<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A platform email template (one row per key). `body_html` is sanitized
 * rich-text with {{variables}} substituted at render time.
 */
class EmailTemplate extends Model
{
    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['key', 'subject', 'body_html', 'logo_url', 'accent_color', 'footer_text'];

    /** The variables offered to the admin for each template key. */
    public const VARIABLES = [
        'company_registration' => ['company_name', 'manager_name', 'login_url'],
        'driver_invite' => ['company_name', 'driver_name', 'invite_link'],
        'company_otp' => ['name', 'otp'],
        'password_otp' => ['name', 'otp'],
        'notification' => ['title', 'body', 'action_url', 'action_label'],
        'subscription_expiring' => ['title', 'body', 'action_url', 'action_label'],
        'subscription_expired' => ['title', 'body', 'action_url', 'action_label'],
        'subscription_activated' => ['title', 'body', 'action_url', 'action_label'],
        'subscription_free' => ['title', 'body', 'action_url', 'action_label'],
        'session_needs_relink' => ['title', 'body', 'action_url', 'action_label'],
        'company_banned' => ['title', 'body', 'action_url', 'action_label'],
        'company_registered' => ['title', 'body', 'action_url', 'action_label'],
        'proxy_expiring' => ['title', 'body', 'action_url', 'action_label'],
        'code_activated' => ['title', 'body', 'action_url', 'action_label'],
    ];
}
