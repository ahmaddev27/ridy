<?php

namespace App\Support;

/**
 * CSV cell hardening against formula injection. Spreadsheet apps (Excel /
 * LibreOffice / Google Sheets) treat a cell that begins with =, +, -, @, a tab
 * or a carriage return as a FORMULA. An externally-sourced value — a rider name
 * or address Uber forwards, a self-registered company name — could therefore run
 * a formula (data exfiltration via HYPERLINK, or a DDE command) on the manager's
 * machine when they open an exported CSV. Prefix such a value with a single quote
 * so the spreadsheet renders it as literal text instead of evaluating it.
 */
class Csv
{
    /** Neutralize a formula-triggering leading character on a string cell; other types pass through. */
    public static function cell(mixed $value): mixed
    {
        return is_string($value) && $value !== '' && preg_match('/^[=+\-@\t\r]/', $value) === 1
            ? "'".$value
            : $value;
    }
}
