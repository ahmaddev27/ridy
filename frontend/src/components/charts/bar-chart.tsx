"use client";

import { Bar, BarChart as RBarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "./chart-tooltip";

type Point = { label: string; value: number };

/**
 * Single-series vertical bar chart (Recharts) — honest for daily counts. The
 * tallest bar is emphasised; the rest use a recessive fill. Rounded tops,
 * recessive grid, theme-aware axes/tooltip, per-bar hover.
 */
export function BarChart({
  data,
  height = 200,
  color = "var(--color-primary)",
  valueFormat,
}: {
  data: Point[];
  height?: number;
  color?: string;
  valueFormat?: (v: number) => string;
}) {
  const peak = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tick={{ fill: "var(--ink-subtle)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={20} />
        <YAxis tick={{ fill: "var(--ink-subtle)", fontSize: 11 }} axisLine={false} tickLine={false} width={38} allowDecimals={false} />
        <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip valueFormat={valueFormat} />} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((_, i) => (
            <Cell key={i} fill={i === peak ? color : "var(--line-strong)"} />
          ))}
        </Bar>
      </RBarChart>
    </ResponsiveContainer>
  );
}
