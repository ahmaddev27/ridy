<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A pending password reset awaiting OTP verification. Consumed (deleted) once the
 * new password is set.
 */
class PasswordReset extends Model
{
    protected $fillable = ['email', 'otp', 'otp_expires_at', 'attempts'];

    protected $hidden = ['otp'];

    protected $casts = [
        'otp_expires_at' => 'datetime',
        'attempts' => 'integer',
    ];
}
