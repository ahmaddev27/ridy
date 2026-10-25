<?php

namespace App\Http\Controllers\Api\V1\Driver;

use App\Domain\Fleet\Models\ElProfessorSubmission;
use App\Domain\Fleet\SubmissionDetailPresenter;
use App\Domain\Fleet\SubmissionDocumentStreamer;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * What every driver of the owner's company has sent, READ-ONLY.
 *
 * An owner never submits (a submission goes UP, and an owner has no company
 * above them), so this surface has no write path and must not gain one.
 *
 * ## The tenant is a term in the query
 *
 * Every read goes through `tenantSubmissions()`, so another company's
 * submission and an unknown uuid are the same missing row: one 404 by
 * construction, saying nothing about which uuids exist.
 *
 * ## Bounded
 *
 * A fleet's history is many drivers' worth, so the list is paged at 50 rows
 * (`simplePaginate`, newest first) and the app asks for the next page; it is
 * never the whole table.
 */
class FleetSubmissionController extends Controller
{
    private const PER_PAGE = 50;

    public function index(Request $request, SubmissionDetailPresenter $presenter): JsonResponse
    {
        $page = $this->tenantSubmissions($request)
            ->with('driver:id,name')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->simplePaginate(self::PER_PAGE);

        return response()->json([
            'data' => $page->getCollection()
                ->map(fn (ElProfessorSubmission $r) => $presenter->row($r) + ['driver' => $this->sender($r)])
                ->values(),
            'meta' => ['has_more' => $page->hasMorePages(), 'page' => $page->currentPage()],
        ]);
    }

    public function show(Request $request, SubmissionDetailPresenter $presenter, string $uuid): JsonResponse
    {
        $row = $this->tenantSubmissions($request)->with('driver:id,name')->where('uuid', $uuid)->first();

        return $row === null
            ? response()->json(['message' => 'Submission not found.'], 404)
            : response()->json(['data' => $presenter->present($row) + ['driver' => $this->sender($row)]]);
    }

    public function document(Request $request, SubmissionDocumentStreamer $streamer, string $uuid): StreamedResponse|JsonResponse
    {
        return $streamer->stream($this->tenantSubmissions($request)->where('uuid', $uuid)->first());
    }

    /** @return array{id: int, name: string}|null */
    private function sender(ElProfessorSubmission $row): ?array
    {
        return $row->driver ? ['id' => $row->driver->id, 'name' => $row->driver->name] : null;
    }

    /** @return Builder<ElProfessorSubmission> */
    private function tenantSubmissions(Request $request): Builder
    {
        $user = $request->user();
        abort_unless($user instanceof User && $user->tenant_id !== null, 403, 'fleet_owner_only');

        return ElProfessorSubmission::query()
            ->withoutGlobalScopes()
            ->where('tenant_id', $user->tenant_id);
    }
}
