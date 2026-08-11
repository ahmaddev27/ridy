<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A pending company self-registration awaiting OTP verification.
 */
class Registration extends Model
{
    protected $fillable = [
        'email', 'company_name', 'name', 'phone', 'password', 'otp', 'otp_expires_at', 'attempts',
    ];

    protected $hidden = ['password', 'otp'];

    protected $casts = [
        'otp_expires_at' => 'datetime',
        'attempts' => 'integer',
    ];
}
