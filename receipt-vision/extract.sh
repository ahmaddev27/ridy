#!/usr/bin/env bash
# Send one receipt image to the local llama.cpp vision server and print the
# extracted fields as JSON. Usage: ./extract.sh <image-path>
#
# This is the SAME request shape the backend will make once the model is proven:
# an OpenAI-compatible /v1/chat/completions call with the image inline and a
# strict field-extraction prompt. Keep the prompt here and in the backend in sync.
set -euo pipefail

IMG="${1:?usage: extract.sh <image-path>}"
ENDPOINT="${VISION_ENDPOINT:-http://127.0.0.1:8099/v1/chat/completions}"

# Guess the mime from the extension (jpg/png are all the app ever uploads).
case "${IMG##*.}" in
  png) MIME="image/png" ;;
  *)   MIME="image/jpeg" ;;
esac

B64="$(base64 -w0 "$IMG")"

read -r -d '' PROMPT <<'EOF' || true
You read German fuel-station receipts. Return ONLY a JSON object, no prose, no
markdown fence, with exactly these keys (use null when a field is truly absent):
  station_name, street, postal_code, city, date, time, fuel_type,
  liters, price_per_liter, total_amount, currency, vat_rate,
  net_amount, vat_amount, receipt_number, station_number
Rules: date as YYYY-MM-DD, time as HH:MM (24h, the SALE time, not the TSE UTC
timestamp). Numbers as plain decimals with a dot (21.94), no thousands sep, no
unit. Read digits exactly as printed; do not compute or "correct" them.
EOF

jq -n --arg prompt "$PROMPT" --arg uri "data:${MIME};base64,${B64}" '
{
  model: "qwen2.5-vl",
  temperature: 0,
  messages: [{
    role: "user",
    content: [
      { type: "text", text: $prompt },
      { type: "image_url", image_url: { url: $uri } }
    ]
  }]
}' \
| curl -s "$ENDPOINT" -H 'Content-Type: application/json' -d @- \
| jq -r '.choices[0].message.content'
