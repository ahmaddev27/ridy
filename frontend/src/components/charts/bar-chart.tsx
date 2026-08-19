"use client";

import { useState } from "react";

type Point = { label: string; value: number };

/**
 * Single-series vertical bar chart in plain SVG — one bar per data point, which
 * reads honestly for daily counts (unlike an area line that looks flat then
 * spikes). The tallest bar is emphasised; hover shows the exact value. First,
 * middle and last labels are shown to avoid clutter.
 */
export function BarChart({ data, height = 180, color = "#4f46e5" }: { data: Point[]; height?: number; color?: string }) {
  const W = 720;
  const H = height;
  const padX = 10;
  const padTop = 14;
  const padBottom = 22;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const slot = innerW / n;
  const barW = Math.max(3, Math.min(slot * 0.62, 34));
  const peak = data.reduce((mi, d, i) => (d.value > data[mi].value ? i : mi), 0);

  const labelIdx = new Set([0, Math.floor((n - 1) / 2), n - 1]);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img">
        {[0.5, 1].map((t) => (
          <line key={t} x1={padX} x2={W - padX} y1={padTop + innerH * (1 - t)} y2={padTop + innerH * (1 - t)} stroke="currentColor" className="text-line" strokeWidth="1" />
        ))}
        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const x = padX + slot * i + (slot - barW) / 2;
          const y = padTop + innerH - h;
          const on = hover === i || (hover === null && i === peak);
          return (
            <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              {/* invisible full-height hit area for easier hover */}
              <rect x={padX + slot * i} y={padTop} width={slot} height={innerH} fill="transparent" />
              <rect x={x} y={y} width={barW} height={Math.max(1, h)} rx={3} fill={on ? color : "currentColor"} className={on ? "" : "text-line"} opacity={on ? 1 : 0.9} />
            </g>
          );
        })}
        {data.map((d, i) =>
          labelIdx.has(i) ? (
            <text key={i} x={padX + slot * i + slot / 2} y={H - 6} textAnchor="middle" className="fill-ink-subtle" fontSize="11">
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-xs font-medium text-surface shadow"
          style={{ left: `${((padX + slot * hover + slot / 2) / W) * 100}%`, top: 0 }}
        >
          {data[hover].label} · {data[hover].value}
        </div>
      )}
    </div>
  );
}
