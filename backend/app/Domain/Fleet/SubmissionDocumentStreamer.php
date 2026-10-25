<?php

namespace App\Domain\Fleet;

use App\Domain\Fleet\Models\ElProfessorSubmission;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The photo of a submission, STREAMED from the private disk.
 *
 * Never a public or guessable URL: a Beleg is one fleet's business record, so
 * the caller has already scoped the row to its token (driver or tenant) and
 * this only turns that row into bytes. Streamed rather than base64 in JSON
 * because a phone photo is megabytes and base64 adds a third.
 */
class SubmissionDocumentStreamer
{
    public function stream(?ElProfessorSubmission $row): StreamedResponse|JsonResponse
    {
        $disk = Storage::disk(config('elprofessor.disk', 'local'));

        if ($row === null || $row->document_path === null || ! $disk->exists($row->document_path)) {
            return response()->json(['message' => 'Document not found.'], 404);
        }

        return $disk->response($row->document_path, null, [
            'Content-Type' => $row->document_mime ?: 'application/octet-stream',
            'Content-Disposition' => 'inline',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
