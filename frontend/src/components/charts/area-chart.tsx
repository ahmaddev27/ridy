"use client";

import { useRef, useState } from "react";

type Point = { label: string; value: number };

/**
 * Single-series area chart in plain SVG — thin 2px line, soft gradient fill,
 * recessive grid, and a hover crosshair + tooltip. One series, so no legend
 * (the caller's title names it). Responsive via a fixed viewBox scaled to 100%.
 */
export function AreaChart({ data, height = 180, color = "#4f46e5" }: { data: Point[]; height?: number; color?: string }) {
  const W = 720;
  const H = height;
  const padX = 8;
  const padTop = 12;
  const padBottom = 22;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...data.map((d) => d.value));
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const x = (i: number) => padX + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => padTop + innerH - (v / max) * innerH;

  // A single data point can't form a line (an "M" with no "L" draws nothing), so
  // the chart would look empty with only one month of data. Draw a flat line at
  // that value across the full width instead, with the area filled beneath it.
  const single = data.length === 1;
  const yFirst = y(data[0]?.value ?? 0).toFixed(1);
  const baseline = (padTop + innerH).toFixed(1);
  const line = single
    ? `M${padX.toFixed(1)},${yFirst} L${(W - padX).toFixed(1)},${yFirst}`
    : data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = single
    ? `${line} L${(W - padX).toFixed(1)},${baseline} L${padX.toFixed(1)},${baseline} Z`
    : `${line} L${x(data.length - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - padX) / innerW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  return (
    <div className="relative w-full">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive gridlines */}
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={padX} x2={W - padX} y1={padTop + innerH * t} y2={padTop + innerH * t} stroke="#f1f5f9" strokeWidth="1" />
        ))}

        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={padTop} y2={padTop + innerH} stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
            <circle cx={x(hover)} cy={y(data[hover].value)} r="4" fill={color} stroke="#fff" strokeWidth="2" />
          </>
        )}

        {/* Sparse x labels: first, middle, last */}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="fill-ink-subtle" fontSize="10">
            {data[i]?.label}
          </text>
        ))}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-primary px-2 py-1 text-xs text-primary-ink shadow-lg"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(data[hover].value) / H) * 100}%` }}
        >
          <span className="font-semibold">{data[hover].value}</span> · {data[hover].label}
        </div>
      )}
    </div>
  );
}
