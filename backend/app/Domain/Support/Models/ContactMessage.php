<?php

namespace App\Domain\Support\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A contact-form submission from the public landing page. Read-only for the
 * admin inbox apart from a read/unread flag.
 */
class ContactMessage extends Model
{
    protected $fillable = [
        'name',
        'email',
        'phone',
        'message',
        'ip',
        'read_at',
    ];

    protected $casts = [
        'read_at' => 'datetime',
    ];
}
