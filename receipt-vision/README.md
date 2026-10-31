# receipt-vision — validation harness

A self-hosted vision model that reads German fuel receipts the on-device ML Kit
OCR misreads (rotated / faded / dark-background thermal prints). This folder is
**only the validation gate**: prove the small model reads real failing receipts
on the prod box before we wire it into the backend + driver app.

- **Model:** `ggml-org/Qwen2.5-VL-3B-Instruct-GGUF` (Q4_K_M ≈ 2.2 GB + f16 mmproj).
- **Runtime:** `llama.cpp` server (OpenAI-compatible API), CPU-only, mem/cpu capped
  so it can NEVER starve the offer-stream Chromium sessions (the core product).
- **Privacy:** the image goes phone → our server → model → deleted. No third party.

## 1. Start the model (on the VPS)

Easy path — `-hf` auto-downloads the model AND its mmproj into a cache volume:

```bash
docker run -d --name receipt-vision --restart unless-stopped \
  --cpus 2 -m 6g \
  -p 127.0.0.1:8099:8080 \
  -v receipt_vision_cache:/root/.cache/llama.cpp \
  ghcr.io/ggml-org/llama.cpp:server \
  -hf ggml-org/Qwen2.5-VL-3B-Instruct-GGUF:Q4_K_M \
  -c 4096 -t 2 --no-warmup
```

First boot downloads ~2.5 GB (watch `docker logs -f receipt-vision` until
"server is listening"). If `-hf` does not fetch the mmproj on this llama.cpp
build, download both files manually and mount them instead:

```bash
mkdir -p /opt/receipt-vision/models && cd /opt/receipt-vision/models
wget https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf
wget https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf
# then run the server with:  -v /opt/receipt-vision/models:/models \
#   -m /models/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf \
#   --mmproj /models/mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf
```

## 2. Test it on the real failing receipts

Copy the sample receipts to the VPS, then:

```bash
./extract.sh shell.jpg
./extract.sh esso.jpg
./extract.sh star.jpg
```

Each prints the fields as JSON. Compare against the ground truth below. If the
numbers match (within OCR-free accuracy), the model is good → we build the
pipeline. If it misreads, we size up to MiniCPM-V 2.6 (RAM allows).

### Ground truth (read by a large vision model, arithmetic-checked)

| field | shell | esso | star |
|---|---|---|---|
| station | Shell (Göller), Düsseldorf | Esso (ROC), Solingen | star (Bahar Basel), Solingen |
| date | 2026-09-28 16:47 | 2026-10-30 10:12 | 2026-10-17 ~03:15 |
| fuel | Super FuelSave E10 | Super E10 | Super E10 |
| liters | 21.94 | 16.91 | 25.87 |
| €/L | 2.279 | 2.129 | 2.049 |
| total € | 50.00 | 36.00 | 53.01 |
| net / VAT(19%) | 42.02 / 7.98 | 30.25 / 5.75 | 44.55 / 8.46 |

## Teardown

```bash
docker rm -f receipt-vision   # the cache volume `receipt_vision_cache` persists
```
