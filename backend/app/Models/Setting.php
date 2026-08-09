<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A single platform setting (key → value). Values are encrypted at rest because
 * they may hold credentials (SMTP password, proxy userinfo).
 */
class Setting extends Model
{
    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['key', 'value'];

    protected $casts = ['value' => 'encrypted'];
}
