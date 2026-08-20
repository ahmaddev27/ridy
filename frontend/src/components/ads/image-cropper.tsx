"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";

/** Longest edge of the exported image; keeps uploads small without visible loss. */
const OUTPUT_WIDTH = 1200;
const MAX_ZOOM = 3;

/**
 * A dependency-free image cropper: the picked file is shown inside a fixed-aspect
 * viewport the user can drag to pan and zoom (slider or wheel). Confirming draws
 * the visible region to a canvas and returns a compressed WebP blob — no server
 * round-trip until the crop is accepted.
 */
export function ImageCropper({
  file,
  aspect = 16 / 9,
  onCancel,
  onCropped,
}: {
  file: File;
  aspect?: number;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.ads.${k}`);

  const [src, setSrc] = useState("");
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const natural = useRef({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0); // re-render once the container has a measured width

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const containerSize = () => {
    const w = containerRef.current?.clientWidth ?? 0;
    return { w, h: w / aspect };
  };

  // Scale at which the image exactly covers the viewport (cover fit) at zoom 1.
  const baseScale = () => {
    const { w, h } = containerSize();
    const n = natural.current;
    if (!n.w || !n.h || !w) return 1;
    return Math.max(w / n.w, h / n.h);
  };

  // Keep the image covering the viewport — no empty gutters when panning.
  const clamp = useCallback(
    (o: { x: number; y: number }, z: number) => {
      const { w, h } = containerSize();
      const eff = baseScale() * z;
      const maxX = Math.max(0, (natural.current.w * eff - w) / 2);
      const maxY = Math.max(0, (natural.current.h * eff - h) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, o.x)),
        y: Math.min(maxY, Math.max(-maxY, o.y)),
      };
    },
    [aspect], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    natural.current = { w: img.naturalWidth, h: img.naturalHeight };
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    force((n) => n + 1);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setOffset(
      clamp(
        { x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) },
        zoom,
      ),
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const applyZoom = (z: number) => {
    const nz = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(nz);
    setOffset((o) => clamp(o, nz));
  };

  async function confirm() {
    const img = imgRef.current;
    if (!img) return;
    setBusy(true);
    try {
      const { w, h } = containerSize();
      const eff = baseScale() * zoom;
      // Map the viewport's top-left back into the source image's pixel space.
      const imgLeft = w / 2 + offset.x - (natural.current.w * eff) / 2;
      const imgTop = h / 2 + offset.y - (natural.current.h * eff) / 2;
      const sx = -imgLeft / eff;
      const sy = -imgTop / eff;
      const sW = w / eff;
      const sH = h / eff;

      const outW = OUTPUT_WIDTH;
      const outH = Math.round(OUTPUT_WIDTH / aspect);
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sW, sH, 0, 0, outW, outH);

      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("crop failed"))), "image/webp", 0.9),
      );
      onCropped(blob);
    } finally {
      setBusy(false);
    }
  }

  const eff = baseScale() * zoom;
  const dispW = natural.current.w * eff;
  const dispH = natural.current.h * eff;

  return (
    <Modal
      open
      onClose={onCancel}
      title={c("cropTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {c("cancel")}
          </Button>
          <Button onClick={confirm} disabled={busy || !dispW}>
            {c("cropApply")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          ref={containerRef}
          className="relative w-full touch-none select-none overflow-hidden rounded-lg bg-surface-2"
          style={{ aspectRatio: String(aspect), cursor: drag.current ? "grabbing" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={(e) => applyZoom(zoom - e.deltaY * 0.001)}
        >
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={onImgLoad}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{
                width: dispW ? `${dispW}px` : "auto",
                height: dispH ? `${dispH}px` : "auto",
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <ZoomIn className="h-4 w-4 shrink-0 text-ink-muted" />
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer accent-ink"
          />
        </div>
        <p className="text-xs text-ink-subtle">{c("cropHint")}</p>
      </div>
    </Modal>
  );
}
