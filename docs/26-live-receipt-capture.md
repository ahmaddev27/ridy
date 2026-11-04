# docs/26 — Live guided receipt capture (driver app)

Status: **IN PROGRESS** (2026-11-04) - Phases 0 and 1 implemented on branch feat/receipt-live-capture (Option B, expo-camera); Phase 2 (polish, glare probe, device test, new build) open. Owner asked for a live, smart receipt read: open the camera,
show a "read %" meter, and guide the driver ("move up / down / closer / hold steady") until the
receipt is captured well — then auto-capture.

## Today (reuse, don't duplicate)
`driver-app/app/submission/receipt.tsx`: the driver taps → `expo-image-picker` takes ONE photo →
`@react-native-ml-kit/text-recognition` runs **on-device** OCR on that static image →
`src/lib/receipt-text-parse.ts` (`parseReceiptText`) extracts fields (station, date, time, total,
liters, €/l…) → read-only confirm screen. Low confidence → `src/lib/receipt-vision.ts` (server
Qwen-VL fallback). `src/lib/ocr-image.ts` sizes the image for OCR. **All of this is reused** — the
live layer only replaces the "take one blind photo" step with a guided, auto-capturing one.

## Goal
A live-scan screen: camera preview + an overlay that, in real time, shows a **coverage %** and a
**one-line guidance hint**, and **auto-captures** the full-res frame once the read is good and
stable. Fully on-device (DSGVO "detect, don't surveil" — no frame leaves the phone; only the final
chosen photo enters the existing upload flow, exactly as today).

## Camera approach — two options
- **A. `react-native-vision-camera` v4 + a frame processor running ML Kit text (recommended for the "smart live" feel).** True per-frame OCR (throttled ~3–5 fps) in a worklet; smooth. Native module → Expo config plugin → **new dev-client + store build** (not Expo Go, not OTA).
- **B. `expo-camera` + periodic `takePictureAsync` (~400 ms, low-res) → existing ML Kit `recognize`.** Lighter (no vision-camera), reuses the current OCR call on snapshots; a bit less smooth. Still a **new build** (expo-camera is native) but a smaller dependency surface and simplest to ship first.

Recommendation: ship **B first** (fast, proves the UX, reuses the OCR path 1:1), then upgrade to **A** if we want buttery per-frame processing.

## The live logic (shared by A/B)
Per processed frame/snapshot:
1. OCR → `parseReceiptText` → which key fields are present (station, date, total, liters).
2. **Coverage %** = weighted count of key fields found (e.g. total 40%, date 20%, station 20%, liters 20%) × a stability factor. Show 0–100 on a ring/bar.
3. **Guidance hint** from cheap signals: text bounding-box position (too high → "move down", too low → "move up"), text area / density (too small → "closer"), low OCR confidence or few lines → "hold steady / clean the lens", glare (bright regions) → "avoid glare".
4. **Auto-capture** when coverage ≥ threshold (≈90%) AND stable for N consecutive frames → grab the full-res photo → hand to the **existing** parse + confirm flow (+ the server-vision fallback for anything weak).
5. Manual shutter always available as a fallback.

## UX
New `app/submission/receipt-live.tsx` (or a mode on the existing screen): full-screen preview, a top
coverage meter, a center/bottom guidance chip (de/en/ar, RTL-aware, Latin digits), an auto-capture
flash, then the existing read-only confirm/edit screen. Entry point: the "Beleg scannen" button.

## Release / constraints
- Native dep → **store build required** (manual GH Actions `workflow_dispatch`; runtimeVersion=fingerprint changes → the OTA won't reach old builds; see the release model).
- Performance: throttle OCR (A: frame-processor fps cap; B: snapshot interval), downscale frames, debounce guidance so it doesn't flicker.
- Permissions: camera (already requested for image-picker; add the vision-camera/expo-camera permission).
- i18n: new strings for the meter + hints in de/en/ar.
- Tests: unit-test the coverage-% and guidance-decision functions (pure TS) like `receipt-text-parse.test.mjs`.

## Phases
0. [x] Add the camera lib (B: `expo-camera`) + a bare live-scan screen that logs OCR + shows a raw %.
1. [x] Coverage-% + guidance heuristics + auto-capture; wire to the existing parse/confirm/fallback.
2. [ ] Polish (stability, glare, i18n, a11y) + a new build + device test.
