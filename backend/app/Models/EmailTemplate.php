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
    ];
}
