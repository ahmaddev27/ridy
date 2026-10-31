# 26 - Receipt vision fallback (self-hosted)

**Status:** built 31.10.2026, off until `RECEIPT_VISION_URL` is set and the `vision` compose profile runs.

## Why

ML Kit on the phone misreads rotated, faded and dark thermal fuel receipts. A small
vision model (Qwen2.5-VL-3B via llama.cpp) read the failing Shell and star receipts
with every field correct (`receipt-vision/README.md`). It is a **fallback for the
low-confidence tail**; ML Kit stays the instant first pass and a clean receipt never
leaves the phone.

## Decisions (owner)

- Automatic: no consent prompt. The privacy policy (Datenschutz, Ziffer 3 Fahrerdaten) and the
  in-app hint say so.
- Our server only, no third party. The image is deleted the moment it has been parsed.
- Observation only; this adds no write to Uber and no new data collection beyond the receipt
  the driver chose to photograph.

## Flow

```
phone: ML Kit + parser -> evaluateScan()
  ok and no "Unsicher" on date/amount -> done, photo stays on the phone
  otherwise ("low confidence"):
    downscale to 1000px long edge, JPEG q0.8
    POST /api/v1/driver/receipt-vision (multipart `image`)   -> 202 {id}   (throttle 10/min)
backend: ReceiptVisionJobs::begin  parks the bytes in storage/app/receipt-vision-tmp/{id}.bin,
         cache["receipt-vision:{driver}:{id}"] = pending (15 min TTL), dispatches ProcessReceiptVision
queue (default queue, 1 try, timeout 270s):
         ReceiptVision::read -> GD downscale (<=1000px) -> POST llama.cpp /v1/chat/completions
         -> ReceiptVisionSanitizer -> cache = done{fields} | failed ; image deleted in `finally`
phone: GET /api/v1/driver/receipt-vision/{id} every 3 s (give up after 150 s)
         done   -> mergeVision() over the ML Kit values, gate re-evaluated
         failed / 503 / timeout / offline -> ML Kit result stands (retake gate as before)
```

The step cannot advance while the second pass runs (`scanning` stays true, label
"reading more closely"); the driver can remove the photo at any time, which cancels the
poll. A job id is bound to the driver in the cache key, so nobody can poll another's.

## The model call (fixes for the two validation bugs)

- `response_format: {"type":"json_object"}`, `temperature: 0`, `max_tokens: 512` - one JSON
  object, then stop (no runaway `net_amount_24h_24h...`).
- Prompt demands bare decimals (no currency, unit or label) and asks for the gross total.
- `ReceiptVisionSanitizer` still strips what slips through: first decimal token of a string
  ("2.279 EUR/1" -> 2.279, "42.02 ... BRUTTO" -> 42.02, "1.234,56" -> 1234.56), range bands,
  date within the last 400 days and not future, `HH:MM`, and:
  - **litres x price/l must equal the total** (tolerance max(0.15, 1.5%)); if not, both fuel
    figures are dropped (`warnings: ["fuel_math"]`) rather than guessed;
  - **PLZ -> city** via `PostalCodes` wins over the model's city.

## Merge on the phone

A vision value (already sanitised) replaces the ML Kit one. If the two readers disagree on the
date or amount, the existing confirm-by-tap ("Unsicher") is kept. The submitted `ocr_meta`
marks vision-supplied fields `source: "vision"` and the parser as `... + vision`.

## Ops

- `docker compose -f docker-compose.prod.yml --profile vision up -d receipt-vision`
- Root `.env` / GitHub secret: `RECEIPT_VISION_URL=http://receipt-vision:8080`
  (`deploy.yml` rewrites `.env` from secrets - add it there too), then `config:clear`.
- Resource cap: `cpus: 4`, `mem_limit: 8g`, `--parallel 1`. Inference is ~30-90 s on CPU.
- The queue worker runs `--queue=push,mail,default`; the job uses `default`. A 270 s inference
  holds that worker, so a single worker serialises vision reads (acceptable: low tail volume).
  `DB_QUEUE_RETRY_AFTER` is 90 s: a re-released copy is neutralised by a claim lock
  (`ReceiptVisionJobs::claim`) so inference never runs twice.
- Orphaned temp files (worker down) are swept after 30 minutes on the next upload.
- Env: `RECEIPT_VISION_TIMEOUT` (240), `RECEIPT_VISION_MAX_EDGE` (1000).

## Needs the real model to verify

Prompt/key naming against Qwen's actual output, whether `response_format: json_object` is
honoured by this llama.cpp build (else add a GBNF grammar), real latency at 1000 px, and the
accuracy on the Shell/star/Esso samples through the full app path.
