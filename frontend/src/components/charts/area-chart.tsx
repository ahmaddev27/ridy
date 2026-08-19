"use client";

import { useId } from "react";
import { Area, AreaChart as RAreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./chart-tooltip";

type Point = { label: string; value: number };

/**
 * Single-series area chart (Recharts): a 2px line over a soft gradient, a
 * recessive horizontal grid, theme-aware axes/tooltip via CSS tokens, and a
 * hover crosshair. One series → the caller's title names it, no legend.
 */
export function AreaChart({
  data,
  height = 200,
  color = "#6366f1",
  valueFormat,
}: {
  data: Point[];
  height?: number;
  color?: string;
  valueFormat?: (v: number) => string;
}) {
  const gid = useId().replace(/:/g, "");

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RAreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tick={{ fill: "var(--ink-subtle)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
        <YAxis tick={{ fill: "var(--ink-subtle)", fontSize: 11 }} axisLine={false} tickLine={false} width={38} allowDecimals={false} />
        <Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }} content={<ChartTooltip valueFormat={valueFormat} />} />
        {/* A single point can't draw a line, so show a dot for that lone value. */}
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} strokeLinecap="round" fill={`url(#${gid})`} dot={data.length === 1 ? { r: 4, fill: color, strokeWidth: 0 } : false} activeDot={{ r: 4, strokeWidth: 0 }} />
      </RAreaChart>
    </ResponsiveContainer>
  );
}
